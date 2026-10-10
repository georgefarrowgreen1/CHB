-- The email outbox remembers what each queued email is about (email_outbox_wanted in
-- mailer.php), so a retry after the stay moved or was cancelled, the enquiry was answered,
-- the address unsubscribed or the person was removed is not sent. A plain ADD COLUMN:
-- migrate.php treats a duplicate column as already applied.
ALTER TABLE email_outbox ADD COLUMN ref VARCHAR(190) NULL;
