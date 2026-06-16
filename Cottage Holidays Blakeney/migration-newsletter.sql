-- Newsletter / seasonal broadcast: a simple opt-in mailing list the owner owns
-- (vs the OTAs). One row per subscriber; unsubscribed_at set when they opt out via
-- their unique token. Applied automatically by migrate.php. Safe to re-run.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(160) NULL,
  token VARCHAR(48) NOT NULL,
  source VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at DATETIME NULL,
  UNIQUE KEY uniq_email (email),
  UNIQUE KEY uniq_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
