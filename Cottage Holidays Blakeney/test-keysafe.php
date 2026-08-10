<?php
// ============================================================
//  test-keysafe.php — the key safe keeper's pure judgements (keysafe-lib.php),
//  no DB and no session. CI-wired; deploy-excluded.
//
//  What it gates: the codes the generator refuses (junk a past guest would
//  try first, and anything recently used), the sanitiser's degrade-to-empty
//  on malformed storage (owner-written JSON reaching a GUEST surface), and
//  the reveal window from BOTH sides of both boundaries — the gate that
//  decides when a guest's booking page may show the code.
// ============================================================
require_once __DIR__ . '/keysafe-lib.php';

$fails = 0;
function ok2($label, $cond)
{
    global $fails;
    echo ($cond ? '  ✓ ' : '  ✗ ') . $label . "\n";
    if (!$cond) {
        $fails++;
    }
}

echo "§1 what a bad code is\n";
ok2('0000 refused (all one digit)', keysafe_bad('0000'));
ok2('7777 refused', keysafe_bad('7777'));
ok2('1234 refused (ascending run)', keysafe_bad('1234'));
ok2('0123 refused', keysafe_bad('0123'));
ok2('4321 refused (descending run)', keysafe_bad('4321'));
ok2('9876 refused', keysafe_bad('9876'));
ok2('three digits refused', keysafe_bad('123'));
ok2('letters refused', keysafe_bad('12a4'));
ok2('null refused', keysafe_bad(null));
ok2('4821 accepted', !keysafe_bad('4821'));
ok2('1224 accepted (repeat but no run)', !keysafe_bad('1224'));
ok2('1235 accepted (broken run)', !keysafe_bad('1235'));

echo "§2 generation refuses junk and the recent codes\n";
$exclude = ['4821', '9265', '3074'];
$allGood = true;
$sawVariety = [];
for ($i = 0; $i < 300; $i++) {
    $c = keysafe_generate($exclude);
    if (keysafe_bad($c) || in_array($c, $exclude, true)) {
        $allGood = false;
        break;
    }
    $sawVariety[$c] = 1;
}
ok2('300 draws: never junk, never an excluded code', $allGood);
ok2('…and genuinely random (many distinct codes)', count($sawVariety) > 50);
// Exhaustion never loops forever and never yields junk.
$mostCodes = [];
for ($n = 0; $n <= 9999; $n++) {
    $c = str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    if ($n % 7 !== 0) {
        $mostCodes[] = $c; // exclude ~86% of the space
    }
}
$c = keysafe_generate($mostCodes);
ok2('a nearly-exhausted space still yields a valid code', !keysafe_bad($c) && !in_array($c, $mostCodes, true));

echo "§3 the sanitiser degrades, never garbles\n";
$empty = keysafe_read(null);
ok2('null → the empty record', $empty['code'] === '' && $empty['forBooking'] === 0 && $empty['history'] === []);
ok2('garbage JSON → the empty record', keysafe_read('not json {{{')['code'] === '');
ok2('a scalar → the empty record', keysafe_read('"4821"')['code'] === '');
$r = keysafe_read(['code' => '4821', 'setAt' => '2026-08-10T09:00:00Z', 'forBooking' => '42', 'history' => [
    ['code' => '9265', 'guest' => 'Hannah', 'setAt' => 'x', 'forBooking' => 7],
    ['code' => 'abcd', 'guest' => 'dropped'],   // non-digit code: the row goes
    'not-a-row',
]]);
ok2('a good record round-trips (forBooking coerced to int)', $r['code'] === '4821' && $r['forBooking'] === 42);
ok2('history keeps only well-formed rows', count($r['history']) === 1 && $r['history'][0]['guest'] === 'Hannah');
$r2 = keysafe_read(['code' => '123', 'history' => []]);
ok2('a stored 3-digit code reads as NO code (never shown to a guest)', $r2['code'] === '');
$big = ['code' => '4821', 'history' => array_fill(0, 60, ['code' => '9265', 'guest' => 'x', 'setAt' => '', 'forBooking' => 0])];
ok2('history is capped at ' . KEYSAFE_HISTORY_MAX, count(keysafe_read($big)['history']) === KEYSAFE_HISTORY_MAX);
// The stay ref — a PLATFORM stay's identity ('o:<check-in>'; 'b:<id>' for
// direct). Anything outside that vocabulary reads as none, so owner-written
// JSON can never smuggle markup or an over-long value through the record.
ok2('a platform stay ref round-trips', keysafe_read(['code' => '4821', 'forStay' => 'o:2026-08-28'])['forStay'] === 'o:2026-08-28');
ok2('a direct stay ref round-trips', keysafe_read(['code' => '4821', 'forStay' => 'b:42'])['forStay'] === 'b:42');
ok2('a garbage ref reads as none', keysafe_read(['code' => '4821', 'forStay' => '<script>x'])['forStay'] === '');
ok2('an over-long ref reads as none', keysafe_read(['code' => '4821', 'forStay' => 'o:' . str_repeat('9', 60)])['forStay'] === '');
ok2('history rows carry their ref through the sanitiser', keysafe_read(['code' => '4821', 'history' => [['code' => '9265', 'forStay' => 'o:2026-08-01']]])['history'][0]['forStay'] === 'o:2026-08-01');
// The per-cottage switch: default ON — a record from before the toggle
// existed keeps working, and only an explicit false turns it off.
ok2('a record with no switch reads as ENABLED', keysafe_read(['code' => '4821'])['enabled'] === true);
ok2('an explicit false disables', keysafe_read(['code' => '4821', 'enabled' => false])['enabled'] === false);
ok2('garbage in the switch reads as enabled (never off by accident)', keysafe_read(['code' => '4821', 'enabled' => 'nope'])['enabled'] === true);
ok2('the empty record is enabled', keysafe_read(null)['enabled'] === true);

echo "§4 the reveal window, both sides of both boundaries\n";
// KEYSAFE_REVEAL_DAYS = 2: check-in 2026-08-14 → visible from 2026-08-12.
ok2('the day before the window: hidden', !keysafe_reveal_window('2026-08-14', '2026-08-18', '2026-08-11'));
ok2('the window opens ' . KEYSAFE_REVEAL_DAYS . ' days out', keysafe_reveal_window('2026-08-14', '2026-08-18', '2026-08-12'));
ok2('check-in day: visible', keysafe_reveal_window('2026-08-14', '2026-08-18', '2026-08-14'));
ok2('mid-stay: visible', keysafe_reveal_window('2026-08-14', '2026-08-18', '2026-08-16'));
ok2('check-out day: still visible (in until the check-out time)', keysafe_reveal_window('2026-08-14', '2026-08-18', '2026-08-18'));
ok2('the day after check-out: hidden', !keysafe_reveal_window('2026-08-14', '2026-08-18', '2026-08-19'));
ok2('a malformed check-in: hidden (never shown on a guess)', !keysafe_reveal_window('soon', '2026-08-18', '2026-08-14'));
ok2('a malformed today: hidden', !keysafe_reveal_window('2026-08-14', '2026-08-18', 'now'));
// A missing check-out falls back to check-in day only.
ok2('no check-out: visible on the check-in day', keysafe_reveal_window('2026-08-14', '', '2026-08-14'));
ok2('no check-out: hidden the day after', !keysafe_reveal_window('2026-08-14', '', '2026-08-15'));
// A month boundary can't off-by-one the subtraction (UTC-noon anchored).
ok2('window opens across a month boundary', keysafe_reveal_window('2026-09-01', '2026-09-05', '2026-08-30'));
ok2('…and not a day earlier', !keysafe_reveal_window('2026-09-01', '2026-09-05', '2026-08-29'));

echo $fails ? "\n{$fails} CHECK(S) FAILED ❌\n" : "\nKEYSAFE TESTS PASSED ✅\n";
exit($fails ? 1 : 0);
