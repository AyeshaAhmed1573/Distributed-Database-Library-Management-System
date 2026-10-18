-- =====================================================================
-- Central Coordinator DB
-- Global catalog index, cross-branch hold ledger, node health table,
-- and the username-uniqueness index (users live here, not per branch).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- branches ----------
CREATE TABLE branches (
    branch_id  SMALLINT PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,          
    name       TEXT NOT NULL,
    city       TEXT,
    latitude   DOUBLE PRECISION,              
    longitude  DOUBLE PRECISION,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- users (Auth / Username service) ----------
CREATE TABLE users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username       VARCHAR(50)  NOT NULL,
    email          VARCHAR(255) NOT NULL,
    password_hash  TEXT         NOT NULL,
    full_name      TEXT,
    role           TEXT         NOT NULL DEFAULT 'student'
                   CHECK (role IN ('student','librarian','admin')),
    home_branch_id SMALLINT REFERENCES branches(branch_id),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- global username uniqueness, case-insensitive
CREATE UNIQUE INDEX uq_users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX uq_users_email_lower    ON users (lower(email));

-- ---------- global catalog index ----------
CREATE TABLE global_books (
    isbn           VARCHAR(20) PRIMARY KEY,
    title          TEXT NOT NULL,
    author         TEXT NOT NULL,
    category       TEXT NOT NULL,
    published_year SMALLINT,
    avg_rating     NUMERIC(3,2) NOT NULL DEFAULT 0,
    search_vector  TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')),  'A') ||
        setweight(to_tsvector('english', coalesce(author, '')), 'B')
    ) STORED,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_global_books_search ON global_books USING GIN (search_vector);
CREATE INDEX idx_global_books_title_trgm ON global_books USING GIN (title gin_trgm_ops);
CREATE INDEX idx_global_books_category ON global_books (category);

-- which branch holds how many copies of each ISBN (drives cross-branch routing)
CREATE TABLE global_book_availability (
    isbn             VARCHAR(20) NOT NULL REFERENCES global_books(isbn) ON DELETE CASCADE,
    branch_id        SMALLINT    NOT NULL REFERENCES branches(branch_id),
    total_copies     INT         NOT NULL DEFAULT 0,
    available_copies INT         NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (isbn, branch_id)
);
CREATE INDEX idx_gba_branch_available ON global_book_availability (branch_id, available_copies);

-- ---------- cross-branch hold ledger (saga-style: pending -> confirmed) ----------
CREATE TABLE cross_branch_holds (
    hold_ref       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(user_id),
    isbn           VARCHAR(20) NOT NULL,
    branch_id      SMALLINT    NOT NULL REFERENCES branches(branch_id),
    branch_hold_id BIGINT,                          -- holds.hold_id inside that branch DB
    status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','cancelled','expired','failed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cbh_user   ON cross_branch_holds (user_id);
CREATE INDEX idx_cbh_status ON cross_branch_holds (status, expires_at);

-- ---------- node health (written by the Replication Monitor) ----------
CREATE TABLE node_health (
    node_name           TEXT PRIMARY KEY,           -- e.g. branch1_primary
    node_role           TEXT NOT NULL CHECK (node_role IN ('primary','replica','coordinator')),
    branch_id           SMALLINT REFERENCES branches(branch_id),
    status              TEXT NOT NULL DEFAULT 'up'
                        CHECK (status IN ('up','degraded','down')),
    is_serving          BOOLEAN NOT NULL DEFAULT TRUE,   -- router only uses serving nodes
    latency_ms          INT,
    consecutive_failures INT NOT NULL DEFAULT 0,
    last_checked_at     TIMESTAMPTZ,
    last_status_change  TIMESTAMPTZ NOT NULL DEFAULT now()
);
