import express from "express";
import cors from "cors";
import { settings } from "./config.js";
import { checkAllNodes, closeAll } from "./db.js";
import { redis, pingRedis } from "./redis.js";
import { pingMongo, closeMongo } from "./mongo.js";
import { authRouter } from "./routes/auth.js";
import { searchRouter } from "./routes/search.js";
import { reservationsRouter } from "./routes/reservations.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { favoritesRouter } from "./routes/favorites.js";
import { reviewsRouter } from "./routes/reviews.js";
import { branchesRouter } from "./routes/branches.js";

const app = express();
app.use(cors({ origin: settings.corsOrigin }));
app.use(express.json());

app.get("/health", async (req, res) => {
  const [nodes, redisUp, mongoUp] = await Promise.all([
    checkAllNodes(),
    pingRedis(),
    pingMongo(),
  ]);
  const down = nodes.filter((n) => n.status !== "up").map((n) => n.node);
  res.json({
    overall: down.length === 0 && redisUp && mongoUp ? "ok" : "degraded",
    down_nodes: down,
    redis: redisUp ? "up" : "down",
    mongo: mongoUp ? "up" : "down",
    nodes,
  });
});

app.use("/auth", authRouter);
app.use("/books", searchRouter);
app.use("/books", recommendationsRouter);
app.use("/reservations", reservationsRouter);
app.use("/favorites", favoritesRouter);
app.use("/branches", branchesRouter);
app.use(reviewsRouter);

// Fallback error handler - so a bug in a route returns JSON, not an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const server = app.listen(settings.port, () => {
  console.log(`API listening on http://localhost:${settings.port}`);
});

async function shutdown() {
  server.close();
  redis.disconnect();
  await closeMongo();
  await closeAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);