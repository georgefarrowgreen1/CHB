-- migration-115-night-shift.sql
--
--  "Ready for you" — the overnight queue.
--
--  A machine on the owner's own network works while nobody is asking, and
--  everything it produces lands here for the owner to read. Nothing in this
--  table is ever acted on by the app: a row is a DRAFT with a destination,
--  and the only things that happen to it are the owner opening it (`used`)
--  or binning it (`dismissed`).
--
--  A table rather than a content key because these rows have a lifecycle —
--  a status, a deadline, a per-row decision — and because `ref` UNIQUE is
--  what makes ingest exactly-once for free: a producer that retries a POST
--  it never saw the answer to inserts nothing the second time. Same
--  discipline as the op ledger (migration-109), one column instead of a
--  whole mechanism, because a night item carries no response to replay.
--
--  `expires_at` is computed at INGEST from the kind (nightshift-lib.php's
--  night_ttl_days), not read back from a setting later, so changing the
--  rule never silently re-dates rows the owner has already been shown a
--  deadline for.
--
--  Guarded the way every migration here is: CREATE TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS night_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    ref         VARCHAR(64)  NOT NULL,
    kind        VARCHAR(24)  NOT NULL,
    title       VARCHAR(200) NOT NULL,
    sub         VARCHAR(255) NOT NULL DEFAULT '',
    body        TEXT         NOT NULL,
    source      VARCHAR(255) NOT NULL DEFAULT '',
    target      VARCHAR(120) NOT NULL DEFAULT '',
    status      VARCHAR(16)  NOT NULL DEFAULT 'open',
    created_at  DATETIME     NOT NULL,
    expires_at  DATETIME     NOT NULL,
    acted_at    DATETIME     NULL,
    UNIQUE KEY uniq_night_ref (ref),
    KEY idx_night_open (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
