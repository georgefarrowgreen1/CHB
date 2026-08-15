-- The email outbox: durable retry for ONE-SHOT transactional emails whose send
-- failed at transport (the booking confirmation, the enquiry acknowledgement,
-- the owner's new-enquiry alert, failed newsletter recipients). A row is only
-- ever queued when the payload provably never went out (sent_uncertain rows are
-- never queued — the server may have accepted them, and a retry would double-
-- send). Flows that already retry via their own stamp-on-success column
-- (pre-arrival, review ask, waitlist, payment chasers) must NEVER also queue
-- here: two retry mechanisms for one email is a double send.
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
);
