// Creates a large population of synthetic users in the coordinator DB and
// writes data/users.jsonl (with the real user_ids) for the activity generator.
//   node scripts/generate-users.js 200000
// Re-running with the same number is safe: existing usernames are skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";
import { nodes, connectionString } from "../src/config.js";

const N = Number(process.argv[2] || 5000000);
const BATCH = 5000;
const PASSWORD = "Password123!"; // every generated user shares this, so you can log in as any of them
const EMAIL_DOMAIN = "student.lib.test";
const BRANCH_WEIGHTS = [0.45, 0.30, 0.25]; // Central is the busiest

const FIRST = ["Ayesha", "Omar", "Sara", "Hassan", "Fatima", "Zainab", "Ali", "Bilal", "Hira",
  "Usman", "Maryam", "Ahmed", "Noor", "Danish", "Iqra", "Talha", "Mehwish", "Saad", "Amna",
  "Faisal", "Daniel", "Emma", "Liam", "Mei", "Carlos", "Elena", "John", "Sofia", "Arjun",
  "Priya", "Yusuf", "Laila", "Kamran", "Rabia", "Imran", "Sana", "Hamza", "Nimra", "Zara", "Adeel"];
const LAST = ["Khan", "Malik", "Raza", "Ahmed", "Farooq", "Noor", "Hussain", "Ali", "Siddiqui",
  "Sheikh", "Qureshi", "Ansari", "Baig", "Chaudhry", "Mirza", "Iqbal", "Butt", "Rehman", "Javed",
  "Shah", "Memon", "Zaidi", "Hashmi", "Lodhi", "Rizvi", "Carter", "Reyes", "Lin", "Petrova",
  "Mendes", "Klein", "Patel", "Singh", "Kapoor", "Nasir", "Aslam", "Mahmood", "Bashir", "Tariq"];

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(2026);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

function pickBranch() {
  let r = rng();
  for (let i = 0; i < BRANCH_WEIGHTS.length; i++) {
    if ((r -= BRANCH_WEIGHTS[i]) < 0) return i + 1;
  }
  return BRANCH_WEIGHTS.length;
}

// Lognormal: most users near 1, a few far above (heavy borrowers).
function activityWeight() {
  const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return Math.round(Math.exp(1.2 * z) * 1000) / 1000;
}

const NOW = Date.now();
const SPAN_MS = 3 * 365 * 24 * 3600 * 1000;
function signupDate() {
  if (rng() < 0.4) { // 40% sign up in the first 3 weeks of a semester (Sep 1 / Feb 1)
    const year = new Date(NOW).getUTCFullYear() - Math.floor(rng() * 4);
    const month = rng() < 0.5 ? 8 : 1;
    const d = Date.UTC(year, month, 1 + Math.floor(rng() * 21));
    if (d < NOW && d > NOW - SPAN_MS) return new Date(d);
  }
  return new Date(NOW - rng() * SPAN_MS);
}

const users = [];
for (let i = 0; i < N; i++) {
  const first = pick(FIRST), last = pick(LAST);
  const username = `${first}${last}${i}`.toLowerCase();
  users.push({
    username,
    email: `${username}@${EMAIL_DOMAIN}`,
    fullName: `${first} ${last}`,
    branch: pickBranch(),
    created: signupDate().toISOString(),
    weight: activityWeight(),
  });
}

const client = new pg.Client({ connectionString: connectionString(nodes.coordinator) });
await client.connect();
const hash = await bcrypt.hash(PASSWORD, 10); // hashed once, reused for every user

let inserted = 0;
for (let start = 0; start < N; start += BATCH) {
  const b = users.slice(start, start + BATCH);
  const res = await client.query(
    `INSERT INTO users (username, email, password_hash, full_name, home_branch_id, created_at)
     SELECT u, e, $6::text, f, br, c
     FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::timestamptz[]) AS t(u, e, f, br, c)
     ON CONFLICT DO NOTHING`,
    [b.map((x) => x.username), b.map((x) => x.email), b.map((x) => x.fullName),
     b.map((x) => x.branch), b.map((x) => x.created), hash]
  );
  inserted += res.rowCount;
  console.log(`${Math.min(start + BATCH, N)} / ${N} processed (${inserted} new)`);
}

// Read the real user_ids back and save them with each user's activity weight.
const weightByEmail = new Map(users.map((u) => [u.email, u.weight]));
const { rows } = await client.query(
  "SELECT user_id, username, email, home_branch_id, created_at FROM users WHERE email LIKE $1 ORDER BY user_id",
  [`%@${EMAIL_DOMAIN}`]
);
await client.end();

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../data/users.jsonl");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  rows.map((r) => JSON.stringify({
    user_id: String(r.user_id),
    username: r.username,
    home_branch_id: r.home_branch_id,
    created_at: r.created_at,
    weight: weightByEmail.get(r.email) ?? 1,
  })).join("\n") + "\n"
);
console.log(`done: ${inserted} new users, ${rows.length} synthetic users total, saved to data/users.jsonl`);
console.log(`every generated user logs in with password: ${PASSWORD}`);