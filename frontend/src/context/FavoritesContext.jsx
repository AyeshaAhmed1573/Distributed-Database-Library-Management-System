import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { getFavoriteBooks, addFavoriteBook, removeFavoriteBook } from "../api";

const FavoritesContext = createContext(null);

// Only the fields we store for a favorite (no live availability, which goes stale).
function snapshot(book) {
  return {
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    category: book.category ?? null,
    published_year: book.published_year ?? null,
    avg_rating: Number(book.avg_rating ?? book.rating ?? 0),
    rating_count: Number(book.rating_count ?? 0),
  };
}

export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setFavorites([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    getFavoriteBooks()
      .then((list) => !cancelled && setFavorites(list))
      .catch(() => !cancelled && setError("Favorites are temporarily unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isFavorite = useCallback((isbn) => favorites.some((b) => b.isbn === isbn), [favorites]);

  // Updates the heart instantly, then saves; puts it back if the save fails.
  const toggleFavorite = useCallback(
    async (book) => {
      const previous = favorites;
      const exists = previous.some((b) => b.isbn === book.isbn);
      const snap = snapshot(book);
      setFavorites(exists ? previous.filter((b) => b.isbn !== book.isbn) : [snap, ...previous]);
      try {
        if (exists) await removeFavoriteBook(book.isbn);
        else await addFavoriteBook(snap);
        setError("");
      } catch {
        setFavorites(previous);
        setError("Could not update your favorites. Please try again.");
      }
    },
    [favorites]
  );

  return (
    <FavoritesContext.Provider value={{ favorites, loading, error, isFavorite, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used inside <FavoritesProvider>");
  return ctx;
}