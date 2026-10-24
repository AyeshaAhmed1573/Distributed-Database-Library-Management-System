import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { connectionString, nodes } from "../src/config.js";

const BATCH_SIZE = 5000;
const PROGRESS_INTERVAL = 500_000;
const CONFIRMED = process.argv.includes("--confirm");
const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.resolve(here, "../data/users.jsonl");

if (!CONFIRMED) {
  console.error("This will append synthetic accounts to coordinator.users.");
  console.error("Review the database target, then rerun with --confirm to proceed.");
  process.exitCode = 1;
} else if (!fs.existsSync(inputPath)) {
  console.error(`Missing generated users file: ${inputPath}`);
  process.exitCode = 1;
} else {
  const client = new pg.Client({ connectionString: connectionString(nodes.coordinator) });
  const batch = [];
  let read = 0;
  let inserted = 0;
  let skipped = 0;

  async function flush(passwordHash, reportProgress = false) {
    if (batch.length === 0) return;

    const users = batch.splice(0, batch.length);
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO users (user_id, username, email, password_hash, full_name, home_branch_id, created_at)
         SELECT input.user_id, input.username, input.email, $4, input.username, input.home_branch_id, input.created_at
         FROM unnest($1::uuid[], $2::text[], $3::text[], $5::smallint[], $6::timestamptz[])
           AS input(user_id, username, email, home_branch_id, created_at)
         ON CONFLICT DO NOTHING`,
        [
          users.map((user) => user.user_id),
          users.map((user) => user.username),
          users.map((user) => `${user.username}@generated.invalid`),
          passwordHash,
          users.map((user) => user.home_branch_id),
          users.map((user) => user.created_at),
        ]
      );
      await client.query("COMMIT");
      inserted += result.rowCount;
      skipped += users.length - result.rowCount;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }

    if (reportProgress || read % PROGRESS_INTERVAL === 0) {
      console.log(`${read.toLocaleString()} read; ${inserted.toLocaleString()} inserted; ${skipped.toLocaleString()} skipped`);
    }
  }

  try {
    await client.connect();
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const lines = readline.createInterface({
      input: fs.createReadStream(inputPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      read++;
      if (!line) continue;

      let user;
      try {
        user = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${read}: ${error.message}`);
      }

      if (
        !user ||
        typeof user !== "object" ||
        Array.isArray(user) ||
        typeof user.user_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.user_id) ||
        typeof user.username !== "string" ||
        user.username.length === 0 ||
        user.username.length > 50 ||
        !Number.isInteger(user.home_branch_id) ||
        user.home_branch_id < 1 ||
        user.home_branch_id > 3 ||
        !Number.isFinite(Date.parse(user.created_at))
      ) {
        throw new Error(`Invalid generated user on line ${read}`);
      }

      batch.push({
        user_id: user.user_id,
        username: user.username,
        home_branch_id: user.home_branch_id,
        created_at: new Date(user.created_at).toISOString(),
      });
      if (batch.length === BATCH_SIZE) await flush(passwordHash);
    }

    await flush(passwordHash, true);
    await client.query("ANALYZE users");
    console.log(`Import complete: ${inserted.toLocaleString()} inserted, ${skipped.toLocaleString()} conflicts skipped.`);
  } catch (error) {
    console.error(`User import failed after reading ${read.toLocaleString()} lines:`, error);
    process.exitCode = 1;
  } finally {
    await client.end().catch((error) => {
      console.error("Could not close coordinator database connection:", error);
      process.exitCode = 1;
    });
  }
}
