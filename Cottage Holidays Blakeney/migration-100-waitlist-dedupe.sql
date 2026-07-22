-- migration-100-waitlist-dedupe.sql — stop the public waitlist "join" from
-- piling up duplicate rows on a double-submit (the concurrency audit's one real
-- gap: the join had no lock, no existence check and no unique key, so the owner
-- could be shown — and email — the same person twice when dates freed up).
--
-- First remove existing duplicate UN-notified joins (keep the earliest id,
-- treating a NULL date as equal to a NULL date), then enforce one join per
-- (cottage, email, dates). The DELETE runs before the ADD UNIQUE so the index
-- can be created on a DB that already has duplicates. Idempotent: re-running the
-- DELETE is a no-op and migrate.php skips the ALTER once the key exists.
DELETE w1 FROM waitlist w1
  JOIN waitlist w2
    ON w1.prop_key = w2.prop_key
   AND w1.email = w2.email
   AND COALESCE(w1.check_in, '') = COALESCE(w2.check_in, '')
   AND COALESCE(w1.check_out, '') = COALESCE(w2.check_out, '')
   AND w1.id > w2.id;

ALTER TABLE waitlist ADD UNIQUE KEY uniq_join (prop_key, email, check_in, check_out);
