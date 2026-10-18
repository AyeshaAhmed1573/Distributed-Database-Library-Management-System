// Generates users and streams them straight to disk in chunks, split across
// several worker threads running in parallel - so memory use stays flat no
// matter how many users you ask for, and the full CPU gets used.
//
//   node scripts/generate-users.js 5000000            (5M users, auto worker count)
//   node scripts/generate-users.js 50000000 --workers 8
//
// Writes data/users.jsonl. Fields match what scripts/generate-activity.js
// expects: user_id, username, created_at, home_branch_id, weight.
import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, "../data");
const OUT_FILE = path.join(DATA_DIR, "users.jsonl");

// ---------------------------------------------------------------
// MAIN THREAD: parse args, spawn workers, each writing its own shard
// file, then stream-concatenate the shards into one final file.
// ---------------------------------------------------------------
if (isMainThread) {
  const args = process.argv.slice(2);
  const N = Number(args.find((a) => !a.startsWith("--")) || 5_000_000);
  const workersArgIdx = args.indexOf("--workers");
  const WORKERS = Math.max(1, Number(workersArgIdx >= 0 ? args[workersArgIdx + 1] : os.cpus().length));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`generating ${N} users across ${WORKERS} worker thread(s)...`);

  const started = Date.now();
  const perWorker = Math.ceil(N / WORKERS);
  const shardPaths = [];

  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => {
      const start = i * perWorker;
      const count = Math.min(perWorker, N - start);
      if (count <= 0) return Promise.resolve(null);
      const shardPath = path.join(DATA_DIR, `.tmp-users-shard-${i}.jsonl`);
      shardPaths.push(shardPath);
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: { start, count, shardPath, seed: 1000 + i },
        });
        worker.on("message", (msg) => console.log(`  worker ${i}: ${msg.written} users written`));
        worker.on("error", reject);
        worker.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}`))));
      });
    })
  );

  console.log("concatenating shards into data/users.jsonl ...");
  await concatFiles(shardPaths.filter(Boolean), OUT_FILE);
  for (const p of shardPaths) if (p && fs.existsSync(p)) fs.unlinkSync(p);

  const sizeMb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\ndone: ${N} users, ${sizeMb} MB, ${seconds}s (${Math.round(N / (seconds || 1))} users/sec)`);
}

// Streams each shard file into the output in order, without ever loading a
// whole shard into memory - this is what keeps a 10GB final file from
// blowing up RAM during the merge step too.
function concatFiles(inputs, outputPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    function next(i) {
      if (i >= inputs.length) return out.end(resolve);
      const inStream = fs.createReadStream(inputs[i]);
      inStream.pipe(out, { end: false });
      inStream.on("end", () => next(i + 1));
      inStream.on("error", reject);
    }
    next(0);
  });
}

// ---------------------------------------------------------------
// WORKER THREAD: generates its slice of users and writes them one line
// at a time, respecting backpressure, so this never buffers more than
// a small amount of data in memory regardless of how many users it owns.
// ---------------------------------------------------------------
if (!isMainThread) {
  const { start, count, shardPath, seed } = workerData;

  function makeRng(s) {
    let a = s >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = makeRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const FIRST = ["ayesha", "omar", "sara", "daniel", "mei", "hassan", "elena", "john", "fatima",
    "liam", "zainab", "carlos", "nadia", "robert", "hira", "ali", "sana", "bilal", "mariam", "usman"];
  const LAST = ["khan", "farooq", "malik", "reyes", "lin", "raza", "petrova", "carter", "noor",
    "obrien", "hussain", "mendes", "klein", "sheikh", "siddiqui", "ahmed", "iqbal", "baig"];

  const FIVE_YEARS_MS = 5 * 365 * 86400000;
  const NOW = Date.now();

  const stream = fs.createWriteStream(shardPath);
  let written = 0;

  async function run() {
    for (let k = 0; k < count; k++) {
      const i = start + k;
      const first = pick(FIRST);
      const last = pick(LAST);

      const user = {
        user_id: randomUuidV4(rng),
        username: `${first}_${last}${i}`,
        created_at: new Date(NOW - rng() * FIVE_YEARS_MS).toISOString(),
        home_branch_id: 1 + Math.floor(rng() * 3),
        weight: Math.exp(rng() * 2 - 1),
      };

      const ok = stream.write(JSON.stringify(user) + "\n");
      written++;
      if (!ok) await new Promise((resolve) => stream.once("drain", resolve)); // respect backpressure

      if (written % 500_000 === 0) parentPort.postMessage({ written });
    }
    await new Promise((resolve) => stream.end(resolve));
    parentPort.postMessage({ written });
  }

  function randomUuidV4(rng) {
    const hex = () => Math.floor(rng() * 16).toString(16);
    const s = () => Array.from({ length: 4 }, hex).join("");
    return `${s()}${s()}-${s()}-4${s().slice(1)}-${["8", "9", "a", "b"][Math.floor(rng() * 4)]}${s().slice(1)}-${s()}${s()}${s()}`;
  }

  await run();
}