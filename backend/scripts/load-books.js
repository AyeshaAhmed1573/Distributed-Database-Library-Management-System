// Loads the real books (data/books.jsonl) into the 3 branch databases and the
// coordinator's global index, using the same stocking rules as generate-activity.js.
//   node scripts/load-books.js             -> adds the real books
//   node scripts/load-books.js --replace   -> also removes the demo books from seed.js
// Re-running is safe: existing ISBNs and barcodes are skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { nodes, connectionString } from "../src/config.js";
import { getMongoDb, closeMongo } from "../src/mongo.js";
import { unit, stockedAt, copiesAt } from "./lib/stocking.js";

const REPLACE = process.argv.includes("--replace");
const BATCH = 5000;
const here = path.dirname(fileURLToPath(import.meta.url));

const raw = fs.readFileSync(path.resolve(here, "../data/books.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const MAX_YEAR = new Date().getFullYear() + 1;
const books = raw.filter((b) => b.year && b.year >= 1450 && b.year <= MAX_YEAR);
console.log(`${raw.length} books in file, ${books.length} have a usable publish year`);

async function connect(node) {
  const c = new pg.Client({ connectionString: connectionString(node) });
  await c.connect();
  return c;
}

// Find out which columns can't be empty, so missing real-world fields get a fallback.
const probe = await connect(nodes.branch1_primary);
const { rows: notNull } = await probe.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'books' AND is_nullable = 'NO'"
);
await probe.end();
const required = new Set(notNull.map((r) => r.column_name));
const pagesFallback = required.has("page_count") ? 250 : null;
const publisherFallback = required.has("publisher") ? "Unknown" : null;

const col = (list, fn) => list.map(fn);

// ---------- remove the demo books from seed.js ----------
async function removeDemoBooks() {
  const real = new Set(raw.map((b) => b.isbn));
  const demo = [];
  for (let i = 0; i < 20000; i++) {
    const isbn = `978${String(1000000000 + i * 37).padStart(10, "0")}`;
    if (!real.has(isbn)) demo.push(isbn);
  }

  const coord = await connect(nodes.coordinator);
  try {
    await coord.query("BEGIN");
    await coord.query("DELETE FROM cross_branch_holds WHERE isbn = ANY($1)", [demo]);
    await coord.query("DELETE FROM global_book_availability WHERE isbn = ANY($1)", [demo]);
    await coord.query("DELETE FROM global_books WHERE isbn = ANY($1)", [demo]);
    await coord.query("COMMIT");
  } catch (err) {
    await coord.query("ROLLBACK");
    throw err;
  } finally { await coord.end(); }

  for (const id of [1, 2, 3]) {
    const c = await connect(nodes[`branch${id}_primary`]);
    try {
      await c.query("BEGIN");
      const ids = "SELECT book_id FROM books WHERE isbn = ANY($1)";
      await c.query(`DELETE FROM holds WHERE book_id IN (${ids})`, [demo]);
      await c.query(`DELETE FROM book_copies WHERE book_id IN (${ids})`, [demo]);
      const r = await c.query("DELETE FROM books WHERE isbn = ANY($1)", [demo]);
      await c.query("COMMIT");
      console.log(`branch${id}: removed ${r.rowCount} demo books`);
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    } finally { await c.end(); }
  }

  try {
    const db = await getMongoDb();
    const r = await db.collection("reviews").deleteMany({ user_id: /^seed-user-/ });
    console.log(`mongo: removed ${r.deletedCount} demo reviews`);
  } catch {
    console.warn("mongo: not reachable, demo reviews left in place");
  }
}

// ---------- one branch ----------
async function loadBranch(branchId) {
  const client = await connect(nodes[`branch${branchId}_primary`]);
  const stock = []; // [isbn, copies], used for the coordinator
  try {
    const chosen = books.filter((b) => stockedAt(b.isbn, branchId));
    await client.query("BEGIN");

    for (let i = 0; i < chosen.length; i += BATCH) {
      const c = chosen.slice(i, i + BATCH);
      await client.query(
        `INSERT INTO books (isbn,title,author,category,publisher,published_year,
                            page_count,description,avg_rating,rating_count)
         SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],
                              $6::smallint[],$7::int[],$8::text[],$9::numeric[],$10::int[])
         ON CONFLICT (isbn) DO NOTHING`,
        [
          col(c, (b) => b.isbn), col(c, (b) => b.title), col(c, (b) => b.author),
          col(c, (b) => b.category), col(c, () => publisherFallback), col(c, (b) => b.year),
          col(c, (b) => b.pages ?? pagesFallback),
          col(c, (b) => b.description ?? (required.has("description") ? `${b.title} by ${b.author}.` : null)),
          col(c, (b) => Math.round((b.rating_avg ?? 0) * 100) / 100),
          col(c, (b) => b.rating_count ?? 0),
        ]
      );
    }

    const { rows } = await client.query("SELECT isbn, book_id FROM books");
    const ids = Object.fromEntries(rows.map((r) => [r.isbn, r.book_id]));

    const bookIds = [], barcodes = [], shelves = [];
    for (const b of chosen) {
      const n = copiesAt(b.isbn, branchId);
      stock.push([b.isbn, n]);
      const shelf = `Shelf ${1 + Math.floor(unit(`${b.isbn}|${branchId}|shelf`) * 60)}`;
      for (let k = 1; k <= n; k++) {
        bookIds.push(ids[b.isbn]);
        barcodes.push(`BR${branchId}-${b.isbn}-${k}`);
        shelves.push(shelf);
      }
    }
    for (let i = 0; i < barcodes.length; i += BATCH) {
      await client.query(
        `INSERT INTO book_copies (book_id, barcode, shelf_location)
         SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[])
         ON CONFLICT (barcode) DO NOTHING`,
        [bookIds.slice(i, i + BATCH), barcodes.slice(i, i + BATCH), shelves.slice(i, i + BATCH)]
      );
    }
    await client.query("COMMIT");
    console.log(`branch${branchId}: ${chosen.length} books, ${barcodes.length} copies`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { await client.end(); }
  return stock;
}

// ---------- coordinator's global index ----------
async function loadCoordinator(stocks) {
  const client = await connect(nodes.coordinator);
  try {
    await client.query("BEGIN");
    const stocked = new Set(Object.values(stocks).flatMap((s) => s.map(([isbn]) => isbn)));
    const list = books.filter((b) => stocked.has(b.isbn));
    for (let i = 0; i < list.length; i += BATCH) {
      const c = list.slice(i, i + BATCH);
      await client.query(
        `INSERT INTO global_books (isbn,title,author,category,published_year,avg_rating)
         SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::smallint[],$6::numeric[])
         ON CONFLICT (isbn) DO UPDATE SET avg_rating = EXCLUDED.avg_rating`,
        [col(c, (b) => b.isbn), col(c, (b) => b.title), col(c, (b) => b.author),
         col(c, (b) => b.category), col(c, (b) => b.year),
         col(c, (b) => Math.round((b.rating_avg ?? 0) * 100) / 100)]
      );
    }

    const isbns = [], branches = [], totals = [];
    for (const [branch, s] of Object.entries(stocks)) {
      for (const [isbn, n] of s) { isbns.push(isbn); branches.push(Number(branch)); totals.push(n); }
    }
    for (let i = 0; i < isbns.length; i += BATCH) {
      await client.query(
        `INSERT INTO global_book_availability (isbn,branch_id,total_copies,available_copies)
         SELECT * FROM unnest($1::text[],$2::smallint[],$3::int[],$3::int[])
         ON CONFLICT (isbn,branch_id) DO UPDATE
         SET total_copies = EXCLUDED.total_copies,
             available_copies = EXCLUDED.available_copies, updated_at = now()`,
        [isbns.slice(i, i + BATCH), branches.slice(i, i + BATCH), totals.slice(i, i + BATCH)]
      );
    }
    await client.query("COMMIT");
    console.log(`coordinator: ${list.length} global books, ${isbns.length} availability rows`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { await client.end(); }
}

if (REPLACE) await removeDemoBooks();
const stocks = {};
for (const id of [1, 2, 3]) stocks[id] = await loadBranch(id);
await loadCoordinator(stocks);
await closeMongo();
console.log("done");