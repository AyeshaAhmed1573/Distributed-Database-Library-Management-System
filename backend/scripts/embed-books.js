// One-off (re-runnable) script: generates an embedding for every book in
// every branch and loads them into Qdrant. Run this after seeding the
// branch databases, and again any time you re-seed.
//
//   node scripts/embed-books.js
import pg from "pg";
import { nodes, connectionString } from "../src/config.js";
import { embedText, bookEmbeddingText, EMBEDDING_DIM } from "../src/services/embeddings.js";
import { ensureCollection, upsertBooks } from "../src/services/vectorStore.js";

await ensureCollection(EMBEDDING_DIM);

// Qdrant point ids must be integers, and the same ISBN can exist in several
// branches as different points - combine branch + book_id into one integer.
function pointId(branchId, bookId) {
  return branchId * 10_000_000 + bookId;
}

let total = 0;
for (const branchId of [1, 2, 3]) {
  const client = new pg.Client({ connectionString: connectionString(nodes[`branch${branchId}_primary`]) });
  await client.connect();
  const { rows } = await client.query(
    "SELECT book_id, isbn, title, author, category, description FROM books"
  );
  await client.end();

  const points = rows.map((b) => ({
    id: pointId(branchId, b.book_id),
    vector: embedText(bookEmbeddingText(b)),
    payload: { isbn: b.isbn, title: b.title, author: b.author, category: b.category, branch_id: branchId },
  }));

  for (let i = 0; i < points.length; i += 200) {
    await upsertBooks(points.slice(i, i + 200));
  }
  console.log(`branch${branchId}: embedded ${points.length} books`);
  total += points.length;
}
console.log(`done - ${total} vectors in Qdrant`);