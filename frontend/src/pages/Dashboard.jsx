import { useEffect, useState } from "react";
import { BookOpen, Building2, ServerCog, Clock, Heart } from "lucide-react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import StatCard from "../components/StatCard";
import BooksIllustration from "../components/BooksIllustration";
import BookDetail from "./BookDetail";
import { searchBooks, getHealth, getMyHolds, getSimilarBooks } from "../api";
import { CATEGORIES, AUTHORS } from "../data/catalogMeta";
  import { useFavorites } from "../context/FavoritesContext";

const SORTS = [
  { value: "relevance", label: "Relevance" },
  { value: "rating", label: "Rating" },
  { value: "year", label: "Newest" },
];

function authorInitials(name) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// Fan out a query across every known category and merge the unique results.
// There's no single "browse all books" endpoint, so this reuses the search
// endpoint the same way the backend fans requests out across branches.
async function fetchAcrossCategories(sort, limitEach = 4) {
  const outcomes = await Promise.allSettled(
    CATEGORIES.map((c) => searchBooks(c, sort, limitEach))
  );
  const byIsbn = new Map();
  for (const o of outcomes) {
    if (o.status !== "fulfilled") continue;
    for (const book of o.value.results) byIsbn.set(book.isbn, book);
  }
  return [...byIsbn.values()];
}

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [popularSort, setPopularSort] = useState("rating");
  const [results, setResults] = useState([]);
  const [failedBranches, setFailedBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [health, setHealth] = useState(null);
  const [holds, setHolds] = useState([]);
  const { favorites } = useFavorites();
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [popular, setPopular] = useState([]);
  const [popularLoading, setPopularLoading] = useState(true);
  const [mostRead, setMostRead] = useState([]);
  const [newReleases, setNewReleases] = useState([]);
  const [forYou, setForYou] = useState([]);
  const [forYouLabel, setForYouLabel] = useState("For you");

  // Health + my-holds summary.
  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getMyHolds().then(setHolds).catch(() => setHolds([]));
  }, []);

  // Popular (re-fetched whenever the sort buttons change, so they aren't dead
  // when nothing has been searched yet).
  useEffect(() => {
    let cancelled = false;
    setPopularLoading(true);
    const effectiveSort = popularSort === "relevance" ? "rating" : popularSort;
    fetchAcrossCategories(effectiveSort, 4).then((merged) => {
      if (cancelled) return;
      const sorted =
        effectiveSort === "year"
          ? merged.sort((a, b) => (b.published_year || 0) - (a.published_year || 0))
          : merged.sort((a, b) => b.avg_rating - a.avg_rating);
      setPopular(sorted.slice(0, 10));
      setPopularLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [popularSort]);

  // Most read (proxy: highest rating_count, since there's no loan/checkout
  // count exposed by the backend) and New releases — loaded once.
  useEffect(() => {
    fetchAcrossCategories("rating", 4).then((merged) => {
      setMostRead([...merged].sort((a, b) => b.rating_count - a.rating_count).slice(0, 10));
    });
    fetchAcrossCategories("year", 4).then((merged) => {
      setNewReleases(
        [...merged].sort((a, b) => (b.published_year || 0) - (a.published_year || 0)).slice(0, 10)
      );
    });
  }, []);

  // "For you": similar books to your most recent favorite or active hold.
  // Falls back to a popular book once one is loaded, so the row isn't empty
  // for a brand-new account.
  useEffect(() => {
    const anchor = favorites[0] || holds[0] || popular[0];
    if (!anchor) return;
    const branchId = anchor.branches?.[0]?.branch_id || anchor.branch_id || 1;
    getSimilarBooks(anchor.isbn, branchId)
      .then((data) => {
        setForYou(data.similar || []);
        setForYouLabel(
          favorites[0] || holds[0] ? `For you, because you liked "${anchor.title}"` : "For you"
        );
      })
      .catch(() => setForYou([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites.length, holds.length, popular.length]);

  async function runSearch(q = query, s = sort) {
    if (!q.trim()) return;
    setQuery(q);
    setLoading(true);
    setSearched(true);
    try {
      const data = await searchBooks(q, s);
      setResults(data.results);
      setFailedBranches(data.branches_failed || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSortClick(value) {
    setSort(value);
    if (searched) runSearch(query, value);
    else setPopularSort(value);
  }

  function openBook(book) {
    setSelected(book);
  }


  const upNodes = health?.nodes?.filter((n) => n.status === "up").length ?? 0;
  const totalNodes = health?.nodes?.length ?? 0;

  const browseRows = [
    { key: "popular", title: popularSort === "year" ? "New on top" : "Popular right now", items: popular, loading: popularLoading },
    { key: "most-read", title: "Most rated books", items: mostRead },
    { key: "new-releases", title: "New releases", items: newReleases },
    { key: "for-you", title: forYouLabel, items: forYou },
  ];

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query={query} onQueryChange={setQuery} onSubmit={() => runSearch()} />

        <div className="dashboard-layout">
          <main className="dashboard">
            <section className="hero-banner">
              <div>
                <h2>Find your next book</h2>
                <p>Search across every branch at once, then reserve a copy in one click.</p>
                <div className="hero-sort">
                  {SORTS.map((s) => (
                    <button
                      key={s.value}
                      className={sort === s.value ? "active" : ""}
                      onClick={() => handleSortClick(s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <BooksIllustration />
            </section>

            <section className="stats-row">
              <StatCard icon={<BookOpen size={20} />} label="Results" value={results.length} tone="purple" />
              <StatCard
                icon={<Building2 size={20} />}
                label="Branches queried"
                value={3 - failedBranches.length + "/3"}
                tone="green"
              />
              <StatCard
                icon={<ServerCog size={20} />}
                label="Nodes up"
                value={totalNodes ? `${upNodes}/${totalNodes}` : "..."}
                tone="orange"
              />
              <StatCard icon={<Clock size={20} />} label="Active holds" value={holds.length} tone="purple" />
              <StatCard icon={<Heart size={20} />} label="Likes" value={favorites.length} tone="green" />
            </section>

            {failedBranches.length > 0 && (
              <div className="warning-banner">
                Branch{failedBranches.length > 1 ? "es" : ""} {failedBranches.join(", ")} did not
                respond — showing results from the others.
              </div>
            )}

            <section>
              <div className="section-heading">
                <h3>Browse by category</h3>
              </div>
              <div className="chip-row">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    className={`chip ${query === c ? "active" : ""}`}
                    onClick={() => runSearch(c, sort)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </section>

            {searched ? (
              <section>
                <div className="section-heading">
                  <h3>Results for "{query}"</h3>
                </div>
                {loading && <p className="muted">Searching...</p>}
                {!loading && results.length === 0 && (
                  <p className="muted">No books matched that search.</p>
                )}
                <div className="book-grid">
                  {results.map((book) => (
                    <BookCard key={book.isbn} book={book} onOpen={openBook} />
                  ))}
                </div>
              </section>
            ) : (
              <>
                {browseRows.map((row) => (
                  <section key={row.key}>
                    <div className="section-heading">
                      <h3>{row.title}</h3>
                    </div>
                    {row.loading && <p className="muted">Loading...</p>}
                    {!row.loading && row.items.length === 0 && (
                      <p className="muted">Nothing here yet.</p>
                    )}
                    <div className="book-grid">
                      {row.items.map((book) => (
                        <BookCard key={book.isbn} book={book} onOpen={openBook} />
                      ))}
                    </div>
                  </section>
                ))}

                <section>
                  <div className="section-heading">
                    <h3>Your likes</h3>
                  </div>
                  {favorites.length === 0 && (
                    <p className="muted">Tap the heart on a book to save it here.</p>
                  )}
                  <div className="book-grid">
                    {favorites.slice(0, 5).map((book) => (
                      <BookCard key={book.isbn} book={book} onOpen={openBook} />
                    ))}
                  </div>
                </section>

                <section>
                  <div className="section-heading">
                    <h3>Top authors</h3>
                  </div>
                  <div className="author-row">
                    {AUTHORS.map((name) => (
                      <button key={name} className="author-chip" onClick={() => runSearch(name, "relevance")}>
                        <span className="author-avatar">{authorInitials(name)}</span>
                        <span>{name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </main>

          <aside className="side-panel">
            <div className="panel-card gradient">
              <h4>Cluster health</h4>
              <p className="panel-big">
                {totalNodes ? `${upNodes}/${totalNodes}` : "..."} <span>nodes up</span>
              </p>
              <p className="panel-sub">
                {health?.overall === "ok"
                  ? "Every database, Redis and MongoDB node is responding."
                  : "Some nodes are degraded — search still works with partial results."}
              </p>
            </div>

            <div className="panel-card">
              <h4>
                <Clock size={16} /> Upcoming due dates
              </h4>
              {holds.length === 0 && <p className="muted">No active holds.</p>}
              <ul className="panel-list">
                {[...holds]
                  .sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at))
                  .slice(0, 3)
                  .map((h) => (
                    <li key={`${h.branch_id}-${h.hold_id}`}>
                      <span className="panel-list-title">{h.title}</span>
                      <span className="muted">{new Date(h.expires_at).toLocaleDateString()}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {selected && (
        <BookDetail
          book={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}