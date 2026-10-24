import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, BookOpen, Activity, MessageSquare, RefreshCw, Plus, Pencil, Trash2, Search, X } from "lucide-react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import StatCard from "../components/StatCard";
import {
  getHealth,
  getAdminOverview,
  getAdminEventsPerDay,
  getAdminTopBooks,
  getAdminTopSearches,
  getAdminBranches,
  getAdminCatalog,
  getAdminBook,
  addAdminBook,
  updateAdminBook,
  deleteAdminBook,
} from "../api";
import "./AdminDashboard.css";

const ACCENT = "#6c4ff0";
const RANGES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "3 years", days: 1095 },
];

const fmt = (n) => Number(n ?? 0).toLocaleString();

function describe(err) {
  const status = err?.response?.status;
  if (status === 403) return "Staff access required.";
  return `Could not load this section${status ? ` (HTTP ${status})` : " (API unreachable)"}.`;
}

function prettyNode(name) {
  if (name === "coordinator") return "Coordinator";
  const m = name.match(/^branch(\d)_(primary|replica)$/);
  return m ? `Branch ${m[1]} · ${m[2]}` : name;
}

// Sum daily points into calendar weeks so a multi-year chart stays readable.
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function toWeekly(points) {
  const weeks = new Map();
  for (const p of points) {
    const key = weekStart(p.day);
    weeks.set(key, (weeks.get(key) || 0) + p.events);
  }
  return [...weeks.entries()].map(([day, events]) => ({ day, events }));
}

function HealthTile({ name, up, detail }) {
  return (
    <div className={`health-tile ${up ? "up" : "down"}`}>
      <span className="health-dot" />
      <div>
        <strong>{name}</strong>
        <span className="muted">{detail}</span>
      </div>
    </div>
  );
}

function LineChart({ points }) {
  const [hover, setHover] = useState(null);
  if (points.length < 2) return <p className="muted">Not enough data to draw a chart.</p>;

  const W = 720, H = 230;
  const pad = { l: 52, r: 12, t: 14, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(...points.map((p) => p.events), 1);
  const x = (i) => pad.l + (i / (points.length - 1)) * innerW;
  const y = (v) => pad.t + innerH - (v / max) * innerH;

  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.events).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${pad.t + innerH} L${x(0).toFixed(1)},${pad.t + innerH} Z`;
  const labelAt = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const hp = hover === null ? null : points[hover];

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / innerW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  return (
    <svg
      className="admin-chart"
      viewBox={`0 0 ${W} ${H}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <rect width={W} height={H} fill="transparent" />
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" strokeOpacity="0.12" />
          <text x={pad.l - 8} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.6">
            {fmt(Math.round(max * f))}
          </text>
        </g>
      ))}
      <path d={area} fill={ACCENT} fillOpacity="0.15" />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" />
      {labelAt.map((i, k) => (
        <text
          key={i}
          x={x(i)}
          y={H - 6}
          fontSize="11"
          fill="currentColor"
          fillOpacity="0.6"
          textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
        >
          {points[i].day}
        </text>
      ))}
      {hp && (
        <g>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke={ACCENT} strokeOpacity="0.5" />
          <circle cx={x(hover)} cy={y(hp.events)} r="4" fill={ACCENT} />
          <text
            x={x(hover) > W / 2 ? x(hover) - 8 : x(hover) + 8}
            y={pad.t + 12}
            fontSize="12"
            fontWeight="600"
            fill="currentColor"
            textAnchor={x(hover) > W / 2 ? "end" : "start"}
          >
            {hp.day}: {fmt(hp.events)}
          </text>
        </g>
      )}
    </svg>
  );
}

function BarList({ items, empty }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ol className="bar-list">
      {items.map((it, i) => (
        <li key={it.key}>
          <div className="bar-head">
            <span className="bar-rank">{i + 1}</span>
            <span className="bar-label" title={it.label}>{it.label}</span>
            <span className="bar-value">{fmt(it.value)}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          {it.sub && <span className="bar-sub muted">{it.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

export default function AdminDashboard() {
  const [health, setHealth] = useState(undefined); // undefined = checking, null = unreachable
  const [overview, setOverview] = useState(null);
  const [topBooks, setTopBooks] = useState(null);
  const [topSearches, setTopSearches] = useState(null);
  const [branches, setBranches] = useState(null);
  const [events, setEvents] = useState(null);
  const [days, setDays] = useState(365);
  const [errors, setErrors] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogError, setCatalogError] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [bookForm, setBookForm] = useState(null);
  const [bookMode, setBookMode] = useState("add");
  const [bookFormError, setBookFormError] = useState("");
  const [bookSaving, setBookSaving] = useState(false);
  const [bookDetailsLoading, setBookDetailsLoading] = useState(false);
  const [bookDetailsFailed, setBookDetailsFailed] = useState(false);
  const bookRequest = useRef(0);
  const catalogRequest = useRef(0);

  const setError = useCallback((key, msg) => setErrors((e) => ({ ...e, [key]: msg })), []);
  const loadCatalog = useCallback(async (query, page) => {
    const requestId = ++catalogRequest.current;
    setCatalogBusy(true);
    try {
      const result = await getAdminCatalog({ q: query, page, limit: 20 });
      if (requestId !== catalogRequest.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.limit));
      if (page > lastPage) {
        setCatalogPage(lastPage);
        return;
      }
      setCatalog(result);
      setCatalogError("");
    } catch (err) {
      if (requestId === catalogRequest.current) {
        setCatalogError(err?.response?.data?.error || describe(err));
      }
    } finally {
      if (requestId === catalogRequest.current) setCatalogBusy(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => loadCatalog(catalogQuery, catalogPage), 250);
    return () => clearTimeout(timeout);
  }, [catalogQuery, catalogPage, loadCatalog]);

  function startBookForm(mode, book = null) {
    const requestId = ++bookRequest.current;
    setBookMode(mode);
    setBookDetailsLoading(!!book);
    setBookDetailsFailed(false);
    const branchId = book
      ? [1, 2, 3].find((id) => !book.branches?.some((branch) => branch.branch_id === id && branch.total_copies > 0)) || 1
      : 1;
    setBookForm({
      isbn: book?.isbn || "",
      title: book?.title || "",
      author: book?.author || "",
      category: book?.category || "",
      published_year: book?.published_year || "",
      publisher: book?.publisher || "",
      page_count: book?.page_count || "",
      description: book?.description || "",
      branch_id: String(branchId),
      copies: "1",
    });
    setBookFormError("");
    setCatalogMessage("");
    if (book) {
      getAdminBook(book.isbn)
        .then((details) => {
          if (requestId !== bookRequest.current) return;
          setBookForm((form) => form?.isbn === book.isbn ? {
            ...form,
            ...details,
            published_year: details.published_year || "",
            page_count: details.page_count || "",
            publisher: details.publisher || "",
            description: details.description || "",
            branch_id: String(branchId),
            copies: "1",
          } : form);
        })
        .catch((err) => {
          if (requestId === bookRequest.current) {
            setBookFormError(err?.response?.data?.error || describe(err));
            setBookDetailsFailed(true);
          }
        })
        .finally(() => {
          if (requestId === bookRequest.current) setBookDetailsLoading(false);
        });
    }
  }

  function closeBookForm() {
    bookRequest.current++;
    setBookForm(null);
    setBookFormError("");
    setBookDetailsLoading(false);
    setBookDetailsFailed(false);
  }

  async function submitBook(event) {
    event.preventDefault();
    setBookSaving(true);
    setBookFormError("");
    try {
      if (bookMode === "edit") {
        const result = await updateAdminBook(bookForm.isbn, bookForm);
        setCatalogMessage("Book details updated across its stocked branches.");
        await loadCatalog(catalogQuery, catalogPage);
        if (result.warnings?.length) setCatalogError(result.warnings.join(" "));
      } else {
        const result = await addAdminBook(bookForm);
        setCatalogMessage("Book added to the selected branch.");
        await loadCatalog(catalogQuery, catalogPage);
        if (result.warnings?.length) setCatalogError(result.warnings.join(" "));
      }
      closeBookForm();
    } catch (err) {
      setBookFormError(err?.response?.data?.error || describe(err));
    } finally {
      setBookSaving(false);
    }
  }

  async function removeBook(book) {
    if (!window.confirm(`Delete "${book.title}" from every branch? This is only allowed when it has no hold or loan history.`)) return;
    setCatalogMessage("");
    try {
      const result = await deleteAdminBook(book.isbn);
      setCatalogMessage("Book deleted.");
      await loadCatalog(catalogQuery, catalogPage);
      if (result.warnings?.length) setCatalogError(result.warnings.join(" "));
    } catch (err) {
      setCatalogError(err?.response?.data?.error || describe(err));
    }
  }

  // Health tiles: poll every 5 seconds.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      getHealth()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Everything except the chart.
  const loadAll = useCallback(() => {
    const run = (key, promise, setter) =>
      promise
        .then((d) => { setter(d); setError(key, ""); })
        .catch((err) => setError(key, describe(err)));
    run("overview", getAdminOverview(), setOverview);
    run("books", getAdminTopBooks(10), setTopBooks);
    run("searches", getAdminTopSearches(10), setTopSearches);
    run("branches", getAdminBranches(), setBranches);
    setLoadedAt(new Date());
  }, [setError]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // The chart reloads when the range changes.
  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    getAdminEventsPerDay(days)
      .then((d) => { if (!cancelled) { setEvents(d); setError("events", ""); } })
      .catch((err) => { if (!cancelled) setError("events", describe(err)); });
    return () => { cancelled = true; };
  }, [days, setError]);

  const weekly = !!events && events.points.length > 200;
  const chartPoints = useMemo(() => {
    if (!events) return null;
    return events.points.length > 200 ? toWeekly(events.points) : events.points;
  }, [events]);
  const totalInRange = events ? events.points.reduce((s, p) => s + p.events, 0) : 0;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query="" onQueryChange={() => {}} onSubmit={() => {}} />
        <main className="dashboard admin-dashboard">
          <div className="admin-header">
            <div>
              <h2>Admin dashboard</h2>
              <p className="muted">Live cluster status and library activity across all branches.</p>
            </div>
            <button className="admin-refresh" onClick={loadAll}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>

          <section className="stats-row">
            <StatCard icon={<Users size={20} />} label="Users" value={overview ? fmt(overview.users) : "..."} tone="purple" />
            <StatCard icon={<BookOpen size={20} />} label="Books" value={overview ? fmt(overview.books) : "..."} tone="green" />
            <StatCard icon={<Activity size={20} />} label="Events logged" value={overview ? fmt(overview.events) : "..."} tone="orange" />
            <StatCard icon={<MessageSquare size={20} />} label="Reviews" value={overview ? fmt(overview.reviews) : "..."} tone="purple" />
          </section>
          {errors.overview && <div className="status-error">{errors.overview}</div>}

          <section className="panel-card catalog-panel">
            <div className="section-heading">
              <div>
                <h3>Book management</h3>
                <p className="muted">Add titles to branches, update catalog details, and remove books with no borrowing history.</p>
              </div>
              <button className="admin-action primary" onClick={() => startBookForm("add")}>
                <Plus size={16} /> Add book
              </button>
            </div>
            <label className="catalog-search">
              <Search size={17} />
              <input
                value={catalogQuery}
                onChange={(event) => { setCatalogQuery(event.target.value); setCatalogPage(1); }}
                placeholder="Search title, author, ISBN, or category"
              />
            </label>
            {catalogMessage && <div className="catalog-success" role="status">{catalogMessage}</div>}
            {catalogError && <div className="status-error">{catalogError}</div>}
            {catalogBusy && <p className="muted">Loading catalog...</p>}
            {!catalogBusy && catalog && catalog.books.length === 0 && <p className="muted">No matching books.</p>}
            {catalog?.books?.length > 0 && (
              <div className="catalog-table-wrap">
                <table className="catalog-table">
                  <thead>
                    <tr><th>Book</th><th>ISBN</th><th>Branch stock</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {catalog.books.map((book) => {
                      const byBranch = new Map(book.branches.map((branch) => [branch.branch_id, branch]));
                      return (
                        <tr key={book.isbn}>
                          <td><strong>{book.title}</strong><span className="catalog-sub">{book.author} · {book.category}</span></td>
                          <td>{book.isbn}</td>
                          <td>
                            <div className="catalog-stock">
                              {[1, 2, 3].map((id) => {
                                const stock = byBranch.get(id);
                                return <span key={id}>B{id}: {fmt(stock?.available_copies || 0)}/{fmt(stock?.total_copies || 0)}</span>;
                              })}
                            </div>
                          </td>
                          <td>
                            <div className="catalog-actions">
                              <button className="admin-action" onClick={() => startBookForm("edit", book)} title="Edit book details">
                                <Pencil size={15} /> Edit
                              </button>
                              <button className="admin-action" onClick={() => startBookForm("add", book)} title="Add this book to another branch">
                                <Plus size={15} /> Stock branch
                              </button>
                              <button className="admin-action danger" onClick={() => removeBook(book)} title="Delete book">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="catalog-pagination">
                  <span className="muted">{fmt(catalog.total)} books · Page {catalog.page} of {Math.max(1, Math.ceil(catalog.total / catalog.limit))}</span>
                  <div>
                    <button className="admin-action" disabled={catalogPage <= 1} onClick={() => setCatalogPage((page) => page - 1)}>Previous</button>
                    <button className="admin-action" disabled={catalogPage >= Math.ceil(catalog.total / catalog.limit)} onClick={() => setCatalogPage((page) => page + 1)}>Next</button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {bookForm && (
            <div className="catalog-modal-backdrop" role="presentation" onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeBookForm();
            }}>
              <form className="catalog-form" onSubmit={submitBook} role="dialog" aria-modal="true" aria-label={bookMode === "edit" ? "Edit book" : "Add book"}>
                <div className="section-heading">
                  <h3>{bookMode === "edit" ? "Edit book details" : bookForm.isbn ? "Add book to a branch" : "Add a book"}</h3>
                  <button type="button" className="admin-action" onClick={closeBookForm} aria-label="Close"><X size={17} /></button>
                </div>
                {bookFormError && <div className="status-error">{bookFormError}</div>}
                {bookDetailsLoading && <p className="muted">Loading current book details...</p>}
                <fieldset className="catalog-form-grid" disabled={bookDetailsLoading || bookDetailsFailed}>
                  {[
                    ["isbn", "ISBN", true],
                    ["title", "Title", false],
                    ["author", "Author", false],
                    ["category", "Category", false],
                    ["publisher", "Publisher", false],
                    ["published_year", "Published year", false],
                    ["page_count", "Pages", false],
                  ].map(([field, label, required]) => (
                    <label key={field} className={field === "title" || field === "description" ? "wide" : ""}>
                      {label}
                      <input
                        value={bookForm[field]}
                        required={required || ["title", "author", "category"].includes(field)}
                        disabled={field === "isbn" && bookMode === "edit"}
                        maxLength={field === "isbn" ? 20 : undefined}
                        type={field === "published_year" || field === "page_count" ? "number" : "text"}
                        min={field === "published_year" ? 1400 : field === "page_count" ? 1 : undefined}
                        max={field === "published_year" ? 2100 : undefined}
                        onChange={(event) => setBookForm((form) => ({ ...form, [field]: event.target.value }))}
                      />
                    </label>
                  ))}
                  <label className="wide">Description
                    <textarea rows="3" value={bookForm.description} onChange={(event) => setBookForm((form) => ({ ...form, description: event.target.value }))} />
                  </label>
                  {bookMode === "add" && (
                    <>
                      <label>Branch
                        <select value={bookForm.branch_id} onChange={(event) => setBookForm((form) => ({ ...form, branch_id: event.target.value }))}>
                          <option value="1">Branch 1</option><option value="2">Branch 2</option><option value="3">Branch 3</option>
                        </select>
                      </label>
                      <label>Copies (1-1000)
                        <input type="number" min="1" max="1000" required value={bookForm.copies} onChange={(event) => setBookForm((form) => ({ ...form, copies: event.target.value }))} />
                      </label>
                    </>
                  )}
                </fieldset>
                <div className="catalog-form-actions">
                  <button type="button" className="admin-action" onClick={closeBookForm}>Cancel</button>
                  <button type="submit" className="admin-action primary" disabled={bookSaving || bookDetailsLoading || bookDetailsFailed}>
                    {bookDetailsLoading ? "Loading..." : bookDetailsFailed ? "Could not load details" : bookSaving ? "Saving..." : bookMode === "edit" ? "Save changes" : "Add book"}
                  </button>
                </div>
              </form>
            </div>
          )}

          <section className="panel-card">
            <div className="section-heading">
              <h3>Cluster health</h3>
              <span className="muted">refreshes every 5 seconds</span>
            </div>
            {health === undefined && <p className="muted">Checking...</p>}
            {health === null && <div className="status-error">The API is not reachable.</div>}
            {health && (
              <div className="health-grid">
                {health.nodes.map((n) => (
                  <HealthTile
                    key={n.node}
                    name={prettyNode(n.node)}
                    up={n.status === "up"}
                    detail={n.status === "up" ? `${n.latency_ms} ms` : "down"}
                  />
                ))}
                <HealthTile name="Redis cache" up={health.redis === "up"} detail={health.redis} />
                <HealthTile name="MongoDB" up={health.mongo === "up"} detail={health.mongo} />
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="section-heading">
              <h3>Activity over time</h3>
              <div className="range-buttons">
                {RANGES.map((r) => (
                  <button key={r.days} className={days === r.days ? "active" : ""} onClick={() => setDays(r.days)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {errors.events && <div className="status-error">{errors.events}</div>}
            {!events && !errors.events && (
              <p className="muted">
                Loading... the first load summarizes millions of events and can take a few seconds.
              </p>
            )}
            {chartPoints && <LineChart points={chartPoints} />}
            {events && (
              <p className="muted">
                {fmt(totalInRange)} events in this range · {weekly ? "grouped by week" : "per day"}
              </p>
            )}
          </section>

          <div className="admin-grid">
            <section className="panel-card">
              <div className="section-heading"><h3>Most viewed books</h3></div>
              {errors.books && <div className="status-error">{errors.books}</div>}
              {!topBooks && !errors.books && <p className="muted">Loading...</p>}
              {topBooks && (
                <BarList
                  empty="No views recorded yet."
                  items={topBooks.books.map((b) => ({
                    key: b.isbn,
                    label: b.title || b.isbn,
                    sub: [b.author, b.isbn].filter(Boolean).join(" · "),
                    value: b.views,
                  }))}
                />
              )}
            </section>

            <section className="panel-card">
              <div className="section-heading"><h3>Top searches</h3></div>
              {errors.searches && <div className="status-error">{errors.searches}</div>}
              {!topSearches && !errors.searches && <p className="muted">Loading...</p>}
              {topSearches && (
                <BarList
                  empty="No searches recorded yet."
                  items={topSearches.searches.map((s) => ({ key: s.query, label: s.query, value: s.searches }))}
                />
              )}
            </section>
          </div>

          <section className="panel-card">
            <div className="section-heading"><h3>Branches</h3></div>
            {errors.branches && <div className="status-error">{errors.branches}</div>}
            {!branches && !errors.branches && <p className="muted">Loading...</p>}
            {branches && (
              <div className="branch-grid">
                {branches.branches.map((b) => {
                  const pct = b.total_copies ? Math.round((b.available_copies / b.total_copies) * 100) : 0;
                  return (
                    <div className="branch-card" key={b.branch_id}>
                      <div className="branch-name">Branch {b.branch_id}</div>
                      <div className="branch-line"><span>Titles stocked</span><strong>{fmt(b.titles)}</strong></div>
                      <div className="branch-line">
                        <span>Copies available</span>
                        <strong>{fmt(b.available_copies)} / {fmt(b.total_copies)}</strong>
                      </div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="branch-line"><span>Events logged</span><strong>{fmt(b.events)}</strong></div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {loadedAt && (
            <p className="muted admin-footnote">
              Last refreshed {loadedAt.toLocaleTimeString()} · the heavy summaries are cached by the server for a few minutes.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}