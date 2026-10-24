 import { redis } from "../redis.js";

const SEARCH_TTL_SECONDS = 30;      // hot searches: short-lived, high write rate
const AVAILABILITY_TTL_SECONDS = 10; // availability changes often, so keep this short

function searchKey(query, sort) {
  return `search:${sort}:${query.toLowerCase().trim()}`;
}

export async function getCachedSearch(query, sort) {
  try {
    const raw = await redis.get(searchKey(query, sort));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedSearch(query, sort, results) {
  try {
    await redis.set(searchKey(query, sort), JSON.stringify(results), "EX", SEARCH_TTL_SECONDS);
  } catch {
    /* cache is best-effort */
  }
}

export async function getCachedAvailability(isbn) {
  try {
    const raw = await redis.get(`avail:${isbn}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedAvailability(isbn, data) {
  try {
    await redis.set(`avail:${isbn}`, JSON.stringify(data), "EX", AVAILABILITY_TTL_SECONDS);
  } catch {
    /* best-effort */
  }
}

// Call this after any hold/cancel/return so the next search shows fresh numbers.
export async function invalidateAvailability(isbn) {
  try {
    await redis.del(`avail:${isbn}`);
  } catch {
    /* best-effort */
  }
}
