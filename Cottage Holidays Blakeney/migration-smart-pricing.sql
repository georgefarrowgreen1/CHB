-- ============================================================
--  migration-smart-pricing.sql — weekend pricing (Phase 1 of smart pricing).
--  Adds a per-cottage weekend uplift used by the deterministic price engine
--  (couple_rate_for_night in pricing.php + coupleRateForNight/nightlyRateFor in
--  app.js, kept in lockstep). The Pricing Coach (admin-only suggestions) reads
--  bookings + search_log and proposes changes to these fields — it never prices
--  guests directly. Plain ADD COLUMN (idempotent via migrate.php's skip).
-- ============================================================

-- Weekend uplift as a percentage on the night's base/seasonal rate (0 = off).
ALTER TABLE properties ADD COLUMN weekend_pct DECIMAL(5,2) NOT NULL DEFAULT 0;
-- Which weekdays count as "weekend", as day-of-week numbers (0=Sun … 6=Sat).
-- Default Fri,Sat. Stored as a short CSV so JS and PHP read it identically.
ALTER TABLE properties ADD COLUMN weekend_days VARCHAR(16) NOT NULL DEFAULT '5,6';
