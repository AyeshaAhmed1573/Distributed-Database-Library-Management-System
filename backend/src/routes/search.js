// Search & Sort: text + numeric queries, fanned out to all 3 branches.
import { Router } from "express";
import { fanOutSearch } from "../services/searchService.js";
import { getCachedSearch, setCachedSearch } from "../services/cache.js";
import { mightMatch } from "../services/bloomFilter.js";
export const searchRouter = Router();

const VALID_SORTS = new Set(["relevance", "rating", "year"]);

// GET /books/search?q=databases&sort=rating&limit=20
searchRouter.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : "relevance";
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  if (!q) return res.status(400).json({ error: "query parameter 'q' is required" });
    // Bloom filter: if any word exists in no book anywhere, skip the cache and all 3 branches
  if (!(await mightMatch(q))) {
    return res.json({
      query: q, sort, count: 0, results: [],
      branches_queried: 0, branches_failed: [], bloom_rejected: true,
    });
  }

  const cached = await getCachedSearch(q, sort);
  if (cached) return res.json({ ...cached, cached: true });

  const { results, failedBranches, branchesQueried } = await fanOutSearch({ q, sort, limit });

  const body = {
    query: q,
    sort,
    count: results.length,
    results,
    branches_queried: branchesQueried,
    branches_failed: failedBranches, // empty array = all branches answered
  };

  // Don't cache a partial/degraded result - the next request should retry the down branch.
  if (failedBranches.length === 0) await setCachedSearch(q, sort, body);

  res.json(body);
});
