-- Dogs aren't allowed: the code defaults were cleaned up, but owner-saved content
-- overrides in the content table can still carry the old copy. Fix the one live
-- remnant (the 21A amenity) and drop the retired chat answer key if present.
-- Idempotent: the UPDATE only fires while the old text is present.

UPDATE content SET item_value = '"Heritage Coastal Setting"'
 WHERE item_key = '21a-am3' AND item_value LIKE '%Dog Friendly%';

DELETE FROM content WHERE item_key = 'chat-ans-dogs';
