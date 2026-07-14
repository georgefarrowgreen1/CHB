-- Magic sign-in links are single-use. We stamp the timestamp of the last consumed
-- link per guest; guest_magic_consume then only accepts a STRICTLY newer ts (via a
-- conditional UPDATE), so a captured link can't be replayed within its 30-minute
-- window. Defence-in-depth alongside the canonical-host fix in db.php.
--
-- Idempotent: MySQL 8 has no ADD COLUMN IF NOT EXISTS, so this is a plain
-- ADD COLUMN and migrate.php swallows the "duplicate column" error on re-run.
ALTER TABLE guests ADD COLUMN magic_used_ts INT NOT NULL DEFAULT 0;
