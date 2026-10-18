// Creates the indexes the review/favorite routes rely on. Safe to call on
// every request: it only runs once, and never throws (if Mongo is down, the
// route's own query fails with a 503 instead).
import { getMongoDb } from "../mongo.js";

let ready = null;

export function ensureMongoIndexes() {
  if (!ready) {
    ready = getMongoDb()
      .then(async (db) => {
        await Promise.all([
          // one review per user per book
          db.collection("reviews").createIndex({ isbn: 1, user_id: 1 }, { unique: true }),
          db.collection("reviews").createIndex({ isbn: 1, created_at: -1 }),
          db.collection("reviews").createIndex({ user_id: 1, created_at: -1 }),
          // one favorite per user per book
          db.collection("favorites").createIndex({ user_id: 1, isbn: 1 }, { unique: true }),
          db.collection("favorites").createIndex({ user_id: 1, created_at: -1 }),
        ]);
      })
      .catch((err) => {
        ready = null; // try again on the next request
        console.error("mongo indexes:", err.message);
      });
  }
  return ready;
}