-- migration-132 — six-digit sign-in codes (the code-first sign-in).
-- One row per code sent. Only the HMAC of the code is kept; a code works once,
-- for 30 minutes, and dies after 5 wrong tries. Asking for a new code retires
-- the older ones for that address.
CREATE TABLE IF NOT EXISTS guest_codes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    email      VARCHAR(190) COLLATE utf8mb4_general_ci NOT NULL,
    code_hash  CHAR(64) NOT NULL,
    tries      TINYINT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    used_at    DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
