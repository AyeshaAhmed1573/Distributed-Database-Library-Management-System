
import { Router } from "express";
import { getMongoDb } from "../mongo.js";
import { getPool } from "../db.js";
import { redis } from "../redis.js";
import { requireAuth } from "../middleware/auth.js";
import { randomUUID } from "node:crypto";
import { addTerms } from "../services/bloomFilter.js";
import { bulkIndexBooks, deleteBook as deleteSearchBook } from "../services/esClient.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use((req, res, next) => {
  if (!["admin", "librarian"].includes(req.user.role)) {
    return res.status(403).json({ error: "staff only" });
  }
  next();
});

const AGG = { allowDiskUse: true, maxTimeMS: 60000 };
const clamp = (n, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number(n) || fallback));
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const BRANCH_IDS = [1, 2, 3];

function readBookInput(body) {
  body = body && typeof body === "object" ? body : {};
  const isbn = String(body.isbn || "").trim();
  const title = String(body.title || "").trim();
  const author = String(body.author || "").trim();
  const category = String(body.category || "").trim();
  const publisher = String(body.publisher || "").trim() || null;
  const year = body.published_year === "" || body.published_year == null
    ? null
    : Number(body.published_year);
  const pages = body.page_count === "" || body.page_count == null
    ? null
    : Number(body.page_count);
  const description = String(body.description || "").trim() || null;

  if (!isbn || isbn.length > 20 || !title || !author || !category) {
    return { error: "ISBN (up to 20 characters), title, author and category are required." };
  }
  if (
    (year !== null && (!Number.isInteger(year) || year < 1400 || year > 2100)) ||
    (pages !== null && (!Number.isInteger(pages) || pages <= 0))
  ) {
    return { error: "Published year must be 1400-2100 and page count must be a positive integer." };
  }

  return { book: { isbn, title, author, category, publisher, year, pages, description } };
}

async function syncBookIndex(book) {
  const pool = getPool("coordinator");
  await pool.query(
    `INSERT INTO global_books (isbn, title, author, category, published_year, avg_rating)
     VALUES ($1,$2,$3,$4,$5,0)
     ON CONFLICT (isbn) DO UPDATE SET
       title = EXCLUDED.title, author = EXCLUDED.author, category = EXCLUDED.category,
       published_year = EXCLUDED.published_year, updated_at = now()`,
    [book.isbn, book.title, book.author, book.category, book.year]
  );
}

async function syncBranchAvailability(branchId, isbn) {
  const branch = await getPool(`branch${branchId}_primary`).query(
    `SELECT count(c.copy_id)::int AS total_copies,
            count(c.copy_id) FILTER (WHERE c.status = 'available')::int AS available_copies
     FROM books b LEFT JOIN book_copies c ON c.book_id = b.book_id
     WHERE b.isbn = $1 GROUP BY b.book_id`,
    [isbn]
  );
  const stock = branch.rows[0];
  const coordinator = getPool("coordinator");
  if (!stock) {
    await coordinator.query(
      "DELETE FROM global_book_availability WHERE isbn = $1 AND branch_id = $2",
      [isbn, branchId]
    );
    return;
  }
  await coordinator.query(
    `INSERT INTO global_book_availability (isbn, branch_id, total_copies, available_copies)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (isbn, branch_id) DO UPDATE SET
       total_copies = EXCLUDED.total_copies,
       available_copies = EXCLUDED.available_copies, updated_at = now()`,
    [isbn, branchId, stock.total_copies, stock.available_copies]
  );
}

async function syncSearchDocument(isbn) {
  const { rows } = await getPool("coordinator").query(
    `SELECT g.isbn, g.title, g.author, g.category, g.published_year, g.avg_rating,
            COALESCE(sum(a.available_copies), 0)::int AS available_copies,
            COALESCE(sum(a.total_copies), 0)::int AS total_copies,
            COALESCE(json_object_agg(a.branch_id, json_build_object(
              'available_copies', a.available_copies, 'total_copies', a.total_copies
            )) FILTER (WHERE a.branch_id IS NOT NULL), '{}'::json) AS branches
     FROM global_books g LEFT JOIN global_book_availability a ON a.isbn = g.isbn
     WHERE g.isbn = $1 GROUP BY g.isbn`,
    [isbn]
  );
  if (!rows[0]) throw new Error(`Global catalog entry missing for ${isbn}`);
  const book = rows[0];
  await bulkIndexBooks([{ ...book, avg_rating: Number(book.avg_rating) }]);
}

async function syncBloomTerms(isbn, branchIds) {
  const terms = new Set();
  for (const branchId of branchIds) {
    const { rows } = await getPool(`branch${branchId}_primary`).query(
      "SELECT DISTINCT unnest(tsvector_to_array(search_vector)) AS term FROM books WHERE isbn=$1",
      [isbn]
    );
    for (const row of rows) terms.add(row.term);
  }
  if (terms.size) await addTerms([...terms]);
}

async function searchIndexWarnings(isbn, branchIds, deleted = false) {
  const warnings = [];
  try {
    if (deleted) await deleteSearchBook(isbn);
    else await syncSearchDocument(isbn);
  } catch (err) {
    console.error("admin search index sync:", err.message);
    warnings.push("PostgreSQL was updated, but Elasticsearch could not be synchronized.");
  }
  if (!deleted) {
    try {
      await syncBloomTerms(isbn, branchIds);
    } catch (err) {
      console.error("admin Bloom filter sync:", err.message);
      warnings.push("PostgreSQL was updated, but the search Bloom filter could not be synchronized.");
    }
  }
  return warnings;
}

// Runs fn() at most once per ttl seconds; everyone else reads the saved result.
// fn must return an object.
async function cached(key, ttlSeconds, fn) {
  try {
    const hit = await redis.get(`admin:${key}`);
    if (hit) return { ...JSON.parse(hit), cached: true };
  } catch { /* Redis down: just compute it */ }
  const data = await fn();
  try {
    await redis.set(`admin:${key}`, JSON.stringify(data), "EX", ttlSeconds);
  } catch { /* best-effort */ }
  return data;
}

function fail(res, err) {
  console.error("admin:", err.message);
  res.status(503).json({ error: "dashboard data temporarily unavailable" });
}
// Big tables: ask Postgres for its own row estimate (instant, a few percent off),
// and only fall back to an exact count if no estimate exists yet.
async function tableCount(pool, table) {
  const { rows } = await pool.query(
    "SELECT reltuples::bigint AS n FROM pg_class WHERE oid = $1::regclass", [table]
  );
  if (rows[0] && Number(rows[0].n) > 0) return Number(rows[0].n);
  const exact = await pool.query({
    text: `SELECT count(*)::bigint AS n FROM ${table}`,
    query_timeout: 60000,
  });
  return Number(exact.rows[0].n);
}

// GET /admin/overview: headline numbers
adminRouter.get("/overview", async (req, res) => {
  try {
    res.json(await cached("overview", 60, async () => {
      const db = await getMongoDb();
      const coordinator = getPool("coordinator");
      const [users, books, events, reviews] = await Promise.all([
        tableCount(coordinator, "users"),
        tableCount(coordinator, "global_books"),
        db.collection("activity_logs").estimatedDocumentCount(),
        db.collection("reviews").estimatedDocumentCount(),
      ]);
      return { users, books, events, reviews, generated_at: new Date() };
    }));
  } catch (err) { fail(res, err); }
});

// GET /admin/catalog?q=&page=&limit=: searchable catalog with branch stock.
adminRouter.get("/catalog", async (req, res) => {
  const page = clamp(req.query.page, 1, 1_000_000, 1);
  const limit = clamp(req.query.limit, 1, 50, 20);
  const offset = (page - 1) * limit;
  const q = String(req.query.q || "").trim().slice(0, 100);
  const pattern = `%${q}%`;
  try {
    const pool = getPool("coordinator");
    const [count, books] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total FROM global_books
         WHERE $1 = '' OR isbn ILIKE $2 OR title ILIKE $2 OR author ILIKE $2 OR category ILIKE $2`,
        [q, pattern]
      ),
      pool.query(
        `SELECT g.isbn, g.title, g.author, g.category, g.published_year, g.avg_rating,
                COALESCE(json_agg(json_build_object(
                  'branch_id', a.branch_id, 'total_copies', a.total_copies,
                  'available_copies', a.available_copies
                ) ORDER BY a.branch_id) FILTER (WHERE a.branch_id IS NOT NULL), '[]') AS branches
         FROM global_books g LEFT JOIN global_book_availability a ON a.isbn = g.isbn
         WHERE $1 = '' OR g.isbn ILIKE $2 OR g.title ILIKE $2 OR g.author ILIKE $2 OR g.category ILIKE $2
         GROUP BY g.isbn
         ORDER BY g.title, g.isbn LIMIT $3 OFFSET $4`,
        [q, pattern, limit, offset]
      ),
    ]);
    res.json({ page, limit, total: count.rows[0].total, books: books.rows });
  } catch (err) { fail(res, err); }
});

// GET /admin/catalog/:isbn returns the full metadata from a stocked branch.
adminRouter.get("/catalog/:isbn", async (req, res) => {
  try {
    for (const branchId of BRANCH_IDS) {
      const result = await getPool(`branch${branchId}_primary`).query(
        `SELECT isbn, title, author, category, publisher, published_year, page_count, description
         FROM books WHERE isbn=$1`,
        [req.params.isbn]
      );
      if (result.rowCount) return res.json({ book: result.rows[0] });
    }
    res.status(404).json({ error: "Book not found." });
  } catch (err) { fail(res, err); }
});

// POST /admin/catalog: add a book to one branch and index it for global search.
adminRouter.post("/catalog", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { book, error } = readBookInput(body);
  const branchId = Number(body.branch_id);
  const copies = Number(body.copies);
  if (error) return res.status(400).json({ error });
  if (!BRANCH_IDS.includes(branchId) || !Number.isInteger(copies) || copies < 1 || copies > 1000) {
    return res.status(400).json({ error: "Choose a branch and a copy count between 1 and 1000." });
  }

  const client = await getPool(`branch${branchId}_primary`).connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT 1 FROM books WHERE isbn = $1", [book.isbn]);
    if (exists.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "That ISBN is already present at this branch." });
    }
    const inserted = await client.query(
      `INSERT INTO books (isbn, title, author, category, publisher, published_year, page_count, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING book_id`,
      [book.isbn, book.title, book.author, book.category, book.publisher, book.year, book.pages, book.description]
    );
    const barcodes = Array.from({ length: copies }, () => `BR${branchId}-${randomUUID()}`);
    await client.query(
      `INSERT INTO book_copies (book_id, barcode, shelf_location)
       SELECT $1, codes.barcode, 'Unassigned' FROM unnest($2::text[]) AS codes(barcode)`,
      [inserted.rows[0].book_id, barcodes]
    );
    await client.query("COMMIT");
    committed = true;
    await syncBookIndex(book);
    await syncBranchAvailability(branchId, book.isbn);
    const warnings = await searchIndexWarnings(book.isbn, [branchId]);
    res.status(201).json({ message: "Book added.", isbn: book.isbn, branch_id: branchId, warnings });
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    console.error("admin catalog create:", err);
    if (err.code === "23505") return res.status(409).json({ error: "That ISBN or barcode already exists." });
    res.status(503).json({
      error: committed
        ? "Book was added to the branch, but the global catalog could not be synchronized. Contact an administrator."
        : "Could not add the book to the selected branch.",
    });
  } finally {
    client.release();
  }
});

// PUT /admin/catalog/:isbn updates metadata for the ISBN wherever it is stocked.
adminRouter.put("/catalog/:isbn", async (req, res) => {
  const { book, error } = readBookInput({ ...req.body, isbn: req.params.isbn });
  if (error) return res.status(400).json({ error });

  const updatedBranches = [];
  try {
    for (const branchId of BRANCH_IDS) {
      const result = await getPool(`branch${branchId}_primary`).query(
        `UPDATE books SET title=$2, author=$3, category=$4, publisher=$5,
                          published_year=$6, page_count=$7, description=$8
         WHERE isbn=$1`,
        [book.isbn, book.title, book.author, book.category, book.publisher, book.year, book.pages, book.description]
      );
      if (result.rowCount) updatedBranches.push(branchId);
    }
    if (!updatedBranches.length) return res.status(404).json({ error: "Book not found in any branch." });
    await syncBookIndex(book);
    const warnings = await searchIndexWarnings(book.isbn, updatedBranches);
    res.json({ message: "Book details updated.", branches: updatedBranches, warnings });
  } catch (err) {
    console.error("admin catalog update:", err);
    res.status(503).json({
      error: `Book update could not be completed. Branches already updated: ${updatedBranches.join(", ") || "none"}.`,
    });
  }
});

// DELETE /admin/catalog/:isbn only removes books with no borrowing history.
adminRouter.delete("/catalog/:isbn", async (req, res) => {
  const isbn = String(req.params.isbn || "").trim();
  const deletedBranches = [];
  try {
    for (const branchId of BRANCH_IDS) {
      const history = await getPool(`branch${branchId}_primary`).query(
        `SELECT EXISTS (
           SELECT 1 FROM books b JOIN book_copies c USING (book_id)
           LEFT JOIN holds h USING (copy_id)
           LEFT JOIN loans l USING (copy_id)
           WHERE b.isbn=$1 AND (h.hold_id IS NOT NULL OR l.loan_id IS NOT NULL)
         ) AS has_history`,
        [isbn]
      );
      if (history.rows[0].has_history) {
        return res.status(409).json({ error: `Cannot delete: the book has hold or loan history at branch ${branchId}.` });
      }
    }

    for (const branchId of BRANCH_IDS) {
      const client = await getPool(`branch${branchId}_primary`).connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("DELETE FROM books WHERE isbn=$1", [isbn]);
        await client.query("COMMIT");
        if (result.rowCount) deletedBranches.push(branchId);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
    if (!deletedBranches.length) return res.status(404).json({ error: "Book not found." });
    const coordinator = getPool("coordinator");
    await coordinator.query("DELETE FROM global_books WHERE isbn=$1", [isbn]);
    const warnings = await searchIndexWarnings(isbn, [], true);
    res.json({ message: "Book and its copies deleted.", branches: deletedBranches, warnings });
  } catch (err) {
    console.error("admin catalog delete:", err);
    res.status(503).json({
      error: `Book deletion could not be completed. Branches already changed: ${deletedBranches.join(", ") || "none"}.`,
    });
  }
});

// GET /admin/events-per-day?days=90
adminRouter.get("/events-per-day", async (req, res) => {
  const days = clamp(req.query.days, 1, 1100, 90);
  try {
    res.json(await cached(`epd:${days}`, 600, async () => {
      const db = await getMongoDb();
      const rows = await db.collection("activity_logs").aggregate([
        { $match: { created_at: { $gte: daysAgo(days) } } },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: "Asia/Karachi" } },
            events: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ], AGG).toArray();
      return { days, points: rows.map((r) => ({ day: r._id, events: r.events })) };
    }));
  } catch (err) { fail(res, err); }
});

// GET /admin/top-books?limit=10&days=365: most viewed books
adminRouter.get("/top-books", async (req, res) => {
  const limit = clamp(req.query.limit, 1, 50, 10);
  const days = clamp(req.query.days, 1, 1100, 365);
  try {
    res.json(await cached(`top-books:${days}:${limit}`, 600, async () => {
      const db = await getMongoDb();
      const rows = await db.collection("activity_logs").aggregate([
        { $match: { action: "view", created_at: { $gte: daysAgo(days) } } },
        { $group: { _id: "$isbn", views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: limit },
      ], AGG).toArray();

      // Titles live in the branch databases, so look them up on the replicas.
      const isbns = rows.map((r) => r._id);
      const info = new Map();
      await Promise.all([1, 2, 3].map(async (b) => {
        try {
          const { rows: found } = await getPool(`branch${b}_replica`).query(
            "SELECT isbn, title, author FROM books WHERE isbn = ANY($1)", [isbns]
          );
          for (const f of found) info.set(f.isbn, f);
        } catch { /* a down branch just leaves some titles empty */ }
      }));

      return {
        days,
        books: rows.map((r) => ({
          isbn: r._id,
          views: r.views,
          title: info.get(r._id)?.title ?? null,
          author: info.get(r._id)?.author ?? null,
        })),
      };
    }));
  } catch (err) { fail(res, err); }
});

// GET /admin/top-searches?limit=10&days=365
adminRouter.get("/top-searches", async (req, res) => {
  const limit = clamp(req.query.limit, 1, 50, 10);
  const days = clamp(req.query.days, 1, 1100, 365);
  try {
    res.json(await cached(`top-searches:${days}:${limit}`, 600, async () => {
      const db = await getMongoDb();
      const rows = await db.collection("activity_logs").aggregate([
        { $match: { action: "search", query: { $exists: true }, created_at: { $gte: daysAgo(days) } } },
        { $group: { _id: { $toLower: "$query" }, searches: { $sum: 1 } } },
        { $sort: { searches: -1 } },
        { $limit: limit },
      ], AGG).toArray();
      return { days, searches: rows.map((r) => ({ query: r._id, searches: r.searches })) };
    }));
  } catch (err) { fail(res, err); }
});

// GET /admin/branches: stock from the coordinator + event counts from MongoDB
adminRouter.get("/branches", async (req, res) => {
  try {
    res.json(await cached("branches", 300, async () => {
      const db = await getMongoDb();
      const [events, stock] = await Promise.all([
        db.collection("activity_logs").aggregate(
          [{ $group: { _id: "$branch", events: { $sum: 1 } } }], AGG
        ).toArray(),
        getPool("coordinator").query(
          `SELECT branch_id, count(*)::int AS titles,
                  sum(total_copies)::int AS total_copies,
                  sum(available_copies)::int AS available_copies
           FROM global_book_availability GROUP BY branch_id ORDER BY branch_id`
        ),
      ]);
      const eventsByBranch = new Map(events.map((e) => [e._id, e.events]));
      return {
        branches: stock.rows.map((s) => ({
          branch_id: s.branch_id,
          code: `BR${s.branch_id}`,
          titles: s.titles,
          total_copies: s.total_copies,
          available_copies: s.available_copies,
          events: eventsByBranch.get(`BR${s.branch_id}`) ?? 0,
        })),
      };
    }));
  } catch (err) { fail(res, err); }
});