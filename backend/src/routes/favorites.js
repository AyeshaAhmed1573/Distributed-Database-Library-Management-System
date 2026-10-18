// Favorites live in MongoDB (library_docs.favorites): one small document per
// user per book, with a snapshot of the book so the Favorites page can draw
// cards without extra lookups.
import { Router } from "express";
import { getMongoDb } from "../mongo.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureMongoIndexes } from "../services/mongoIndexes.js";

export const favoritesRouter = Router();
favoritesRouter.use(requireAuth); // mounted at /favorites, so only affects these routes

const userKey = (req) => String(req.user.sub);

function snapshot(book) {
  return {
    title: String(book.title || "").slice(0, 200),
    author: String(book.author || "").slice(0, 200),
    category: book.category ? String(book.category).slice(0, 80) : null,
    published_year: Number.isFinite(Number(book.published_year)) ? Number(book.published_year) : null,
    avg_rating: Number.isFinite(Number(book.avg_rating)) ? Number(book.avg_rating) : 0,
    rating_count: Number.isFinite(Number(book.rating_count)) ? Number(book.rating_count) : 0,
  };
}

// GET /favorites: my favorites, newest first
favoritesRouter.get("/", async (req, res) => {
  try {
    await ensureMongoIndexes();
    const db = await getMongoDb();
    const docs = await db
      .collection("favorites")
      .find({ user_id: userKey(req) })
      .sort({ created_at: -1 })
      .toArray();
    res.json({
      favorites: docs.map((d) => ({
        isbn: d.isbn,
        title: d.title,
        author: d.author,
        category: d.category,
        published_year: d.published_year,
        avg_rating: d.avg_rating,
        rating_count: d.rating_count,
        favorited_at: d.created_at,
      })),
    });
  } catch (err) {
    console.error("favorites:get", err.message);
    res.status(503).json({ error: "Favorites are temporarily unavailable." });
  }
});

// POST /favorites  { book: { isbn, title, author, ... } }
favoritesRouter.post("/", async (req, res) => {
  const book = req.body?.book;
  const isbn = typeof book?.isbn === "string" ? book.isbn.trim() : "";
  if (!isbn || isbn.length > 30) {
    return res.status(400).json({ error: "A book with an isbn is required." });
  }

  try {
    await ensureMongoIndexes();
    const db = await getMongoDb();
    await db.collection("favorites").updateOne(
      { user_id: userKey(req), isbn },
      { $set: snapshot(book), $setOnInsert: { created_at: new Date() } },
      { upsert: true }
    );
    res.status(201).json({ isbn });
  } catch (err) {
    if (err.code === 11000) return res.status(201).json({ isbn }); // double-click race: already saved
    console.error("favorites:post", err.message);
    res.status(503).json({ error: "Could not save this favorite right now." });
  }
});

// DELETE /favorites/:isbn
favoritesRouter.delete("/:isbn", async (req, res) => {
  try {
    const db = await getMongoDb();
    const result = await db
      .collection("favorites")
      .deleteOne({ user_id: userKey(req), isbn: req.params.isbn });
    res.json({ removed: result.deletedCount > 0 });
  } catch (err) {
    console.error("favorites:delete", err.message);
    res.status(503).json({ error: "Could not remove this favorite right now." });
  }
});