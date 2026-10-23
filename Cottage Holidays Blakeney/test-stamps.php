<?php
// ============================================================
//  test-stamps.php — the change stamps (stamps-lib.php) and what could write round them.
//  No database. The writes themselves, the readers and the fingerprints are driven for
//  real in test-integration §105; this holds the rules that make those complete:
//   1. the statement classifier, case by case;
//   2. the app's one connection is a ChbPDO, and every other connection the app opens is
//      a reader, or writes only activity rows no stamped reader sees (no entity);
//   3. only log_activity's own insert says it stamps itself, and it does.
//  CI-wired by run-checks.js; deploy-excluded with every test-*.php.
// ============================================================
require __DIR__ . '/stamps-lib.php';

$fails = 0;
$checks = 0;
function stmc(bool $ok, string $what, string $detail = ''): void
{
    global $fails, $checks;
    $checks++;
    if ($ok) {
        echo "  ✓ $what\n";
        return;
    }
    $fails++;
    echo "  ✗ $what" . ($detail !== '' ? " — $detail" : '') . "\n";
}

echo "== 1. What a statement may change ==\n";
$cases = [
    // [sql, names, dml]
    ['SELECT * FROM messages WHERE thread_id = ?', [], false],
    ["  SELECT COUNT(*) FROM messages m JOIN chat_threads t ON t.id = m.thread_id", [], false],
    ['(SELECT 1) UNION (SELECT id FROM guests)', [], false],
    ['SHOW TABLES LIKE ?', [], false],
    ["SET time_zone = '+01:00'", [], false],
    ['SELECT GET_LOCK(?, 5)', [], false],
    ['CHECKSUM TABLE bookings, guests', [], false],
    ['UPDATE messages SET read_by_admin = 1 WHERE thread_id = ?', ['messages'], true],
    ["/* a comment */ UPDATE messages SET read_by_admin = 1", ['messages'], true],
    ["-- a comment\nDELETE FROM chat_threads WHERE id = ?", ['chat_threads'], true],
    ['DELETE m FROM messages m JOIN chat_threads t ON t.id = m.thread_id WHERE t.id = ?', ['chat_threads', 'messages'], true],
    ['INSERT INTO guest_reviews (guest_id, stars) VALUES (?, ?)', ['guest_reviews'], true],
    ['INSERT IGNORE INTO direct_leads (name) VALUES (?)', ['direct_leads'], true],
    ['REPLACE INTO guests (id, name) VALUES (?, ?)', ['guests'], true],
    ['UPDATE guests SET email_verified_at = NOW() WHERE id = ?', ['guests'], true],
    ['UPDATE activity_log SET meta = NULL WHERE entity = ?', ['activity_log'], true],
    ["INSERT INTO activity_log (actor, category) VALUES ('owner', 'comms')", ['activity_log'], true],
    [CHB_STAMP_SELF . ' INSERT INTO activity_log (actor, category, entity) VALUES (?, ?, ?)', [], false],
    ['ALTER TABLE messages ADD COLUMN kind VARCHAR(12)', ['messages'], false],
    ['TRUNCATE TABLE chat_threads', ['chat_threads'], false],
    ['SELECT 1; DELETE FROM messages', ['messages'], false],
    ['EXECUTE stmt', CHB_STAMPED, false],
    ['CALL tidy()', CHB_STAMPED, false],
    ['UPDATE `chb`.messages SET read_by_admin = 1', ['messages'], true],
    ['DELETE FROM `messages` WHERE id = ?', ['messages'], true],
    ["DELETE FROM content WHERE item_key = 'stamp-messages'", [], true],
    ['UPDATE bookings SET notes = ? WHERE id = ?', [], true],
    ['UPDATE max_guests SET x = 1', [], true],
    ["INSERT INTO content (item_key, item_value) VALUES (?, '1') ON DUPLICATE KEY UPDATE item_value = CAST(item_value AS UNSIGNED) + 1", [], true],
];
foreach ($cases as [$sql, $names, $dml]) {
    [$got, $gotDml] = chb_stamp_targets($sql);
    sort($got);
    $want = $names;
    sort($want);
    stmc($got === $want && $gotDml === $dml, 'classifies: ' . preg_replace('/\s+/', ' ', substr($sql, 0, 70)), json_encode([$got, $gotDml]));
}
// The stamps' own row names no stamped table: moving one can never move another.
[$self] = chb_stamp_targets("INSERT INTO content (item_key, item_value) VALUES ('" . CHB_STAMP_KEY . "messages', '1')");
stmc($self === [], "a stamp's own write moves no stamp", json_encode($self));

echo "\n== 2. Every connection the app opens ==\n";
$dir = __DIR__;
$src = function (string $f) use ($dir): string {
    return (string) file_get_contents($dir . '/' . $f);
};
// A statement that writes, by its target table.
$writes = function (string $code): array {
    preg_match_all('/\b(INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|DELETE\s+\w+\s+FROM)\s+`?(\w+)`?\s*(\([^)]*\))?/i', $code, $m, PREG_SET_ORDER);
    return $m;
};
$db = $src('db.php');
stmc(strpos($db, 'new ChbPDO(') !== false && preg_match('/new\s+\\\\?PDO\s*\(/', $db) === 0, "db() hands out a ChbPDO, and db.php opens no plain PDO");
// Files that open a connection of their own (they must never meet db()'s JSON exit).
const STAMP_OWN_CONNECTIONS = [
    // Readers: they write nothing.
    'cottage.php' => 'read', 'experiences-page.php' => 'read', 'home.php' => 'read', 'review.php' => 'read',
    'sitemap.php' => 'read', 'status.php' => 'read',
    // The two public reporters: an entity-less activity row, which no stamped reader lists.
    'blocked.php' => 'noise', 'csp-report.php' => 'noise',
];
$found = [];
foreach (glob($dir . '/*.php') ?: [] as $path) {
    $f = basename($path);
    if (strpos($f, 'test-') === 0 || $f === 'db.php' || $f === 'stamps-lib.php') {
        continue;
    }
    $code = (string) file_get_contents($path);
    if (!preg_match('/new\s+\\\\?PDO\s*\(/', $code)) {
        continue;
    }
    $found[$f] = true;
    $kind = STAMP_OWN_CONNECTIONS[$f] ?? null;
    if ($kind === null) {
        stmc(false, "$f opens a connection of its own and is not on the list (stamps-lib.php: its writes would move no stamp)");
        continue;
    }
    $bad = [];
    foreach ($writes($code) as $w) {
        $table = strtolower($w[2]);
        if ($kind === 'read') {
            $bad[] = $w[0];
        } elseif ($table !== 'activity_log' || !preg_match('/^INSERT/i', $w[1]) || stripos($w[3] ?? '', 'entity') !== false) {
            $bad[] = $w[0];
        }
    }
    stmc(!$bad, $kind === 'read' ? "$f writes nothing" : "$f writes only entity-less activity rows", implode(' | ', $bad));
}
stmc(count($found) >= 6, 'the connection scan found the standalone files (vacuity: ' . count($found) . ')');
foreach (array_keys(STAMP_OWN_CONNECTIONS) as $f) {
    stmc(isset($found[$f]) || !is_file($dir . '/' . $f), "$f is on the list because it opens its own connection", 'it no longer does: take it off');
}

echo "\n== 3. log_activity stamps its own insert ==\n";
$selfUses = [];
foreach (glob($dir . '/*.php') ?: [] as $path) {
    $f = basename($path);
    if (strpos($f, 'test-') === 0 || $f === 'stamps-lib.php') {
        continue;
    }
    $n = substr_count((string) file_get_contents($path), 'CHB_STAMP_SELF');
    if ($n) {
        $selfUses[$f] = $n;
    }
}
stmc(array_keys($selfUses) === ['db.php'], 'only db.php says an insert stamps itself', json_encode($selfUses));
$la = (string) strstr($db, 'function log_activity(');
$la = substr($la, 0, (int) strpos($la, "\n}\n"));
stmc(substr_count($la, 'CHB_STAMP_SELF') === 2, "…in log_activity's two inserts, and nowhere else", (string) substr_count($la, 'CHB_STAMP_SELF'));
stmc(strpos($la, "chbTouch(['activity_log.' . ") !== false && strpos($la, 'CHB_STAMPED_ENTITIES') !== false, "…which moves 'activity_log.<entity>' for the entities a reader lists");
stmc(in_array('booking', CHB_STAMPED_ENTITIES, true), "the email log's entity is stamped ('booking')");

echo "\n" . ($fails ? "$fails of $checks CHECK(S) FAILED ❌" : "ALL $checks CHECKS PASSED ✅") . "\n";
exit($fails ? 1 : 0);
