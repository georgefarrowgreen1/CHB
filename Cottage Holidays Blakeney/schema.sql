-- ============================================================
--  Cottage Holidays Blakeney — database schema (MySQL / MariaDB)
--  Import this once via IONOS phpMyAdmin into your database.
-- ============================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------- Property rates & fees (one row per cottage) ----------
CREATE TABLE IF NOT EXISTS properties (
    prop_key        VARCHAR(32)   NOT NULL PRIMARY KEY,   -- '21a','jollyboat','pimpernel' (or owner-added)
    name            VARCHAR(120)  NOT NULL,
    couple_rate     DECIMAL(10,2) NOT NULL DEFAULT 0,
    extra_adult_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
    child_rate      DECIMAL(10,2) NOT NULL DEFAULT 0,
    booking_fee     DECIMAL(10,2) NOT NULL DEFAULT 0,   -- repurposed: standard REFUNDABLE DAMAGES DEPOSIT (held, not income)
    transaction_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
    address         TEXT          NULL,
    -- Dynamic accommodations (owner can add/remove): see migration-accommodations.sql
    archived_at     DATETIME      NULL,                 -- NULL = live; set = removed (soft-archived, history kept)
    slug            VARCHAR(80)   NULL,                  -- pretty URL segment /cottages/<slug>
    accent          VARCHAR(16)   NULL,                  -- hex accent colour for swatches/tags/bars
    sort_order      INT           NOT NULL DEFAULT 100,  -- display order of the cottage cards
    max_adults      INT           NOT NULL DEFAULT 2,    -- occupancy caps (single source of truth)
    max_children    INT           NOT NULL DEFAULT 0,
    max_total       INT           NOT NULL DEFAULT 2,
    weekend_pct     DECIMAL(5,2)  NOT NULL DEFAULT 0,    -- weekend uplift % (smart pricing); 0 = off
    weekend_days    VARCHAR(16)   NOT NULL DEFAULT '5,6' -- weekend day-of-week CSV (0=Sun…6=Sat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Guest accounts ----------
CREATE TABLE IF NOT EXISTS guests (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(160)  NOT NULL,
    email         VARCHAR(190)  NOT NULL UNIQUE,
    phone         VARCHAR(60)   NULL,
    address       TEXT          NULL,
    postcode      VARCHAR(12)   NULL,
    password_hash VARCHAR(255)  NOT NULL,             -- bcrypt via password_hash()
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Enquiries (pending, from the public form) ----------
CREATE TABLE IF NOT EXISTS enquiries (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    prop_key     VARCHAR(32)  NOT NULL,
    name         VARCHAR(160) NOT NULL,
    email        VARCHAR(190) NULL,
    phone        VARCHAR(60)  NULL,
    address      TEXT         NULL,
    postcode     VARCHAR(12)  NULL,
    check_in     DATE         NOT NULL,
    check_out    DATE         NOT NULL,
    check_in_time  VARCHAR(8) NOT NULL DEFAULT '15:00',
    check_out_time VARCHAR(8) NOT NULL DEFAULT '10:00',
    adults       INT          NOT NULL DEFAULT 2,
    children     INT          NOT NULL DEFAULT 0,
    message      TEXT         NULL,
    terms_accepted_at DATETIME NULL,
    terms_version     VARCHAR(20) NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Confirmed bookings ----------
CREATE TABLE IF NOT EXISTS bookings (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    prop_key       VARCHAR(32)  NOT NULL,
    name           VARCHAR(160) NOT NULL,
    email          VARCHAR(190) NULL,
    phone          VARCHAR(60)  NULL,
    address        TEXT         NULL,
    postcode       VARCHAR(12)  NULL,
    check_in       DATE         NOT NULL,
    check_out      DATE         NOT NULL,
    check_in_time  VARCHAR(8)   NOT NULL DEFAULT '15:00',
    check_out_time VARCHAR(8)   NOT NULL DEFAULT '10:00',
    adults         INT          NOT NULL DEFAULT 2,
    children       INT          NOT NULL DEFAULT 0,
    notes          TEXT         NULL,
    payment        ENUM('unpaid','deposit','paid') NOT NULL DEFAULT 'unpaid',
    deposit_paid   DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(40)  NULL,
    payment_date   DATE         NULL,
    -- Agreed (locked) price snapshot, frozen at booking time:
    agreed_total       DECIMAL(10,2) NULL,
    agreed_per_night   DECIMAL(10,2) NULL,
    agreed_nights      INT           NULL,
    agreed_nightly     DECIMAL(10,2) NULL,
    agreed_booking_fee DECIMAL(10,2) NULL,   -- repurposed: damages deposit snapshot for this booking (held, not income)
    agreed_txn_pct     DECIMAL(5,2)  NULL,
    agreed_txn_fee     DECIMAL(10,2) NULL,
    agreed_on          DATE          NULL,
    price_override     DECIMAL(10,2) NULL,   -- if set, this is the agreed TOTAL (manual back-office price)
    terms_accepted_at  DATETIME      NULL,
    terms_version      VARCHAR(20)   NULL,
    -- Refundable damage deposit taken as a Square card HOLD (see migration-damage-hold.sql)
    hold_payment_id    VARCHAR(64)   NULL,
    hold_status        VARCHAR(16)   NOT NULL DEFAULT 'none',  -- none|authorized|captured|released|expired
    hold_amount        DECIMAL(10,2) NULL,
    hold_authorized_at DATETIME      NULL,
    hold_settled_at    DATETIME      NULL,
    hold_requested_at  DATETIME      NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_dates (prop_key, check_in, check_out),
    INDEX idx_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Admin/staff users (back office login) ----------
CREATE TABLE IF NOT EXISTS admins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(60)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Editable site content (key -> JSON value) ----------
-- Stores Live Editor text/image overrides and the dynamic per-property
-- gallery photo lists, so they are shared across devices and permanent.
CREATE TABLE IF NOT EXISTS content (
    item_key   VARCHAR(190) NOT NULL PRIMARY KEY,
    item_value MEDIUMTEXT   NULL,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Seed the three properties (edit later in Settings) ----------
INSERT INTO properties (prop_key, name, couple_rate, extra_adult_rate, child_rate, booking_fee, transaction_pct, address, slug, accent, sort_order, max_adults, max_children, max_total) VALUES
 ('21a',       '21A Westgate', 130, 45, 30, 75, 3, '21A Westgate Street, Blakeney, Norfolk NR25 7NQ', '21a-westgate', '#42A5F5', 10, 2, 0, 2),
 ('jollyboat', 'Jollyboat',    110, 40, 25, 75, 3, 'Jollyboat, Quay Road, Blakeney, Norfolk NR25 7ND',  'jollyboat',    '#43A047', 20, 2, 0, 2),
 ('pimpernel', 'Pimpernel',    120, 42, 28, 75, 3, 'Pimpernel, High Street, Cley-next-the-Sea, Norfolk NR25 7RF', 'pimpernel', '#9C27B0', 30, 3, 1, 3)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- NOTE: the initial admin user is created by running setup.php once (it hashes
-- the password properly). Do not insert a plain-text password here.

-- ---------- External iCal blocked dates (Airbnb/Vrbo sync) ----------
CREATE TABLE IF NOT EXISTS ical_blocks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    prop_key    VARCHAR(32)  NOT NULL,
    source      VARCHAR(40)  NOT NULL,
    uid         VARCHAR(190) NULL,
    check_in    DATE         NOT NULL,
    check_out   DATE         NOT NULL,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prop (prop_key),
    INDEX idx_dates (prop_key, check_in, check_out)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Guest passkeys (WebAuthn / FIDO2) ----------
CREATE TABLE IF NOT EXISTS guest_passkeys (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    guest_id      INT          NOT NULL,
    credential_id VARCHAR(512) NOT NULL,
    public_key    TEXT         NOT NULL,
    label         VARCHAR(120) NULL,
    sign_count    INT          NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  DATETIME     NULL,
    UNIQUE KEY uq_cred (credential_id(191)),
    INDEX idx_guest (guest_id),
    CONSTRAINT fk_passkey_guest FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Admin passkeys (WebAuthn / FIDO2 for back office) ----------
CREATE TABLE IF NOT EXISTS admin_passkeys (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    admin_id      INT          NOT NULL,
    credential_id VARCHAR(512) NOT NULL,
    public_key    TEXT         NOT NULL,
    label         VARCHAR(120) NULL,
    sign_count    INT          NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  DATETIME     NULL,
    UNIQUE KEY uq_admin_cred (credential_id(191)),
    INDEX idx_admin (admin_id),
    CONSTRAINT fk_passkey_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
