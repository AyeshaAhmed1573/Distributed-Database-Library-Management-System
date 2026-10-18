// Reviews live in MongoDB (library_docs.reviews), one document per review.
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getMongoDb } from "../mongo.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyToken } from "../services/auth.js";
import { ensureMongoIndexes } from "../services/mongoIndexes.js";

export const reviewsRouter = Router(); // mounted at the root: the paths below are full paths

const userKey = (req) => String(req.user.sub);

// For public routes: who is asking, if they sent a valid token (else null).
function viewerId(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return String(verifyToken(header.slice(7)).sub);
  } catch {
    return null;
  }
}

function shape(r, me = null) {
  return {
    id: r._id.toString(),
    isbn: r.isbn,
    username: r.username || "",
    book_title: r.book_title || "",
    book_author: r.book_author || "",
    rating: r.rating,
    title: r.title || "",
    comment: r.comment || "",
    helpful_votes: r.helpful_votes || 0,
    created_at: r.created_at,
    mine: me !== null && r.user_id === me,
  };
}

// GET /books/:isbn/reviews (public): reviews + average for one book
reviewsRouter.get("/books/:isbn/reviews", async (req, res) => {
  const { isbn } = req.params;
  const me = viewerId(req);
  try {
    await ensureMongoIndexes();
    const db = await getMongoDb();
    const col = db.collection("reviews");
    const [reviews, agg] = await Promise.all([
      col.find({ isbn }).sort({ created_at: -1 }).limit(50).toArray(),
      col
        .aggregate([
          { $match: { isbn } },
          { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    res.json({
      reviews: reviews.map((r) => shape(r, me)),
      average_rating: agg[0]?.avg ?? null,
      review_count: agg[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("reviews:get", err.message);
    res.status(503).json({ error: "Reviews are temporarily unavailable." });
  }
});

// POST /books/:isbn/reviews (login required): one review per user per book
reviewsRouter.post("/books/:isbn/reviews", requireAuth, async (req, res) => {
  const { isbn } = req.params;
  const { rating, title, comment, book_title, book_author } = req.body;

  const numRating = Number(rating);
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: "Rating must be a whole number from 1 to 5." });
  }

  try {
    await ensureMongoIndexes();
    const db = await getMongoDb();
    const col = db.collection("reviews");

    if (await col.findOne({ isbn, user_id: userKey(req) })) {
      return res.status(409).json({ error: "You've already reviewed this book." });
    }

    const doc = {
      isbn,
      user_id: userKey(req),
      username: String(req.user.username || ""),
      book_title: String(book_title || "").slice(0, 200),
      book_author: String(book_author || "").slice(0, 200),
      rating: numRating,
      title: String(title || "").trim().slice(0, 120),
      comment: String(comment || "").trim().slice(0, 1000),
      helpful_votes: 0,
      created_at: new Date(),
    };
    const result = await col.insertOne(doc);
    res.status(201).json(shape({ ...doc, _id: result.insertedId }, userKey(req)));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "You've already reviewed this book." });
    }
    console.error("reviews:post", err.message);
    res.status(503).json({ error: "Could not save your review right now." });
  }
});

// GET /reviews/mine (login required): everything I've reviewed
reviewsRouter.get("/reviews/mine", requireAuth, async (req, res) => {
  try {
    const db = await getMongoDb();
    const list = await db
      .collection("reviews")
      .find({ user_id: userKey(req) })
      .sort({ created_at: -1 })
      .toArray();
    res.json({ reviews: list.map((r) => shape(r, userKey(req))) });
  } catch (err) {
    console.error("reviews:mine", err.message);
    res.status(503).json({ error: "Could not load your reviews." });
  }
});

// DELETE /reviews/:id (login required, owner only)
reviewsRouter.delete("/reviews/:id", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid review id." });
  }
  try {
    const db = await getMongoDb();
    const result = await db
      .collection("reviews")
      .deleteOne({ _id: new ObjectId(req.params.id), user_id: userKey(req) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Review not found." });
    res.json({ deleted: true });
  } catch (err) {
    console.error("reviews:delete", err.message);
    res.status(503).json({ error: "Could not delete the review." });
  }
});