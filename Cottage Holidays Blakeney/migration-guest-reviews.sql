-- Guest-submitted reviews (moderated: only approved ones appear on the site).
-- Run ONCE in phpMyAdmin. Safe to re-run (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS guest_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  guest_id INT NOT NULL,
  prop_key VARCHAR(32) NOT NULL,
  stars TINYINT NOT NULL DEFAULT 5,
  review_text TEXT NOT NULL,
  status ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_guest_prop (guest_id, prop_key),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
