-- ============================================================
--  migration-141-calendar-indexes.sql — indexes for the calendar checks
--  every visitor and every booking runs.
--
--  bookings had no index that starts with the cottage, so the availability
--  read (every visitor's 30-second tick, availability.php) and the clash
--  check (dates_clash, every add, edit and enquiry) scanned every booking the
--  business ever took: measured on five years' data, 461 rows examined to
--  return 33, and 436 to answer one clash. (prop_key, check_out, check_in)
--  serves both: the cottage, then the stays not yet over.
--  enquiries.declined_at had none either, and the owner's boot lists the
--  live enquiries (`declined_at IS NULL`, newest first): 2,879 rows
--  examined for 20.
--
--  One plain ALTER per index: migrate.php reads "Duplicate key name" as
--  already applied, so this is safe to run again.
-- ============================================================
ALTER TABLE bookings ADD INDEX idx_book_prop_dates (prop_key, check_out, check_in);
ALTER TABLE enquiries ADD INDEX idx_enq_declined (declined_at, created_at);
