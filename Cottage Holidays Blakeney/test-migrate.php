<?php
// ============================================================
//  test-migrate.php — SQL statement splitter (dev/CI only).
//
//      php test-migrate.php
//
//  Exercises split_sql() in migrate.php WITHOUT a DB: including the file only
//  defines the (hoisted) pure helpers because its request bootstrap returns
//  early when the running script isn't migrate.php.
//
//  Regression guard: a semicolon inside an inline "-- " / "#" comment (or inside
//  a string literal) must NOT chop a CREATE TABLE in half — that bug shipped a
//  broken migration-guest-registrations.sql to production (MySQL 1064 "near ''
//  at line 8").
// ============================================================
error_reporting(E_ALL);
require __DIR__ . '/migrate.php';

$fail = 0;
$pass = 0;
function check($name, $cond)
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name\n";
    }
}

echo "\n== SQL statement splitter ==\n";

check('split_sql is exposed (hoisted past the bootstrap guard)', function_exists('split_sql'));

$tmp = tempnam(sys_get_temp_dir(), 'mig') . '.sql';

// 1. Inline "-- " comment containing a semicolon must not split the statement.
file_put_contents($tmp, "CREATE TABLE t (\n  a INT NOT NULL,           -- checkout + 12 months; then purged\n  b DATE NULL\n) ENGINE=InnoDB;\n");
$p = split_sql($tmp);
check('inline "--" comment with ; → single statement', count($p) === 1 && stripos($p[0], 'ENGINE=InnoDB') !== false);
check('inline comment text is stripped from the statement', stripos($p[0], 'checkout') === false);

// 2. Inline "#" comment containing a semicolon.
file_put_contents($tmp, "CREATE TABLE t (\n  a INT NOT NULL  # note; with a semicolon\n) ENGINE=InnoDB;\n");
$p = split_sql($tmp);
check('inline "#" comment with ; → single statement', count($p) === 1 && stripos($p[0], 'note') === false);

// 3. A semicolon inside a string literal is preserved and does not split.
file_put_contents($tmp, "INSERT INTO t (b) VALUES ('sail daily; check tides');\n");
$p = split_sql($tmp);
check('semicolon inside a string literal → single statement', count($p) === 1 && strpos($p[0], 'sail daily; check tides') !== false);

// 4. Genuine statement terminators still split.
file_put_contents($tmp, "CREATE TABLE a (x INT);\nCREATE TABLE b (y INT);\n");
$p = split_sql($tmp);
check('two real statements → two parts', count($p) === 2);

// 5. Full-line comments and blank lines are dropped.
file_put_contents($tmp, "-- a full line comment\n\n# another\nCREATE TABLE z (x INT);\n");
$p = split_sql($tmp);
check('full-line comments + blanks dropped → one statement', count($p) === 1 && stripos($p[0], 'CREATE TABLE z') === 0);

// 6. The real shipped migration parses to exactly one CREATE TABLE.
$p = split_sql(__DIR__ . '/migration-guest-registrations.sql');
check('migration-guest-registrations.sql → one complete CREATE TABLE', count($p) === 1 && stripos($p[0], 'guest_registrations') !== false && stripos($p[0], 'ENGINE=InnoDB') !== false);

@unlink($tmp);

echo "\n== Migration apply order (migration_sort) ==\n";

check('migration_sort is exposed (hoisted past the bootstrap guard)', function_exists('migration_sort'));

// Legacy names keep plain byte order among themselves; numeric-prefixed NEW
// migrations run after ALL legacy files, in numeric order — so a fresh database
// always runs a new ALTER after the legacy CREATE it depends on.
$sorted = migration_sort([
    '/x/migration-101-add-col.sql',
    '/x/migration-zzd-magic-single-use.sql',
    '/x/migration-100-new-table.sql',
    '/x/migration-accommodations.sql',
    '/x/migration-zz3-content-no-dogs.sql',
]);
$names = array_map('basename', $sorted);
check('legacy files first, in byte order', array_slice($names, 0, 3) === ['migration-accommodations.sql', 'migration-zz3-content-no-dogs.sql', 'migration-zzd-magic-single-use.sql']);
check('numeric migrations after all legacy, in numeric order', array_slice($names, 3) === ['migration-100-new-table.sql', 'migration-101-add-col.sql']);
check('numeric order is numeric, not lexical (110 > 20)', array_map('basename', migration_sort(['/x/migration-110-b.sql', '/x/migration-20-a.sql'])) === ['migration-20-a.sql', 'migration-110-b.sql']);

// ---- A force=1 RE-RUN redoes schema, never data ---------------------------
// force exists to repair a wrongly-baselined database (tables marked applied
// that were never created), and its safety argument is that the DDL is
// idempotent. Two migrations carry DATA backfills that are not: re-running
// migration-111's `UPDATE guests SET email_verified_at = NOW() WHERE
// email_verified_at IS NULL` re-verifies every account that has since
// registered and not proved its address, and migration-damages-deposit's
// `UPDATE properties SET booking_fee = 75` resets each original cottage's
// deposit over whatever the owner has set since. migration_stmt_is_schema is
// the classifier that decides; an ALLOWLIST, so anything unrecognised counts as
// data and a re-run leaves it alone.
check('ALTER is schema — a re-run may redo it', migration_stmt_is_schema('ALTER TABLE bookings ADD COLUMN x DATE NULL') === true);
check('CREATE TABLE is schema', migration_stmt_is_schema('CREATE TABLE IF NOT EXISTS t (id INT)') === true);
check('CREATE INDEX is schema, leading whitespace and all', migration_stmt_is_schema("  \n CREATE INDEX i ON t (c)") === true);
check('a leading -- comment does not hide the verb', migration_stmt_is_schema("-- why\nALTER TABLE t ADD COLUMN y INT") === true);
check('the guest-verification backfill is DATA — never redone on a re-run',
    migration_stmt_is_schema('UPDATE guests SET email_verified_at = NOW() WHERE email_verified_at IS NULL') === false);
check('the damages-deposit backfill is DATA — the owner\'s figure survives a re-run',
    migration_stmt_is_schema("UPDATE properties SET booking_fee = 75 WHERE prop_key IN ('21a','jollyboat','pimpernel')") === false);
check('INSERT is data', migration_stmt_is_schema('INSERT INTO t VALUES (1)') === false);
check('DELETE is data', migration_stmt_is_schema('DELETE FROM t WHERE id = 1') === false);
// The conservative direction: an unrecognised shape is DATA, so a re-run skips
// it rather than guessing. (A genuinely new DDL verb simply needs adding here,
// which is a deliberate act; the failure mode of the reverse is overwriting
// live values.)
check('an unrecognised statement counts as data, not schema', migration_stmt_is_schema('REPLACE INTO t VALUES (1)') === false);
// The two real files are still classified as expected, read from disk.
$m111 = array_filter(array_map('trim', split_sql(__DIR__ . '/migration-111-guest-email-verified.sql')), fn($s) => $s !== '');
// NB check() takes exactly (name, cond) here — no detail argument (the
// three-ok() lesson: PHPStan analyses every test file as one set, so calling it
// with a third would re-type this helper against every other call site).
check('migration-111 really carries both a schema statement and a data one',
    count(array_filter($m111, 'migration_stmt_is_schema')) >= 1
    && count(array_filter($m111, fn($s) => !migration_stmt_is_schema($s))) >= 1);

// ---- "Already in place", in both engines' words --------------------------------
// migrate.php skips a statement whose change is already there and stops a file on
// anything else. Dropping an index that is not there is one error (1091) worded two
// ways: MariaDB's wording was missing, so migration-152's DROP of an index only some
// databases have stopped the file on every MariaDB database. The messages are the
// engines' own, captured from a server.
echo "\n== What counts as already in place ==\n";
check('MySQL: dropping an index that is not there is already done',
    is_idempotent_error("SQLSTATE[42000]: Syntax error or access violation: 1091 Can't DROP 'ft_bookings'; check that column/key exists") === true);
check('MariaDB: the same error in its own words',
    is_idempotent_error('SQLSTATE[42000]: Syntax error or access violation: 1091 Can\'t DROP INDEX `ft_bookings`; check that it exists') === true);
check('an index name that exists already is already done',
    is_idempotent_error("SQLSTATE[42000]: Syntax error or access violation: 1061 Duplicate key name 'ft_messages_body'") === true);
check('a column that exists already is already done',
    is_idempotent_error("SQLSTATE[42S21]: Column already exists: 1060 Duplicate column name 'username'") === true);
check('a table that exists already is already done',
    is_idempotent_error("SQLSTATE[42S01]: Base table or view already exists: 1050 Table 'perf_day' already exists") === true);
check('a full-text index over two collations is a real failure (1283)',
    is_idempotent_error("SQLSTATE[HY000]: General error: 1283 Column 'email' cannot be part of FULLTEXT index") === false);
check('an illegal mix of collations is a real failure (1267)',
    is_idempotent_error("SQLSTATE[HY000]: General error: 1267 Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_general_ci,IMPLICIT) for operation '='") === false);
check('a missing table is a real failure (1146)',
    is_idempotent_error("SQLSTATE[42S02]: Base table or view not found: 1146 Table 'chb.pageviews' doesn't exist") === false);

// ---- One collation per full-text index -----------------------------------------
// A FULLTEXT index needs ONE collation across its columns (error 1283). A column that
// states its own (migration-112's email, migration-148's username) and one that takes
// its table's default only agree on a server whose utf8mb4 default happens to be that
// same collation: MariaDB's is utf8mb4_general_ci, MySQL 8's utf8mb4_0900_ai_ci. The
// first migration-151 indexed email beside name and message, passed every local run on
// MariaDB, and failed on the live database every night. Read from the files, so an
// index is checked the day it is written.
/** @return array{0: array<string, array<string, string>>, 1: array<string, string>, 2: list<array{0: string, 1: string, 2: list<string>}>} */
function tm_sql_shape(array $stmts): array
{
    $stated = [];
    $tableColl = [];
    $fts = [];
    $id = '`?([A-Za-z0-9_]+)`?';
    // Split on commas outside brackets and quotes.
    $split = function (string $s): array {
        $out = [];
        $cur = '';
        $depth = 0;
        $q = '';
        for ($i = 0, $n = strlen($s); $i < $n; $i++) {
            $ch = $s[$i];
            if ($q !== '') {
                $cur .= $ch;
                if ($ch === '\\') { $cur .= $s[++$i] ?? ''; continue; }
                if ($ch === $q) { $q = ''; }
                continue;
            }
            if ($ch === "'" || $ch === '"' || $ch === '`') { $q = $ch; $cur .= $ch; continue; }
            if ($ch === '(') { $depth++; }
            if ($ch === ')') { $depth--; }
            if ($ch === ',' && $depth === 0) { $out[] = trim($cur); $cur = ''; continue; }
            $cur .= $ch;
        }
        $out[] = trim($cur);
        return array_values(array_filter($out, fn($x) => $x !== ''));
    };
    $cols = fn(string $list) => array_map(fn($c) => strtolower(trim(preg_replace('/\(\d+\)$/', '', trim($c, " `\t\n")) ?? '')), explode(',', $list));
    foreach ($stmts as $stmt) {
        $s = trim((string) $stmt);
        if (preg_match('/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?' . $id . '\s*\(/i', $s, $m)) {
            $t = strtolower($m[1]);
            $open = strlen($m[0]) - 1;
            $depth = 0;
            $close = -1;
            $q = '';
            for ($i = $open, $n = strlen($s); $i < $n; $i++) {
                $ch = $s[$i];
                if ($q !== '') { if ($ch === '\\') { $i++; } elseif ($ch === $q) { $q = ''; } continue; }
                if ($ch === "'" || $ch === '"') { $q = $ch; continue; }
                if ($ch === '(') { $depth++; }
                if ($ch === ')' && --$depth === 0) { $close = $i; break; }
            }
            if ($close < 0) { continue; }
            if (preg_match('/\bCOLLATE\s*=?\s*([a-z0-9_]+)/i', substr($s, $close + 1), $c)) { $tableColl[$t] = strtolower($c[1]); }
            foreach ($split(substr($s, $open + 1, $close - $open - 1)) as $def) {
                if (preg_match('/^FULLTEXT\s+(?:KEY|INDEX)?\s*(?:`?([A-Za-z0-9_]+)`?\s*)?\(([^)]*)\)/i', $def, $f)) {
                    $fts[] = [$t, $f[1] !== '' ? $f[1] : '(unnamed)', $cols($f[2])];
                } elseif (!preg_match('/^(PRIMARY|KEY|INDEX|UNIQUE|CONSTRAINT|FOREIGN|CHECK|SPATIAL)\b/i', $def)
                    && preg_match('/^' . $id . '\s+/', $def, $c1) && preg_match('/\bCOLLATE\s+([a-z0-9_]+)/i', $def, $c2)) {
                    $stated[$t][strtolower($c1[1])] = strtolower($c2[1]);
                }
            }
            continue;
        }
        if (preg_match('/^CREATE\s+FULLTEXT\s+INDEX\s+' . $id . '\s+ON\s+' . $id . '\s*\(([^)]*)\)/i', $s, $m)) {
            $fts[] = [strtolower($m[2]), $m[1], $cols($m[3])];
            continue;
        }
        if (preg_match('/^ALTER\s+TABLE\s+' . $id . '\s+(.*)$/is', $s, $m)) {
            $t = strtolower($m[1]);
            foreach ($split($m[2]) as $spec) {
                if (preg_match('/^ADD\s+FULLTEXT\s+(?:KEY|INDEX)?\s*(?:`?([A-Za-z0-9_]+)`?\s*)?\(([^)]*)\)/i', $spec, $f)) {
                    $fts[] = [$t, $f[1] !== '' ? $f[1] : '(unnamed)', $cols($f[2])];
                } elseif (preg_match('/^(?:ADD|MODIFY)\s+(?:COLUMN\s+)?' . $id . '\s+(.*)$/is', $spec, $c)
                    && !preg_match('/^(INDEX|KEY|UNIQUE|PRIMARY|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL)$/i', $c[1])
                    && preg_match('/\bCOLLATE\s+([a-z0-9_]+)/i', $c[2], $c2)) {
                    $stated[$t][strtolower($c[1])] = strtolower($c2[1]);
                } elseif (preg_match('/^CHANGE\s+(?:COLUMN\s+)?' . $id . '\s+' . $id . '\s+(.*)$/is', $spec, $c)
                    && preg_match('/\bCOLLATE\s+([a-z0-9_]+)/i', $c[3], $c2)) {
                    $stated[$t][strtolower($c[2])] = strtolower($c2[1]);
                }
            }
        }
    }
    return [$stated, $tableColl, $fts];
}
/** The full-text indexes whose columns do not share one collation, in words. */
function tm_ft_mixed(array $stmts): array
{
    [$stated, $tableColl, $fts] = tm_sql_shape($stmts);
    $bad = [];
    foreach ($fts as [$t, $name, $cs]) {
        $by = [];
        foreach ($cs as $c) {
            $by[$stated[$t][$c] ?? ($tableColl[$t] ?? "the table's default")][] = $c;
        }
        if (count($by) > 1) {
            $bad[] = "$t.$name: " . implode('; ', array_map(fn($k, $v) => implode(', ', $v) . " ($k)", array_keys($by), $by));
        }
    }
    return $bad;
}
echo "\n== One collation per full-text index ==\n";
$allStmts = split_sql(__DIR__ . '/schema.sql');
foreach (migration_sort(glob(__DIR__ . '/migration-*.sql')) as $mf) {
    $allStmts = array_merge($allStmts, split_sql($mf));
}
[$shStated, $shTableColl, $shFts] = tm_sql_shape($allStmts);
check('the scan finds the full-text indexes (vacuity guard: at least 9)', count($shFts) >= 9);
check('…and the columns that state their own collation: the three emails and the username',
    ($shStated['bookings']['email'] ?? '') === 'utf8mb4_general_ci' && ($shStated['enquiries']['email'] ?? '') === 'utf8mb4_general_ci'
    && ($shStated['guests']['email'] ?? '') === 'utf8mb4_general_ci' && ($shStated['guests']['username'] ?? '') === 'utf8mb4_general_ci');
check('…and a table that states one for every column (bank_lines)', ($shTableColl['bank_lines'] ?? '') === 'utf8mb4_general_ci');
$mixedNow = tm_ft_mixed($allStmts);
check('no full-text index mixes a column that states its collation with ones that do not'
    . ($mixedNow ? ' — ' . implode(' | ', $mixedNow) : ''), $mixedNow === []);
// The check can fail: the first migration-151, as it shipped, is caught three times over.
$first151 = [
    'ALTER TABLE enquiries ADD FULLTEXT INDEX ft_enquiries (name, email, message)',
    'ALTER TABLE bookings ADD FULLTEXT INDEX ft_bookings (name, email, address, notes)',
    'ALTER TABLE guests ADD FULLTEXT INDEX ft_guests (name, email)',
];
$mixedFirst = tm_ft_mixed(array_merge($allStmts, $first151));
check('…and it catches the first migration-151 (all three indexes it could not build)',
    count($mixedFirst) === 3 && strpos(implode(' ', $mixedFirst), 'enquiries.ft_enquiries: ') !== false
    && strpos(implode(' ', $mixedFirst), 'email (utf8mb4_general_ci)') !== false);
// An index over columns that all state the same collation is fine (the table states it).
check('…while columns that all share one stated collation pass',
    tm_ft_mixed(['CREATE TABLE z (id INT, a TEXT COLLATE utf8mb4_general_ci, b TEXT COLLATE utf8mb4_general_ci) ENGINE=InnoDB',
        'ALTER TABLE z ADD FULLTEXT INDEX fz (a, b)']) === []
    && tm_ft_mixed(['CREATE TABLE y (id INT, a TEXT, b TEXT, FULLTEXT KEY fy (a, b)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci']) === []);
// search.php matches each source's words against an index that really lists those
// columns: MySQL refuses a MATCH() whose columns no FULLTEXT index lists (error 1191),
// and an index nothing reads is a cost for nothing. The indexes are the ones the
// migrations leave (an index a later migration drops is gone).
$ftLeft = [];
foreach ($shFts as [$t, $name, $cs]) {
    $ftLeft["$t.$name"] = [$t, $cs];
}
foreach ($allStmts as $st) {
    if (preg_match('/^\s*ALTER\s+TABLE\s+`?(\w+)`?\s+DROP\s+(?:INDEX|KEY)\s+`?(\w+)`?/i', (string) $st, $dm)) {
        unset($ftLeft[strtolower($dm[1]) . '.' . $dm[2]]);
    }
}
$srcTokens = token_get_all((string) file_get_contents(__DIR__ . '/search.php'));
$srcCode = implode('', array_map(fn($tk) => is_array($tk) ? (in_array($tk[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : $tk[1]) : $tk, $srcTokens));
$searchFt = [];
if (preg_match('/const SEARCH_FT = \[(.*?)\];/s', $srcCode, $sm)) {
    preg_match_all("/'(\\w+)'\\s*=>\\s*\\[([^\\]]*)\\]/", $sm[1], $pm, PREG_SET_ORDER);
    foreach ($pm as $p) {
        preg_match_all("/'(\\w+)'/", $p[2], $cm);
        $searchFt[$p[1]] = $cm[1];
    }
}
check('search.php names its word indexes in one list (vacuity guard: at least 9 sources)', count($searchFt) >= 9);
$noIndex = [];
foreach ($searchFt as $t => $cs) {
    $hit = array_filter($ftLeft, fn($ix) => $ix[0] === $t && $ix[1] === $cs);
    if (!$hit) { $noIndex[] = "$t (" . implode(', ', $cs) . ')'; }
}
check('every source search.php matches by its words has an index listing exactly those columns'
    . ($noIndex ? ' — none for ' . implode('; ', $noIndex) : ''), $noIndex === []);
$unread = [];
foreach ($ftLeft as $key => [$t, $cs]) {
    if (($searchFt[$t] ?? null) !== $cs) { $unread[] = $key; }
}
check('…and every full-text index the migrations leave is one search.php reads'
    . ($unread ? ' — not read: ' . implode(', ', $unread) : ''), $unread === []);
check('…and no word index holds a column that states its own collation (an email is found by its own index)',
    !array_filter($searchFt, fn($cs, $t) => array_intersect($cs, array_keys($shStated[$t] ?? [])) !== [], ARRAY_FILTER_USE_BOTH));
check('search.php reads no MATCH() it did not build from that list',
    substr_count($srcCode, 'MATCH(') === 1 && strpos($srcCode, "'MATCH(' . implode(', ', \$cols)") !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
