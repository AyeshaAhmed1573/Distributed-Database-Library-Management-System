// Coordinator DB access: users, branches, global catalog, cross-branch holds.
// This is the ONE place that talks to the coordinator database directly -
// routes call these functions instead of writing SQL themselves.
import { getPool } from "../db.js";

const pool = () => getPool("coordinator");

// ---------- users ----------
export async function findUserByUsername(username) {
  const { rows } = await pool().query(
    "SELECT * FROM users WHERE lower(username) = lower($1)",
    [username]
  );
  return rows[0] || null;
}

export async function createUser({ username, email, passwordHash, fullName, homeBranchId }) {
  const { rows } = await pool().query(
    `INSERT INTO users (username, email, password_hash, full_name, home_branch_id)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING user_id, username, email, full_name, role, home_branch_id, created_at`,
    [username, email, passwordHash, fullName || null, homeBranchId || null]
  );
  return rows[0];
}

// ---------- branches ----------
export async function listBranches() {
  const { rows } = await pool().query(
    "SELECT branch_id, code, name, city, latitude, longitude FROM branches WHERE is_active ORDER BY branch_id"
  );
  return rows;
}

// ---------- global catalog / availability (used by the search fan-out as a fallback,
// and to show "which branches have this book" on a book's detail page) ----------
export async function getAvailabilityByIsbn(isbn) {
  const { rows } = await pool().query(
    `SELECT branch_id, total_copies, available_copies
     FROM global_book_availability WHERE isbn = $1 ORDER BY branch_id`,
    [isbn]
  );
  return rows;
}
` `
// Best-effort: keep the coordinator's copy of availability roughly in sync
// after a hold or a return. It is a cache for cross-branch search, not the
// source of truth - the branch's own book_copies table always wins.
export async function adjustAvailability(isbn, branchId, delta) {
  await pool().query(
    `UPDATE global_book_availability
     SET available_copies = GREATEST(0, available_copies + $3), updated_at = now()
     WHERE isbn = $1 AND branch_id = $2`,
    [isbn, branchId, delta]
  );
}

// ---------- cross-branch hold ledger ----------
export async function recordCrossBranchHold({ userId, isbn, branchId, branchHoldId, expiresAt }) {
  const { rows } = await pool().query(
    `INSERT INTO cross_branch_holds (user_id, isbn, branch_id, branch_hold_id, status, expires_at)
     VALUES ($1,$2,$3,$4,'confirmed',$5)
     RETURNING hold_ref`,
    [userId, isbn, branchId, branchHoldId, expiresAt]
  );
  return rows[0].hold_ref;
}

export async function cancelCrossBranchHold({ branchId, branchHoldId, userId }) {
  await pool().query(
    `UPDATE cross_branch_holds SET status = 'cancelled', updated_at = now()
     WHERE branch_id = $1 AND branch_hold_id = $2 AND user_id = $3`,
    [branchId, branchHoldId, userId]
  );
}
