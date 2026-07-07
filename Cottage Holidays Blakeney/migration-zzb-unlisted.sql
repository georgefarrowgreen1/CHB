-- "Unlisted" (private) cottages — fully managed in the back office (bookings,
-- payments, calendar, money, invoices) but hidden from every PUBLIC surface
-- (website cottage cards, footer, JSON-LD, sitemap, /cottages/<slug>, and the
-- public enquiry form). A boolean flag on the properties table; unlike
-- archived_at, operational paths (availability/iCal/conflict-audit) keep
-- including it so its bookings still work.
--
-- Idempotent: MySQL 8 has no ADD COLUMN IF NOT EXISTS, so this is a plain
-- ADD COLUMN and migrate.php swallows the "duplicate column" error on re-run.
ALTER TABLE properties ADD COLUMN unlisted TINYINT(1) NOT NULL DEFAULT 0;
