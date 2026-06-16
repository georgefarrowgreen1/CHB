<?php
// ============================================================
//  test-pricing.php — CI guard for the server pricing engine.
//
//  The price model is implemented TWICE (by necessity, no build step):
//    - JS  priceBreakdown()  in index.html   (tested by smoke-test.js §2)
//    - PHP price_breakdown()  in pricing.php  (authoritative; tested here)
//  Both are asserted against the SAME fixed fixtures/expected values, so if
//  either implementation drifts, its test fails — catching silent divergence.
//
//  Pure + offline: we pass an explicit $rate and $seasons=[] so no DB/config is
//  touched. Run locally or in CI:  php test-pricing.php   (exit 0 = ok)
//  Dev/CI tool only — excluded from deploy (like smoke-test.js).
// ============================================================
require_once __DIR__ . '/pricing.php';

$fail = 0;
function approxEq($a, $b) { return abs($a - $b) < 0.005; }
function chk($name, $cond) {
    global $fail;
    if ($cond) { echo "  ✓ $name\n"; } else { echo "  ✗ $name\n"; $fail++; }
}

echo "== Pricing parity (PHP price_breakdown vs smoke-test.js fixtures) ==\n";

// 21A: couple 130, txn 3%, deposit 75. 3 nights, 2 adults, no season.
$rate21a = ['prop_key' => '21a', 'couple_rate' => 130, 'extra_adult_rate' => 40, 'child_rate' => 25, 'booking_fee' => 75, 'transaction_pct' => 3];
$p = price_breakdown($rate21a, 2, 0, '2026-07-01', '2026-07-04', null, []);
chk('21A 3-night => nights = 3', $p['nights'] === 3);
chk('21A nightly = 390 (3 x 130)', approxEq($p['nightly'], 390));
chk('21A per-night = 130', approxEq($p['perNight'], 130));
chk('21A transaction fee = 11.70 (3% of 390)', approxEq($p['txFee'], 11.70));
chk('21A damages deposit = 75', approxEq($p['damagesDeposit'], 75));
chk('21A total = 476.70 (390 + 11.70 + 75)', approxEq($p['total'], 476.70));

// Pimpernel: couple 120, extra adult 42. 2 nights, 3 adults (1 extra).
$ratePimp = ['prop_key' => 'pimpernel', 'couple_rate' => 120, 'extra_adult_rate' => 42, 'child_rate' => 30, 'booking_fee' => 75, 'transaction_pct' => 3];
$p2 = price_breakdown($ratePimp, 3, 0, '2026-07-01', '2026-07-03', null, []);
chk('Pimpernel extra adult adds 42/night (2 nights) => nightly = 324', approxEq($p2['nightly'], (120 + 42) * 2));

echo "\n";
if ($fail) { fwrite(STDERR, "$fail pricing check(s) FAILED — JS and PHP pricing may have diverged.\n"); exit(1); }
echo "All pricing parity checks passed.\n";
exit(0);
