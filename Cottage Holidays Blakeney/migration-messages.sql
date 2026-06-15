-- Two-way messaging between the owner (admin) and a logged-in guest.
-- One thread per guest; read flags drive the unread badges on each side.
CREATE TABLE IF NOT EXISTS messages (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    guest_id      INT NOT NULL,
    sender_role   ENUM('guest','admin') NOT NULL,
    body          TEXT NOT NULL,
    read_by_admin TINYINT(1) NOT NULL DEFAULT 0,
    read_by_guest TINYINT(1) NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_guest (guest_id, id),
    CONSTRAINT fk_msg_guest FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
