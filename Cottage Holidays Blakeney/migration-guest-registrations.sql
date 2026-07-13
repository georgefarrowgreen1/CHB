-- ============================================================
--  migration-guest-registrations.sql — guest party register (UK legal duty).
--
--  The Immigration (Hotel Records) Order 1972 requires accommodation providers
--  to record, for every guest aged 16+, their full name and nationality (and,
--  for non-British/Irish guests, passport/ID details and their next
--  destination), and to keep those records for 12 months.
--
--  The lead guest fills this in from a token link in the confirmation email
--  (guest-details.php). One row per booking; the party is stored ENCRYPTED at
--  rest (db.php encrypt_value / AES-256-GCM) because it is sensitive PII, and is
--  auto-purged 12 months after checkout (self-repair.php).
--
--  Idempotent: CREATE TABLE IF NOT EXISTS is safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS guest_registrations (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    booking_id    INT NOT NULL,
    party_enc     MEDIUMTEXT NOT NULL,          -- encrypt_value(json_encode(party))
    guest_count   INT NOT NULL DEFAULT 0,       -- number of 16+ guests recorded (no PII)
    submitted_at  DATETIME NULL,                -- when the guest first submitted
    updated_at    DATETIME NULL,                -- last edit
    expires_at    DATE NULL,                    -- checkout + 12 months; purged after
    UNIQUE KEY uniq_booking (booking_id),
    KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
