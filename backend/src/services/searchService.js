
import { getPool } from "../db.js";
import { searchBooks, pingEs } from "./esClient.js";

const BRANCH_IDS = [1, 2, 3];

function getOrderBy(sort) {
  return {
    relevance: "rank DESC",
    rating: "b.avg_rating DESC NULLS LAST",
    year: "b.published_year DESC NULLS LAST",
  }[sort] || "rank DESC";
}

/**
 * Search one PostgreSQL replica.
 */
async function searchBranchSql(branchId, { q, sort, limit }) {
  const pool = getPool(`branch${branchId}_replica`);
  const orderBy = getOrderBy(sort);

  try {
    const { rows } = await pool.query(
      `SELECT
          b.book_id,
          b.isbn,
          b.title,
          b.author,
          b.category,
          b.published_year,
          b.avg_rating,
          b.rating_count,
          COALESCE(av.available_copies, 0)::int AS available_copies,
          COALESCE(av.total_copies, 0)::int AS total_copies,
          GREATEST(
            CASE
              WHEN b.search_vector @@ websearch_to_tsquery('english', $1)
              THEN ts_rank(
                b.search_vector,
                websearch_to_tsquery('english', $1)
              )
              ELSE 0
            END,
            similarity(b.title, $1) * 0.9,
            similarity(b.author, $1) * 0.7,
            CASE
              WHEN lower(b.title) = lower($1) THEN 1.0
              WHEN lower(b.title) LIKE lower($2) THEN 0.95
              ELSE 0
            END
          ) AS rank
       FROM books b
       JOIN book_availability av ON av.book_id = b.book_id
       WHERE
          b.search_vector @@ websearch_to_tsquery('english', $1)
          OR similarity(b.title, $1) > 0.2
          OR similarity(b.author, $1) > 0.25
          OR lower(b.title) LIKE lower($2)
       ORDER BY ${orderBy}
       LIMIT $3`,
      [q, `${q}%`, limit]
    );

    return { branchId, rows };
  } catch (err) {
    console.error(`Search failed on branch ${branchId}:`, err.message);
    return { branchId, rows: [], error: err.code || err.message };
  }
}

/**
 * Merge copies of the same book across branches using ISBN.
 */
function mergeByIsbn(branchResults) {
  const merged = new Map();

  for (const { branchId, rows = [] } of branchResults) {
    for (const row of rows) {
      const isbn = row.isbn;

      if (merged.has(isbn)) {
        const existing = merged.get(isbn);

        existing.available_copies += Number(row.available_copies || 0);
        existing.total_copies += Number(row.total_copies || 0);
        existing.branches.push({
          branch_id: branchId,
          available_copies: Number(row.available_copies || 0),
          total_copies: Number(row.total_copies || 0),
        });

        existing.rank = Math.max(
          Number(existing.rank || 0),
          Number(row.rank || 0)
        );
      } else {
        merged.set(isbn, {
          book_id: row.book_id,
          isbn,
          title: row.title,
          author: row.author,
          category: row.category,
          published_year: row.published_year,
          avg_rating: Number(row.avg_rating || 0),
          rating_count: Number(row.rating_count || 0),
          available_copies: Number(row.available_copies || 0),
          total_copies: Number(row.total_copies || 0),
          rank: Number(row.rank || row._score || 0),
          branches: [
            {
              branch_id: branchId,
              available_copies: Number(row.available_copies || 0),
              total_copies: Number(row.total_copies || 0),
            },
          ],
        });
      }
    }
  }

  return [...merged.values()];
}

/**
 * Sort the complete list using the selected UI sort option.
 */
function sortMerged(items, sort) {
  const sorted = [...items];

  if (sort === "rating") {
    return sorted.sort(
      (a, b) =>
        Number(b.avg_rating || 0) - Number(a.avg_rating || 0)
    );
  }

  if (sort === "year") {
    return sorted.sort(
      (a, b) =>
        Number(b.published_year || 0) -
        Number(a.published_year || 0)
    );
  }

  return sorted.sort(
    (a, b) => Number(b.rank || 0) - Number(a.rank || 0)
  );
}

/**
 * Select one best match and put the other results in similarBooks.
 * Exact title match wins; otherwise the highest relevance score wins.
 */
function separateBestMatch(items, q) {
  if (!items.length) {
    return { bestMatch: null, similarBooks: [] };
  }

  const normalizedQuery = q.trim().toLowerCase();

  const sortedByRelevance = [...items].sort((a, b) => {
    const aExact =
      String(a.title || "").trim().toLowerCase() === normalizedQuery;
    const bExact =
      String(b.title || "").trim().toLowerCase() === normalizedQuery;

    if (aExact !== bExact) {
      return aExact ? -1 : 1;
    }

    return (
      Number(b.rank ?? b._score ?? 0) -
      Number(a.rank ?? a._score ?? 0)
    );
  });

  const bestMatch = sortedByRelevance[0];

  const similarBooks = items.filter(
    (book) => book.isbn !== bestMatch.isbn
  );

  return { bestMatch, similarBooks };
}

/**
 * PostgreSQL fallback: search all three branches concurrently.
 */
async function fanOutSearchSql({ q, sort, limit }) {
  const perBranchLimit = Math.max(limit, 20);

  const branchResults = await Promise.all(
    BRANCH_IDS.map((branchId) =>
      searchBranchSql(branchId, {
        q,
        sort,
        limit: perBranchLimit,
      })
    )
  );

  const failedBranches = branchResults
    .filter((result) => result.error)
    .map((result) => result.branchId);

  const merged = mergeByIsbn(branchResults);
  const sortedResults = sortMerged(merged, sort);
  const results = sortedResults.slice(0, limit);

  // Select the best match by relevance even if the UI sort is rating/year.
  const { bestMatch, similarBooks } = separateBestMatch(results, q);

  return {
    bestMatch,
    similarBooks: sortMerged(similarBooks, sort),
    results,
    failedBranches,
    branchesQueried: BRANCH_IDS.length,
    method: "sql_fallback",
  };
}

/**
 * Main search function used by routes/search.js.
 */
export async function fanOutSearch({
  q,
  sort = "relevance",
  limit = 20,
}) {
  const query = String(q || "").trim();

  if (!query) {
    return {
      bestMatch: null,
      similarBooks: [],
      results: [],
      failedBranches: [],
      branchesQueried: 0,
      method: "empty_query",
    };
  }

  try {
    if (await pingEs()) {
      const esResults = await searchBooks({
        q: query,
        sort,
        limit,
      });

      if (Array.isArray(esResults) && esResults.length > 0) {
        const normalizedResults = esResults.map((book) => ({
          ...book,
          rank: Number(book.rank ?? book._score ?? 0),
        }));

        const { bestMatch, similarBooks } = separateBestMatch(
          normalizedResults,
          query
        );

        return {
          bestMatch,
          similarBooks: sortMerged(similarBooks, sort),
          results: normalizedResults,
          failedBranches: [],
          branchesQueried: 1,
          method: "elasticsearch",
        };
      }

      // An empty Elasticsearch result falls through to PostgreSQL.
    }
  } catch (err) {
    console.warn(
      "Elasticsearch search failed, falling back to PostgreSQL:",
      err.message
    );
  }

  return fanOutSearchSql({
    q: query,
    sort,
    limit,
  });
}
