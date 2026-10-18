// Bloom filter over every word the search can match, stored as a Redis bitmap
// so all API instances share it.
//   "no"    = definitely no book has this word -> skip cache + all 3 branches
//   "maybe" = continue through the normal search path
// It fails open: if Redis is down or the filter was never built, every
// query counts as "maybe", so search keeps working.
import crypto from "node:crypto";
import snowball from "snowball-stemmers";
import { redis } from "../redis.js";

const KEY = "bloom:terms";
const READY_KEY = "bloom:terms:ready";
const BITS = 16_000_000; // 2 MB, <0.1% false positives up to ~1M distinct words
const HASHES = 7;

const stemmer = snowball.newStemmer("english");
const STOPWORDS = new Set(
  ("i me my myself we our ours ourselves you your yours yourself yourselves he him his " +
   "himself she her hers herself it its itself they them their theirs themselves what " +
   "which who whom this that these those am is are was were be been being have has had " +
   "having do does did doing a an the and but if or because as until while of at by for " +
   "with about against between into through during before after above below to from up " +
   "down in out on off over under again further then once here there when where why how " +
   "all any both each few more most other some such no nor not only own same so than too " +
   "very s t can will just don should now").split(" ")
);

function positions(term) {
  const h = crypto.createHash("md5").update(term).digest();
  const h1 = h.readUInt32LE(0);
  const h2 = (h.readUInt32LE(4) | 1) >>> 0; // odd, kept unsigned
  return Array.from({ length: HASHES }, (_, i) => (h1 + i * h2) % BITS);
}

// text -> stemmed words, minus stopwords (what Postgres would actually search for)
export function termsOf(text) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.filter((w) => !STOPWORDS.has(w)).map((w) => stemmer.stem(w));
}

export async function resetFilter() {
  await redis.del(KEY, READY_KEY);
}

// terms must already be stemmed (the build script gets them from Postgres)
export async function addTerms(terms) {
  const pipe = redis.pipeline();
  for (const t of terms) for (const p of positions(t)) pipe.setbit(KEY, p, 1);
  await pipe.exec();
}

export const markReady = () => redis.set(READY_KEY, "1");

// true  = every term is "maybe present"
// false = at least one term is definitely absent
// null  = can't tell (Redis error, or filter not built)
export async function checkTerms(terms, { requireReady = true } = {}) {
  const pipe = redis.pipeline();
  pipe.get(READY_KEY);
  for (const t of terms) for (const p of positions(t)) pipe.getbit(KEY, p);
  const out = await pipe.exec();
  if (out.some(([err]) => err)) return null;
  if (requireReady && !out[0][1]) return null;
  const bits = out.slice(1).map(([, v]) => v);
  for (let i = 0; i < terms.length; i++) {
    if (bits.slice(i * HASHES, (i + 1) * HASHES).includes(0)) return false;
  }
  return true;
}

export async function mightMatch(q) {
  try {
    if (!/^[\p{L}\p{N}\s]+$/u.test(q)) return true; // quotes, "-word", punctuation: let the DB decide
    if (/\bor\b/i.test(q)) return true;             // websearch "or" operator
    const terms = termsOf(q);
    if (terms.length === 0) return true;
    return (await checkTerms(terms)) !== false;
  } catch {
    return true;
  }
}