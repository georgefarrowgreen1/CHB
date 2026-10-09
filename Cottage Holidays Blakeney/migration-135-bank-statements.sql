-- migration-135 — the business bank account, read from exported statements.
-- One row per payment in a statement the owner added (statements.php). ext_key is
-- the bank's own transaction id (or a fingerprint when a file has none), and it is
-- UNIQUE: a payment already here is never added twice, so statements may overlap.
-- sorted_as is what the owner said it was (payment / expense / platform / ignore /
-- tax / income), or what needs no question (square / pot); NULL means still to sort.
CREATE TABLE IF NOT EXISTS bank_lines (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    ext_key      VARCHAR(80) NOT NULL,
    import_id    INT NOT NULL DEFAULT 0,
    txn_date     DATE NOT NULL,
    txn_time     VARCHAR(8) NOT NULL DEFAULT '',
    kind         VARCHAR(40) NOT NULL DEFAULT '',
    name         VARCHAR(160) NOT NULL DEFAULT '',
    category     VARCHAR(60) NOT NULL DEFAULT '',
    description  VARCHAR(255) NOT NULL DEFAULT '',
    notes        VARCHAR(255) NOT NULL DEFAULT '',
    amount       DECIMAL(10,2) NOT NULL,
    balance      DECIMAL(12,2) NULL,
    sorted_as    VARCHAR(20) NULL,
    booking_id   INT NULL,
    expense_id   INT NULL,
    sorted_label VARCHAR(160) NULL,
    sorted_at    DATETIME NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ext (ext_key),
    INDEX idx_date (txn_date),
    INDEX idx_sorted (sorted_as)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- One row per statement added: its dates, what it held, and the closing balance
-- when the file carries one (Monzo Business CSVs have a running Balance column).
CREATE TABLE IF NOT EXISTS bank_imports (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    filename        VARCHAR(160) NOT NULL DEFAULT '',
    from_date       DATE NULL,
    to_date         DATE NULL,
    rows_in_file    INT NOT NULL DEFAULT 0,
    added           INT NOT NULL DEFAULT 0,
    skipped         INT NOT NULL DEFAULT 0,
    money_in        DECIMAL(12,2) NOT NULL DEFAULT 0,
    money_out       DECIMAL(12,2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(12,2) NULL,
    closing_at      VARCHAR(19) NULL,
    admin_id        INT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
