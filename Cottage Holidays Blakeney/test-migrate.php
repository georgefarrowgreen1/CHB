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

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
