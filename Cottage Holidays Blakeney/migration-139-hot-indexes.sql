-- ============================================================
--  migration-139-hot-indexes.sql — indexes for the reads that run on every
--  booking page, every send and every rate-limited request.
--
--  activity_log is kept for three years under a 200,000-row ceiling, and the
--  reads that run most often filtered it on columns nothing indexed, so each
--  was a scan of the whole table:
--   * a booking page's feed and the send guard (recent_send_at) read
--     `entity = 'booking' AND entity_id = ?` — idx_activity_entity;
--   * the per-hour caps (CSP and blocked reports, the guest chat's owner
--     alert, the customer-lookup dedupe) and the status checks read
--     `action = ? AND created_at > …` — idx_activity_action.
--  login_attempts is counted by `identifier` alone (the per-account limits,
--  the daily sign-in email allowance, the code pause) while its only index
--  starts with `ip`, so a flood of requests made every check slower than the
--  last. enquiries.email had no index at all (a guest's own enquiries, account
--  deletion, the nudge's "enquired again" check).
--
--  One plain ALTER per index: migrate.php reads "Duplicate key name" as
--  already applied, so this is safe to run again.
-- ============================================================
ALTER TABLE activity_log ADD INDEX idx_activity_entity (entity, entity_id, id);
ALTER TABLE activity_log ADD INDEX idx_activity_action (action, created_at);
ALTER TABLE login_attempts ADD INDEX idx_attempt_ident (identifier, attempted_at);
ALTER TABLE enquiries ADD INDEX idx_enq_email (email);
