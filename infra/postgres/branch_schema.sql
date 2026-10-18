-- =====================================================================
-- Branch database schema  (applied to EVERY branch primary)
-- Holds: local catalog, physical copies (stock), holds, loans.
-- Replicas get this automatically through streaming replication.
-- member_id refers to users in the coordinator DB (no cross-database FK).
-- =====================================================================
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy / partial text matching

-- ---------- identity of this node ----------
CREATE TABLE branch_info (
    branch_code  TEXT PRIMARY KEY,
    branch_name  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO branch_info (branch_code, branch_name)
VALUES (:'branch_code', :'branch_name');

-- ---------- helper: keep updated_at fresh ----------
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- catalog ----------
CREATE TABLE books (
    book_id         BIGSERIAL PRIMARY KEY,
    isbn            VARCHAR(20)  NOT NULL UNIQUE,
    title           TEXT         NOT NULL,
    author          TEXT         NOT NULL,
    category        TEXT         NOT NULL,
    publisher       TEXT,
    published_year  SMALLINT CHECK (published_year BETWEEN 1400 AND 2100),
    page_count      INT      CHECK (page_count > 0),
    description     TEXT,
    avg_rating      NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (avg_rating BETWEEN 0 AND 5),
    rating_count    INT          NOT NULL DEFAULT 0,
    -- weighted full-text vector: title (A) > author (B) > description (C)
    search_vector   TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
        setweight(to_tsvector('english', coalesce(author, '')),      'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
    ) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_books_search_vector ON books USING GIN (search_vector);
CREATE INDEX idx_books_title_trgm    ON books USING GIN (title  gin_trgm_ops);
CREATE INDEX idx_books_author_trgm   ON books USING GIN (author gin_trgm_ops);
CREATE INDEX idx_books_category      ON books (category);
CREATE INDEX idx_books_rating        ON books (avg_rating DESC);
CREATE INDEX idx_books_year          ON books (published_year);

CREATE TRIGGER trg_books_touch BEFORE UPDATE ON books
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- stock: physical copies ----------
CREATE TABLE book_copies (
    copy_id        BIGSERIAL PRIMARY KEY,
    book_id        BIGINT      NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    barcode        VARCHAR(40) NOT NULL UNIQUE,
    shelf_location TEXT,
    status         TEXT        NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','held','borrowed','lost','maintenance')),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_copies_book_status ON book_copies (book_id, status);

CREATE TRIGGER trg_copies_touch BEFORE UPDATE ON book_copies
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- holds (reservations) ----------
CREATE TABLE holds (
    hold_id          BIGSERIAL PRIMARY KEY,
    book_id          BIGINT      NOT NULL REFERENCES books(book_id),
    copy_id          BIGINT      NOT NULL REFERENCES book_copies(copy_id),
    member_id        UUID        NOT NULL,          -- users.user_id in coordinator DB
    cross_branch_ref UUID,                          -- cross_branch_holds.hold_ref, if any
    status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','fulfilled','cancelled','expired')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Race-condition guards enforced by the database itself:
--   * a copy can have only ONE active hold  (two people can't get the last copy)
--   * a member can hold a given book only once at a time
CREATE UNIQUE INDEX uq_active_hold_per_copy
    ON holds (copy_id) WHERE status = 'active';
CREATE UNIQUE INDEX uq_active_hold_per_member_book
    ON holds (member_id, book_id) WHERE status = 'active';
CREATE INDEX idx_holds_expiry ON holds (expires_at) WHERE status = 'active';

CREATE TRIGGER trg_holds_touch BEFORE UPDATE ON holds
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- loans ----------
CREATE TABLE loans (
    loan_id      BIGSERIAL PRIMARY KEY,
    copy_id      BIGINT      NOT NULL REFERENCES book_copies(copy_id),
    member_id    UUID        NOT NULL,
    borrowed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at       TIMESTAMPTZ NOT NULL,
    returned_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_open_loan_per_copy ON loans (copy_id) WHERE returned_at IS NULL;
CREATE INDEX idx_loans_member ON loans (member_id);

-- ---------- convenience view: live availability per book ----------
CREATE VIEW book_availability AS
SELECT b.book_id,
       b.isbn,
       count(c.copy_id)                                    AS total_copies,
       count(c.copy_id) FILTER (WHERE c.status = 'available') AS available_copies
FROM books b
LEFT JOIN book_copies c ON c.book_id = b.book_id
GROUP BY b.book_id, b.isbn;
