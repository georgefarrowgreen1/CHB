-- The Guest Book: the owner's PRIVATE rating of a stay (approved demo, second
-- pass). One row per booking — the PRIMARY KEY is what makes re-rating a
-- replace rather than an accumulation — and deleting a rating really deletes
-- it. Nothing guest-reachable ever joins this table: my-bookings selects b.*
-- only, and the absence is asserted in test-integration §31 rather than
-- assumed. Category marks are 'good' | 'poor' | '' (unset).
CREATE TABLE IF NOT EXISTS guest_ratings (
    booking_id INT          NOT NULL PRIMARY KEY,
    overall    TINYINT      NOT NULL,
    clean      VARCHAR(8)   NOT NULL DEFAULT '',
    rules      VARCHAR(8)   NOT NULL DEFAULT '',
    comms      VARCHAR(8)   NOT NULL DEFAULT '',
    note       TEXT         NULL,
    rated_at   DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
