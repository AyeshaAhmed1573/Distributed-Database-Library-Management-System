// Central configuration + the map of every database node.
//
// Two ways to run the API:
//   * on your laptop  -> nodes are reached via localhost + the mapped ports
//   * inside Docker   -> nodes are reached via service names on port 5432
// Set IN_DOCKER=1 to switch (the Dockerfile does this for you).
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// project-root .env (works no matter which folder you start node from)
dotenv.config({ path: path.resolve(here, "../../.env") });

const env = process.env;
const inDocker = ["1", "true"].includes(String(env.IN_DOCKER).toLowerCase());

export const settings = {
  port: Number(env.PORT || 8000),
  inDocker,
  postgresUser: env.POSTGRES_USER || "admin",
  postgresPassword: env.POSTGRES_PASSWORD || "admin123",
  redisUrl: env.REDIS_URL || `redis://${inDocker ? "redis" : "localhost"}:6379`,
  mongoUrl:
    env.MONGO_URL ||
    `mongodb://${env.MONGO_USER || "admin"}:${env.MONGO_PASSWORD || "admin123"}@${inDocker ? "mongo" : "localhost"}:27017/?authSource=admin`,
  mongoDbName: "library_docs",
  jwtSecret: env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: "7d",
  holdDurationHours: 72,
  corsOrigin: env.CORS_ORIGIN || "http://localhost:5173",
  connectTimeoutMs: 3000,
  poolMax: 10,
  qdrantUrl: env.QDRANT_URL || `http://${inDocker ? "qdrant" : "localhost"}:6333`,
  esUrl: env.ES_URL || `http://${inDocker ? "elasticsearch" : "localhost"}:9200`,
};

// name -> { name, role, branchId, host, port, database }
export function buildNodes() {
  const nodes = {};
  nodes.coordinator = {
    name: "coordinator",
    role: "coordinator",
    branchId: null,
    host: inDocker ? "coordinator-db" : "localhost",
    port: inDocker ? 5432 : 5440,
    database: "coordinator",
  };
  for (const i of [1, 2, 3]) {
    for (const [role, base] of [["primary", 5440], ["replica", 5450]]) {
      const name = `branch${i}_${role}`;
      nodes[name] = {
        name,
        role,
        branchId: i,
        host: inDocker ? `branch${i}-${role}` : "localhost",
        port: inDocker ? 5432 : base + i,   // 5441-5443 primaries, 5451-5453 replicas
        database: "library",
      };
    }
  }
  return nodes;
}

export const nodes = buildNodes();

export function connectionString(node) {
  const { postgresUser: u, postgresPassword: p } = settings;
  return `postgresql://${u}:${encodeURIComponent(p)}@${node.host}:${node.port}/${node.database}`;
}
