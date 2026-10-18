// Pulls real books from Open Library into data/books.jsonl.
// Run from the backend folder:  node scripts/fetch-books.js
// Re-running is safe: ISBNs already saved are skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../data/books.jsonl");
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const SUBJECTS = ["fiction", "science", "history", "computers", "romance",
  "fantasy", "biography", "mathematics", "art", "philosophy"];
const PAGES = 50; // 100 books per page
const FIELDS = ["title", "author_name", "first_publish_year", "isbn",
  "number_of_pages_median", "first_sentence", "ratings_average", "ratings_count",
  "want_to_read_count", "already_read_count"].join(",");
const USER_AGENT = "LibraryCourseProject/1.0 (ayeshaahmedyounus@gmail.com)"; // put your real email

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set();
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
    if (line.trim()) seen.add(JSON.parse(line).isbn);
  }
}
const out = fs.createWriteStream(outFile, { flags: "a" });

// Returns the list of books on that page, or null if it failed 4 times.
async function getPage(subject, page) {
  const url = new URL("https://openlibrary.org/search.json");
  url.search = new URLSearchParams({
    q: `subject:${subject}`, limit: "100", page: String(page), fields: FIELDS,
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return (await res.json()).docs || [];
      console.warn(`  ${subject} p${page}: HTTP ${res.status}, retry ${attempt}`);
    } catch (err) {
      console.warn(`  ${subject} p${page}: ${err.message}, retry ${attempt}`);
    }
    await sleep(2000 * attempt);
  }
  return null;
}

let added = 0, withRatings = 0;
for (const subject of SUBJECTS) {
  for (let page = 1; page <= PAGES; page++) {
    const docs = await getPage(subject, page);
    if (docs === null || docs.length === 0) break;
    for (const d of docs) {
      const isbn = (d.isbn || []).find((i) => /^\d{13}$/.test(i)); // ISBN-13 only
      const author = d.author_name?.[0];
      if (!isbn || !author || !d.title || seen.has(isbn)) continue;
      seen.add(isbn);

      const first = Array.isArray(d.first_sentence) ? d.first_sentence[0] : d.first_sentence;
      const ratingCount = d.ratings_count || 0;
      const popularity = (d.want_to_read_count || 0) + (d.already_read_count || 0) + ratingCount;
      if (ratingCount > 0) withRatings++;

      out.write(JSON.stringify({
        isbn,
        title: String(d.title).slice(0, 200),
        author: String(author).slice(0, 200),
        category: subject,
        year: d.first_publish_year ?? null,
        pages: d.number_of_pages_median ?? null,
        description: typeof first === "string" ? first.slice(0, 500) : null,
        rating_avg: d.ratings_average ?? null,
        rating_count: ratingCount,
        popularity, // real demand signal, used in step 3
      }) + "\n");
      added++;
    }
    await sleep(1000); // be polite to the API
  }
  console.log(`${subject} done - ${added} new books so far`);
}

await new Promise((r) => out.end(r));
console.log(`finished: ${added} new books (${withRatings} with real rating data), ${seen.size} total in file`);
