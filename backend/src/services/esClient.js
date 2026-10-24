import { settings } from "../config.js";

const INDEX = "books";

async function es(path, options = {}) {
  const res = await fetch(`${settings.esUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ES ${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

// Creates the "books" index with a sensible mapping, if it doesn't exist yet.
// Safe to call every time the app starts.
export async function ensureIndex() {
  const exists = await fetch(`${settings.esUrl}/${INDEX}`, { method: "HEAD" });
  if (exists.ok) return;
  await es(`/${INDEX}`, {
    method: "PUT",
    body: JSON.stringify({
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          isbn: { type: "keyword" },
          title: { type: "text" },
          author: { type: "text" },
          category: { type: "keyword" },
          published_year: { type: "integer" },
          avg_rating: { type: "float" },
          rating_count: { type: "integer" },
          available_copies: { type: "integer" },
          total_copies: { type: "integer" },
          // "object" (not "nested") so partial updates can merge one
          // branch's counts without touching the others.
          branches: { type: "object" },
        },
      },
    }),
  });
}

// docs: [{ isbn, title, author, ... }]. Uses the bulk API - one HTTP call
// for however many books you pass, instead of one call per book.
export async function bulkIndexBooks(docs) {
  if (docs.length === 0) return;
  const lines = docs.flatMap((d) => [
    JSON.stringify({ index: { _index: INDEX, _id: d.isbn } }),
    JSON.stringify(d),
  ]);
  const result = await es("/_bulk", {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: lines.join("\n") + "\n",
  });
  if (result.errors) {
    const firstError = result.items.find((i) => i.index?.error)?.index?.error;
    throw new Error(`ES bulk index had errors: ${JSON.stringify(firstError)}`);
  }
}

// Deleting a doc that doesn't exist in ES returns 404 - that's expected
// (e.g. a book that was never indexed), not a real failure, so it's
// swallowed here rather than left to the caller to special-case.
export async function deleteBook(isbn) {
  try {
    await es(`/${INDEX}/_doc/${encodeURIComponent(isbn)}`, { method: "DELETE" });
  } catch (err) {
    if (!String(err.message).includes("-> 404")) throw err;
  }
}

const SORT_FIELD = { rating: "avg_rating", year: "published_year" };

// The main search: text relevance by default, or sort by rating/year.
export async function searchBooks({ q, sort = "relevance", limit = 20 }) {
  const body = {
    size: limit,
    query: {
      multi_match: {
        query: q,
        fields: ["title^3", "author^2", "category"],
        fuzziness: "AUTO", // tolerates small typos
      },
    },
  };
  if (SORT_FIELD[sort]) {
    body.sort = [{ [SORT_FIELD[sort]]: "desc" }];
  }
  const result = await es(`/${INDEX}/_search`, { method: "POST", body: JSON.stringify(body) });
  return result.hits.hits.map((h) => ({ ...h._source, score: h._score }));
}

// Best-effort: after a hold/cancel, push the fresh per-branch availability
// into the book's ES document, without re-indexing the whole thing. Uses a
// partial update (ES merges "branches" key by key since it's an "object"
// field, not "nested").
export async function updateAvailability(isbn, branchRows) {
  const branches = {};
  let available_copies = 0, total_copies = 0;
  for (const r of branchRows) {
    branches[r.branch_id] = { available_copies: r.available_copies, total_copies: r.total_copies };
    available_copies += r.available_copies;
    total_copies += r.total_copies;
  }
  await es(`/${INDEX}/_update/${encodeURIComponent(isbn)}`, {
    method: "POST",
    body: JSON.stringify({ doc: { branches, available_copies, total_copies } }),
  });
}

export async function pingEs() {
  try {
    const res = await fetch(`${settings.esUrl}/_cluster/health`);
    return res.ok;
  } catch {
    return false;
  }
}