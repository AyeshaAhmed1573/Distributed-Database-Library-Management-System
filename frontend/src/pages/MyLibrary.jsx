import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import BookDetail from "./BookDetail";
import { getMyHolds } from "../api";
import { useFavorites } from "../context/FavoritesContext";

export default function MyLibrary() {
  const [holds, setHolds] = useState([]);
  const { favorites } = useFavorites();
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyHolds()
      .then(setHolds)
      .catch(() => setHolds([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query="" onQueryChange={() => {}} onSubmit={() => {}} />
        <main className="dashboard">
          <div className="section-heading">
            <h3>Your Library</h3>
          </div>
          <p className="muted">Everything you've reserved or saved, in one place.</p>

          <section>
            <div className="section-heading">
              <h4>Active holds</h4>
            </div>
            {loading && <p className="muted">Loading...</p>}
            {!loading && holds.length === 0 && (
              <p className="muted">No active holds — reserve a book to see it here.</p>
            )}
            <div className="holds-list">
              {holds.map((h) => (
                <div className="hold-row" key={`${h.branch_id}-${h.hold_id}`}>
                  <div>
                    <h4>{h.title}</h4>
                    <p className="muted">
                      ISBN {h.isbn} · Branch {h.branch_id} · expires{" "}
                      {new Date(h.expires_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="section-heading">
              <h4>Favorites</h4>
            </div>
            {favorites.length === 0 && <p className="muted">No favorites yet.</p>}
            <div className="book-grid">
              {favorites.map((book) => (
                <BookCard key={book.isbn} book={book} onOpen={setSelected} />
              ))}
            </div>
          </section>
        </main>
      </div>

      {selected && <BookDetail book={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}