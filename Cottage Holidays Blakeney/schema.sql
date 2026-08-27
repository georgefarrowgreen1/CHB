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
    unlisted        TINYINT(1)    NOT NULL DEFAULT 0,   -- 1 = private: bookable in the back office, hidden from the public site
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
    -- COLLATE stated, not inherited: every "same person" lookup is a plain
    -- `email = ?` so it can use the index (migration-112), and plain equality is
    -- only case-insensitive because this collation is. Don't drop the COLLATE.
    email         VARCHAR(190)  COLLATE utf8mb4_general_ci NOT NULL UNIQUE,
    phone         VARCHAR(60)   NULL,
    address       TEXT          NULL,
    postcode      VARCHAR(12)   NULL,
    password_hash VARCHAR(255)  NOT NULL,             -- bcrypt via password_hash()
    -- Proof the address is really theirs (migration-111). Only the magic link can
    -- set it, because the link is emailed TO that address. NULL = registered against
    -- an email that already had bookings and not yet confirmed: password sign-in is
    -- refused until then, or anyone who guessed a guest's email would inherit their
    -- stay. A brand-new address has nothing to claim and is stamped at registration.
    email_verified_at DATETIME  NULL,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Enquiries (pending, from the public form) ----------
CREATE TABLE IF NOT EXISTS enquiries (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    prop_key     VARCHAR(32)  NOT NULL,
    name         VARCHAR(160) NOT NULL,
    email        VARCHAR(190) COLLATE utf8mb4_general_ci NULL,
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
    no_dogs_at        DATETIME NULL,           -- guest confirmed they aren't bringing a dog
    seen_at           DATETIME NULL,           -- when the OWNER opened it (stops the red count nagging)
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Confirmed bookings ----------
CREATE TABLE IF NOT EXISTS bookings (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    prop_key       VARCHAR(32)  NOT NULL,
    name           VARCHAR(160) NOT NULL,
    email          VARCHAR(190) COLLATE utf8mb4_general_ci NULL,
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
    -- Per-booking payment plan (migration-103): NULL = site standard.
    deposit_pct_override    DECIMAL(5,2)  NULL,  -- this booking's deposit %, replacing square-deposit-pct
    deposit_amount_override DECIMAL(10,2) NULL,  -- …or a fixed £ deposit (wins over the pct; capped at the total)
    balance_due_date        DATE          NULL,  -- when the balance falls due, replacing check-in − PAYMENT_BALANCE_DAYS
    arrival_window     VARCHAR(20)   NULL,  -- RETIRED: the "when will you arrive?" ask was removed. Nothing reads or writes it; kept because dropping a column destroys what guests already told us, and an unused NULL column costs nothing.
    -- Arrival email review (migration-114): set when the daily job marks the
    -- email ready for the owner to read and send; NULL once review mode is off
    -- or the email went automatically. Distinct from pre_arrival_sent — one is
    -- "waiting for you", the other is "it has gone".
    pre_arrival_ready_at DATETIME    NULL,
    terms_accepted_at  DATETIME      NULL,
    no_dogs_at         DATETIME      NULL,           -- guest confirmed no dog (carried from the enquiry)
    guest_checked_out_at DATETIME    NULL,           -- the guest's own "we've left" tap (migration-120)
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

-- Guest party register (UK Immigration (Hotel Records) Order 1972). One row per
-- booking; the party (names/nationalities/ID docs) is stored ENCRYPTED at rest
-- and auto-purged 12 months after checkout. See migration-guest-registrations.sql.
CREATE TABLE IF NOT EXISTS guest_registrations (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    booking_id    INT NOT NULL,
    party_enc     MEDIUMTEXT NOT NULL,
    guest_count   INT NOT NULL DEFAULT 0,
    submitted_at  DATETIME NULL,
    updated_at    DATETIME NULL,
    expires_at    DATE NULL,
    UNIQUE KEY uniq_booking (booking_id),
    KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The op ledger (migration-109): exactly-once for replayed offline writes.
-- A client-generated op_id rides each queued write; the first success stores
-- its JSON response here and a replay of the same id is answered from it.
-- Pruned after 30 days by self-repair.php.
CREATE TABLE IF NOT EXISTS op_ledger (
    op_id VARCHAR(48) NOT NULL PRIMARY KEY,
    response MEDIUMTEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_op_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The overnight queue (migration-115): what a machine on the owner's own
-- network produced while nobody was asking, waiting for the owner to read.
-- A row is a DRAFT plus a destination — never an instruction; nothing here is
-- ever acted on by the app. `ref` UNIQUE is what makes a retried POST store
-- once, and `expires_at` is stamped at ingest from the kind (nightshift-lib.php)
-- so the deadline the owner was shown never moves. Retired and pruned by
-- self-repair.php.
CREATE TABLE IF NOT EXISTS night_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    ref         VARCHAR(64)  NOT NULL,
    kind        VARCHAR(24)  NOT NULL,
    title       VARCHAR(200) NOT NULL,
    sub         VARCHAR(255) NOT NULL DEFAULT '',
    body        TEXT         NOT NULL,
    source      VARCHAR(255) NOT NULL DEFAULT '',
    target      VARCHAR(120) NOT NULL DEFAULT '',
    status      VARCHAR(16)  NOT NULL DEFAULT 'open',
    created_at  DATETIME     NOT NULL,
    expires_at  DATETIME     NOT NULL,
    acted_at    DATETIME     NULL,
    UNIQUE KEY uniq_night_ref (ref),
    KEY idx_night_open (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The ask channel — the daytime half of the overnight queue (migration-116).
-- The owner files an ask from a screen; the Mac polls, answers with its local
-- model, and the answer lands back on the row for that screen to collect.
CREATE TABLE IF NOT EXISTS night_asks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    kind        VARCHAR(24)  NOT NULL,
    entity_id   INT          NOT NULL DEFAULT 0,
    prop_key    VARCHAR(64)  NOT NULL DEFAULT '',
    question    TEXT         NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'open',
    answer      MEDIUMTEXT   NULL,
    model       VARCHAR(160) NOT NULL DEFAULT '',
    options     TEXT         NULL,
    created_at  DATETIME     NOT NULL,
    answered_at DATETIME     NULL,
    KEY idx_ask_open (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One-shot transactional emails whose transport send failed, retried with
-- backoff (email_outbox_drain in mailer.php; migration-113). Only queued when
-- the payload provably never went out. Stamp-on-success cron flows never queue.
CREATE TABLE IF NOT EXISTS email_outbox (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_try_at DATETIME NOT NULL,
    tries TINYINT NOT NULL DEFAULT 0,
    context VARCHAR(40) NOT NULL DEFAULT '',
    to_email VARCHAR(190) NOT NULL,
    to_name VARCHAR(190) NOT NULL DEFAULT '',
    subject VARCHAR(300) NOT NULL DEFAULT '',
    body_text MEDIUMTEXT NULL,
    body_html MEDIUMTEXT NULL,
    reply_to VARCHAR(190) NULL,
    message_id VARCHAR(120) NULL,
    extra_headers TEXT NULL,
    attachments MEDIUMTEXT NULL,
    last_error VARCHAR(220) NOT NULL DEFAULT '',
    sent_at DATETIME NULL,
    gave_up_at DATETIME NULL,
    KEY idx_due (sent_at, gave_up_at, next_try_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- The web AI chat's conversation (see migration-118) ----------
CREATE TABLE IF NOT EXISTS ownerchat_msgs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    who         VARCHAR(8)   NOT NULL,            -- 'you' | 'mac'
    text        MEDIUMTEXT   NOT NULL,
    think       MEDIUMTEXT   NULL,
    used        VARCHAR(120) NULL,                -- JSON list of tool names
    model       VARCHAR(80)  NULL,
    stopped     TINYINT      NOT NULL DEFAULT 0,
    act         TEXT         NULL,                -- JSON, validated both ways
    act_done    VARCHAR(12)  NULL,                -- 'done' | 'dismissed'
    act_done_at VARCHAR(8)   NULL,
    img         VARCHAR(80)  NULL,                -- chat photo ref (minted shape)
    file        VARCHAR(80)  NULL,                -- an attached document's name
    at          VARCHAR(16)  NOT NULL DEFAULT '',
    convo       INT          NOT NULL DEFAULT 1,   -- which conversation (the rail)
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at),
    INDEX idx_convo (convo, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
