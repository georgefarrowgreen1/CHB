-- Owner-logged running costs, so the Money page can show NET income (income −
-- expenses) per UK tax year. Allocated to a tax year by expense_date.
CREATE TABLE IF NOT EXISTS expenses (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    category     VARCHAR(64)  NOT NULL DEFAULT 'General',
    description  VARCHAR(255) NULL,
    amount       DECIMAL(10,2) NOT NULL DEFAULT 0,
    prop_key     VARCHAR(32)  NULL,
    expense_date DATE         NOT NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
