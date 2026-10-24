import { Router } from "express";
import { getPool } from "../db.js";
import { settings, nodes } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { adjustAvailability, recordCrossBranchHold, cancelCrossBranchHold } from "../services/coordinator.js";
import { invalidateAvailability } from "../services/cache.js";
import { getAvailabilityByIsbn } from "../services/coordinator.js";
import { updateAvailability as updateEsAvailability } from "../services/esClient.js";

export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);

// POST /reservations  { isbn, branchId }
// Reserves ONE available copy of a book at a specific branch.
reservationsRouter.post("/", async (req, res) => {
  const { isbn, branchId } = req.body;
  const userId = req.user.sub;

  if (!isbn || !branchId) return res.status(400).json({ error: "isbn and branchId are required" });
  if (!nodes[`branch${branchId}_primary`]) return res.status(400).json({ error: "unknown branchId" });

  // Reservations write to the PRIMARY (never the replica) - replicas are read-only.
  const pool = getPool(`branch${branchId}_primary`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock ONE available copy of this book so two concurrent requests can't
    // both pick the same row. FOR UPDATE SKIP LOCKED means: if another
    // transaction already grabbed a copy, just look at the next one instead
    // of waiting - this is what lets 2 people racing for the LAST copy get
    // resolved instantly instead of queuing.
    const { rows: bookRows } = await client.query(
      "SELECT book_id FROM books WHERE isbn = $1", [isbn]
    );
    if (bookRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: `isbn ${isbn} not found at this branch` });
    }
    const bookId = bookRows[0].book_id;

    const { rows: copyRows } = await client.query(
      `SELECT copy_id FROM book_copies
       WHERE book_id = $1 AND status = 'available'
       ORDER BY copy_id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [bookId]
    );
    if (copyRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "no available copies at this branch right now" });
    }
    const copyId = copyRows[0].copy_id;
    const expiresAt = new Date(Date.now() + settings.holdDurationHours * 3600 * 1000);

    // The unique index uq_active_hold_per_copy is the REAL safety net here -
    // even without the lock above, two simultaneous inserts for the same
    // copy can't both succeed. We catch that below just in case.
    let hold;
    try {
      const { rows } = await client.query(
        `INSERT INTO holds (book_id, copy_id, member_id, expires_at)
         VALUES ($1,$2,$3,$4) RETURNING hold_id, expires_at`,
        [bookId, copyId, userId, expiresAt]
      );
      hold = rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") {
        return res.status(409).json({ error: "that copy was just taken - try again" });
      }
      throw err;
    }

    await client.query(
      "UPDATE book_copies SET status = 'held' WHERE copy_id = $1", [copyId]
    );
    await client.query("COMMIT");

    // Best-effort bookkeeping outside the transaction: the reservation
    // already succeeded, so a failure here should not undo it.
    adjustAvailability(isbn, Number(branchId), -1).catch(() => {});
    getAvailabilityByIsbn(isbn).then((rows) => updateEsAvailability(isbn, rows)).catch(() => {});
    invalidateAvailability(isbn).catch(() => {});
    let crossBranchRef = null;
    try {
      crossBranchRef = await recordCrossBranchHold({
        userId, isbn, branchId: Number(branchId), branchHoldId: hold.hold_id, expiresAt,
      });
    } catch (err) {
      console.warn("coordinator ledger update failed (hold still valid at the branch):", err.message);
    }

    res.status(201).json({
      hold_id: Number(hold.hold_id),
      isbn,
      branch_id: Number(branchId),
      copy_id: Number(copyId),
      expires_at: hold.expires_at,
      cross_branch_ref: crossBranchRef,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reservation failed:", err);
    res.status(503).json({ error: `could not reach branch ${branchId}` });
  } finally {
    client.release();
  }
});

// DELETE /reservations/:branchId/:holdId
reservationsRouter.delete("/:branchId/:holdId", async (req, res) => {
  const { branchId, holdId } = req.params;
  const userId = req.user.sub;
  if (!nodes[`branch${branchId}_primary`]) return res.status(400).json({ error: "unknown branchId" });

  const pool = getPool(`branch${branchId}_primary`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE holds SET status = 'cancelled', updated_at = now()
       WHERE hold_id = $1 AND member_id = $2 AND status = 'active'
       RETURNING copy_id, book_id`,
      [holdId, userId]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "active hold not found for this user" });
    }
    await client.query(
      "UPDATE book_copies SET status = 'available' WHERE copy_id = $1", [rows[0].copy_id]
    );
    const { rows: isbnRows } = await client.query(
      "SELECT isbn FROM books WHERE book_id = $1", [rows[0].book_id]
    );
    await client.query("COMMIT");

    const isbn = isbnRows[0]?.isbn;
    if (isbn) {
      adjustAvailability(isbn, Number(branchId), 1).catch(() => {});
      getAvailabilityByIsbn(isbn).then((rows) => updateEsAvailability(isbn, rows)).catch(() => {});
      invalidateAvailability(isbn).catch(() => {});
    }
    cancelCrossBranchHold({
      branchId: Number(branchId),
      branchHoldId: Number(holdId),
      userId,
    }).catch(() => {});

    res.json({ cancelled: true, hold_id: Number(holdId) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("cancel hold failed:", err);
    res.status(503).json({ error: `could not reach branch ${branchId}` });
  } finally {
    client.release();
  }
});

// GET /reservations/mine - fans out to all 3 branches for the logged-in user.
reservationsRouter.get("/mine", async (req, res) => {
  const userId = req.user.sub;
  const branchIds = [1, 2, 3];

  const perBranch = await Promise.all(
    branchIds.map(async (branchId) => {
      try {
        const pool = getPool(`branch${branchId}_primary`);
        const { rows } = await pool.query(
          `SELECT h.hold_id, h.status, h.expires_at, b.isbn, b.title
           FROM holds h JOIN books b ON b.book_id = h.book_id
           WHERE h.member_id = $1 AND h.status = 'active'
           ORDER BY h.expires_at`,
          [userId]
        );
        return rows.map((r) => ({ ...r, hold_id: Number(r.hold_id), branch_id: branchId }));
      } catch {
        return []; // a down branch just contributes no rows, not an error
      }
    })
  );

  res.json(perBranch.flat());
});