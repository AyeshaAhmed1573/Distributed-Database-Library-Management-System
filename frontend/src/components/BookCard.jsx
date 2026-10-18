import { Star, Heart } from "lucide-react";
import { useFavorites } from "../context/FavoritesContext";

const PALETTES = [
  ["#6c4ff0", "#2d1f6e"],
  ["#3fae55", "#0f4a24"],
  ["#f0a23f", "#7a4a05"],
  ["#d1495b", "#5c1420"],
  ["#2f8fd1", "#0c3a63"],
  ["#c0479c", "#4a1440"],
];

function hashSeed(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function paletteFor(seed) {
  return PALETTES[hashSeed(seed) % PALETTES.length];
}

// Deterministic decorative pattern so the same book always renders the same
// cover. No network image, so it never fails to load or flickers on retry.
function CoverPattern({ seed }) {
  const h = hashSeed(seed);
  const shapes = (h % 3) + 3; // 3–5 shapes
  const items = Array.from({ length: shapes }, (_, i) => {
    const s = (h >> (i * 4)) & 0xff;
    return {
      cx: 15 + ((s * 7) % 70),
      cy: 15 + ((s * 13) % 70),
      r: 10 + (s % 18),
    };
  });
  return (
    <svg className="book-cover-pattern" viewBox="0 0 100 100" preserveAspectRatio="none">
      {items.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
    </svg>
  );
}

export default function BookCard({ book, onOpen }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const fav = isFavorite(book.isbn);

  function handleFavClick(e) {
    e.stopPropagation();
    toggleFavorite(book);
  }

  const seed = book.title || book.isbn || "";
  const [from, to] = paletteFor(seed);

  return (
    <div className="book-card" onClick={() => onOpen(book)}>
      <div className="book-cover" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
        <CoverPattern seed={seed} />
        <div className="book-cover-spine" />
        <span className="book-cover-title">{book.title}</span>
        <button
          className={`book-fav ${fav ? "active" : ""}`}
          onClick={handleFavClick}
          aria-label="Toggle favorite"
        >
          <Heart size={15} fill={fav ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="book-info">
        <h4>{book.title}</h4>
        <p className="book-author">{book.author}</p>
        <div className="book-meta">
          <span className="book-rating">
            <Star size={14} fill="currentColor" />
            {Number(book.avg_rating ?? book.rating ?? 0).toFixed(1)}
          </span>
          {"available_copies" in book && (
            <span
              className={
                Number(book.available_copies) > 0 ? "book-stock in" : "book-stock out"
              }
            >
              {Number(book.available_copies) > 0
                ? `${book.available_copies} available`
                : "none available"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}