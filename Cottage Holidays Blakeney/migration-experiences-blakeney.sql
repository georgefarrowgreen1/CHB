-- ============================================================
--  migration-experiences-blakeney.sql — real local "Experiences" for the
--  Blakeney area: seal trips, pubs, food, delis & shops, each with directions
--  (map_query → Google Maps) and a phone number where one could be verified.
--
--  Applied by migrate.php. Each card is guarded by its own title with
--  WHERE NOT EXISTS, so this is safe to re-run and never duplicates or
--  overwrites the owner's edits. All are published + source 'admin', so they
--  show on the public Experiences tab immediately. Phone/links/images can be
--  refined any time in Settings → Experiences.
--
--  NOTE: phone numbers were verified against the businesses' own sites/listings
--  at authoring time but can change — the owner should sanity-check before relying
--  on them. Where a number was ambiguous it was left blank (the card just hides
--  the Call button). Images are left blank (a tasteful placeholder shows until the
--  owner adds a photo).
-- ============================================================

-- ---- Schema safety ----
-- Make sure the table AND the columns these cards use exist before inserting.
-- Older installs created `experiences` before the distance/map_query columns were
-- added, and CREATE TABLE IF NOT EXISTS won't add columns to an existing table —
-- so guard with ALTERs. migrate.php treats "duplicate column" as already-applied,
-- so both are safe to re-run. (This file sorts before migration-experiences.sql,
-- so the CREATE also covers a brand-new database where the table doesn't exist yet.)
CREATE TABLE IF NOT EXISTS experiences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  image_url VARCHAR(512) NOT NULL DEFAULT '',
  link_label VARCHAR(80) NOT NULL DEFAULT '',
  link_url VARCHAR(512) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  category VARCHAR(48) NOT NULL DEFAULT '',
  distance VARCHAR(80) NOT NULL DEFAULT '',
  map_query VARCHAR(255) NOT NULL DEFAULT '',
  status ENUM('published','pending','rejected') NOT NULL DEFAULT 'published',
  source ENUM('admin','guest') NOT NULL DEFAULT 'admin',
  suggested_by_name VARCHAR(120) NOT NULL DEFAULT '',
  suggested_by_email VARCHAR(190) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE experiences ADD COLUMN distance VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE experiences ADD COLUMN map_query VARCHAR(255) NOT NULL DEFAULT '';

-- ---- Seal trips to Blakeney Point (Boat trips & wildlife) ----
INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'Beans Boat Trips — Blakeney Point seals', 'A Blakeney institution: the Bean family have run ferries out to the Blakeney Point grey-seal colony for generations. Sail from Morston Quay to see seals hauled out on the sand and seabirds along the spit — check tide times, as departures follow the tide.', 'Boat trips & wildlife', 'About 5 min drive to Morston Quay', 'Beans Boat Trips, Morston Quay, Norfolk', '01263 740505', 'Visit website', 'https://www.beansboattrips.co.uk/', 'published', 'admin', 7
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Beans Boat Trips — Blakeney Point seals');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'Bishop''s Boats Seal Trips', 'Family-run seal trips to Blakeney Point, sailing from Blakeney Quay itself (and Morston) depending on the tide. A lovely hour or so out on the water past the saltmarsh to England''s largest grey-seal colony. Book ahead in season.', 'Boat trips & wildlife', 'Departs Blakeney Quay', 'Blakeney Quay, Blakeney, Norfolk', '01263 740753', 'Book online', 'https://bishopsboats.co.uk/', 'published', 'admin', 8
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Bishop''s Boats Seal Trips');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'Temple''s Seal Trips', 'Long-established seal-trip operator running daily ferries from Morston Quay out to Blakeney Point. Knowledgeable local skippers and a great-value way to see the seals and nesting seabirds up close.', 'Boat trips & wildlife', 'About 5 min drive to Morston Quay', 'Temple''s Seal Trips, Morston Quay, Norfolk', '01263 740791', 'Visit website', 'https://www.sealtrips.co.uk/', 'published', 'admin', 9
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Temple''s Seal Trips');

-- ---- Pubs & dining (Food & drink) ----
INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'The White Horse, Blakeney', 'A cosy former coaching inn just up from the quay, pouring Adnams ales and serving local seafood and seasonal Norfolk dishes. A favourite spot for lunch after a walk on the marshes.', 'Food & drink', 'In the village', 'The White Horse, High Street, Blakeney, Norfolk', '01263 740574', 'Visit website', 'https://www.whitehorseblakeney.co.uk/', 'published', 'admin', 10
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'The White Horse, Blakeney');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'The Kings Arms, Blakeney', 'A welcoming, dog-friendly free house near the harbour, built from three old fishermen''s cottages. Hearty pub food, well-kept ales and a sunny garden — a Blakeney classic.', 'Food & drink', 'In the village', 'Kings Arms, Westgate Street, Blakeney, Norfolk', '01263 740341', 'Visit website', 'https://www.kingsarmsblakeney.co.uk/', 'published', 'admin', 11
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'The Kings Arms, Blakeney');

INSERT INTO experiences (title, body, category, distance, map_query, link_label, link_url, status, source, sort_order)
SELECT 'The Anchor Inn, Morston', 'A relaxed coastal free house in neighbouring Morston, well known for proper fish & chips and just-landed local crab. Handy before or after a seal trip from Morston Quay.', 'Food & drink', 'About 5 min drive to Morston', 'The Anchor Inn, Morston, Norfolk', 'Visit website', 'https://www.themorstonanchor.co.uk/', 'published', 'admin', 12
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'The Anchor Inn, Morston');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'The George & Dragon, Cley', 'A handsome inn overlooking the Cley marshes — a popular birdwatchers'' haunt with a good kitchen and a terrace made for big Norfolk skies. A short hop along the coast road.', 'Food & drink', 'About 5 min drive to Cley', 'The George & Dragon, Cley-next-the-Sea, Norfolk', '01263 741578', 'Visit website', 'https://georgeanddragoncley.co.uk/', 'published', 'admin', 13
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'The George & Dragon, Cley');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'Wiveton Hall Café & pick-your-own', 'A quirky, much-loved café in a Jacobean hall just inland, with garden tables, home baking and pick-your-own fruit in summer. Lovely for a leisurely lunch off the coast road.', 'Food & drink', 'About 5 min drive', 'Wiveton Hall, Wiveton, Norfolk', '07521 219476', 'Visit website', 'https://www.wivetonhall.co.uk/', 'published', 'admin', 14
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Wiveton Hall Café & pick-your-own');

-- ---- Delis, smokehouse & shops (Local shops & markets) ----
INSERT INTO experiences (title, body, category, distance, map_query, phone, status, source, sort_order)
SELECT 'Cley Smokehouse', 'A family smokehouse on Cley high street, curing kippers, smoked salmon, prawns and Cromer crab the traditional way for over 30 years. Perfect for stocking the cottage fridge with proper local produce.', 'Local shops & markets', 'About 5 min drive to Cley', 'Cley Smokehouse, High Street, Cley-next-the-Sea, Norfolk', '01263 740282', 'published', 'admin', 15
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Cley Smokehouse');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'Picnic Fayre Delicatessen, Cley', 'An award-winning deli in the old forge at Cley — fresh-baked bread, cheese, charcuterie, wine and local groceries. Exactly where to build a marsh-side picnic.', 'Local shops & markets', 'About 5 min drive to Cley', 'Picnic Fayre, The Old Forge, Cley-next-the-Sea, Norfolk', '01263 740587', 'Visit website', 'https://www.picnic-fayre.co.uk/', 'published', 'admin', 16
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Picnic Fayre Delicatessen, Cley');

INSERT INTO experiences (title, body, category, distance, map_query, phone, status, source, sort_order)
SELECT 'Blakeney Delicatessen', 'A friendly village deli on Blakeney high street for coffee, sandwiches, local cheeses and treats to take back to the cottage — handy for everyday bits without leaving the village.', 'Local shops & markets', 'In the village', 'Blakeney Delicatessen, High Street, Blakeney, Norfolk', '01263 740939', 'published', 'admin', 17
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Blakeney Delicatessen');

INSERT INTO experiences (title, body, category, distance, map_query, phone, link_label, link_url, status, source, sort_order)
SELECT 'Bakers & Larners of Holt', 'A wonderful old-fashioned department store and food hall in Georgian Holt — a grand deli counter, wines, homeware and more. A lovely rainy-day potter a short drive inland.', 'Local shops & markets', 'About 10 min drive to Holt', 'Bakers & Larners, Market Place, Holt, Norfolk', '01263 712244', 'Visit website', 'https://www.bakersandlarners.co.uk/', 'published', 'admin', 18
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Bakers & Larners of Holt');
