// Thin wrapper around Qdrant's REST API (plain fetch, no extra client
// library needed - Qdrant's HTTP API is simple enough on its own).
import { settings } from "../config.js";

const COLLECTION = "books";

async function qdrant(path, options = {}) {
  const res = await fetch(`${settings.qdrantUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Qdrant ${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

// Creates the "books" collection if it doesn't already exist. Safe to call
// every time the app starts - Qdrant just returns an error we ignore if it's
// already there.
export async function ensureCollection(dim) {
  try {
    await qdrant(`/collections/${COLLECTION}`, {
      method: "PUT",
      body: JSON.stringify({ vectors: { size: dim, distance: "Dot" } }),
    });
  } catch (err) {
    if (!String(err.message).includes("already exists")) throw err;
  }
}

// points: [{ id, vector, payload }]. Qdrant upserts by id, so re-running
// this with the same ids just updates them - safe to re-run the seed script.
export async function upsertBooks(points) {
  await qdrant(`/collections/${COLLECTION}/points`, {
    method: "PUT",
    body: JSON.stringify({ points }),
  });
}

// Finds the `limit` closest vectors to `vector`, excluding `excludeId` (the
// book you're already looking at).
export async function searchSimilar(vector, { limit = 10, excludeId } = {}) {
  const body = {
    vector,
    limit: excludeId != null ? limit + 1 : limit,
    with_payload: true,
  };
  const { result } = await qdrant(`/collections/${COLLECTION}/points/search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return result
    .filter((r) => r.id !== excludeId)
    .slice(0, limit)
    .map((r) => ({ score: r.score, ...r.payload }));
}

export async function pingQdrant() {
  try {
    await qdrant("/collections");
    return true;
  } catch {
    return false;
  }
}