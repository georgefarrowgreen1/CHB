-- migration-activity-severity.sql — add a severity flag to the activity log so
-- the back office can surface a "Needs attention" stream (failures, money-at-risk,
-- unusual sign-ins). Idempotent: migrate.php treats a duplicate-column error as
-- already-applied.
ALTER TABLE activity_log ADD COLUMN severity VARCHAR(12) NOT NULL DEFAULT 'info';
