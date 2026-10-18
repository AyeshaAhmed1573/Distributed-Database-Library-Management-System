// Reads "Authorization: Bearer <token>", verifies it, and attaches req.user.
// Use requireAuth on any route that needs a logged-in user.
import { verifyToken } from "../services/auth.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing Authorization header" });

  try {
    req.user = verifyToken(token); // { sub, username, role }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
