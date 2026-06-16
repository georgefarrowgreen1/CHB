-- Guest photo wall (UGC): guests submit photos of their stay; the owner moderates;
-- approved ones appear in a gallery on the cottage page. Applied by migrate.php.
CREATE TABLE IF NOT EXISTS guest_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prop_key VARCHAR(32) NOT NULL,
  guest_id INT NULL,
  guest_name VARCHAR(160) NULL,
  url VARCHAR(255) NOT NULL,
  caption VARCHAR(280) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prop_status (prop_key, status),
  INDEX idx_guest (guest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
