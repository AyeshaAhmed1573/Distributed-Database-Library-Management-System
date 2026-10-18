# Distributed Library — Frontend

A React (Vite) frontend for the Distributed Library backend. Talks to your
Express API (search, auth, reservations) — no other setup needed beyond the
backend already running.

## Setup

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Open http://localhost:5173. Make sure the backend is running at
http://localhost:8000 (or update `VITE_API_URL` in `.env`), and that
`CORS_ORIGIN=http://localhost:5173` is set in the backend's `.env` so the
browser is allowed to call it.

## Pages

- `/login`, `/register` — auth, calls `POST /auth/register` and
  `POST /auth/login`, stores the JWT in `localStorage`.
- `/` (Dashboard) — search bar + sort (relevance/rating/year), a small
  stats row (result count, branches queried, node health from `/health`),
  and a results grid. Click a book to open its detail modal.
- Book detail modal — per-branch availability with a **Reserve** button
  (`POST /reservations`) and a "you might also like" list from
  `GET /books/:isbn/similar`.
- `/my-holds` — active holds (`GET /reservations/mine`) with cancel
  (`DELETE /reservations/:branchId/:holdId`).

## Notes

- All API calls live in `src/api.js` — one place to change if a route or
  base URL changes.
- `src/context/AuthContext.jsx` holds the logged-in user and JWT; routes
  under `<ProtectedRoute>` redirect to `/login` if there's no user.
- Styling is a small hand-written stylesheet (`src/styles/index.css`), no
  CSS framework — easy to restyle without learning a new tool.
- To demo the last-copy race condition from the UI: open the same book's
  detail modal in two browser tabs (same branch, one copy left) and click
  Reserve in both — one succeeds, the other shows the 409 error message.
