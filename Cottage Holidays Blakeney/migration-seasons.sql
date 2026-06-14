-- Seasonal pricing: date-range couple-rate overrides per property.
-- Run ONCE in phpMyAdmin. Safe to re-run (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS rate_seasons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prop_key VARCHAR(32) NOT NULL,
  label VARCHAR(100) NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  couple_rate DECIMAL(10,2) NOT NULL,
  INDEX idx_prop_start (prop_key, start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
