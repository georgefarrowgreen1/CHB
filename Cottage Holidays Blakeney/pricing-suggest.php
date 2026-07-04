<?php
// ============================================================
//  pricing-suggest.php — admin-only "Pricing Coach".
//
//  Turns the owner's OWN data — calendar occupancy, weekend fill, near-term
//  pace, orphan gaps, and the search_log demand signal (what guests searched +
//  how often nothing was free) — into plain-English pricing suggestions.
//
//  READ-ONLY: it never changes prices. The front end applies an accepted
//  suggestion through rates.php (the existing, validated save path), so guest
//  pricing stays deterministic + lockstepped. This is advisory + a nudge.
//
//  GET ?action=suggest  ->  { ok, generatedAt, signals, suggestions:[…] }
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

require_admin();

$today = date('Y-m-d');
function money($n)
{
    return '£' . number_format(round($n), 0);
}

// Live (non-archived) cottages.
try {
    $props = db()->query('SELECT * FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name')->fetchAll();
} catch (\Throwable $e) {
    $props = [];
}

// Reservations overlapping the next 120 days, grouped by cottage. We combine the
// SAME two authoritative sources the public availability calendar uses, so the
// Coach sees true cross-channel occupancy, not just direct bookings:
//   1. confirmed direct bookings on this site
//   2. imported Airbnb/Vrbo iCal blocks (busy dates synced from those platforms;
//      iCal carries no prices, so this is occupancy only)
$horizon = date('Y-m-d', strtotime('+120 days'));
$bkByProp = [];
$hasExternal = false;
try {
    $st = db()->prepare(
        'SELECT prop_key, check_in, check_out FROM bookings WHERE check_out >= ? AND check_in <= ? ORDER BY check_in',
    );
    $st->execute([$today, $horizon]);
    foreach ($st->fetchAll() as $b) {
        $bkByProp[$b['prop_key']][] = $b;
    }
} catch (\Throwable $e) {
}
try {
    $st = db()->prepare(
        'SELECT prop_key, check_in, check_out FROM ical_blocks WHERE check_out >= ? AND check_in <= ? ORDER BY check_in',
    );
    $st->execute([$today, $horizon]);
    foreach ($st->fetchAll() as $b) {
        $bkByProp[$b['prop_key']][] = $b;
        $hasExternal = true;
    }
} catch (\Throwable $e) {
    /* ical_blocks not present on older installs */
}

function is_booked_date($bookings, $date)
{
    foreach ($bookings as $b) {
        if ($date >= $b['check_in'] && $date < $b['check_out']) {
            return true;
        }
    }
    return false;
}
// DISTINCT booked nights within [start, end) — counts each day at most once, so
// overlapping ranges from the two sources (direct + Airbnb/Vrbo) never double-count.
function booked_days_in($bookings, $start, $end)
{
    $n = 0;
    $days = (int) round((strtotime($end) - strtotime($start)) / 86400);
    for ($i = 0; $i < $days; $i++) {
        if (is_booked_date($bookings, date('Y-m-d', strtotime($start . " +$i days")))) {
            $n++;
        }
    }
    return $n;
}
// Merge overlapping/adjacent reservation intervals (across both sources) so gap
// detection sees one continuous calendar rather than two interleaved feeds.
function merge_intervals($bookings)
{
    $iv = [];
    foreach ($bookings as $b) {
        $iv[] = [$b['check_in'], $b['check_out']];
    }
    usort($iv, fn($a, $b) => strcmp($a[0], $b[0]));
    $out = [];
    foreach ($iv as $cur) {
        if ($out && $cur[0] <= end($out)[1]) {
            if ($cur[1] > $out[count($out) - 1][1]) {
                $out[count($out) - 1][1] = $cur[1];
            }
        } else {
            $out[] = $cur;
        }
    }
    return $out;
}

// ---- Search demand (global), last 60 days ----
$signals = ['searches60' => 0, 'noResult60' => 0];
$topNoMonths = [];
try {
    $since = date('Y-m-d H:i:s', strtotime('-60 days'));
    $q = db()->prepare('SELECT COUNT(*) FROM search_log WHERE created_at >= ?');
    $q->execute([$since]);
    $signals['searches60'] = (int) $q->fetchColumn();
    $q = db()->prepare('SELECT COUNT(*) FROM search_log WHERE created_at >= ? AND found = 0');
    $q->execute([$since]);
    $signals['noResult60'] = (int) $q->fetchColumn();
    $q = db()->prepare(
        'SELECT month, COUNT(*) c FROM search_log WHERE created_at >= ? AND found = 0 AND month IS NOT NULL GROUP BY month ORDER BY c DESC LIMIT 2',
    );
    $q->execute([$since]);
    foreach ($q->fetchAll() as $r) {
        $topNoMonths[] = ['month' => $r['month'], 'count' => (int) $r['c']];
    }
} catch (\Throwable $e) {
    /* search_log not migrated yet */
}

$monthName = function ($ym) {
    if (!preg_match('/^(\d{4})-(\d{2})$/', (string) $ym, $m)) {
        return $ym;
    }
    return date('F Y', mktime(0, 0, 0, (int) $m[2], 1, (int) $m[1]));
};

$suggestions = [];

foreach ($props as $p) {
    $k = $p['prop_key'];
    $name = $p['name'];
    $bk = $bkByProp[$k] ?? [];
    $base = (float) $p['couple_rate'];
    $weekendPct = (float) ($p['weekend_pct'] ?? 0);
    $weekendDays = array_map('intval', array_filter(explode(',', (string) ($p['weekend_days'] ?? '5,6')), 'strlen'));
    if (!$weekendDays) {
        $weekendDays = [5, 6];
    }

    // 90-day + 30-day occupancy (direct bookings + Airbnb/Vrbo, distinct days).
    $win90 = date('Y-m-d', strtotime('+90 days'));
    $win30 = date('Y-m-d', strtotime('+30 days'));
    $booked30 = booked_days_in($bk, $today, $win30);
    $occ90 = (int) round((booked_days_in($bk, $today, $win90) / 90) * 100);
    $occ30 = (int) round(($booked30 / 30) * 100);
    $chan = $hasExternal ? ' (direct + Airbnb/Vrbo)' : '';

    // Weekend nights in the next 90 days: total / free / booked.
    $wkTotal = 0;
    $wkFree = 0;
    for ($i = 0; $i < 90; $i++) {
        $d = date('Y-m-d', strtotime("+$i days"));
        if (!in_array((int) date('w', strtotime($d)), $weekendDays, true)) {
            continue;
        }
        $wkTotal++;
        if (!is_booked_date($bk, $d)) {
            $wkFree++;
        }
    }
    $wkOcc = $wkTotal > 0 ? (int) round((($wkTotal - $wkFree) / $wkTotal) * 100) : 0;

    // 1) Weekend pricing OFF but there's weekend inventory to sell.
    if ($weekendPct <= 0 && $wkFree > 0 && $base > 0) {
        $est = $wkFree * $base * 0.2;
        $suggestions[] = [
            'id' => 'weekend-on-' . $k,
            'prop_key' => $k,
            'prop_name' => $name,
            'severity' => 'opportunity',
            'title' => 'Turn on weekend pricing for ' . $name,
            'detail' =>
                'Fri & Sat are your highest-demand nights, but they\'re priced the same as weekdays. ' .
                $wkFree .
                ' weekend night' .
                ($wkFree === 1 ? '' : 's') .
                ' are still open in the next 90 days — a +20% uplift could add about ' .
                money($est) .
                ' if they book.',
            'apply' => ['field' => 'weekendPct', 'value' => 20],
        ];
    }
    // 2) Weekend pricing ON and weekends filling fast — nudge it up.
    elseif ($weekendPct > 0 && $weekendPct < 50 && $wkOcc >= 70 && $wkTotal >= 4) {
        $newPct = min(60, (int) round($weekendPct + 10));
        $suggestions[] = [
            'id' => 'weekend-up-' . $k,
            'prop_key' => $k,
            'prop_name' => $name,
            'severity' => 'opportunity',
            'title' => 'Raise the weekend uplift for ' . $name,
            'detail' =>
                'Your Fri/Sat are ' .
                $wkOcc .
                '% booked' .
                $chan .
                ' over the next 90 days — strong demand. Consider raising the weekend uplift from ' .
                (int) $weekendPct .
                '% to ' .
                $newPct .
                '%.',
            'apply' => ['field' => 'weekendPct', 'value' => $newPct],
        ];
    }

    // 3) Quiet next 30 days — flag for a last-minute push (Phase 2 will automate it).
    if ($occ30 < 40 && $booked30 < 30) {
        $suggestions[] = [
            'id' => 'quiet30-' . $k,
            'prop_key' => $k,
            'prop_name' => $name,
            'severity' => 'info',
            'title' => $name . ' is quiet in the next 30 days',
            'detail' =>
                'Only ' .
                $occ30 .
                '% of the next 30 days is booked' .
                $chan .
                '. A short last-minute offer (within ~10 days of arrival) is the usual way to fill near-term gaps.',
            'apply' => null,
        ];
    }

    // 4) Orphan gaps: 1–2 night gaps between reservations (across BOTH channels)
    // that your minimum stay may be leaving empty. Merge first so interleaved
    // direct + Airbnb/Vrbo ranges read as one calendar.
    $orphans = 0;
    $merged = merge_intervals($bk);
    for ($i = 0; $i < count($merged) - 1; $i++) {
        $gap = (int) round((strtotime($merged[$i + 1][0]) - strtotime($merged[$i][1])) / 86400);
        if ($gap >= 1 && $gap <= 2) {
            $orphans += $gap;
        }
    }
    if ($orphans > 0) {
        $suggestions[] = [
            'id' => 'orphan-' . $k,
            'prop_key' => $k,
            'prop_name' => $name,
            'severity' => 'info',
            'title' => $orphans . ' orphan night' . ($orphans === 1 ? '' : 's') . ' for ' . $name,
            'detail' =>
                'There ' .
                ($orphans === 1 ? 'is' : 'are') .
                ' ' .
                $orphans .
                ' single/double-night gap' .
                ($orphans === 1 ? '' : 's') .
                ' between bookings that your minimum-stay rule may be leaving empty. Allowing 1–2 night stays in those gaps (often at a small discount) recovers otherwise-lost nights.',
            'apply' => null,
        ];
    }
}

// 5) Unmet demand from search_log — a month people search but rarely find free.
foreach ($topNoMonths as $tm) {
    if ($tm['count'] < 3) {
        continue;
    } // need a real signal, not noise
    $suggestions[] = [
        'id' => 'demand-' . $tm['month'],
        'prop_key' => '',
        'prop_name' => '',
        'severity' => 'opportunity',
        'title' => 'Unmet demand for ' . $monthName($tm['month']),
        'detail' =>
            $tm['count'] .
            ' searches for ' .
            $monthName($tm['month']) .
            ' found nothing available. If you can open dates that month — or your rate would still sell higher — that\'s real demand you\'re turning away. (Airbnb can\'t see this; your own search log can.)',
        'apply' => null,
    ];
}

// 6) Week-level demand radar — exact-date searches (found or not) grouped by the
//    Monday of the week guests wanted. Unmet weeks with a real signal become
//    suggestion cards: future weeks are actionable now; past weeks inform next year.
try {
    $q = db()->prepare("SELECT DATE_SUB(check_in, INTERVAL WEEKDAY(check_in) DAY) wk,
                               COUNT(*) c, SUM(found = 0) missed
                        FROM search_log
                        WHERE created_at >= ? AND check_in IS NOT NULL
                        GROUP BY wk ORDER BY c DESC LIMIT 8");
    $q->execute([$since]);
    $weeks = $q->fetchAll();
    $signals['searchWeeks'] = array_map(
        fn($r) => [
            'week' => $r['wk'],
            'count' => (int) $r['c'],
            'missed' => (int) $r['missed'],
        ],
        $weeks,
    );
    foreach ($weeks as $w) {
        if ((int) $w['missed'] < 3) {
            continue;
        } // need a real signal, not noise
        $wc = date('j M', strtotime($w['wk']));
        $future = $w['wk'] >= date('Y-m-d');
        $suggestions[] = [
            'id' => 'radar-' . $w['wk'],
            'prop_key' => '',
            'prop_name' => '',
            'severity' => 'opportunity',
            'title' => 'Demand radar: week of ' . $wc,
            'detail' =>
                (int) $w['missed'] .
                ' of ' .
                (int) $w['c'] .
                ' searches for the week of ' .
                $wc .
                ' found nothing free. ' .
                ($future
                    ? 'If any dates that week can be opened (or a booking moved), that\'s demand waiting — the waitlist and newsletter are the quickest way to fill it.'
                    : 'You were full that week — worth pricing it higher next year, since demand outran supply.'),
            'apply' => null,
        ];
    }
} catch (\Throwable $e) {
    /* search_log not migrated yet */
}

// Opportunities first, then info.
usort(
    $suggestions,
    fn($a, $b) => ($a['severity'] === 'opportunity' ? 0 : 1) - ($b['severity'] === 'opportunity' ? 0 : 1),
);

json_out([
    'ok' => true,
    'generatedAt' => date('c'),
    'signals' => $signals,
    'suggestions' => $suggestions,
]);
