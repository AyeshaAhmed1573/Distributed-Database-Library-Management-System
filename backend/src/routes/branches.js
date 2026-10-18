import { Router } from "express";
import { nearestBranches } from "../services/nearby.js";

export const branchesRouter = Router();

function num(value) {
  return value === undefined || value === "" ? NaN : Number(value);
}

// GET /branches/nearby?lat=24.86&lng=67.00&isbn=9781000001036&limit=3
branchesRouter.get("/nearby", async (req, res) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "valid lat and lng query parameters are required" });
  }
  const isbn = req.query.isbn ? String(req.query.isbn).trim() : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 10);

  try {
    const { branches, nearestWithCopy } = await nearestBranches({ lat, lng, isbn, limit });
    const body = { origin: { lat, lng }, count: branches.length, branches };
    if (isbn) {
      body.isbn = isbn;
      body.nearest_with_copy = nearestWithCopy;
    }
    res.json(body);
  } catch (err) {
    console.error("nearby:", err.message);
    res.status(503).json({ error: "could not reach the coordinator database" });
  }
});