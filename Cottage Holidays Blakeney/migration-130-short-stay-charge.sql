-- ============================================================
--  migration-130-short-stay-charge.sql — a short stay pays for its own trip.
--
--  Every changeover costs the owner a two-hour round drive plus cleaning, the
--  same for two nights as for a week. short_fee is a per-night charge added to
--  stays of short_max nights or fewer (0 = off), folded into the nightly
--  rental so every quote, snapshot, email and invoice carries it unchanged.
-- ============================================================
ALTER TABLE properties ADD COLUMN short_fee DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN short_max INT NOT NULL DEFAULT 2;
