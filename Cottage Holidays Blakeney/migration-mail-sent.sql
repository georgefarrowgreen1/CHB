-- ============================================================
--  migration-mail-sent.sql — the admin email client's Sent record.
--
--  POP3 can only read the INBOX, so "Sent" in Manage → Email is our own
--  ledger: every message sent from the client is recorded here (the
--  transactional send_* emails keep their existing email_logs trail —
--  this table is only the owner's hand-written mail).
--
--  Idempotent: CREATE TABLE IF NOT EXISTS, like every other migration.
-- ============================================================
CREATE TABLE IF NOT EXISTS mail_sent (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    to_email VARCHAR(255) NOT NULL,
    cc_email VARCHAR(255) NULL,
    subject VARCHAR(300) NOT NULL,
    body TEXT NOT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_sent_at (sent_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
