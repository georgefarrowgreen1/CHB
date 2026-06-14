<?php
// ============================================================
//  pricing.php — server-side price calculation (authoritative).
//  Mirrors the front-end couple-based model.
// ============================================================

function nights_between($checkIn, $checkOut) {
    $a = strtotime($checkIn); $b = strtotime($checkOut);
    if (!$a || !$b) return 0;
    $d = (int)round(($b - $a) / 86400);
    return $d > 0 ? $d : 0;
}

// Seasonal rates for a property: date ranges with their own couple rate.
// Returns [] if the table doesn't exist yet (migration not run) — never throws.
function get_seasons($propKey) {
    try {
        $s = db()->prepare('SELECT label, start_date, end_date, couple_rate FROM rate_seasons WHERE prop_key = ? ORDER BY start_date, id');
        $s->execute([$propKey]);
        return $s->fetchAll();
    } catch (\Throwable $e) { return []; }
}

// Couple rate that applies on a given night (Y-m-d). First matching season wins
// (inclusive of both start and end dates); otherwise the property's base rate.
function couple_rate_for_night($date, $baseRate, $seasons) {
    foreach ($seasons as $s) {
        if ($date >= $s['start_date'] && $date <= $s['end_date']) return (float)$s['couple_rate'];
    }
    return (float)$baseRate;
}

// $rate is a properties row. Returns the full breakdown.
// $depositOverride: optional per-booking damages deposit (null = use property standard).
// $seasons: optional pre-fetched seasonal rates (null = fetch from DB).
// The refundable damages deposit is HELD, not income: it is excluded from the
// rental subtotal and from the transaction-fee calculation, but added to the
// total the guest pays upfront.
function price_breakdown($rate, $adults, $children, $checkIn, $checkOut, $depositOverride = null, $seasons = null) {
    $nights = nights_between($checkIn, $checkOut);
    $extraAdults = max(0, (int)$adults - 2);
    $extrasPerNight = $extraAdults * (float)$rate['extra_adult_rate']
                    + (int)$children * (float)$rate['child_rate'];
    if ($seasons === null) $seasons = get_seasons($rate['prop_key'] ?? '');
    // Sum night-by-night: each night's couple rate can differ by season.
    // NOTE: step by "+N days" (DST-safe), not +86400s — the October clock change
    // has a 25-hour day which would otherwise repeat a date and mis-price.
    $nightly = 0.0;
    for ($i = 0; $i < $nights; $i++) {
        $d = date('Y-m-d', strtotime($checkIn . ' +' . $i . ' days'));
        $nightly += couple_rate_for_night($d, $rate['couple_rate'], $seasons) + $extrasPerNight;
    }
    $nightly = round($nightly, 2);
    // Average per-night figure (for display and the agreed snapshot).
    $perNight = $nights > 0 ? round($nightly / $nights, 2)
              : (float)$rate['couple_rate'] + $extrasPerNight;
    // Damages deposit: per-booking override if given, else the property standard
    // (stored in the booking_fee column, which is repurposed for this).
    $depBase = ($depositOverride !== null && $depositOverride !== '')
        ? (float)$depositOverride : (float)$rate['booking_fee'];
    $damagesDeposit = $nights > 0 ? max(0.0, $depBase) : 0.0;
    $txPct = (float)$rate['transaction_pct'];
    $txFee = round($nightly * ($txPct / 100), 2);          // income only
    $rentalTotal = $nightly + $txFee;                       // what the owner earns
    $total = $rentalTotal + $damagesDeposit;                // what the guest pays
    return [
        'nights' => $nights, 'perNight' => $perNight, 'nightly' => $nightly,
        'damagesDeposit' => round($damagesDeposit, 2), 'transactionPct' => $txPct,
        'txFee' => $txFee, 'rentalTotal' => round($rentalTotal, 2),
        'total' => round($total, 2), 'extraAdults' => $extraAdults,
    ];
}

function get_rate($propKey) {
    $stmt = db()->prepare('SELECT * FROM properties WHERE prop_key = ?');
    $stmt->execute([$propKey]);
    return $stmt->fetch();
}
