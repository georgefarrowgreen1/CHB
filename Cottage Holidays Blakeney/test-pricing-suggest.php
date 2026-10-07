<?php
// test-pricing-suggest.php — the pricing engine looks FORWARD (pricing-suggest-lib.php).
// Pure: no DB, no clock (today is passed in). CI-wired, deploy-excluded.
require_once __DIR__ . '/pricing-suggest-lib.php';

$fails = 0;
$n = 0;
function psk(string $label, bool $cond): void
{
    global $fails, $n;
    $n++;
    if (!$cond) {
        $fails++;
        echo "  ✗ $label\n";
    }
}

$today = '2026-10-07'; // a Wednesday
psk('week start of a Wednesday is the Monday', psug_week_start($today) === '2026-10-05');
psk('week start of a Monday is itself', psug_week_start('2026-10-05') === '2026-10-05');
psk('week start of a Sunday is the Monday before', psug_week_start('2026-10-11') === '2026-10-05');
psk('week start across a DST change', psug_week_start('2026-10-27') === '2026-10-26');

$rows = [
    ['week' => '2026-08-17', 'count' => 20, 'missed' => 9],
    ['week' => '2026-08-31', 'count' => 15, 'missed' => 5],
    ['week' => '2026-09-28', 'count' => 12, 'missed' => 4], // last week — gone
    ['week' => '2026-10-05', 'count' => 3, 'missed' => 0],  // this week — still has nights ahead
    ['week' => '2026-10-19', 'count' => 6, 'missed' => 4],
    ['week' => '2026-12-21', 'count' => 9, 'missed' => 3],
    ['week' => 'garbage', 'count' => 99, 'missed' => 99],
];
$fw = psug_future_weeks($rows, $today);
$wks = array_column($fw, 'week');
psk('past weeks dropped', !in_array('2026-08-17', $wks, true) && !in_array('2026-08-31', $wks, true) && !in_array('2026-09-28', $wks, true));
psk('this week kept', in_array('2026-10-05', $wks, true));
psk('future weeks kept', in_array('2026-10-19', $wks, true) && in_array('2026-12-21', $wks, true));
psk('garbage week dropped', !in_array('garbage', $wks, true));
psk('calendar order', $wks === ['2026-10-05', '2026-10-19', '2026-12-21']);
$cap = psug_future_weeks([
    ['week' => '2026-11-02', 'count' => 1, 'missed' => 0],
    ['week' => '2026-11-09', 'count' => 9, 'missed' => 0],
    ['week' => '2026-11-16', 'count' => 5, 'missed' => 0],
], $today, 2);
psk('cap keeps the busiest, then calendar order', array_column($cap, 'week') === ['2026-11-09', '2026-11-16']);

$m = psug_future_months([
    ['month' => '2026-08', 'count' => 9],
    ['month' => '2026-10', 'count' => 4],
    ['month' => '2027-01', 'count' => 2],
    ['month' => '2027-02', 'count' => 5],
    ['month' => 'nope', 'count' => 9],
], $today);
psk('months: past dropped, current kept, noise dropped', array_column($m, 'month') === ['2026-10', '2027-02']);

psk('no unmet weeks → no card', psug_unmet_weeks_card($fw === [] ? [] : [['week' => '2026-10-19', 'count' => 5, 'missed' => 2]]) === null);
$one = psug_unmet_weeks_card([['week' => '2026-10-19', 'count' => 6, 'missed' => 4]]);
psk('one week → named', $one && strpos($one['title'], '19 Oct') !== false);
psk('card is an insight, never an opportunity', $one && $one['severity'] === 'info' && $one['apply'] === null);
$card = psug_unmet_weeks_card($fw);
psk('several weeks → ONE card', $card && $card['id'] === 'radar-ahead' && strpos($card['title'], '2 weeks ahead') !== false);
psk('card sums only qualifying weeks', $card && strpos($card['detail'], '7 searches') === 0);
psk('card never says next year', $card && stripos($card['detail'], 'next year') === false);

$merged = [['2026-09-20', '2026-09-25'], ['2026-09-26', '2026-10-10'], ['2026-10-11', '2026-10-15'], ['2026-10-17', '2026-10-20'], ['2026-11-01', '2026-11-05']];
psk('orphans: only gaps starting today or later', psug_future_orphans($merged, $today) === 3);
psk('orphans: none in an empty calendar', psug_future_orphans([], $today) === 0);

// The endpoint actually uses the lib (the helper-tested-alone trap).
$src = file_get_contents(__DIR__ . '/pricing-suggest.php');
psk('endpoint requires the lib', strpos($src, "require_once __DIR__ . '/pricing-suggest-lib.php'") !== false);
foreach (['psug_future_weeks(', 'psug_unmet_weeks_card(', 'psug_future_months(', 'psug_future_orphans('] as $fn) {
    psk("endpoint calls $fn", strpos($src, $fn) !== false);
}
psk('endpoint no longer says "next year"', stripos($src, 'next year') === false);
psk('endpoint no longer mints a card per radar week', strpos($src, "'radar-' .") === false);

echo $fails ? "FAIL: $fails of $n\n" : "ok: $n checks\n";
exit($fails ? 1 : 0);
