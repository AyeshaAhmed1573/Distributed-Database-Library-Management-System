
import pg from "pg";
import { nodes, connectionString } from "../src/config.js";
import { ensureIndex, bulkIndexBooks } from "../src/services/esClient.js";

await ensureIndex();

const merged = new Map(); // isbn -> doc

for (const branchId of [1, 2, 3]) {
  const client = new pg.Client({ connectionString: connectionString(nodes[`branch${branchId}_primary`]) });
  await client.connect();
  const { rows } = await client.query(`
    SELECT b.isbn, b.title, b.author, b.category, b.published_year, b.avg_rating, b.rating_count,
           COALESCE(av.available_copies, 0)::int AS available_copies,
           COALESCE(av.total_copies, 0)::int AS total_copies
    FROM books b
    JOIN book_availability av ON av.book_id = b.book_id
  `);
  await client.end();

  for (const r of rows) {
    const existing = merged.get(r.isbn);
    if (existing) {
      existing.available_copies += r.available_copies;
      existing.total_copies += r.total_copies;
      existing.branches[branchId] = { available_copies: r.available_copies, total_copies: r.total_copies };
    } else {
      merged.set(r.isbn, {
        isbn: r.isbn, title: r.title, author: r.author, category: r.category,
        published_year: r.published_year, avg_rating: Number(r.avg_rating), rating_count: r.rating_count,
        available_copies: r.available_copies, total_copies: r.total_copies,
        branches: { [branchId]: { available_copies: r.available_copies, total_copies: r.total_copies } },
      });
    }
  }
  console.log(`branch${branchId}: read ${rows.length} books`);
}

const docs = [...merged.values()];
for (let i = 0; i < docs.length; i += 500) {
  await bulkIndexBooks(docs.slice(i, i + 500));
}
console.log(`indexed ${docs.length} unique books into Elasticsearch`);