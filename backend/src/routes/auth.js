// Auth / username endpoints. Usernames and emails are globally unique
// (enforced by the coordinator DB), even though branches are separate.
import { Router } from "express";
import {
  findUserByUsername,
  createUser,
  listBranches,
} from "../services/coordinator.js";
import { hashPassword, verifyPassword, signToken } from "../services/auth.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const { username, email, password, fullName, homeBranchId } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "username, email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  if (await findUserByUsername(username)) {
    return res.status(409).json({ error: "username already taken" });
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await createUser({ username, email, passwordHash, fullName, homeBranchId });
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "username or email already taken" });
    console.error("register failed:", err);
    res.status(503).json({ error: "could not reach the coordinator database" });
  }
});

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  let user;
  try {
    user = await findUserByUsername(username);
  } catch (err) {
    console.error("login failed:", err);
    return res.status(503).json({ error: "could not reach the coordinator database" });
  }

  // Same error for "no such user" and "wrong password" - don't reveal which one.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "invalid username or password" });
  }

  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser, token: signToken(user) });
});

authRouter.get("/branches", async (req, res) => {
  try {
    res.json(await listBranches());
  } catch (err) {
    res.status(503).json({ error: "could not reach the coordinator database" });
  }
});
