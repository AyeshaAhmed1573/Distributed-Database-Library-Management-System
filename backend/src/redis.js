import Redis from "ioredis";
import { settings } from "./config.js";

// enableOfflineQueue:false -> commands fail immediately when Redis is down
// instead of hanging, so /health can report it quickly.
export const redis = new Redis(settings.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});
redis.on("error", () => {}); // reconnects automatically; avoid crashing on connection errors

export async function pingRedis() {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}
