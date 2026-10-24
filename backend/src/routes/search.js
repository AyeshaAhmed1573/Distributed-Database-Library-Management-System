
import { Router } from "express";
import { fanOutSearch } from "../services/searchService.js";
import {
  getCachedSearch,
  setCachedSearch,
} from "../services/cache.js";
import { mightMatch } from "../services/bloomFilter.js";

export const searchRouter = Router();

const VALID_SORTS = new Set(["relevance", "rating", "year"]);

searchRouter.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const sort = VALID_SORTS.has(req.query.sort)
      ? req.query.sort
      : "relevance";

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1),
      100
    );

    if (!q) {
      return res.status(400).json({
        error: "query parameter 'q' is required",
      });
    }

    // Bloom filter: reject queries that cannot match any book.
    if (!(await mightMatch(q))) {
      return res.json({
        query: q,
        sort,
        count: 0,
        bestMatch: null,
        similarBooks: [],
        results: [],
        branches_queried: 0,
        branches_failed: [],
        bloom_rejected: true,
      });
    }

    // Return cached results when available.
    const cached = await getCachedSearch(q, sort);

    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    // Search Elasticsearch or fall back to PostgreSQL.
    const {
      bestMatch,
      similarBooks,
      results,
      failedBranches,
      branchesQueried,
      method,
    } = await fanOutSearch({ q, sort, limit });

    const body = {
      query: q,
      sort,
      count: results.length,
      bestMatch: bestMatch ?? null,
      similarBooks: similarBooks ?? [],
      results,
      branches_queried: branchesQueried,
      branches_failed: failedBranches,
      method,
    };

    // Cache only if all queried branches succeeded.
    if (failedBranches.length === 0) {
      await setCachedSearch(q, sort, body);
    }

    return res.json(body);
  } catch (err) {
    console.error("Search route failed:", err);

    return res.status(500).json({
      error: "Search failed",
      bestMatch: null,
      similarBooks: [],
      results: [],
    });
  }
});
