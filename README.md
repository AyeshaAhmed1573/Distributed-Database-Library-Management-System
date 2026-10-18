# Distributed Library Management System

A library system spread across **three branch databases** plus a central **coordinator**. One API searches every branch at once, merges the answers, and keeps working (with partial results) if a branch goes down.

## What lives where

| Store | What it holds | Why |
|---|---|---|
| **Branch Postgres x3** (each with a streaming read replica) | `books`, `book_copies`, `holds`, `loans` for that branch | Each branch owns its own stock. Searches read from the replicas so browsing never competes with reservations. |
| **Coordinator Postgres** | `users` (accounts and login), `branches`, global book index, cross-branch holds | Usernames and emails must be unique across all branches, which needs a relational database with constraints. |
| **MongoDB** (`library_docs`) | `reviews`, `favorites` | Flexible, user-owned documents with no joins. |
| **Redis** | Search and availability cache | Fast in-memory reads. |
| **Qdrant** (optional) | Vector search, planned | Started only with the `extras` profile. |

Reserving the last copy is race-safe: the reservation runs in a transaction with `SELECT ... FOR UPDATE SKIP LOCKED`, and a unique database index blocks two active holds on the same copy.

## Prerequisites

- Docker Desktop (running)
- Node.js 20+
- Git

## 1. Start the databases

From the project root:

```powershell
copy .env.example .env
docker compose up -d
docker compose ps
```

Wait until the Postgres containers and Redis show `healthy` and `lib_mongo` shows `Up`. The replicas start after their primary is healthy and clone it automatically, so the first start takes about a minute.

Optional vector database, later: `docker compose --profile extras up -d`

### Ports (host)

| Node | Port |
|---|---|
| coordinator | 5440 |
| branch 1 / 2 / 3 primary | 5441 / 5442 / 5443 |
| branch 1 / 2 / 3 replica | 5451 / 5452 / 5453 |
| redis | 6379 |
| mongo | 27017 |
| qdrant (extras) | 6333 |
| API | 8000 |
| frontend | 5173 |

Postgres user, password and replication password come from `.env`. Databases are `library` (each branch) and `coordinator`. MongoDB defaults to user `admin`, password `admin123` (override with `MONGO_USER` / `MONGO_PASSWORD`), database `library_docs`.

## 2. Run the API and seed data

```powershell
cd backend
npm install
npm run seed
npm run dev
```

- `npm run seed` fills the branches with 600 sample books (about 60% stocked in each branch) and sample reviews. It is safe to re-run: existing ISBNs are skipped. Run it once on a fresh database, not every time.
- `npm run dev` restarts automatically when you edit files in `backend/`.

Open http://localhost:8000/health. It should show `"overall": "ok"` once every Postgres node, Redis and MongoDB are up. If one is down it shows `"degraded"` and lists which one, and the API keeps serving what it can.

Add a real secret to `.env` before deploying or demoing to others:

```
JWT_SECRET=change-this-to-a-long-random-string
```

## 3. Run the frontend

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

Open http://localhost:5173. `frontend/.env` holds `VITE_API_URL` (default `http://localhost:8000`). The API allows the frontend origin through `CORS_ORIGIN` (default `http://localhost:5173`).

## API routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Status of every database node, Redis and MongoDB |
| POST | `/auth/register` | none | Create an account (`username`, `email`, `password` min 8 chars, optional `fullName`, `homeBranchId`). Returns `user` and `token`. |
| POST | `/auth/login` | none | Log in. Returns `user` and `token` (JWT, valid 7 days). |
| GET | `/auth/branches` | none | List branches |
| GET | `/books/search?q=&sort=&limit=` | none | Search all 3 branch replicas in parallel, merge duplicates, sort (`relevance`, `rating`, `year`). Reports any branch that failed. |
| GET | `/books/:isbn/similar?branchId=` | none | Similar books (same category or author) |
| POST | `/reservations` | JWT | Reserve a copy: `{ isbn, branchId }` |
| GET | `/reservations/mine` | JWT | My active holds |
| DELETE | `/reservations/:branchId/:holdId` | JWT | Cancel a hold |
| GET | `/books/:isbn/reviews` | optional | Reviews and average for a book. Each review has `mine: true` when it is yours. |
| POST | `/books/:isbn/reviews` | JWT | Write a review: `{ rating 1-5, title, comment, book_title, book_author }`. One per user per book (409 if repeated). |
| GET | `/reviews/mine` | JWT | Everything I have reviewed |
| DELETE | `/reviews/:id` | JWT | Delete my own review |
| GET | `/favorites` | JWT | My favorite books, newest first |
| POST | `/favorites` | JWT | Add a favorite: `{ book: { isbn, title, author, ... } }` |
| DELETE | `/favorites/:isbn` | JWT | Remove a favorite |

Protected routes need the header `Authorization: Bearer <token>`.

## Frontend pages

| Page | Route | Data source |
|---|---|---|
| Login / Register | `/login`, `/register` | coordinator Postgres via the API |
| Dashboard (search, categories, sort, cluster health) | `/` | API search, health, holds |
| Book detail (branch availability, reserve, similar, reviews) | modal | API |
| My Library | `/my-library` | holds + favorites |
| My Holds | `/my-holds` | API |
| My Reviews | `/my-reviews` | MongoDB via the API |
| Favorites | `/favorites` | MongoDB via the API |
| Settings (dark/light theme) | `/settings` | browser only |

Only the theme preference is stored in the browser. The login token is also kept in the browser (localStorage) so a refresh does not log you out; the account itself is in Postgres.

## Check that data is really stored

Accounts (coordinator Postgres):

```powershell
docker exec lib_coordinator psql -U admin -d coordinator -c "SELECT username, email, role FROM users;"
```

Favorites and reviews (MongoDB):

```powershell
docker exec lib_mongo mongosh -u admin -p admin123 --authenticationDatabase admin library_docs --eval "db.favorites.find().toArray()"
docker exec lib_mongo mongosh -u admin -p admin123 --authenticationDatabase admin library_docs --eval "db.reviews.find().sort({created_at:-1}).limit(3).toArray()"
```

Replication:

```powershell
docker exec lib_branch1_primary psql -U admin -d library -c "SELECT client_addr, state FROM pg_stat_replication;"
docker exec lib_branch1_replica psql -U admin -d library -c "SELECT count(*) FROM books;"
```

Each laptop has its own containers, so accounts, favorites and reviews are per machine. Nothing in Git carries database contents.

## Fault-tolerance demo

1. Open http://localhost:8000/health and confirm `"overall": "ok"`.
2. Stop a branch: `docker stop lib_branch2_primary`
3. Reload `/health`: it now says `"degraded"` and names the node. Search in the app still works and shows a warning banner for the branch that did not answer.
4. Bring it back: `docker start lib_branch2_primary`

## Reset everything (deletes all data)

```powershell
docker compose down -v
```

Then start again from step 1 and re-run `npm run seed`.


## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker` not recognized, or cannot connect to the Docker API | Open Docker Desktop and wait for "Engine running", then use a new terminal. |
| `/health` shows `"mongo": "down"` | `docker compose up -d mongo`. Reviews and favorites show "temporarily unavailable" until it is up. |
| A replica keeps restarting | Check `docker compose logs --tail 30 branch1-replica`. Replicas need `max_connections` at least as high as their primary. |
| `Cannot find package 'pg'` | Run `npm install` inside `backend/`. |
| Everything logs you out | Your token expired or `JWT_SECRET` changed. Log in again. |
| Port already in use | Stop the other program using it, or run `docker compose ps` to see if containers are already running. |

