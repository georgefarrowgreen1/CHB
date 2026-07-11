-- Keep payment/refund records usable even after their booking is deleted:
-- snapshot the guest name + cottage onto each payments row, and backfill any
-- existing rows from their (still-present) bookings. Applied by migrate.php.
ALTER TABLE payments ADD COLUMN guest_name VARCHAR(190) NULL;
ALTER TABLE payments ADD COLUMN prop_key VARCHAR(32) NULL;
UPDATE payments p JOIN bookings b ON b.id = p.booking_id
  SET p.guest_name = b.name, p.prop_key = b.prop_key
  WHERE p.guest_name IS NULL;
