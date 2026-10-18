// node scripts/build-bloom.js   (re-run after seeding or adding books)
import pg from "pg";
import { nodes, connectionString } from "../src/config.js";
import { redis } from "../src/redis.js";
import { resetFilter, addTerms, markReady, checkTerms, termsOf } from "../src/services/bloomFilter.js";

if (redis.status !== "ready") await new Promise((r) => redis.once("ready", r));
await resetFilter();

let total = 0, checked = 0, mismatches = 0;
for (const i of [1, 2, 3]) {
  const client = new pg.Client({ connectionString: connectionString(nodes[`branch${i}_primary`]) });
  await client.connect();

  const { rows } = await client.query(
    "SELECT DISTINCT unnest(tsvector_to_array(search_vector)) AS term FROM books"
  );
  const terms = rows.map((r) => r.term);
  for (let j = 0; j < terms.length; j += 5000) await addTerms(terms.slice(j, j + 5000));
  total += terms.length;

  // Self-check: every real title must pass the filter, or stemming doesn't match Postgres
  const { rows: sample } = await client.query(
    "SELECT title FROM books ORDER BY random() LIMIT 2000"
  );
  for (const { title } of sample) {
    const t = termsOf(title);
    if (!t.length) continue;
    checked++;
    if ((await checkTerms(t, { requireReady: false })) === false) {
      if (++mismatches <= 5) console.warn("mismatch:", title);
    }
  }
  await client.end();
  console.log(`branch${i}: ${terms.length} words added`);
}

if (mismatches === 0) {
  await markReady();
  console.log(`done - ${total} words, ${checked} titles checked, 0 mismatches. Filter is live.`);
} else {
  console.warn(`${mismatches}/${checked} titles failed. Filter NOT enabled (search still works, just without it).`);
}
redis.disconnect();