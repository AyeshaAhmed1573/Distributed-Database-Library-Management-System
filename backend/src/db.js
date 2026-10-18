// Connection pools for every Postgres node (3 primaries, 3 replicas, coordinator).
//
// A pool does not connect until it is used, so a node that is down at startup
// never stops the API. Each query on a dead node fails fast and only that
// request sees the error - the rest of the system keeps working.
import pg from "pg";
import { nodes, settings, connectionString } from "./config.js";

const pools = {};
for (const node of Object.values(nodes)) {
  const pool = new pg.Pool({
    connectionString: connectionString(node),
    max: settings.poolMax,
    connectionTimeoutMillis: settings.connectTimeoutMs,
    query_timeout: 5000,
  });
  // Without this handler, a node dying while connections are idle would crash Node.
  pool.on("error", (err) => console.warn(`[db] ${node.name}: ${err.message}`));
  pools[node.name] = pool;
}

export function getPool(name) {
  const pool = pools[name];
  if (!pool) throw new Error(`Unknown node: ${name}`);
  return pool;
}

// Health probe for one node. Never throws.
export async function checkNode(name) {
  const node = nodes[name];
  const started = performance.now();
  try {
    const pool = getPool(name);
    const info = { node: name, status: "up" };

    if (node.role === "replica") {
      const r = await pool.query("SELECT pg_is_in_recovery() AS v");
      info.in_recovery = r.rows[0].v;
    } else if (node.role === "primary") {
      const r = await pool.query(
        "SELECT count(*)::int AS v FROM pg_stat_replication WHERE state = 'streaming'"
      );
      info.streaming_replicas = r.rows[0].v;
    } else {
      await pool.query("SELECT 1");
    }

    info.latency_ms = Math.round((performance.now() - started) * 10) / 10;
    return info;
  } catch (err) {
    return { node: name, status: "down", error: err.code || err.name };
  }
}

export function checkAllNodes() {
  return Promise.all(Object.keys(nodes).map(checkNode));
}

export async function closeAll() {
  await Promise.allSettled(Object.values(pools).map((p) => p.end()));
}
