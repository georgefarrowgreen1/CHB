<?php
// ============================================================
//  booking-rules-lib.php — the minimum stay that applies to ONE stay.
//
//  The owner's rules (content 'rules-<prop>') carry a standard minNights and,
//  optionally, minByDate: [{from, to, min}] — a dated minimum for check-ins
//  between from and to INCLUSIVE (a half term asking 5 nights, a quiet
//  November asking 3). And gapFitDays: within that many days of today, a stay
//  that exactly fills the gap between two taken nights may be booked whatever
//  the minimum — the gap can never sell any other way, and one stay there is
//  one trip. JS twins: ruleMinNights / ruleGapFit (app.js). Pure: the caller
//  passes how to ask whether a night is taken.
// ============================================================

function rule_min_nights(array $rules, string $checkIn): int
{
    $min = max(1, (int) ($rules['minNights'] ?? 1));
    $dated = is_array($rules['minByDate'] ?? null) ? $rules['minByDate'] : [];
    foreach ($dated as $d) {
        if (!is_array($d)) {
            continue;
        }
        $from = (string) ($d['from'] ?? '');
        $to = (string) ($d['to'] ?? '');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) && $from <= $checkIn && $checkIn <= $to) {
            return max(1, min(28, (int) ($d['min'] ?? $min)));
        }
    }
    return $min;
}

// $taken(string $night): bool — is that night already booked or held.
function rule_gap_fit(array $rules, string $checkIn, string $checkOut, string $today, callable $taken): bool
{
    $days = max(0, min(60, (int) ($rules['gapFitDays'] ?? 0)));
    if ($days === 0 || $checkOut <= $checkIn) {
        return false;
    }
    $lead = (int) round((strtotime($checkIn . ' 12:00:00') - strtotime($today . ' 12:00:00')) / 86400);
    if ($lead > $days) {
        return false;
    }
    $before = date('Y-m-d', strtotime($checkIn . ' 12:00:00 -1 day'));
    return $taken($before) && $taken($checkOut);
}
