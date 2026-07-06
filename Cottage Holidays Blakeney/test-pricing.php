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
function approxEq($a, $b)
{
    return abs($a - $b) < 0.005;
}
function chk($name, $cond)
{
    global $fail;
    if ($cond) {
        echo "  ✓ $name\n";
    } else {
        echo "  ✗ $name\n";
        $fail++;
    }
}

echo "== Pricing parity (PHP price_breakdown vs smoke-test.js fixtures) ==\n";

// 21A: couple 130, txn 3%, deposit 75. 3 nights, 2 adults, no season.
$rate21a = [
    'prop_key' => '21a',
    'couple_rate' => 130,
    'extra_adult_rate' => 40,
    'child_rate' => 25,
    'booking_fee' => 75,
    'transaction_pct' => 3,
];
$p = price_breakdown($rate21a, 2, 0, '2026-07-01', '2026-07-04', null, []);
chk('21A 3-night => nights = 3', $p['nights'] === 3);
chk('21A nightly = 390 (3 x 130)', approxEq($p['nightly'], 390));
chk('21A per-night = 130', approxEq($p['perNight'], 130));
chk('21A transaction fee = 11.70 (3% of 390)', approxEq($p['txFee'], 11.7));
chk('21A damages deposit = 75 (held separately, not in total)', approxEq($p['damagesDeposit'], 75));
chk('21A total = 401.70 (390 + 11.70; damages held, not charged)', approxEq($p['total'], 401.7));

// Pimpernel: couple 120, extra adult 42. 2 nights, 3 adults (1 extra).
$ratePimp = [
    'prop_key' => 'pimpernel',
    'couple_rate' => 120,
    'extra_adult_rate' => 42,
    'child_rate' => 30,
    'booking_fee' => 75,
    'transaction_pct' => 3,
];
$p2 = price_breakdown($ratePimp, 3, 0, '2026-07-01', '2026-07-03', null, []);
chk('Pimpernel extra adult adds 42/night (2 nights) => nightly = 324', approxEq($p2['nightly'], (120 + 42) * 2));

// Weekend uplift: base 100, +20% on Fri(5)/Sat(6). 2026-01-02 is Fri, 01-03 Sat.
$rateWk = [
    'prop_key' => 'wk',
    'couple_rate' => 100,
    'extra_adult_rate' => 0,
    'child_rate' => 0,
    'booking_fee' => 0,
    'transaction_pct' => 0,
    'weekend_pct' => 20,
    'weekend_days' => '5,6',
];
$pw = price_breakdown($rateWk, 2, 0, '2026-01-02', '2026-01-04', null, []); // Fri + Sat = 2 weekend nights
chk('weekend +20%: Fri+Sat nightly = 240 (120 x 2)', approxEq($pw['nightly'], 240));
$pw2 = price_breakdown($rateWk, 2, 0, '2026-01-05', '2026-01-07', null, []); // Mon + Tue = no uplift
chk('weekend rule leaves weekdays at base = 200', approxEq($pw2['nightly'], 200));
// Empty weekend_days = NO weekend days (must NOT fall back to Fri/Sat) — parity guard.
$rateWkEmpty = [
    'prop_key' => 'wke',
    'couple_rate' => 100,
    'extra_adult_rate' => 0,
    'child_rate' => 0,
    'booking_fee' => 0,
    'transaction_pct' => 0,
    'weekend_pct' => 20,
    'weekend_days' => '',
];
$pwe = price_breakdown($rateWkEmpty, 2, 0, '2026-01-02', '2026-01-04', null, []); // Fri + Sat, but no weekend days set
chk('weekend_days="" applies no uplift => 200', approxEq($pwe['nightly'], 200));

// Last-minute discount — pure factor (mirrors lastMinuteFactor() in app.js).
chk('lastmin: within window → 0.8 (20% off)', approxEq(last_minute_factor('2026-01-03', '2026-01-01', 20, 10), 0.8));
chk('lastmin: outside window → 1.0', approxEq(last_minute_factor('2026-01-20', '2026-01-01', 20, 10), 1.0));
chk('lastmin: past check-in → 1.0', approxEq(last_minute_factor('2025-12-31', '2026-01-01', 20, 10), 1.0));
chk('lastmin: 0% → 1.0 (off)', approxEq(last_minute_factor('2026-01-03', '2026-01-01', 0, 10), 1.0));
chk('lastmin: 0 days → 1.0 (off)', approxEq(last_minute_factor('2026-01-03', '2026-01-01', 20, 0), 1.0));
chk('lastmin: capped at 90% off', approxEq(last_minute_factor('2026-01-03', '2026-01-01', 99, 10), 0.1));
// Full breakdown with a last-minute stay (deterministic via explicit $today).
$rateLM = [
    'prop_key' => 'lm', 'couple_rate' => 100, 'extra_adult_rate' => 0, 'child_rate' => 0,
    'booking_fee' => 0, 'transaction_pct' => 3, 'weekend_pct' => 0, 'weekend_days' => '',
    'lastmin_pct' => 20, 'lastmin_days' => 10,
];
$plm = price_breakdown($rateLM, 2, 0, '2026-01-03', '2026-01-05', null, [], '2026-01-01'); // 2 nights, 2 days out
chk('lastmin breakdown: nightly 200 → 160 (20% off)', approxEq($plm['nightly'], 160));
chk('lastmin breakdown: txFee 3% of 160 = 4.80', approxEq($plm['txFee'], 4.8));
chk('lastmin breakdown: total = 164.80', approxEq($plm['total'], 164.8));
$plmOut = price_breakdown($rateLM, 2, 0, '2026-02-01', '2026-02-03', null, [], '2026-01-01'); // 31 days out — no discount
chk('lastmin breakdown: outside window unchanged = 200', approxEq($plmOut['nightly'], 200));

echo "\n";
if ($fail) {
    fwrite(STDERR, "$fail pricing check(s) FAILED — JS and PHP pricing may have diverged.\n");
    exit(1);
}
echo "All pricing parity checks passed.\n";
exit(0);
