// Generates years of realistic library activity and bulk-loads it into MongoDB.
//   node scripts/generate-activity.js 5000000 --fresh
// Needs data/books.jsonl (step 1) and data/users.jsonl (with usernames).
// --fresh deletes the documents a previous run generated (marked generated:true)
// before loading; without it, the new events are added on top.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMongoDb, closeMongo } from "../src/mongo.js";
import { unit, stockedAt } from "./lib/stocking.js";

const args = process.argv.slice(2);
const N = Number(args.find((a) => !a.startsWith("--")) || 5_000_000);
const FRESH = args.includes("--fresh");
const BATCH = 10_000;
const NOW = Date.now();
const WINDOW_MS = 3 * 365 * 86400000; // last 3 years
const TZ_OFFSET_MS = 5 * 3600 * 1000; // Karachi, UTC+5
const POP_EXPONENT = 0.75;            // dampens bestsellers so they don't take everything

const here = path.dirname(fileURLToPath(import.meta.url));
function readJsonl(name) {
  const file = path.resolve(here, "../data", name);
  if (!fs.existsSync(file)) { console.error(`missing ${file}`); process.exit(1); }
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const books = readJsonl("books.jsonl");
const users = readJsonl("users.jsonl").map((u) => ({
  ...u, signup: new Date(u.created_at).getTime(), username: u.username || "",
}));
console.log(`${books.length} books, ${users.length} users, generating ${N} events`);

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(99);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Weighted random choice: returns a function that picks an index with
// probability proportional to its weight.
function makeSampler(weights) {
  const cum = new Float64Array(weights.length);
  let sum = 0;
  for (let i = 0; i < weights.length; i++) cum[i] = sum += weights[i];
  return () => {
    const r = rng() * sum;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return lo;
  };
}

// ---- which book: real popularity, with each branch's own taste ----
const base = books.map((b) => Math.pow((b.popularity || 0) + 1, POP_EXPONENT));
const branchBooks = {};
for (const branchId of [1, 2, 3]) {
  const idx = [], w = [];
  books.forEach((b, i) => {
    if (!stockedAt(b.isbn, branchId)) return;
    const u1 = unit(`${b.isbn}|${branchId}|n1`), u2 = unit(`${b.isbn}|${branchId}|n2`);
    const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
    idx.push(i);
    w.push(base[i] * Math.exp(0.5 * z));
  });
  const sample = makeSampler(w);
  branchBooks[branchId] = () => idx[sample()];
}

// ---- which user, and where ----
const pickUser = makeSampler(users.map((u) => u.weight));
function branchFor(u) {
  const home = u.home_branch_id || 1 + Math.floor(rng() * 3);
  return rng() < 0.8 ? home : 1 + Math.floor(rng() * 3);
}

// ---- when: busier weekdays, semester months, daytime ----
const DAY = [0.3, 1, 1, 1, 1, 0.9, 0.5];                                   // Sun..Sat
const MONTH = [0.8, 1.3, 1.2, 1.1, 0.9, 0.5, 0.5, 0.6, 1.3, 1.3, 1.2, 0.7]; // Jan..Dec
const HOUR = [0.1, 0.05, 0.03, 0.03, 0.03, 0.05, 0.2, 0.5, 1, 1.5, 1.7, 1.6,
  1.4, 1.6, 1.7, 1.6, 1.4, 1.1, 0.9, 0.8, 0.6, 0.4, 0.25, 0.15];
const MAX_FACTOR = 1.3;
const pickHour = makeSampler(HOUR);
function eventTime(lo) {
  for (let tries = 0; tries < 50; tries++) {
    const t = lo + rng() * (NOW - lo);
    const local = new Date(t + TZ_OFFSET_MS);
    if (rng() < (DAY[local.getUTCDay()] * MONTH[local.getUTCMonth()]) / MAX_FACTOR) {
      const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TZ_OFFSET_MS;
      const ms = dayStart + pickHour() * 3600000 + rng() * 3600000;
      return new Date(clamp(ms, lo, NOW));
    }
  }
  return new Date(lo + rng() * (NOW - lo));
}

// ---- what happened (action names must match the validator in infra/mongo/init.js) ----
const ACTIONS = ["view", "search", "reserve", "login"];
const pickAction = makeSampler([0.46, 0.35, 0.10, 0.09]);
const SORTS = ["relevance", "rating", "year"];
const pickSort = makeSampler([0.7, 0.2, 0.1]);
function queryFor(book) {
  const words = book.title.toLowerCase().match(/[a-z]{4,}/g) || [book.category];
  return rng() < 0.7 ? pick(words) : `${pick(words)} ${pick(words)}`;
}

const REVIEW = {
  good: { titles: ["Great read", "Highly recommended", "Very useful"],
    comments: ["Clear explanations and good examples throughout.", "I used this for my course and it helped a lot.", "A solid reference to keep at hand."] },
  mid: { titles: ["Not bad", "Decent", "Okay overall"],
    comments: ["Covers the basics well but gets repetitive in the middle.", "Useful in parts, slow in others.", "Fine for a first pass on the topic."] },
  bad: { titles: ["Could be better", "Disappointing", "Hard to follow"],
    comments: ["The later chapters are hard to follow without prior knowledge.", "Too long for what it covers.", "I expected more depth."] },
};
function makeReview(book, user, at) {
  const mean = book.rating_avg ?? 3.8; // real rating when we have one
  const rating = clamp(Math.round(mean + gauss()), 1, 5);
  const t = REVIEW[rating >= 4 ? "good" : rating === 3 ? "mid" : "bad"];
  return {
    isbn: book.isbn, user_id: user.user_id, username: user.username,
    book_title: book.title.slice(0, 200), book_author: book.author.slice(0, 200),
    rating, title: pick(t.titles), comment: pick(t.comments),
    helpful_votes: Math.floor(-Math.log(1 - rng()) * 1.5),
    created_at: at, generated: true,
  };
}

// ---- generate and load ----
const db = await getMongoDb();
const activity = db.collection("activity_logs");
const reviews = db.collection("reviews");
if (FRESH) {
  const a = await activity.deleteMany({ generated: true });
  const r = await reviews.deleteMany({ generated: true });
  console.log(`--fresh: removed ${a.deletedCount} events and ${r.deletedCount} reviews from a previous run`);
}

let actBuf = [], revBuf = [], eventTotal = 0, reviewTotal = 0;
const reviewed = new Set();
const perBook = new Map(), byType = {};
const started = Date.now();

async function flushReviews() {
  try {
    await reviews.insertMany(revBuf, { ordered: false });
    reviewTotal += revBuf.length;
  } catch (err) {
    if (err.code !== 11000) throw err; // duplicate review from an earlier run: fine
    reviewTotal += err.insertedCount ?? 0;
  }
  revBuf = [];
}
async function flush(force = false) {
  if (actBuf.length >= BATCH || (force && actBuf.length)) {
    await activity.insertMany(actBuf, { ordered: false });
    eventTotal += actBuf.length;
    actBuf = [];
  }
  if (revBuf.length >= 5000 || (force && revBuf.length)) await flushReviews();
}

for (let n = 0; n < N; n++) {
  const user = users[pickUser()];
  const branch = branchFor(user);
  const book = books[branchBooks[branch]()];
  const at = eventTime(Math.max(NOW - WINDOW_MS, user.signup));

  const action = ACTIONS[pickAction()];
  const branchCode = `BR${branch}`;

  const doc = { user_id: user.user_id, action, branch: branchCode, created_at: at, generated: true };
  if (action === "search") {
    doc.query = queryFor(book);
    doc.meta = { sort: SORTS[pickSort()] };
  } else if (action !== "login") {
    doc.isbn = book.isbn;
    perBook.set(book.isbn, (perBook.get(book.isbn) || 0) + 1);
  }
  actBuf.push(doc);
  byType[action] = (byType[action] || 0) + 1;

  if (action === "reserve") {
    if (rng() < 0.15) { // cancelled about a day later
      const t = at.getTime() - Math.log(1 - rng()) * 86400000;
      if (t <= NOW) {
        actBuf.push({ user_id: user.user_id, action: "cancel_hold", isbn: book.isbn,
          branch: branchCode, created_at: new Date(t), generated: true });
        byType.cancel_hold = (byType.cancel_hold || 0) + 1;
      }
    }
    const key = `${book.isbn}|${user.user_id}`;
    if (rng() < 0.2 && !reviewed.has(key)) { // a review 3 to 30 days after the reservation
      const t = at.getTime() + (3 + rng() * 27) * 86400000;
      if (t <= NOW) { reviewed.add(key); revBuf.push(makeReview(book, user, new Date(t))); }
    }
  }

  if (actBuf.length >= BATCH || revBuf.length >= 5000) await flush();
  if ((n + 1) % 250000 === 0) {
    const rate = Math.round(((n + 1) / (Date.now() - started)) * 1000);
    console.log(`${n + 1} / ${N} generated (${rate} per second)`);
  }
}
await flush(true);

console.log("building indexes...");
try {
  await activity.createIndex({ user_id: 1, created_at: -1 });
  await activity.createIndex({ isbn: 1, created_at: -1 });
  await activity.createIndex({ action: 1, created_at: -1 });
} catch (err) {
  console.warn("index creation warning:", err.message);
}

// summary you can show your teacher
const counts = [...perBook.entries()].sort((a, b) => b[1] - a[1]);
const withIsbn = counts.reduce((s, [, c]) => s + c, 0);
const topN = Math.max(1, Math.ceil(books.length * 0.01));
const topShare = counts.slice(0, topN).reduce((s, [, c]) => s + c, 0) / withIsbn;
const titleOf = new Map(books.map((b) => [b.isbn, b.title]));
console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)}s: ${eventTotal} events, ${reviewTotal} reviews`);
console.log("events by action:", byType);
console.log(`top 1% of books (${topN}) got ${(topShare * 100).toFixed(1)}% of book events`);
console.log("most active books:", counts.slice(0, 5).map(([i, c]) => `${titleOf.get(i)} (${c})`));
await closeMongo();