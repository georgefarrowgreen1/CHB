-- The check-out tap: the guest's own "we've left the cottage", timestamped.
-- NULL = never tapped, which is every existing row and every guest who simply
-- drives home — nothing anywhere depends on this being set (it can only add
-- information early, never withhold it). A plain guarded ADD COLUMN on purpose:
-- migrate.php treats the duplicate-column error as already-applied, and the
-- information_schema + PREPARE guard is the shape that kills the NEXT migration
-- with PDO 2014 (see CLAUDE.md).
ALTER TABLE bookings ADD COLUMN guest_checked_out_at DATETIME NULL;
