import { Router } from "express";
import { getPool } from "../db.js";
import { embedText, bookEmbeddingText } from "../services/embeddings.js";
import { searchSimilar } from "../services/vectorStore.js";

export const recommendationsRouter = Router();

// GET /books/:isbn/similar?branchId=1
recommendationsRouter.get("/:isbn/similar", async (req, res) => {
  const { isbn } = req.params;
  const branchId = Number(req.query.branchId) || 1;
  const pool = getPool(`branch${branchId}_replica`);

  let target;
  try {
    const { rows } = await pool.query(
      "SELECT book_id, title, author, category, description FROM books WHERE isbn = $1",
      [isbn]
    );
    if (rows.length === 0) return res.status(404).json({ error: "book not found at this branch" });
    target = rows[0];
  } catch {
    return res.status(503).json({ error: `could not reach branch ${branchId}` });
  }

  // 1) vector search
  try {
    const hits = await searchSimilar(embedText(bookEmbeddingText(target)), { limit: 40 });
    const seen = new Set([isbn]); // same ISBN at another branch is a different point, so dedupe
    const similar = [];
    for (const h of hits) {
      if (seen.has(h.isbn)) continue;
      seen.add(h.isbn);
      similar.push({ isbn: h.isbn, title: h.title, author: h.author, category: h.category, score: h.score });
      if (similar.length === 10) break;
    }
    if (similar.length > 0) return res.json({ isbn, method: "vector", similar });
  } catch (err) {
    console.warn("vector search failed, using SQL fallback:", err.message);
  }

  // 2) SQL fallback: same category or author
  try {
    const { rows } = await pool.query(
      `SELECT isbn, title, author, category, avg_rating FROM books
       WHERE book_id != $1 AND (category = $2 OR author = $3)
       ORDER BY (author = $3) DESC, avg_rating DESC LIMIT 10`,
      [target.book_id, target.category, target.author]
    );
    res.json({
      isbn,
      method: "sql_fallback",
      similar: rows.map((r) => ({ ...r, avg_rating: Number(r.avg_rating) })),
    });
  } catch {
    res.status(503).json({ error: `could not reach branch ${branchId}` });
  }
});