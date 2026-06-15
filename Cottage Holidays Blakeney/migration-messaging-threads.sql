-- Chat threads: one per conversation. Either a logged-in guest (guest_id) or an
-- anonymous visitor (token, kept in their browser), with context captured at
-- first contact (where they came from, rough location, device). Messages now
-- reference a thread, so anonymous visitors can chat too.
CREATE TABLE IF NOT EXISTS chat_threads (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    guest_id    INT NULL,
    token       VARCHAR(64) NULL,
    name        VARCHAR(120) NULL,
    email       VARCHAR(190) NULL,
    source      VARCHAR(190) NULL,
    location    VARCHAR(120) NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_token (token),
    INDEX idx_guest (guest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Link existing per-guest messages to threads.
ALTER TABLE messages ADD COLUMN thread_id INT NULL;
ALTER TABLE messages MODIFY guest_id INT NULL;

INSERT INTO chat_threads (guest_id, name, email, created_at)
    SELECT g.id, g.name, g.email, NOW() FROM guests g
    WHERE g.id IN (SELECT DISTINCT guest_id FROM messages WHERE guest_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.guest_id = g.id);

UPDATE messages m JOIN chat_threads t ON t.guest_id = m.guest_id
    SET m.thread_id = t.id WHERE m.thread_id IS NULL AND m.guest_id IS NOT NULL;
