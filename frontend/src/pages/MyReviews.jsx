import { useEffect, useState } from "react";
import { Star, Trash2, MessageSquare } from "lucide-react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { getMyReviews, deleteReview } from "../api";

export default function MyReviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getMyReviews()
      .then(setReviews)
      .catch(() => setError("Could not load your reviews."))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    try {
      await deleteReview(id);
      setReviews((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Could not remove that review.");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query="" onQueryChange={() => {}} onSubmit={() => {}} />
        <main className="dashboard">
          <section className="section-heading">
            <h3>
              <MessageSquare size={18} /> My reviews
            </h3>
          </section>

          {error && <div className="status-error">{error}</div>}
          {loading && <p className="muted">Loading...</p>}
          {!loading && !error && reviews.length === 0 && (
            <p className="muted">You haven't reviewed any books yet — open a book and write one.</p>
          )}

          <div className="holds-list">
            {reviews.map((r) => (
              <div className="hold-row" key={r.id}>
                <div>
                  <h4>{r.book_title || r.isbn}</h4>
                  <p className="muted">{r.book_author}</p>
                  <span className="review-stars">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star key={i} size={13} fill={i < r.rating ? "currentColor" : "none"} />
                    ))}
                  </span>
                  {r.title && <p className="review-title">{r.title}</p>}
                  {r.comment && <p className="review-comment">{r.comment}</p>}
                  <p className="muted">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
                <button onClick={() => handleDelete(r.id)}>
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}