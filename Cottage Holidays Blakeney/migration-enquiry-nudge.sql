-- One gentle follow-up email per pending enquiry: track when it was sent so we
-- never nudge the same enquiry twice. Applied by migrate.php.
-- If the line errors with "duplicate column", that part is already done.
ALTER TABLE enquiries ADD COLUMN nudge_sent_at DATETIME NULL;
