-- ============================================================
--  migration-accommodations.sql — make accommodations dynamic.
--
--  Lets the owner ADD and REMOVE cottages from the back office instead
--  of the three being hardcoded. All payment/booking logic is keyed off
--  prop_key against a `properties` row, so a created row "just works".
--
--  Removal is a SOFT ARCHIVE (archived_at) — never a hard delete — so
--  past bookings, payments and confirmation emails that reference the
--  cottage stay intact and the row can be restored later.
--
--  Idempotent the same way the other migrations are: plain ADD COLUMN, with
--  migrate.php skipping the "duplicate column" error on re-run (MySQL 8 has no
--  ADD COLUMN IF NOT EXISTS, so we must NOT use it here).
-- ============================================================

-- archived_at: NULL = live; a timestamp = archived (hidden from the public
-- site and new-booking flows, but kept for history).
ALTER TABLE properties ADD COLUMN archived_at DATETIME NULL;

-- slug: the pretty URL segment (/cottages/<slug>). Generated from the name
-- on create; falls back to prop_key when empty.
ALTER TABLE properties ADD COLUMN slug VARCHAR(80) NULL;

-- accent: a hex colour (e.g. '#42A5F5') used for this cottage's swatch/tag/
-- price-bar accents on the site. Auto-assigned on create from a palette.
ALTER TABLE properties ADD COLUMN accent VARCHAR(16) NULL;

-- sort_order: display order of the cottage cards (ascending). Defaults keep
-- the original three first.
ALTER TABLE properties ADD COLUMN sort_order INT NOT NULL DEFAULT 100;

-- Occupancy caps live on the row now (single source of truth) instead of the
-- old hardcoded php map. Saved overrides in content('occupancy-<key>') still
-- win when present (back office "House rules"), so existing edits are kept.
ALTER TABLE properties ADD COLUMN max_adults   INT NOT NULL DEFAULT 2;
ALTER TABLE properties ADD COLUMN max_children INT NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN max_total    INT NOT NULL DEFAULT 2;

-- Seed slugs / accents / occupancy / order for the original three so the live
-- site is byte-for-byte unchanged after migrating. Guarded by prop_key so it
-- only touches the seeded rows and never clobbers owner edits made later.
-- Accents match the hand-tuned --prop-* colours already in app.css / the email
-- templates, so migrating changes nothing visually for the original three.
UPDATE properties SET slug='21a-westgate', accent='#42A5F5', sort_order=10,
       max_adults=2, max_children=0, max_total=2
 WHERE prop_key='21a'       AND (slug IS NULL OR slug='');
UPDATE properties SET slug='jollyboat',    accent='#43A047', sort_order=20,
       max_adults=2, max_children=0, max_total=2
 WHERE prop_key='jollyboat' AND (slug IS NULL OR slug='');
UPDATE properties SET slug='pimpernel',    accent='#9C27B0', sort_order=30,
       max_adults=3, max_children=1, max_total=3
 WHERE prop_key='pimpernel' AND (slug IS NULL OR slug='');
