<?php
// ============================================================
//  test-watchers.php — the rules behind standing queries. DEV/CI only
//  (deploy-excluded with the other test-*.php).
//
//      php test-watchers.php
//
//  No database, no clock: every function under test takes the list and the day as
//  arguments precisely so the rules can be pinned without either. What matters
//  here is not that a watcher fires, but WHEN IT DOESN'T — a notification the
//  owner did not ask for is worse than no feature, so the silence cases carry as
//  many checks as the firing ones.
// ============================================================
require_once __DIR__ . '/watchers-lib.php';

$fails = 0;
function twchk($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  ✓ $name\n";
    } else {
        $fails++;
        echo "  ✗ $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

$gap = ['id' => 'w1', 'kind' => 'gap-unsold', 'pk' => 'jollyboat', 'from' => '2026-08-14', 'to' => '2026-08-17', 'tell' => '2026-08-12'];

echo "\n== watchers: when they speak, and when they must not ==\n";

// ---- collaborators (the lesson from weather-data.php: assert the seam) ----
twchk('the store read helper exists (content_json)', function_exists('content_json'));
twchk('the store write helper exists (content_set_scalar)', function_exists('content_set_scalar'));

// ---- identity: one watcher per THING, not per time it was asked about ----
echo "\n-- identity --\n";
$list = watchers_merge([], $gap);
twchk('a watcher is stored', count($list) === 1, json_encode($list));
$again = watchers_merge($list, array_merge($gap, ['id' => 'w2', 'tell' => '2026-08-13']));
twchk('asking again about the SAME gap replaces it — not two alerts one morning', count($again) === 1, json_encode($again));
twchk('and the newest intent wins', $again[0]['tell'] === '2026-08-13', json_encode($again));
$other = watchers_merge($again, array_merge($gap, ['id' => 'w3', 'pk' => '21a']));
twchk('a different cottage is a different watcher', count($other) === 2, json_encode(array_map(fn($x) => $x['pk'], $other)));

// ---- junk in ----
twchk('a watcher with nothing to watch is refused', count(watchers_merge([], ['tell' => '2026-08-12'])) === 0);
twchk('a watcher with no day to speak is refused', count(watchers_merge([], ['kind' => 'gap-unsold', 'pk' => 'x', 'from' => 'a', 'to' => 'b'])) === 0);

// ---- the cap: a forgotten watcher is an unasked-for notification ----
echo "\n-- the cap --\n";
$many = [];
for ($i = 0; $i < WATCHERS_MAX + 5; $i++) {
    $many = watchers_merge($many, array_merge($gap, ['id' => "m$i", 'from' => '2026-09-' . str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT)]));
}
twchk('the list is capped', count($many) === WATCHERS_MAX, (string) count($many));
twchk('and it keeps the NEWEST, dropping the oldest', $many[count($many) - 1]['id'] === 'm' . (WATCHERS_MAX + 4), $many[count($many) - 1]['id']);

// ---- DUE ----
echo "\n-- when it speaks --\n";
$one = [$gap];
twchk('silent the day before', count(watchers_due($one, '2026-08-11')) === 0);
twchk('speaks on the day', count(watchers_due($one, '2026-08-12')) === 1);
// A cron that failed on Friday must still tell you on Saturday. `>=`, not `===`:
// swallowing the one alert the owner asked for is the worst possible failure here.
twchk('a MISSED day still speaks the next morning (cron failure must not eat it)', count(watchers_due($one, '2026-08-13')) === 1);
twchk('a watcher that already spoke stays quiet', count(watchers_due([array_merge($gap, ['done' => 1])], '2026-08-13')) === 0);
twchk('a watcher with no tell-day never speaks', count(watchers_due([['id' => 'x', 'kind' => 'k', 'pk' => 'p']], '2026-08-13')) === 0);

// ---- EXPIRED: cleared, never announced ----
echo "\n-- when it goes away quietly --\n";
twchk('not expired while the window is still ahead', count(watchers_expired($one, '2026-08-16')) === 0);
twchk('not expired on the last day of the window', count(watchers_expired($one, '2026-08-17')) === 0);
twchk('expired once the window has passed', count(watchers_expired($one, '2026-08-18')) === 1);
twchk('an expired watcher is NOT also due — it goes quietly', count(watchers_due(watchers_remove($one, 'w1'), '2026-08-18')) === 0);

// ---- stop ----
echo "\n-- stopping one --\n";
twchk('remove takes it out', count(watchers_remove($one, 'w1')) === 0);
twchk('removing an unknown id changes nothing', count(watchers_remove($one, 'nope')) === 1);
twchk('remove survives a junk list', count(watchers_remove(['not an array'], 'w1')) === 0);

// ---- defensive ----
twchk('due() survives a junk list', watchers_due('nope', '2026-08-12') === []);
twchk('expired() survives a junk list', watchers_expired(null, '2026-08-12') === []);
twchk('merge() survives a junk list', count(watchers_merge('nope', $gap)) === 1);

// ---- IDENTITY BEYOND DATES. A gap watcher is identified by its cottage and its
// dates, but the kinds added later are about a RECORD (a booking) or a MONTH, and
// those carry no pk/from/to of their own. Without `ref` in the key every
// balance watcher hashed to the same 'balance-unpaid|||' string, so asking to be
// told about a SECOND guest's balance silently replaced the first one's watcher —
// the owner would have been waiting on an alert that no longer existed.
$balA = ['id' => 'wA', 'kind' => 'balance-unpaid', 'ref' => '7', 'tell' => '2030-01-01'];
$balB = ['id' => 'wB', 'kind' => 'balance-unpaid', 'ref' => '9', 'tell' => '2030-01-01'];
$two = watchers_merge(watchers_merge([], $balA), $balB);
twchk('two balance watchers on DIFFERENT bookings both survive', count($two) === 2);
twchk('…and the same booking still replaces rather than duplicating',
    count(watchers_merge(watchers_merge([], $balA), $balA)) === 1);
twchk('a month watcher is identified by its month', watchers_key(['kind' => 'month-behind', 'ref' => '2026-09'])
    !== watchers_key(['kind' => 'month-behind', 'ref' => '2026-10']));
twchk('and a kind alone is still not an identity', watchers_key(['ref' => '7']) === '');

echo "\n" . ($fails ? "  $fails WATCHER CHECK(S) FAILED ❌\n\n" : "  ALL WATCHER CHECKS PASSED ✅\n\n");
exit($fails ? 1 : 0);
