-- migration-112: state the email columns' collation instead of inheriting it.
--
-- Every "is this the same person" query in the app compares an email address,
-- and they all did it as `LOWER(email) = LOWER(?)`. Measured on this schema with
-- 5,036 rows in `bookings` (MariaDB 10.11, ANALYZE'd):
--
--     WHERE email = ?               ->  type=ref    key=idx_email   rows=1
--     WHERE LOWER(email) = LOWER(?) ->  type=index  key=NULL        rows=5036
--
-- Wrapping the column in a function makes it unusable by the index, so the one
-- query my-bookings.php runs on every guest page load read every row in the
-- table. Plain `=` is ALREADY case-insensitive here — the columns collate
-- utf8mb4_general_ci — so the LOWER() pair bought nothing and cost the index.
--
-- The call sites now use plain equality, which means their correctness rests on
-- that collation. It was inherited from the server default (CHARSET=utf8mb4 with
-- no COLLATE), i.e. true by luck rather than by statement — and a host whose
-- default were a *_bin collation would silently stop a guest seeing their own
-- stay. So say it out loud, on all three tables that hold an address. Same value
-- the columns already carry, so this is a no-op on a correct install and a fix on
-- a wrong one; test-integration asserts the collation ends _ci either way.
--
-- NB a MODIFY drops nothing but the column's own attributes: `guests.email` keeps
-- its UNIQUE key and `bookings.email` keeps idx_email (both are rebuilt under the
-- stated collation, which is the point).
ALTER TABLE bookings  MODIFY email VARCHAR(190) NULL     COLLATE utf8mb4_general_ci;
ALTER TABLE enquiries MODIFY email VARCHAR(190) NULL     COLLATE utf8mb4_general_ci;
ALTER TABLE guests    MODIFY email VARCHAR(190) NOT NULL COLLATE utf8mb4_general_ci;
