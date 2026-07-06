-- ============================================================
--  migration-lastmin.sql — last-minute discount (per cottage). A % off the
--  nightly rental for stays whose check-in is within N days of today. Both 0 by
--  default = OFF, so pricing is unchanged until the owner sets it. Applied by the
--  price model (pricing.php + app.js, kept in lockstep, guarded by the pricing
--  tests). Plain ADD COLUMN on the base `properties` table — no ordering concern.
-- ============================================================
ALTER TABLE properties ADD COLUMN lastmin_pct  DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN lastmin_days INT          NOT NULL DEFAULT 0;
