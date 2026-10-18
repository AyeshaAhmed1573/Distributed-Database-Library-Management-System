// Search & Sort: tries Elasticsearch first (the real search index), and
// falls back to fanning the query out to all 3 branches' Postgres
// full-text search if Elasticsearch is down - same fallback pattern as
// services/vectorStore.js uses for recommendations.
import { getPool } from "../db.js";
import { searchBooks, pingEs } from "./esClient.js";

const BRANCH_IDS = [1, 2, 3];

async function searchBranchSql(branchId, { q, sort, limit }) {
  const pool = getPool(`branch${branchId}_replica`);
  const orderBy = { relevance: "rank DESC", rating: "b.avg_rating DESC", year: "b.published_year DESC" }[sort]
    || "rank DESC";
  try {
    const { rows } = await pool.query(
      `SELECT b.book_id, b.isbn, b.title, b.author, b.category, b.published_year,
              b.avg_rating, b.rating_count,
              COALESCE(av.available_copies, 0)::int AS available_copies,
              COALESCE(av.total_copies, 0)::int     AS total_copies,
              ts_rank(b.search_vector, query) AS rank
       FROM books b
       JOIN book_availability av ON av.book_id = b.book_id,
            websearch_to_tsquery('english', $1) query
       WHERE b.search_vector @@ query
       ORDER BY ${orderBy}
       LIMIT $2`,
      [q, limit]
    );
    return { branchId, rows };
  } catch (err) {
    return { branchId, error: err.code || err.message };
  }
}

function mergeByIsbn(branchResults) {
  const merged = new Map();
  for (const { branchId, rows = [] } of branchResults) {
    for (const r of rows) {
      const existing = merged.get(r.isbn);
      if (existing) {
        existing.available_copies += r.available_copies;
        existing.total_copies += r.total_copies;
        existing.branches.push({ branch_id: branchId, available_copies: r.available_copies });
        existing.rank = Math.max(existing.rank, r.rank);
      } else {
        merged.set(r.isbn, {
          isbn: r.isbn, title: r.title, author: r.author, category: r.category,
          published_year: r.published_year, avg_rating: Number(r.avg_rating),
          rating_count: r.rating_count, available_copies: r.available_copies,
          total_copies: r.total_copies, rank: r.rank,
          branches: [{ branch_id: branchId, available_copies: r.available_copies }],
        });
      }
    }
  }
  return [...merged.values()];
}

function sortMerged(items, sort) {
  const key = { relevance: "rank", rating: "avg_rating", year: "published_year" }[sort] || "rank";
  return items.sort((a, b) => b[key] - a[key]);
}

// Fallback path: identical to the original Postgres fan-out search.
async function fanOutSearchSql({ q, sort, limit }) {
  const perBranchLimit = Math.max(limit, 20);
  const branchResults = await Promise.all(
    BRANCH_IDS.map((id) => searchBranchSql(id, { q, sort, limit: perBranchLimit }))
  );
  const failedBranches = branchResults.filter((r) => r.error).map((r) => r.branchId);
  const merged = sortMerged(mergeByIsbn(branchResults), sort).slice(0, limit);
  return { results: merged, failedBranches, branchesQueried: BRANCH_IDS.length, method: "sql_fallback" };
}

// The one function routes/search.js calls.
export async function fanOutSearch({ q, sort = "relevance", limit = 20 }) {
  try {
    if (await pingEs()) {
      const results = await searchBooks({ q, sort, limit });
      if (results.length > 0 || q.length > 0) {
        return { results, failedBranches: [], branchesQueried: 1, method: "elasticsearch" };
      }
    }
  } catch (err) {
    console.warn("Elasticsearch search failed, falling back to Postgres:", err.message);
  }
  return fanOutSearchSql({ q, sort, limit });
}