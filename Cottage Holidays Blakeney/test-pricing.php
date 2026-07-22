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

echo "== Pricing parity (PHP price_breakdown vs shared pricing-fixtures.json) ==\n";

// ONE source of truth for the JS/PHP parity cases: pricing-fixtures.json
// (smoke-test.js §2 loops the same file against priceBreakdown()), so the two
// engines are always asserted against identical inputs and expectations.
$fx = json_decode((string) file_get_contents(__DIR__ . '/pricing-fixtures.json'), true);
if (!is_array($fx) || empty($fx['cases'])) {
    chk('pricing-fixtures.json loads and has cases', false);
} else {
    foreach ($fx['cases'] as $c) {
        $rate = array_merge(['prop_key' => $c['prop']], $c['rate']);
        $p = price_breakdown($rate, $c['adults'], $c['children'], $c['checkIn'], $c['checkOut'], null, []);
        foreach ($c['expect'] as $k => $v) {
            chk("{$c['name']}: $k = $v", $k === 'nights' ? $p[$k] === $v : approxEq($p[$k], $v));
        }
    }
}

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

// Discounted-NIGHTLY rounding parity (regression for the audit finding): a
// last-minute × weekend nightly that sums to a .xx5 float boundary. round($x,2)
// gives 284.34 but the JS engine's Math.round($x*100)/100 gives 284.33, so the
// PHP nightly must scale-then-round too (it feeds perNight, txFee AND total).
// £41/night, 15% Fri/Sat uplift, 5% last-minute within 14 days, 7 nights from a
// Monday → raw discounted nightly 284.335 → 284.33 on both engines.
$rateNightlyBd = [
    'prop_key' => 'nbd', 'couple_rate' => 41, 'extra_adult_rate' => 0, 'child_rate' => 0,
    'booking_fee' => 0, 'transaction_pct' => 3, 'weekend_pct' => 15, 'weekend_days' => '5,6',
    'lastmin_pct' => 5, 'lastmin_days' => 14,
];
$pnbd = price_breakdown($rateNightlyBd, 2, 0, '2026-09-07', '2026-09-14', null, [], '2026-09-01');
chk('discounted nightly scale-then-rounds to 284.33 (not round()\'s 284.34), matching JS', approxEq($pnbd['nightly'], 284.33));

// Rounding-boundary parity: a fractional nightly whose ×3% fee lands exactly on a
// .xx5 float boundary. round($x,2) and Math.round($x*100)/100 disagree here by 1p,
// so this fixture pins PHP to the JS scale-then-round (guards the txFee/perNight
// lockstep the integer fixtures above can never exercise). nightly 178.50 → fee
// 178.50×0.03 = 5.355 → 5.36 (both engines), total 183.86.
$rateBoundary = [
    'prop_key' => 'bd', 'couple_rate' => 178.50, 'extra_adult_rate' => 0, 'child_rate' => 0,
    'booking_fee' => 0, 'transaction_pct' => 3, 'weekend_pct' => 0, 'weekend_days' => '',
];
$pbd = price_breakdown($rateBoundary, 2, 0, '2026-07-01', '2026-07-02', null, []); // 1 night → nightly 178.50
chk('rounding boundary: nightly = 178.50', approxEq($pbd['nightly'], 178.5));
chk('rounding boundary: per-night = 178.50 (scale-then-round matches JS)', approxEq($pbd['perNight'], 178.5));
chk('rounding boundary: txFee = 5.36 (178.50×3% = 5.355 → 5.36, matches JS)', approxEq($pbd['txFee'], 5.36));
chk('rounding boundary: total = 183.86 (not 183.85)', approxEq($pbd['total'], 183.86));

// booking_price(): confirmed bookings must show their AGREED (locked-in) snapshot,
// never today's rates — emails and previews route through this helper.
$rateNow = [
    'prop_key' => 'bp', 'couple_rate' => 165, 'extra_adult_rate' => 0, 'child_rate' => 0,
    'booking_fee' => 75, 'transaction_pct' => 3, 'weekend_pct' => 0, 'weekend_days' => '',
];
$bAgreed = [
    'adults' => 2, 'children' => 0, 'check_in' => '2026-08-01', 'check_out' => '2026-08-05',
    'agreed_total' => 556.2, 'agreed_per_night' => 135, 'agreed_nights' => 4,
    'agreed_nightly' => 540, 'agreed_booking_fee' => 75, 'agreed_txn_pct' => 3,
    'agreed_txn_fee' => 16.2, 'price_override' => null,
];
$bp = booking_price($rateNow, $bAgreed);
chk('booking_price: locked total 556.20 (not live 679.80)', approxEq($bp['total'], 556.2));
chk('booking_price: locked per-night 135 (not live 165)', approxEq($bp['perNight'], 135));
chk('booking_price: locked damages deposit rides along', approxEq($bp['damagesDeposit'], 75));
chk('booking_price: flags the snapshot as agreed', !empty($bp['agreed']));
$bpOv = booking_price($rateNow, array_merge($bAgreed, ['price_override' => 500]));
chk('booking_price: manual override wins over agreed total', approxEq($bpOv['total'], 500));
$bLive = ['adults' => 2, 'children' => 0, 'check_in' => '2026-08-01', 'check_out' => '2026-08-05', 'agreed_total' => null];
$bpLive = booking_price($rateNow, $bLive);
chk('booking_price: no snapshot → live rates (679.80)', approxEq($bpLive['total'], 679.8));
chk('booking_price: no snapshot and no rate → null', booking_price(null, $bLive) === null);

// ---- Structural anti-leak guard -------------------------------------------
// A confirmed booking's price is LOCKED. Every direct price_breakdown() call in
// a booking-context file below is an audited agreed-first fallback (or the
// snapshot creator itself). If this check fails, you added a NEW direct call:
// use booking_price($rate, $b) instead — it returns the agreed snapshot first —
// or, if the new call genuinely is a guarded legacy fallback, re-audit the file
// and update the expected count here in the same PR.
$allowedDirectCalls = [
    'bookings.php' => 3, // snapshot_fields() + confirmation-email fallback + hold-request deposit fallback
    'pay.php' => 2, // total + damages-deposit legacy fallbacks
    'mailer.php' => 1, // payment-request damages-deposit legacy fallback
    'invoice.php' => 1, // legacy pre-snapshot fallback
    'square-webhook.php' => 1, // legacy pre-snapshot fallback
];
foreach ($allowedDirectCalls as $file => $expected) {
    $src = (string) file_get_contents(__DIR__ . '/' . $file);
    $n = preg_match_all('/price_breakdown\s*\(/', $src);
    chk(
        "guard: $file has exactly $expected audited price_breakdown() call(s) — new booking-context calls must use booking_price() (found $n)",
        $n === $expected,
    );
}
// The owner email composer must price bookings through booking_price().
$bkSrc = (string) file_get_contents(__DIR__ . '/bookings.php');
chk(
    'guard: bookings.php email composer routes through booking_price() (preview + send)',
    preg_match_all('/booking_price\s*\(/', $bkSrc) >= 2,
);

echo "\n";
if ($fail) {
    fwrite(STDERR, "$fail pricing check(s) FAILED — JS and PHP pricing may have diverged.\n");
    exit(1);
}
echo "All pricing parity checks passed.\n";
exit(0);
