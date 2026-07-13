-- Direct-booking leads: reviews left by EXTERNAL (Airbnb/Vrbo/etc.) guests via
-- the per-cottage /review/<slug> links. Distinct from guest_reviews (which keys
-- off a registered guest with a booking) — these guests have no account, so we
-- capture their contact details here to (a) publish an approved review and
-- (b) re-invite them next year to book DIRECT and skip the OTA fees.
-- Applied by migrate.php. Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS direct_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prop_key VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) DEFAULT NULL,
  stars TINYINT NOT NULL DEFAULT 5,
  review_text TEXT NOT NULL,
  source VARCHAR(24) NOT NULL DEFAULT 'direct',        -- which channel the link was shared on (airbnb/vrbo/direct)
  status ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',  -- moderation of the PUBLIC review
  admin_rating TINYINT DEFAULT NULL,                   -- PRIVATE owner rating of the guest (1-5); low = drop from follow-ups
  admin_note VARCHAR(500) DEFAULT NULL,                -- PRIVATE owner note (never shown to the guest)
  review_id INT DEFAULT NULL,                          -- guest_reviews.id once the review is published (reserved)
  follow_up_at DATE DEFAULT NULL,                      -- when to send the "book direct" re-invite
  follow_up_sent_at DATETIME DEFAULT NULL,
  ip VARCHAR(45) DEFAULT NULL,                         -- submitter IP (abuse triage only)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_followup (follow_up_at, follow_up_sent_at),
  INDEX idx_prop (prop_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
