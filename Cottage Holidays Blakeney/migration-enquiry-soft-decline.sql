-- ============================================================
--  migration-enquiry-soft-decline.sql — make "decline enquiry" reversible.
--
--  Declining an enquiry used to DELETE the row, so a mis-tap lost the guest's
--  details for good. Now it's a SOFT delete: declined_at gets a timestamp and
--  the enquiry drops out of every admin list, but the row survives so an Undo
--  (or the enquiry hub) can restore it by clearing the column.
--
--  Idempotent the same way the other migrations are: plain ADD COLUMN, with
--  migrate.php skipping the "duplicate column" error on re-run (MySQL 8 has no
--  ADD COLUMN IF NOT EXISTS, so we must NOT use it here).
-- ============================================================

-- declined_at: NULL = a live enquiry in the inbox; a timestamp = declined
-- (hidden from the inbox, Needs-you strip, badges, nudges and the digest, but
-- kept so it can be restored).
ALTER TABLE enquiries ADD COLUMN declined_at DATETIME NULL;
