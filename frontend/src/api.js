import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const api = axios.create({ baseURL });

// Attach the JWT (if we have one) to every outgoing request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// If the server says the token is missing/expired, log out and go to /login.
// Login/register failures also return 401, so those are left alone.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err?.config?.url || "";
    const isAuthCall = url.startsWith("/auth/");
    if (err?.response?.status === 401 && !isAuthCall) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ---- Auth ----
export const registerUser = (data) => api.post("/auth/register", data).then((r) => r.data);
export const loginUser = (data) => api.post("/auth/login", data).then((r) => r.data);
export const getBranches = () => api.get("/auth/branches").then((r) => r.data);

// ---- Branches ----
export const getNearbyBranches = (lat, lng, isbn = null, limit = 3) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Latitude and longitude must be valid numbers");
  }
  const params = { lat, lng, limit };
  if (isbn) params.isbn = isbn;
  return api.get("/branches/nearby", { params }).then((r) => r.data);
};

// ---- Health ----
export const getHealth = () => api.get("/health").then((r) => r.data);

// ---- Search ----
export const searchBooks = (q, sort = "relevance", limit = 20) =>
  api.get("/books/search", { params: { q, sort, limit } }).then((r) => r.data);

export const getSimilarBooks = (isbn, branchId = 1) =>
  api.get(`/books/${isbn}/similar`, { params: { branchId } }).then((r) => r.data);

// ---- Reservations ----
export const reserveBook = (isbn, branchId) =>
  api.post("/reservations", { isbn, branchId }).then((r) => r.data);

export const cancelHold = (branchId, holdId, crossBranchRef) =>
  api.delete(`/reservations/${branchId}/${holdId}`, { data: { crossBranchRef } }).then((r) => r.data);

export const getMyHolds = () => api.get("/reservations/mine").then((r) => r.data);

// ---- Reviews (MongoDB) ----
export const getReviews = (isbn) => api.get(`/books/${isbn}/reviews`).then((r) => r.data);
export const submitReview = (isbn, payload) =>
  api.post(`/books/${isbn}/reviews`, payload).then((r) => r.data);
export const getMyReviews = () => api.get("/reviews/mine").then((r) => r.data.reviews);
export const deleteReview = (id) => api.delete(`/reviews/${id}`).then((r) => r.data);

// ---- Favorites (MongoDB) ----
export const getFavoriteBooks = () => api.get("/favorites").then((r) => r.data.favorites);
export const addFavoriteBook = (book) => api.post("/favorites", { book }).then((r) => r.data);
export const removeFavoriteBook = (isbn) => api.delete(`/favorites/${isbn}`).then((r) => r.data);