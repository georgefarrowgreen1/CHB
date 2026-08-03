-- migration-106-autopay-card.sql — the saved card, and what happened when we
-- tried to use it.
--
-- migration-105 recorded the guest's PERMISSION. These are the three things the
-- collector needs on top of it, and each exists because leaving it out makes a
-- specific failure invisible:
--
--   autopay_customer_id  Square stores a card against a CUSTOMER, and charging a
--                        stored card needs that id back. Kept per booking rather
--                        than per guest deliberately: a guest who books twice
--                        gives permission twice, and one booking's consent must
--                        never quietly authorise another's.
--   autopay_attempts     how many times we have tried. Without a counter the
--                        only retry policy available is "for ever", which on a
--                        declined card is how a guest collects bank fees.
--   autopay_last_try     the date of the last attempt, so a retry is once a DAY
--                        rather than once a cron tick.
--
-- Guarded ADD COLUMNs: migrate.php treats a duplicate-column error as
-- already-applied (do NOT wrap these in information_schema + PREPARE — the
-- no-op branch leaves an open cursor that kills the next migration).
ALTER TABLE bookings ADD COLUMN autopay_customer_id VARCHAR(191) NULL;
ALTER TABLE bookings ADD COLUMN autopay_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN autopay_last_try DATE NULL;
