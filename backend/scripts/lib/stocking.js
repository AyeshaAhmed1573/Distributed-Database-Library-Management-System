// Deterministic (hash-based) choice of which branch stocks which book.
import crypto from "node:crypto";

export const STOCK_PROB = 0.6; // chance a branch carries a given book

export function unit(str) {
  return crypto.createHash("md5").update(str).digest().readUInt32LE(0) / 4294967296;
}

export function stockedAt(isbn, branchId) {
  if (unit(`${isbn}|${branchId}|stock`) < STOCK_PROB) return true;
  // never leave a book with zero branches: give it one deterministic home
  const anywhere = [1, 2, 3].some((b) => unit(`${isbn}|${b}|stock`) < STOCK_PROB);
  return !anywhere && branchId === 1 + Math.floor(unit(`${isbn}|fallback`) * 3);
}

export function copiesAt(isbn, branchId) {
  return 1 + Math.floor(unit(`${isbn}|${branchId}|copies`) * 4); // 1 to 4 copies
}