<?php
// ============================================================
//  pricing.php — server-side price calculation (authoritative).
//  Mirrors the front-end couple-based model.
// ============================================================

function nights_between($checkIn, $checkOut)
{
    $a = strtotime($checkIn);
    $b = strtotime($checkOut);
    if (!$a || !$b) {
        return 0;
    }
    $d = (int) round(($b - $a) / 86400);
    return $d > 0 ? $d : 0;
}

// Seasonal rates for a property: date ranges with their own couple rate.
// Returns [] if the table doesn't exist yet (migration not run) — never throws.
function get_seasons($propKey)
{
    try {
        $s = db()->prepare(
            'SELECT label, start_date, end_date, couple_rate FROM rate_seasons WHERE prop_key = ? ORDER BY start_date, id',
        );
        $s->execute([$propKey]);
        return $s->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}

// Couple rate that applies on a given night (Y-m-d). First matching season wins
// (inclusive of both start and end dates); otherwise the property's base rate.
function couple_rate_for_night($date, $baseRate, $seasons)
{
    foreach ($seasons as $s) {
        if ($date >= $s['start_date'] && $date <= $s['end_date']) {
            return (float) $s['couple_rate'];
        }
    }
    return (float) $baseRate;
}

// Weekend uplift % that applies on a given night, from a properties row.
// weekend_days is a CSV of day-of-week numbers (0=Sun … 6=Sat); default Fri,Sat.
// MUST mirror weekendPctFor() in app.js exactly (lockstep, guarded by the tests).
function weekend_pct_for_night($date, $rate)
{
    $pct = (float) ($rate['weekend_pct'] ?? 0);
    if ($pct <= 0) {
        return 0.0;
    }
    $days = array_map('intval', array_filter(explode(',', (string) ($rate['weekend_days'] ?? '5,6')), 'strlen'));
    return in_array((int) date('w', strtotime($date)), $days, true) ? $pct : 0.0;
}

// The full nightly rate for a date: season/base, then weekend uplift if applicable.
function nightly_rate_for($date, $rate, $seasons)
{
    $base = couple_rate_for_night($date, $rate['couple_rate'], $seasons);
    $pct = weekend_pct_for_night($date, $rate);
    return $pct > 0 ? $base * (1 + $pct / 100) : $base;
}

// Last-minute discount multiplier: PCT% off the nightly rental when check-in is
// within DAYS days of TODAY (both 0 = off). Returns 1.0 (no discount) otherwise.
// MUST mirror lastMinuteFactor() in app.js exactly (lockstep, guarded by tests).
function last_minute_factor($checkIn, $today, $pct, $days)
{
    $pct = (float) $pct;
    $days = (int) $days;
    if ($pct <= 0 || $days <= 0) {
        return 1.0;
    }
    // Parse both dates at UTC midnight so the day-count is DST-immune and matches
    // app.js's lastMinuteFactor() exactly (it uses `T00:00:00Z`). Using local time
    // here would drift a day across the spring clock change (a 23-hour "day").
    $lead = (int) floor((strtotime($checkIn . ' UTC') - strtotime($today . ' UTC')) / 86400);
    if ($lead < 0 || $lead > $days) {
        return 1.0;
    }
    return 1 - min(90.0, $pct) / 100; // never discount more than 90%
}

// Round to 2dp EXACTLY like the JS engine's Math.round(x*100)/100, on EVERY PHP
// version. PHP's native round() pre-rounds on < 8.4 (8.3 is the production pin),
// so round(28433.4999…) → 28434 while JS Math.round → 28433 — a 1p divergence
// between the stored/charged price (PHP) and the on-screen quote (JS). floor(x+0.5)
// has no pre-rounding step and is bit-identical to Math.round for the non-negative
// money values here. Keep in lockstep with app.js priceBreakdown().
function price_round2($x)
{
    return floor((float) $x * 100 + 0.5) / 100;
}

// $rate is a properties row. Returns the full breakdown.
// $depositOverride: optional per-booking damages deposit (null = use property standard).
// $seasons: optional pre-fetched seasonal rates (null = fetch from DB).
// The refundable damages deposit is NOT income: it is excluded from the
// rental subtotal, the transaction-fee calculation and `total` (RENTAL ONLY).
// It is CHARGED together with the guest's first payment (pay.php) and
// refunded after checkout (bookings.php return_deposit / keep_deposit).
function price_breakdown($rate, $adults, $children, $checkIn, $checkOut, $depositOverride = null, $seasons = null, $today = null)
{
    $today = $today ?: date('Y-m-d');
    $nights = nights_between($checkIn, $checkOut);
    $extraAdults = max(0, (int) $adults - 2);
    $extrasPerNight = $extraAdults * (float) $rate['extra_adult_rate'] + (int) $children * (float) $rate['child_rate'];
    if ($seasons === null) {
        $seasons = get_seasons($rate['prop_key'] ?? '');
    }
    // Sum night-by-night: each night's couple rate can differ by season.
    // NOTE: step by "+N days" (DST-safe), not +86400s — the October clock change
    // has a 25-hour day which would otherwise repeat a date and mis-price.
    $nightly = 0.0;
    for ($i = 0; $i < $nights; $i++) {
        $d = date('Y-m-d', strtotime($checkIn . ' +' . $i . ' days'));
        $nightly += nightly_rate_for($d, $rate, $seasons) + $extrasPerNight;
    }
    // Last-minute discount on the nightly rental (never the damages deposit).
    // price_round2 (below) mirrors JS Math.round(x*100)/100 EXACTLY on every PHP
    // version. round($x, 2) — and even round($x*100)/100 — diverges by 1p from JS
    // at a "just below .xx5" float boundary on PHP < 8.4 (8.3, the production pin),
    // whose round() pre-rounds 28433.4999… up to 28434; $nightly feeds perNight,
    // txFee AND total, so any drift lands the snapshot/charge off the guest's
    // on-screen quote.
    $nightly = price_round2(
        $nightly * last_minute_factor($checkIn, $today, $rate['lastmin_pct'] ?? 0, $rate['lastmin_days'] ?? 0),
    );
    // Average per-night figure (for display and the agreed snapshot) — same
    // JS-identical rounding so the snapshot never drifts off the quote.
    $perNight = $nights > 0 ? price_round2($nightly / $nights) : (float) $rate['couple_rate'] + $extrasPerNight;
    // Damages deposit: per-booking override if given, else the property standard
    // (stored in the booking_fee column, which is repurposed for this).
    $depBase =
        $depositOverride !== null && $depositOverride !== '' ? (float) $depositOverride : (float) $rate['booking_fee'];
    $damagesDeposit = $nights > 0 ? max(0.0, $depBase) : 0.0;
    $txPct = (float) $rate['transaction_pct'];
    // JS-identical rounding (see $perNight note above) — this fee is part of
    // `total`, which is snapshotted/emailed/charged, so a 1p drift from the
    // guest's quote must never happen.
    $txFee = price_round2($nightly * ($txPct / 100)); // income only
    $rentalTotal = $nightly + $txFee; // what the owner earns
    // `total` is RENTAL ONLY. The refundable damages deposit is returned
    // separately as damagesDeposit — pay.php charges it alongside the guest's
    // FIRST payment and it is refunded after checkout, so it never counts as
    // income and never joins this total.
    $total = $rentalTotal;
    return [
        'nights' => $nights,
        'perNight' => $perNight,
        'nightly' => $nightly,
        'damagesDeposit' => round($damagesDeposit, 2),
        'transactionPct' => $txPct,
        'txFee' => $txFee,
        'rentalTotal' => round($rentalTotal, 2),
        'total' => round($total, 2),
        'extraAdults' => $extraAdults,
    ];
}

function get_rate($propKey)
{
    $stmt = db()->prepare('SELECT * FROM properties WHERE prop_key = ?');
    $stmt->execute([$propKey]);
    return $stmt->fetch();
}

// ---- Payment-schedule helpers (Square deposit + balance) ----
// Days-before-check-in window: deposit on approval, balance this many days out,
// and full-amount-upfront if a booking is approved inside the window.
function payment_balance_days()
{
    return defined('PAYMENT_BALANCE_DAYS') && (int) PAYMENT_BALANCE_DAYS > 0 ? (int) PAYMENT_BALANCE_DAYS : 30;
}
// Global deposit policy (percentage of the total). Owner-editable in Settings
// (content key 'square-deposit-pct'); defaults to 25%.
function square_deposit_pct()
{
    try {
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute(['square-deposit-pct']);
        $r = $s->fetch();
        if ($r) {
            $v = (float) json_decode($r['item_value'], true);
            if ($v > 0 && $v <= 100) {
                return $v;
            }
        }
    } catch (\Throwable $e) {
    }
    return 25.0;
}
// Effective total + amount due for a kind ('deposit'|'balance'), server-authoritative.
// 'balance' = everything still outstanding; 'deposit' = the deposit % minus anything paid.
function booking_amount_due($b, $kind)
{
    $total =
        $b['agreed_total'] !== null
            ? ($b['price_override'] !== null
                ? (float) $b['price_override']
                : (float) $b['agreed_total'])
            : 0.0;
    if ($total <= 0) {
        $rate = get_rate($b['prop_key']);
        if ($rate) {
            $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $total = $p['total'];
        }
    }
    $total = round($total, 2);
    $alreadyPaid = round((float) ($b['deposit_paid'] ?? 0), 2);
    $depositAmount = round($total * (square_deposit_pct() / 100), 2);
    $due = $kind === 'balance' ? max(0, $total - $alreadyPaid) : max(0, $depositAmount - $alreadyPaid);
    return ['total' => $total, 'alreadyPaid' => $alreadyPaid, 'due' => round($due, 2)];
}

// The price a CONFIRMED booking shows anywhere a guest can see it (emails,
// previews): the LOCKED agreed snapshot (honouring a manual price override),
// falling back to a live calculation only for legacy pre-snapshot rows.
// Same shape as price_breakdown() so consumers can swap it in directly.
function booking_price($rate, $b)
{
    if (isset($b['agreed_total']) && $b['agreed_total'] !== null) {
        $total =
            isset($b['price_override']) && $b['price_override'] !== null && $b['price_override'] !== ''
                ? (float) $b['price_override']
                : (float) $b['agreed_total'];
        return [
            'total' => $total,
            'perNight' => (float) $b['agreed_per_night'],
            'nights' => (int) $b['agreed_nights'],
            'nightly' => (float) $b['agreed_nightly'],
            'damagesDeposit' => (float) $b['agreed_booking_fee'],
            'transactionPct' => (float) $b['agreed_txn_pct'],
            'txFee' => (float) $b['agreed_txn_fee'],
            'agreed' => true,
        ];
    }
    if (!$rate) {
        return null;
    }
    return price_breakdown($rate, (int) $b['adults'], (int) $b['children'], $b['check_in'], $b['check_out']);
}
