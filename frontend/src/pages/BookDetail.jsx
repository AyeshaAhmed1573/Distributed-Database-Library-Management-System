import { useEffect, useState } from "react";
import { X, Star, MessageSquare, Trash2, MapPin } from "lucide-react";
import {
  getSimilarBooks,
  reserveBook,
  searchBooks,
  getReviews,
  submitReview,
  deleteReview,
  getNearbyBranches,
} from "../api";

export default function BookDetail({ book: initialBook, onClose }) {
  const [book, setBook] = useState(initialBook);
  const [similar, setSimilar] = useState([]);
  const [status, setStatus] = useState(null); // { type: "success" | "error", message }
  const [reserving, setReserving] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState({ average: null, count: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsDown, setReviewsDown] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myTitle, setMyTitle] = useState("");
  const [myComment, setMyComment] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [nearbyBranches, setNearbyBranches] = useState(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  const iReviewed = reviews.some((r) => r.mine);

  // Books opened from Favorites have no branch data: fetch the live record once.
  useEffect(() => {
    if (initialBook.branches) return;
    let cancelled = false;
    setSwitching(true);
    searchBooks(initialBook.title, "relevance", 5)
      .then((data) => {
        const match = data.results.find((r) => r.isbn === initialBook.isbn);
        if (match && !cancelled) setBook(match);
      })
      .catch(() => {})
      .finally(() => !cancelled && setSwitching(false));
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadReviews(isbn) {
    try {
      const data = await getReviews(isbn);
      setReviews(data.reviews || []);
      setSummary({ average: data.average_rating, count: data.review_count || 0 });
      setReviewsDown(false);
    } catch {
      setReviews([]);
      setSummary({ average: null, count: 0 });
      setReviewsDown(true);
    } finally {
      setReviewsLoading(false);
    }
  }

  useEffect(() => {
    const firstBranch = book.branches?.[0]?.branch_id || 1;
    getSimilarBooks(book.isbn, firstBranch)
      .then((data) => setSimilar(data.similar || []))
      .catch(() => setSimilar([]));

    setShowForm(false);
    setMyRating(0);
    setMyTitle("");
    setMyComment("");
    setReviewError("");
    setReviewsLoading(true);
    loadReviews(book.isbn);
  }, [book.isbn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleReserve(branchId) {
    setReserving(true);
    setStatus(null);
    try {
      const hold = await reserveBook(book.isbn, branchId);
      setStatus({
        type: "success",
        message: `Reserved! Hold #${hold.hold_id} at branch ${hold.branch_id}, expires ${new Date(
          hold.expires_at
        ).toLocaleString()}.`,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err?.response?.data?.error || "Could not reserve this copy.",
      });
    } finally {
      setReserving(false);
    }
  }

  // The /similar endpoint only returns title/author/category/rating (no
  // per-branch availability), so drilling into one of these rows re-searches
  // by its title to get the full merged record, then swaps the modal to it.
  async function openSimilar(s) {
    setSwitching(true);
    setStatus(null);
    try {
      const data = await searchBooks(s.title, "relevance", 5);
      const match = data.results.find((r) => r.isbn === s.isbn) || data.results[0];
      if (match) setBook(match);
    } catch {
      // leave the current book showing if the lookup fails
    } finally {
      setSwitching(false);
    }
  }

  async function handleSubmitReview(e) {
    e.preventDefault();
    if (myRating < 1) {
      setReviewError("Pick a star rating first.");
      return;
    }
    setSubmitting(true);
    setReviewError("");
    try {
      await submitReview(book.isbn, {
        rating: myRating,
        title: myTitle,
        comment: myComment,
        book_title: book.title,
        book_author: book.author,
      });
      await loadReviews(book.isbn);
      setShowForm(false);
      setMyRating(0);
      setMyTitle("");
      setMyComment("");
    } catch (err) {
      setReviewError(err?.response?.data?.error || "Could not submit your review.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteReview(id) {
    try {
      await deleteReview(id);
      await loadReviews(book.isbn);
    } catch {
      setReviewError("Could not delete that review.");
    }
  }

  async function handleFindNearby() {
    setNearbyLoading(true);
    setNearbyError(null);
    setLocationDenied(false);
    setHasAttempted(true);

    if (!navigator.geolocation) {
      setNearbyError("Geolocation is not supported by your browser.");
      setNearbyLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const data = await getNearbyBranches(latitude, longitude, book.isbn, 3);
          setNearbyBranches(data);
          setNearbyError(null);
        } catch (err) {
          setNearbyError(err?.response?.data?.error || err?.message || "Could not fetch nearby branches.");
        } finally {
          setNearbyLoading(false);
        }
      },
      (error) => {
        setNearbyLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationDenied(true);
          setNearbyError("Location permission denied. Use the fallback button to search from Karachi city centre.");
        } else {
          setNearbyError("Could not get your location. Use the fallback button to search from Karachi city centre.");
        }
      }
    );
  }

  async function handleUseKarachiCentre() {
    setNearbyLoading(true);
    setNearbyError(null);
    setHasAttempted(true);
    try {
      const KARACHI_LAT = 24.8607;
      const KARACHI_LNG = 67.0011;
      const data = await getNearbyBranches(KARACHI_LAT, KARACHI_LNG, book.isbn, 3);
      setNearbyBranches(data);
      setLocationDenied(false);
      setNearbyError(null);
    } catch (err) {
      setNearbyError(err?.response?.data?.error || err?.message || "Could not fetch nearby branches.");
    } finally {
      setNearbyLoading(false);
    }
  }

  async function handleReserveNearby(branchId) {
    await handleReserve(branchId);
    // Refresh nearby branches to show updated availability
    if (nearbyBranches) {
      const { lat, lng } = nearbyBranches.origin;
      try {
        const data = await getNearbyBranches(lat, lng, book.isbn, 3);
        setNearbyBranches(data);
      } catch {
        // If refresh fails, keep showing current data
      }
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <X size={20} />
        </button>

        {switching ? (
          <p className="muted">Loading book...</p>
        ) : (
          <>
            <h2>{book.title}</h2>
            <p className="book-author">{book.author}</p>
            <div className="book-meta">
              <span className="book-rating">
                <Star size={14} fill="currentColor" />
                {Number(book.avg_rating).toFixed(1)} ({book.rating_count} ratings)
              </span>
              {book.category && <span className="book-category">{book.category}</span>}
              {book.published_year && <span>{book.published_year}</span>}
            </div>

            <h4 className="modal-subheading">Availability by branch</h4>
            <div className="branch-list">
              {(book.branches || []).map((b) => (
                <div className="branch-row" key={b.branch_id}>
                  <span>Branch {b.branch_id}</span>
                  <span className={b.available_copies > 0 ? "in" : "out"}>
                    {b.available_copies > 0 ? `${b.available_copies} available` : "none available"}
                  </span>
                  <button
                    disabled={b.available_copies <= 0 || reserving}
                    onClick={() => handleReserve(b.branch_id)}
                  >
                    Reserve
                  </button>
                </div>
              ))}
              {(!book.branches || book.branches.length === 0) && (
                <p className="muted">No branch stocks this title.</p>
              )}
            </div>

            {status && (
              <div className={status.type === "success" ? "status-ok" : "status-error"}>
                {status.message}
              </div>
            )}

            <h4 className="modal-subheading">Nearest branch</h4>
            {!nearbyBranches && !nearbyLoading && (
              <button
                className="branch-nearby-btn"
                onClick={handleFindNearby}
                disabled={nearbyLoading}
              >
                <MapPin size={16} />
                Find nearest branch
              </button>
            )}
            {locationDenied && (
              <button
                className="branch-nearby-btn"
                onClick={handleUseKarachiCentre}
                disabled={nearbyLoading}
              >
                <MapPin size={16} />
                Use Karachi city centre
              </button>
            )}
            {nearbyLoading && <p className="muted">Finding nearby branches...</p>}
            {hasAttempted && nearbyError && <div className="status-error">{nearbyError}</div>}
            {nearbyBranches && nearbyBranches.branches.length > 0 && (
              <div className="branch-list">
                {nearbyBranches.branches.map((b) => (
                  <div
                    className={`branch-row ${nearbyBranches.nearest_with_copy?.branch_id === b.branch_id ? "nearest-highlight" : ""}`}
                    key={b.branch_id}
                  >
                    <div>
                      <span className="branch-name">{b.name}</span>
                      <span className="muted branch-location">
                        {b.city} · {b.distance_km.toFixed(1)} km away
                      </span>
                    </div>
                    <div className="branch-stock">
                      <span className={b.available_copies > 0 ? "in" : "out"}>
                        {b.available_copies > 0 ? `${b.available_copies} of ${b.total_copies} available` : "none available"}
                      </span>
                      {b.available_copies > 0 && (
                        <button
                          disabled={reserving}
                          onClick={() => handleReserveNearby(b.branch_id)}
                        >
                          Reserve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {nearbyBranches.nearest_with_copy && (
                  <p className="muted">
                    <MapPin size={12} /> Nearest with a copy available: {nearbyBranches.nearest_with_copy.name}
                  </p>
                )}
              </div>
            )}
            {nearbyBranches && nearbyBranches.branches.length === 0 && (
              <p className="muted">No branches found.</p>
            )}
          </>
        )}

        {similar.length > 0 && (
          <>
            <h4 className="modal-subheading">You might also like</h4>
            <ul className="similar-list">
              {similar.map((s) => (
                <li key={s.isbn} onClick={() => openSimilar(s)}>
                  <span>{s.title}</span>
                  <span className="muted">{s.author}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="reviews-header">
          <h4 className="modal-subheading" style={{ margin: 0 }}>
            <MessageSquare size={15} /> Reviews
            {summary.count > 0 && (
              <span className="reviews-avg">
                <Star size={13} fill="currentColor" />
                {Number(summary.average).toFixed(1)} · {summary.count} review
                {summary.count === 1 ? "" : "s"}
              </span>
            )}
          </h4>
          {!showForm && !iReviewed && !reviewsDown && (
            <button className="review-write-btn" onClick={() => setShowForm(true)}>
              Write a review
            </button>
          )}
        </div>

        {showForm && (
          <form className="review-form" onSubmit={handleSubmitReview}>
            <div className="star-input">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  className={n <= myRating ? "star-btn active" : "star-btn"}
                  onClick={() => setMyRating(n)}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                >
                  <Star size={20} fill={n <= myRating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Title (optional)"
              value={myTitle}
              onChange={(e) => setMyTitle(e.target.value)}
              maxLength={120}
            />
            <textarea
              placeholder="What did you think?"
              value={myComment}
              onChange={(e) => setMyComment(e.target.value)}
              maxLength={1000}
              rows={3}
            />
            <div className="review-form-actions">
              <button type="button" className="review-cancel-btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Submit review"}
              </button>
            </div>
          </form>
        )}

        {reviewError && <div className="status-error">{reviewError}</div>}
        {reviewsLoading && <p className="muted">Loading reviews...</p>}
        {!reviewsLoading && reviewsDown && <p className="muted">Reviews are temporarily unavailable.</p>}
        {!reviewsLoading && !reviewsDown && reviews.length === 0 && (
          <p className="muted">No reviews yet — be the first.</p>
        )}
        <ul className="review-list">
          {reviews.map((r) => (
            <li key={r.id} className="review-row">
              <div className="review-row-top">
                <span className="review-stars">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} size={13} fill={i < r.rating ? "currentColor" : "none"} />
                  ))}
                </span>
                <span className="review-row-right">
                  <span className="muted">
                    {r.username || "Reader"} · {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  {r.mine && (
                    <button
                      className="review-delete-btn"
                      onClick={() => handleDeleteReview(r.id)}
                      aria-label="Delete review"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>
              {r.title && <p className="review-title">{r.title}</p>}
              {r.comment && <p className="review-comment">{r.comment}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}