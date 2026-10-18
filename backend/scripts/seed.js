// Fill the branch databases and the coordinator's global index with sample data.
//
//   npm run seed                 -> 600 books, ~60% of them in each branch
//   node scripts/seed.js 2000    -> 2000 books
//
// Re-running with the same number is safe: existing ISBNs / barcodes are skipped.
import pg from "pg";
import { nodes, connectionString } from "../src/config.js";
import { getMongoDb, closeMongo } from "../src/mongo.js";

const ADJ = ["Silent", "Hidden", "Modern", "Ancient", "Digital", "Distributed", "Practical",
  "Complete", "Advanced", "Essential", "Forgotten", "Golden", "Broken", "Rapid"];
const NOUN = ["Databases", "Networks", "Algorithms", "Systems", "Gardens", "Oceans", "Empires",
  "Mathematics", "Economics", "Poetry", "Machines", "Cities", "Stories", "Rivers"];
const SUFFIX = ["Explained", "in Practice", "Handbook", "Fundamentals", "for Beginners",
  "Revisited", "Unbound", "and Society", "A Guide", "Volume II"];
const AUTHORS = ["Ayesha Khan", "Omar Farooq", "Sara Malik", "Daniel Reyes", "Mei Lin",
  "Hassan Raza", "Elena Petrova", "John Carter", "Fatima Noor", "Liam O'Brien",
  "Zainab Ali", "Carlos Mendes", "Nadia Hussain", "Robert Klein"];
const CATEGORIES = ["Computer Science", "Fiction", "History", "Science", "Business",
  "Philosophy", "Poetry", "Engineering", "Mathematics", "Biography"];
const PUBLISHERS = ["Orbit Press", "Nova Books", "Lakeside", "Meridian", "Harbor House"];

// small seeded random generator -> same catalog on every machine
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

function makeCatalog(n) {
  const rng = makeRng(42);
  const books = [];
  for (let i = 0; i < n; i++) {
    const title = `${pick(rng, ADJ)} ${pick(rng, NOUN)} ${pick(rng, SUFFIX)}`;
    const category = pick(rng, CATEGORIES);
    books.push({
      isbn: `978${String(1000000000 + i * 37).padStart(10, "0")}`,
      title,
      author: pick(rng, AUTHORS),
      category,
      publisher: pick(rng, PUBLISHERS),
      year: int(rng, 1985, 2025),
      pages: int(rng, 120, 900),
      description: `A ${category.toLowerCase()} title. ${title} covers key ideas, examples and exercises.`,
      rating: Math.round((2.5 + rng() * 2.5) * 100) / 100,
      ratingCount: int(rng, 3, 400),
    });
  }
  return books;
}

async function inTransaction(client, fn) {
  await client.query("BEGIN");
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function seedBranch(idx, catalog, rng) {
  const client = new pg.Client({ connectionString: connectionString(nodes[`branch${idx}_primary`]) });
  await client.connect();
  const stock = {}; // isbn -> [total, available]
  try {
    const chosen = catalog.filter(() => rng() < 0.6);
    await inTransaction(client, async () => {
      await client.query(
        `INSERT INTO books (isbn,title,author,category,publisher,published_year,
                            page_count,description,avg_rating,rating_count)
         SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],
                              $6::smallint[],$7::int[],$8::text[],$9::numeric[],$10::int[])
         ON CONFLICT (isbn) DO NOTHING`,
        [
          chosen.map((b) => b.isbn), chosen.map((b) => b.title), chosen.map((b) => b.author),
          chosen.map((b) => b.category), chosen.map((b) => b.publisher), chosen.map((b) => b.year),
          chosen.map((b) => b.pages), chosen.map((b) => b.description),
          chosen.map((b) => b.rating), chosen.map((b) => b.ratingCount),
        ]
      );
      const { rows } = await client.query("SELECT isbn, book_id FROM books");
      const ids = Object.fromEntries(rows.map((r) => [r.isbn, r.book_id]));

      const bookIds = [], barcodes = [], shelves = [];
      for (const b of chosen) {
        const n = int(rng, 1, 4);
        stock[b.isbn] = [n, n];
        for (let c = 1; c <= n; c++) {
          bookIds.push(ids[b.isbn]);
          barcodes.push(`BR${idx}-${b.isbn}-${c}`);
          shelves.push(`Shelf ${int(rng, 1, 60)}`);
        }
      }
      await client.query(
        `INSERT INTO book_copies (book_id, barcode, shelf_location)
         SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[])
         ON CONFLICT (barcode) DO NOTHING`,
        [bookIds, barcodes, shelves]
      );
      console.log(`branch${idx}: ${chosen.length} books, ${barcodes.length} copies`);
    });
  } finally {
    await client.end();
  }
  return stock;
}

async function seedCoordinator(catalog, stocks) {
  const client = new pg.Client({ connectionString: connectionString(nodes.coordinator) });
  await client.connect();
  try {
    const stocked = new Set(Object.values(stocks).flatMap((s) => Object.keys(s)));
    const books = catalog.filter((b) => stocked.has(b.isbn));
    await inTransaction(client, async () => {
      await client.query(
        `INSERT INTO global_books (isbn,title,author,category,published_year,avg_rating)
         SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::smallint[],$6::numeric[])
         ON CONFLICT (isbn) DO UPDATE SET avg_rating = EXCLUDED.avg_rating`,
        [books.map((b) => b.isbn), books.map((b) => b.title), books.map((b) => b.author),
         books.map((b) => b.category), books.map((b) => b.year), books.map((b) => b.rating)]
      );
      const isbns = [], branches = [], totals = [], avails = [];
      for (const [branch, s] of Object.entries(stocks)) {
        for (const [isbn, [total, avail]] of Object.entries(s)) {
          isbns.push(isbn); branches.push(Number(branch)); totals.push(total); avails.push(avail);
        }
      }
      await client.query(
        `INSERT INTO global_book_availability (isbn,branch_id,total_copies,available_copies)
         SELECT * FROM unnest($1::text[],$2::smallint[],$3::int[],$4::int[])
         ON CONFLICT (isbn,branch_id) DO UPDATE
         SET total_copies = EXCLUDED.total_copies,
             available_copies = EXCLUDED.available_copies, updated_at = now()`,
        [isbns, branches, totals, avails]
      );
      console.log(`coordinator: ${books.length} global books, ${isbns.length} availability rows`);
    });
  } finally {
    await client.end();
  }
}


const REVIEW_TITLES = ["Great read", "Very useful", "Not bad", "Could be better", "Highly recommended"];
const REVIEW_TEXT = [
  "Clear explanations and good examples throughout.",
  "Covers the basics well but gets repetitive in the middle.",
  "I used this for my course and it helped a lot.",
  "The later chapters are hard to follow without prior knowledge.",
  "Well written, easy to borrow again for revision.",
  "A solid reference to keep at hand.",
];

// Sample reviews go to MongoDB (the document DB). Skipped if MongoDB is not running.
async function seedReviews(catalog, stocks, rng) {
  let db;
  try {
    db = await getMongoDb();
  } catch {
    console.warn("mongo: not reachable, skipping reviews (start the mongo container and re-run)");
    return;
  }
  const stocked = new Set(Object.values(stocks).flatMap((s) => Object.keys(s)));
  const docs = [];
  for (const b of catalog) {
    if (!stocked.has(b.isbn) || rng() > 0.4) continue;
    const count = int(rng, 1, 3);
    const firstUser = int(rng, 0, 49);
    for (let k = 0; k < count; k++) {
      docs.push({
        isbn: b.isbn,
        user_id: `seed-user-${(firstUser + k) % 50}`, // different user for each review of a book
        rating: int(rng, 1, 5),
        title: pick(rng, REVIEW_TITLES),
        comment: pick(rng, REVIEW_TEXT),
        helpful_votes: int(rng, 0, 20),
        created_at: new Date(),
      });
    }
  }
  try {
    await db.collection("reviews").insertMany(docs, { ordered: false });
  } catch (err) {
    if (err.code !== 11000) throw err; // 11000 = duplicate (already seeded), fine
  }
  console.log(`mongo: ${docs.length} reviews`);
}

const nBooks = Number(process.argv[2] || 600);
const catalog = makeCatalog(nBooks);
const rng = makeRng(7);
const stocks = {};
for (const i of [1, 2, 3]) stocks[i] = await seedBranch(i, catalog, rng);
await seedCoordinator(catalog, stocks);
await seedReviews(catalog, stocks, rng);
await closeMongo();
