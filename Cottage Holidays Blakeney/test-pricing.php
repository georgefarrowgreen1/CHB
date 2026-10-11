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

// A deposit is a percentage of money rounded one way (money_pct): deposit-fixtures.json,
// generated from it and looped by smoke-test.js against the JS quoting it, holds the
// cases the old JS got wrong and the ones where round() depends on the PHP version.
$dfx = json_decode((string) file_get_contents(__DIR__ . '/deposit-fixtures.json'), true);
$dCases = array_merge($dfx['oldJs'] ?? [], $dfx['php84'] ?? [], $dfx['normal'] ?? []);
chk('deposit-fixtures.json loads with its cases (' . count($dCases) . ')', count($dCases) >= 50 && count($dfx['php84'] ?? []) >= 10);
$dBad = [];
foreach ($dCases as $c) {
    $got = booking_deposit_amount(['deposit_pct_override' => $c['pct']], $c['total']);
    if (abs($got - $c['deposit']) > 0.001) {
        $dBad[] = "{$c['pct']}% of {$c['total']}: $got not {$c['deposit']}";
    }
}
chk('the deposit charged is the one the form quotes, on any PHP (' . (implode('; ', array_slice($dBad, 0, 2)) ?: 'all ' . count($dCases)) . ')', !$dBad);

// Short-stay charge (migration-130) — same cases as smoke-test's shortStayCharge.
chk('short stay: 2 nights at £50 → £100', approxEq(short_stay_charge(['short_fee' => 50, 'short_max' => 2], 2), 100));
chk('short stay: 3 nights not short at max 2 → 0', approxEq(short_stay_charge(['short_fee' => 50, 'short_max' => 2], 3), 0));
chk('short stay: max 3 covers 3 nights → £150', approxEq(short_stay_charge(['short_fee' => 50, 'short_max' => 3], 3), 150));
chk('short stay: no fee → 0', approxEq(short_stay_charge(['short_fee' => 0, 'short_max' => 2], 1), 0));
chk('short stay: max defaults to 2 nights', approxEq(short_stay_charge(['short_fee' => 40], 2), 80) && approxEq(short_stay_charge(['short_fee' => 40], 3), 0));
$rateSs = ['prop_key' => 'ss', 'couple_rate' => 100, 'extra_adult_rate' => 0, 'child_rate' => 0, 'booking_fee' => 0, 'transaction_pct' => 0, 'short_fee' => 50, 'short_max' => 2, 'lastmin_pct' => 20, 'lastmin_days' => 10];
$pss = price_breakdown($rateSs, 2, 0, '2026-01-05', '2026-01-07', null, [], '2026-01-01');
chk('short stay rides AFTER the last-minute discount: 200×0.8 + 100 = 260', approxEq($pss['nightly'], 260) && approxEq($pss['perNight'], 130));
$pss3 = price_breakdown($rateSs, 2, 0, '2026-01-05', '2026-01-08', null, [], '2026-01-01');
chk('a 3-night stay carries no short-stay charge: 300×0.8 = 240', approxEq($pss3['nightly'], 240));

// Minimum stay by date + gap fit (booking-rules-lib.php) — the same cases as
// smoke-test's ruleMinNights / ruleGapFit, so the form and the server agree.
require_once __DIR__ . '/booking-rules-lib.php';
$rulesD = ['minNights' => 2, 'minByDate' => [['from' => '2026-10-24', 'to' => '2026-10-31', 'min' => 5], ['from' => '2026-11-02', 'to' => '2026-11-30', 'min' => 3]], 'gapFitDays' => 10];
chk('dated minimum: half-term check-in → 5', rule_min_nights($rulesD, '2026-10-24') === 5 && rule_min_nights($rulesD, '2026-10-31') === 5);
chk('dated minimum: November → 3', rule_min_nights($rulesD, '2026-11-15') === 3);
chk('dated minimum: outside every range → the standard 2', rule_min_nights($rulesD, '2026-11-01') === 2 && rule_min_nights($rulesD, '2026-12-01') === 2);
chk('dated minimum: garbage rows are ignored', rule_min_nights(['minNights' => 2, 'minByDate' => ['x', ['from' => 'nope', 'to' => '2026-12-01', 'min' => 9]]], '2026-11-15') === 2);
$takenG = fn($d) => in_array($d, ['2026-10-09', '2026-10-12'], true);
chk('gap fit: exactly the 10–12 gap, 2 days out → allowed', rule_gap_fit($rulesD, '2026-10-10', '2026-10-12', '2026-10-08', $takenG));
chk('gap fit: part of the gap is not a fit', !rule_gap_fit($rulesD, '2026-10-10', '2026-10-11', '2026-10-08', $takenG));
chk('gap fit: outside the window → not allowed', !rule_gap_fit($rulesD, '2026-10-10', '2026-10-12', '2026-09-01', $takenG));
chk('gap fit: off by default', !rule_gap_fit(['minNights' => 2], '2026-10-10', '2026-10-12', '2026-10-08', $takenG));
$enqSrc = (string) file_get_contents(__DIR__ . '/enquiries.php');
chk('guard: enquiries.php enforces the dated minimum and the gap fit', strpos($enqSrc, 'rule_min_nights($rules, $checkIn)') !== false && strpos($enqSrc, '!$gapFit') !== false);

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
    'bookings.php' => 1, // snapshot_fields() (the hold-request initiator, and its fallback, are retired — no caller)
    'booking-confirm-lib.php' => 1, // the confirmation-email fallback (moved out of bookings.php so approval shares it)
    'pay.php' => 0, // NONE left. The TOTAL's fallback moved inside
    // booking_amount_due (stage-1: one ask derivation, not two copies), and the
    // damages-deposit fallback moved inside booking_damages_amount so the guest's
    // ACCOUNT can name the same charge this screen makes. The ratchet only ever
    // falls — a NEW direct call here still fails, which is its whole job.
    'mailer.php' => 0, // the request's damages now come from booking_damages_due (round 8)
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
