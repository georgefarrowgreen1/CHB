-- Local "Experiences" (things to do near Blakeney): admin-curated cards plus
-- guest SUGGESTIONS (moderated — only 'published' rows show on the site).
-- Applied by migrate.php. Safe to re-run (CREATE IF NOT EXISTS).
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

-- Starter experiences tied to the local area. Each is guarded by its own title,
-- so this is safe to re-run and won't duplicate or overwrite the owner's edits.
INSERT INTO experiences (title, body, category, distance, map_query, sort_order)
SELECT 'Blakeney Point seal trips', 'Hop on a ferry from Morston Quay out to Blakeney Point to see England''s largest grey seal colony — pups on the sand in winter and seals basking year-round, with seabirds all along the spit. Several family-run operators sail daily; check tide times before you go.', 'Boat trips & wildlife', 'About 10 min drive to Morston Quay', 'Morston Quay, Blakeney, Norfolk', 1
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Blakeney Point seal trips');

INSERT INTO experiences (title, body, category, distance, map_query, sort_order)
SELECT 'Walk the Norfolk Coast Path', 'Step straight onto the Norfolk Coast Path from the village — wide skies, saltmarsh and endless birdlife. Head east toward Cley''s windmill or west to Stiffkey and Wells; the marshes here are a National Nature Reserve.', 'Walks & nature', 'On the doorstep', 'Blakeney Quay, Norfolk', 2
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Walk the Norfolk Coast Path');

INSERT INTO experiences (title, body, category, distance, map_query, sort_order)
SELECT 'Crabbing off Blakeney Quay', 'A Norfolk rite of passage: drop a line off the quay around high tide and see how many crabs you can catch. Buckets and lines are sold in the village. Gentle, free and endlessly fun for little ones — just pop the crabs back afterwards.', 'Family & kids', '5 min walk', 'Blakeney Quay, Norfolk', 3
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Crabbing off Blakeney Quay');

INSERT INTO experiences (title, body, category, distance, map_query, sort_order)
SELECT 'Cley Marshes & the windmill', 'Norfolk Wildlife Trust''s flagship reserve is superb for birdwatching from the hides, with a visitor centre café looking out over the reeds. Pair it with a photo of the much-loved Cley windmill just along the road.', 'Days out & attractions', 'About 5 min drive', 'Cley Marshes Visitor Centre, Norfolk', 4
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Cley Marshes & the windmill');

INSERT INTO experiences (title, body, category, distance, map_query, sort_order)
SELECT 'Wells-next-the-Sea beach & pinewoods', 'A classic Norfolk beach: pastel beach huts, miles of golden sand and shady pinewoods behind. Add fish and chips on the quay and the little harbour railway for a perfect family day out.', 'Beaches & coast', 'About 15 min drive', 'Wells-next-the-Sea Beach, Norfolk', 5
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Wells-next-the-Sea beach & pinewoods');

INSERT INTO experiences (title, body, category, distance, map_query, sort_order)
SELECT 'Blakeney pubs & local seafood', 'Seafood and local ales right on your doorstep — try the Kings Arms or the White Horse in the village, or head to Morston for just-landed crab. Booking ahead is wise in summer.', 'Food & drink', 'Short walk in the village', 'Blakeney, Norfolk', 6
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE title = 'Blakeney pubs & local seafood');

