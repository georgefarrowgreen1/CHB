-- Drop the two tracking columns left behind by the removed stay push
-- notifications (the check-in "your cottage is ready" push and the
-- tide-timed push). The feature code is long gone; these were the last
-- remnant. On a FRESH database the older migration-push.sql /
-- migration-tide-push.sql still add them first and this then drops them —
-- same end state either way. Safe to re-run: migrate.php treats MySQL's
-- "check that column/key exists" error as already-applied.
ALTER TABLE bookings DROP COLUMN checkin_push_sent;
ALTER TABLE bookings DROP COLUMN tide_push_sent;
