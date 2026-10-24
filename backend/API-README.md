# Backend API and Resilience Guide

This guide documents the Express API routes and shows how to run the included
load test and demonstrate a branch database failure.

## Run the backend

From the repository root, start the databases:

```powershell
docker compose up -d
```

For a single API instance on port 8000, open a second PowerShell terminal:

```powershell
Set-Location backend
npm install
npm run dev
```

For the three API instances behind Nginx, run this from the repository root
instead:

```powershell
docker compose up -d --build
```

The direct API URL is `http://localhost:8000`. The load-balanced URL is
`http://localhost:8080`. The `/whoami` load-balancer endpoint returns the
health response and includes an `X-Upstream` header identifying the API
instance that handled it.

## Authentication

Routes marked **JWT** require this header:

```http
Authorization: Bearer <token>
```

Obtain a token from `POST /auth/login` or `POST /auth/register`. Tokens last
7 days. Routes marked **Staff** also require the authenticated user's role to
be `admin` or `librarian`. The public review listing accepts an optional
Bearer token so it can mark reviews written by the current user.

## API reference

Unless otherwise noted, successful responses are JSON. Common errors include
`400` for invalid or missing input, `401` for missing/invalid authentication,
`403` for insufficient permissions, `404` for missing records, `409` for
conflicts, and `503` when a required service or database is unavailable.

### Health and accounts

| Method | Route | Auth | Purpose and input |
|---|---|---|---|
| `GET` | `/health` | None | Checks coordinator, all three branch primaries and replicas, Redis, and MongoDB. Returns `overall` (`ok` or `degraded`), per-node statuses, and Redis/Mongo statuses. |
| `POST` | `/auth/register` | None | Create an account. JSON: `{"username":"reader1","email":"reader@example.com","password":"at-least-8-chars","fullName":"Reader One","homeBranchId":1}`. `fullName` and `homeBranchId` are optional. Returns the user and JWT. |
| `POST` | `/auth/login` | None | Log in. JSON: `{"username":"reader1","password":"at-least-8-chars"}`. Returns the user and JWT. |
| `GET` | `/auth/branches` | None | List branch choices from the coordinator database. |

### Books and branches

| Method | Route | Auth | Purpose and input |
|---|---|---|---|
| `GET` | `/books/search?q=<text>&sort=<sort>&limit=<n>` | None | Search books. `q` is required; `sort` can be `relevance`, `rating`, or `year` (default `relevance`); `limit` defaults to 20 and is capped at 100. Returns `results`, `branches_queried`, and `branches_failed`. |
| `GET` | `/books/:isbn/similar?branchId=<id>` | None | Return up to 10 similar books, using vector search where available and SQL fallback otherwise. `branchId` defaults to 1. |
| `GET` | `/branches/nearby?lat=<latitude>&lng=<longitude>&isbn=<isbn>&limit=<n>` | None | Find nearby branches from valid latitude/longitude. `isbn` is optional and adds `nearest_with_copy`; `limit` defaults to 3 and is clamped to 1–10. |

Example search:

```powershell
Invoke-RestMethod "http://localhost:8000/books/search?q=databases&sort=rating&limit=10" |
  ConvertTo-Json -Depth 6
```

Search normally uses Elasticsearch when available. If it is unavailable, the
API searches the three branch read replicas in parallel using PostgreSQL.
`branches_failed` identifies failed branches on this PostgreSQL fallback
path. When Elasticsearch is serving the query, `branches_failed` is empty
because the individual branch databases were not queried.

### Reservations

All reservation routes require a JWT. Holds expire after 72 hours.

| Method | Route | Purpose and input |
|---|---|---|
| `POST` | `/reservations` | Reserve one available copy at a branch. JSON: `{"isbn":"9781000001036","branchId":1}`. Writes to that branch's primary database; returns hold, copy, expiry, and cross-branch reference details. |
| `GET` | `/reservations/mine` | List the authenticated user's active holds across the branches. |
| `DELETE` | `/reservations/:branchId/:holdId` | Cancel the authenticated user's active hold and release the copy. |

### Favorites and reviews

| Method | Route | Auth | Purpose and input |
|---|---|---|---|
| `GET` | `/favorites` | JWT | List the user's favorites, newest first. |
| `POST` | `/favorites` | JWT | Add or update a favorite snapshot. JSON: `{"book":{"isbn":"9781000001036","title":"Example","author":"A. Writer","category":"Fiction","published_year":2020,"avg_rating":4.5,"rating_count":3}}`. `isbn` is required. |
| `DELETE` | `/favorites/:isbn` | JWT | Remove the specified favorite belonging to the current user. |
| `GET` | `/books/:isbn/reviews` | Optional JWT | List up to 50 reviews and the book's average rating/count. With a valid JWT, each review includes whether it belongs to the current user. |
| `POST` | `/books/:isbn/reviews` | JWT | Create one review per user per book. JSON: `{"rating":5,"title":"Great read","comment":"Enjoyed it.","book_title":"Example","book_author":"A. Writer"}`. `rating` must be an integer from 1 to 5; the other fields are optional. |
| `GET` | `/reviews/mine` | JWT | List reviews written by the current user. |
| `DELETE` | `/reviews/:id` | JWT | Delete the current user's review by its MongoDB ID. |

### Staff dashboard and catalog

All `/admin` routes require a JWT and the `admin` or `librarian` role.

| Method | Route | Purpose and input |
|---|---|---|
| `GET` | `/admin/overview` | Headline totals for users, books, activity events, and reviews. |
| `GET` | `/admin/catalog?q=<text>&page=<n>&limit=<n>` | Search/paginate the catalog and include stock by branch. Page defaults to 1; limit defaults to 20 and is capped at 50. |
| `GET` | `/admin/catalog/:isbn` | Get full book metadata from a stocked branch. |
| `POST` | `/admin/catalog` | Add a book and copies to one branch. Required JSON fields: `isbn`, `title`, `author`, `category`, `branch_id` (1–3), and `copies` (1–1000). Optional: `publisher`, `published_year` (1400–2100), `page_count` (positive integer), `description`. |
| `PUT` | `/admin/catalog/:isbn` | Update book metadata across branches where that ISBN is stocked. Body fields: `title`, `author`, `category`; optional `publisher`, `published_year`, `page_count`, and `description`. The ISBN comes from the URL. |
| `DELETE` | `/admin/catalog/:isbn` | Delete a book and its copies if it has no hold or loan history. |
| `GET` | `/admin/events-per-day?days=<n>` | Daily activity counts. `days` defaults to 90 and is clamped to 1–1100. |
| `GET` | `/admin/top-books?limit=<n>&days=<n>` | Most-viewed books in the requested period. `limit` defaults to 10 (max 50); `days` defaults to 365 (max 1100). |
| `GET` | `/admin/top-searches?limit=<n>&days=<n>` | Most frequent searches in the requested period, with the same defaults and limits as top books. |
| `GET` | `/admin/branches` | Per-branch book/copy totals and activity-event counts. |

Book catalog writes also synchronize the global catalog and search index.
Responses may include `warnings` if a search index could not be synchronized.

## Load test

The included k6 scenario in `loadtest/search.js` sends search requests through
Nginx by default. It ramps up to 50 virtual users and checks that the failed
request rate is below 5% and the 95th-percentile response time is below one
second.

Start the distributed stack from the repository root:

```powershell
docker compose up -d --build
```

Install k6 if it is not already available in your terminal, then run:

```powershell
k6 run loadtest/search.js
```

To run against one locally running API instance instead of Nginx:

```powershell
k6 run -e BASE_URL=http://localhost:8000 loadtest/search.js
```

At the end, check the k6 summary for `http_req_failed` and `http_req_duration`
threshold results. A failed threshold means the measured load did not meet the
scenario's target.

## Branch failure demo

### Check health and search degradation

Use PowerShell from the repository root. First confirm the services are
healthy:

```powershell
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json -Depth 6
```

Stop branch 2's **read replica** to make the PostgreSQL search fallback detect
an unavailable search branch:

```powershell
docker stop lib_branch2_replica
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json -Depth 6
Invoke-RestMethod "http://localhost:8000/books/search?q=databases&limit=10" |
  ConvertTo-Json -Depth 6
```

In the health response, look for `branch2_replica` with status `down`. If
Elasticsearch is unavailable, search falls back to PostgreSQL and the search
response should list branch `2` in `branches_failed`, while still returning
results from branches that answered. If Elasticsearch is running, it handles
search independently of the branch replicas, so search will not report a
branch failure; the health response still shows the down database node.

Restore the replica when finished:

```powershell
docker start lib_branch2_replica
```

### Test a branch primary failure

To check how the branch's write path and health endpoint respond when its
primary is unavailable:

```powershell
docker stop lib_branch2_primary
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json -Depth 6
```

Health should report `branch2_primary` as down. Operations that need to write
to branch 2, such as creating or cancelling a reservation there, cannot
complete while its primary is stopped. Restore it after the check:

```powershell
docker start lib_branch2_primary
```

### Test API-instance failover during load

With the distributed stack up, start the load test:

```powershell
k6 run loadtest/search.js
```

While it is running, use a second terminal to stop one API instance:

```powershell
docker stop lib_api2
```

Nginx should continue routing requests to the other API instances. Check
`http_req_failed` and `http_req_duration` in the k6 summary, or watch the
Nginx upstream log in another terminal:

```powershell
docker compose logs -f nginx
```

Restore the API instance after the demo:

```powershell
docker start lib_api2
```
