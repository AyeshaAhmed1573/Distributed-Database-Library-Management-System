// k6 load test: hammer the search endpoint to prove the system holds up
// under traffic. This is the "no traffic should block the server" demo.
//
// Run against Nginx (the real distributed setup):
//   k6 run loadtest/search.js
//
// Run against one API instance directly (useful while developing):
//   k6 run -e BASE_URL=http://localhost:8000 loadtest/search.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const QUERIES = ["databases", "fiction", "history", "science", "poetry", "engineering"];

export const options = {
  // Ramp up, hold, ramp down - a realistic traffic spike, not a flat hammer.
  stages: [
    { duration: "10s", target: 20 },   // ramp up to 20 concurrent users
    { duration: "30s", target: 20 },   // hold steady at 20
    { duration: "10s", target: 50 },   // spike to 50
    { duration: "10s", target: 50 },   // hold the spike
    { duration: "10s", target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"],     // fewer than 5% of requests may fail
    http_req_duration: ["p(95)<1000"],  // 95% of requests under 1 second
  },
};

export default function () {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const res = http.get(`${BASE_URL}/books/search?q=${q}&sort=rating&limit=10`);

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has results array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).results);
      } catch {
        return false;
      }
    },
  });

  sleep(1); // a small pause per virtual user, like a real person reading results
}
