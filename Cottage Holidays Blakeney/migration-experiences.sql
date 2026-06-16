-- Local "Experiences" (things to do near Blakeney): admin-curated cards plus
-- guest SUGGESTIONS (moderated — only 'published' rows show on the site).
-- Applied by migrate.php. Safe to re-run (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS experiences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  image_url VARCHAR(512) NOT NULL DEFAULT '',
  link_label VARCHAR(80) NOT NULL DEFAULT '',
  link_url VARCHAR(512) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  category VARCHAR(48) NOT NULL DEFAULT '',
  status ENUM('published','pending','rejected') NOT NULL DEFAULT 'published',
  source ENUM('admin','guest') NOT NULL DEFAULT 'admin',
  suggested_by_name VARCHAR(120) NOT NULL DEFAULT '',
  suggested_by_email VARCHAR(190) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
