-- ============================================================
--  migration-zz-experience-photos.sql — give every Experiences card a themed
--  illustration (same-origin SVGs; the CSP blocks external image hosts, so these
--  live on the site). Named "zz" so it sorts AFTER the experiences card inserts.
--
--  Each UPDATE is guarded with "AND image_url = ''", so it only fills a BLANK
--  image and never overwrites a real photo the owner uploads later in
--  Settings → Experiences. Safe to re-run.
-- ============================================================

-- Seal trips & wildlife
UPDATE experiences SET image_url='exp-seals.svg' WHERE title='Blakeney Point seal trips' AND image_url='';
UPDATE experiences SET image_url='exp-seals.svg' WHERE title='Beans Boat Trips — Blakeney Point seals' AND image_url='';
UPDATE experiences SET image_url='exp-seals.svg' WHERE title='Bishop''s Boats Seal Trips' AND image_url='';
UPDATE experiences SET image_url='exp-seals.svg' WHERE title='Temple''s Seal Trips' AND image_url='';

-- Coast, walks, marshes & beaches
UPDATE experiences SET image_url='exp-coast.svg' WHERE title='Walk the Norfolk Coast Path' AND image_url='';
UPDATE experiences SET image_url='exp-coast.svg' WHERE title='Crabbing off Blakeney Quay' AND image_url='';
UPDATE experiences SET image_url='exp-coast.svg' WHERE title='Cley Marshes & the windmill' AND image_url='';
UPDATE experiences SET image_url='exp-coast.svg' WHERE title='Wells-next-the-Sea beach & pinewoods' AND image_url='';

-- Pubs & dining
UPDATE experiences SET image_url='exp-pub.svg' WHERE title='Blakeney pubs & local seafood' AND image_url='';
UPDATE experiences SET image_url='exp-pub.svg' WHERE title='The White Horse, Blakeney' AND image_url='';
UPDATE experiences SET image_url='exp-pub.svg' WHERE title='The Kings Arms, Blakeney' AND image_url='';
UPDATE experiences SET image_url='exp-pub.svg' WHERE title='The Anchor Inn, Morston' AND image_url='';
UPDATE experiences SET image_url='exp-pub.svg' WHERE title='The George & Dragon, Cley' AND image_url='';

-- Café
UPDATE experiences SET image_url='exp-cafe.svg' WHERE title='Wiveton Hall Café & pick-your-own' AND image_url='';

-- Smokehouse
UPDATE experiences SET image_url='exp-smokehouse.svg' WHERE title='Cley Smokehouse' AND image_url='';

-- Delis & shops
UPDATE experiences SET image_url='exp-deli.svg' WHERE title='Picnic Fayre Delicatessen, Cley' AND image_url='';
UPDATE experiences SET image_url='exp-deli.svg' WHERE title='Blakeney Delicatessen' AND image_url='';
UPDATE experiences SET image_url='exp-deli.svg' WHERE title='Bakers & Larners of Holt' AND image_url='';
