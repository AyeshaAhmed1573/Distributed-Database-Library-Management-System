// Password hashing and JWT helpers. Routes call these instead of using
// bcrypt/jsonwebtoken directly, so the hashing cost and token shape live
// in one place.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { settings } from "../config.js";

const SALT_ROUNDS = 10;

export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.user_id, username: user.username, role: user.role },
    settings.jwtSecret,
    { expiresIn: settings.jwtExpiresIn }
  );
}

// Throws if the token is missing/invalid/expired - callers wrap this in try/catch
// (see middleware/auth.js).
export function verifyToken(token) {
  return jwt.verify(token, settings.jwtSecret);
}
