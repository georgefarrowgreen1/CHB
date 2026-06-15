-- Web Push: store each guest device's push subscription, and track the one-time
-- check-in push so it is never sent twice. Safe to re-run (migrate.php skips
-- "already exists"/"duplicate column").
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  guest_id INT NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh VARCHAR(255) NOT NULL DEFAULT '',
  auth VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  UNIQUE KEY uniq_endpoint (endpoint(191)),
  INDEX idx_guest (guest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE bookings ADD COLUMN checkin_push_sent DATETIME NULL;
