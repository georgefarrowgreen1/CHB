-- Square online payments: an audit row per charge/refund taken through Square.
-- The booking's headline state still lives on bookings (payment/deposit_paid);
-- this table is the per-transaction ledger (deposit + balance + any refunds).
-- Applied automatically by migrate.php. Safe to re-run (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  square_payment_id VARCHAR(64) NOT NULL,
  kind ENUM('deposit','balance','refund') NOT NULL DEFAULT 'deposit',
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_square_payment (square_payment_id),
  INDEX idx_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
