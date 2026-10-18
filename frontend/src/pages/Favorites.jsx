import { useState } from "react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import BookDetail from "./BookDetail";
import { useFavorites } from "../context/FavoritesContext";

export default function Favorites() {
  const { favorites, loading, error } = useFavorites();
  const [selected, setSelected] = useState(null);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query="" onQueryChange={() => {}} onSubmit={() => {}} />
        <main className="dashboard">
          <div className="section-heading">
            <h3>Your favorites</h3>
          </div>
          <p className="muted">Saved to your account — tap the heart on any book to add or remove it.</p>

          {error && <div className="status-error">{error}</div>}
          {loading && <p className="muted">Loading...</p>}
          {!loading && !error && favorites.length === 0 && <p className="muted">No favorites yet.</p>}

          <div className="book-grid">
            {favorites.map((book) => (
              <BookCard key={book.isbn} book={book} onOpen={setSelected} />
            ))}
          </div>
        </main>
      </div>

      {selected && <BookDetail book={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}