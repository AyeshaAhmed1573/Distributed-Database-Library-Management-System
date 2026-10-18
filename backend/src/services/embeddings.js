// Turns book text into a fixed-length numeric vector for the vector DB.
//
// This uses FEATURE HASHING (the same family of technique as scikit-learn's
// HashingVectorizer): each word gets hashed straight to a position in the
// vector, so there's no model to download and no internet needed - it runs
// instantly, anywhere. A full transformer model (e.g. sentence-transformers)
// would give richer embeddings, but needs a ~90MB download on first run and
// an internet connection every time the container rebuilds - too fragile
// for a live demo. This is the pragmatic trade-off for a course project.
import crypto from "node:crypto";

export const EMBEDDING_DIM = 128;

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []);
}

// Hash one word to (which position, +1 or -1). The random-looking sign
// cancels out hash collisions on average instead of letting them stack up.
function hashToken(token) {
  const hash = crypto.createHash("md5").update(token).digest();
  const index = hash.readUInt32LE(0) % EMBEDDING_DIM;
  const sign = (hash.readUInt8(4) & 1) === 0 ? 1 : -1;
  return [index, sign];
}

// Turns any text into a EMBEDDING_DIM-length vector, L2-normalized so that
// a plain dot product between two vectors equals their cosine similarity -
// this is exactly what Qdrant's "Dot" distance metric expects.
export function embedText(text) {
  const vec = new Float64Array(EMBEDDING_DIM);
  for (const token of tokenize(text)) {
    const [index, sign] = hashToken(token);
    vec[index] += sign;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const out = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = vec[i] / norm;
  return out;
}

// What text represents a book for embedding purposes. Kept in one place so
// the seed script and the search-time query always build vectors the same way.
export function bookEmbeddingText({ title, author, category, description }) {
  return [title, author, category, description].filter(Boolean).join(". ");
}