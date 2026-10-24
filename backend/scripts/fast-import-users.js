
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import copyStreams from "pg-copy-streams";
import { connectionString, nodes } from "../src/config.js";

const { from: copyFrom } = copyStreams;
const CHUNK_LINES = 20_000;
const PROGRESS_INTERVAL = 1_000_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.resolve(here, process.env.USERS_FILE || "../data/users.jsonl");
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

if (!process.argv.includes("--confirm")) {
  console.error("This will add synthetic accounts to coordinator.users.");
  console.error("Rerun with --confirm to proceed.");
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Missing generated users file: ${inputPath}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: connectionString(nodes.coordinator) });
let read = 0;

// Reads the file line by line and yields chunks of CSV text for COPY.
async function* csvChunks() {
  const lines = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let buf = [];
  for await (const line of lines) {
    read++;
    if (!line) continue;

    let u;
    try {
      u = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSON on line ${read}: ${err.message}`);
    }
    if (
      !u || typeof u !== "object" || Array.isArray(u) ||
      typeof u.user_id !== "string" || !UUID_V4.test(u.user_id) ||
      typeof u.username !== "string" || u.username.length === 0 || u.username.length > 50 ||
      !Number.isInteger(u.home_branch_id) || u.home_branch_id < 1 || u.home_branch_id > 3 ||
      !Number.isFinite(Date.parse(u.created_at))
    ) {
      throw new Error(`Invalid generated user on line ${read}`);
    }

    // username is the only free-text field, so it is the only one that needs CSV quoting
    buf.push(
      `${u.user_id},"${u.username.replaceAll('"', '""')}",${u.home_branch_id},${new Date(u.created_at).toISOString()}\n`
    );
    if (buf.length >= CHUNK_LINES) {
      yield buf.join("");
      buf = [];
    }
    if (read % PROGRESS_INTERVAL === 0) console.log(`  ${read.toLocaleString()} lines streamed`);
  }
  if (buf.length) yield buf.join("");
}

async function stageIsComplete() {
  const { rows } = await client.query(
    "SELECT obj_description(to_regclass('users_stage'), 'pg_class') AS note"
  );
  return rows[0].note === "complete";
}

try {
  await client.connect();
  console.log("Target:", connectionString(nodes.coordinator).replace(/:[^:@/]+@/, ":***@"));
  const startedAll = Date.now();

  // ---------- step 1: COPY the file into an unindexed staging table ----------
  if (!process.argv.includes("--restage") && (await stageIsComplete())) {
    console.log("Step 1: staging table is already complete, skipping the file read (use --restage to redo it).");
  } else {
    const t0 = Date.now();
    console.log("Step 1: streaming the file into a staging table with COPY...");
    await client.query("DROP TABLE IF EXISTS users_stage");
    await client.query(
      `CREATE UNLOGGED TABLE users_stage (
         user_id uuid, username text, home_branch_id smallint, created_at timestamptz)`
    );
    await pipeline(
      Readable.from(csvChunks()),
      client.query(copyFrom("COPY users_stage (user_id, username, home_branch_id, created_at) FROM STDIN WITH (FORMAT csv)"))
    );
    await client.query("COMMENT ON TABLE users_stage IS 'complete'");
    await client.query("ANALYZE users_stage");
    console.log(`  ${read.toLocaleString()} lines staged in ${secs(t0)}`);
  }

  // ---------- step 2: one transaction - drop secondary indexes, insert, rebuild ----------
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const { rows: secondary } = await client.query(
    `SELECT pg_get_indexdef(i.indexrelid) AS index_def,
            i.indexrelid::regclass::text AS index_name,
            quote_ident(c.conname) AS constraint_name,
            pg_get_constraintdef(c.oid) AS constraint_def
       FROM pg_index i
       LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid AND c.conrelid = i.indrelid
      WHERE i.indrelid = 'users'::regclass AND NOT i.indisprimary
      ORDER BY i.indexrelid`
  );
  console.log(`Step 2: moving rows into users (${secondary.length} secondary indexes will be rebuilt afterwards)...`);
  console.log("  Note: logins and username checks wait until this finishes.");

  const t1 = Date.now();
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL synchronous_commit = off");
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query("SET LOCAL maintenance_work_mem = '512MB'");

    for (const ix of secondary) {
      await client.query(
        ix.constraint_name ? `ALTER TABLE users DROP CONSTRAINT ${ix.constraint_name}` : `DROP INDEX ${ix.index_name}`
      );
    }
    console.log(`  indexes dropped (${secs(t1)})`);

    const t2 = Date.now();
    const result = await client.query(
      `INSERT INTO users (user_id, username, email, password_hash, full_name, home_branch_id, created_at)
       SELECT s.user_id, s.username, s.username || '@generated.invalid', $1, s.username, s.home_branch_id, s.created_at
         FROM users_stage s
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = s.user_id)
        ORDER BY s.user_id
       ON CONFLICT DO NOTHING`,
      [passwordHash]
    );
    console.log(`  ${result.rowCount.toLocaleString()} new rows inserted in ${secs(t2)}`);

    for (const ix of secondary) {
      const t3 = Date.now();
      await client.query(
        ix.constraint_name ? `ALTER TABLE users ADD CONSTRAINT ${ix.constraint_name} ${ix.constraint_def}` : ix.index_def
      );
      console.log(`  rebuilt ${ix.constraint_name || ix.index_name} in ${secs(t3)}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }

  // ---------- step 3: tidy up ----------
  await client.query("ANALYZE users");
  await client.query("DROP TABLE IF EXISTS users_stage");
  const { rows } = await client.query("SELECT count(*)::bigint AS n FROM users");
  console.log(`Done in ${secs(startedAll)}. users now has ${Number(rows[0].n).toLocaleString()} rows.`);
} catch (err) {
  console.error(`Import failed after reading ${read.toLocaleString()} lines:`, err);
  console.error("Nothing in users was changed by the failed step. The staging table (if it finished) is kept, so a re-run can skip the file read.");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}