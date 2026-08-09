-- The op ledger: exactly-once for replayed writes.
--
-- A phone on one bar can land a request whose REPLY dies on the way back — the
-- client cannot tell that from a request that never arrived, so it queues the
-- write and retries. Without this table the retry double-applies: a second
-- expense row, a duplicated chat message, or set_payment regressing a newer
-- figure with a stale one. Each queued write carries a client-generated op_id;
-- the FIRST successful run stores its JSON response here, and a replay of the
-- same id is answered from the stored response instead of re-running.
--
-- Rows are pruned after 30 days by self-repair.php — far beyond any replay
-- horizon (the client queue itself refuses nothing, but a phone that has been
-- offline for a month gets a fresh answer, which is the safe direction).
CREATE TABLE IF NOT EXISTS op_ledger (
    op_id VARCHAR(48) NOT NULL PRIMARY KEY,
    response MEDIUMTEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_op_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
