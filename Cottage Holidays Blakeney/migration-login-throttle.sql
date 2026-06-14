-- Login rate-limiting: records attempts so repeated failures can be slowed.
-- Run ONCE in phpMyAdmin. Safe to re-run (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS login_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  identifier VARCHAR(190) NOT NULL,
  success TINYINT NOT NULL DEFAULT 0,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ip_id_time (ip, identifier, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
