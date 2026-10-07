<?php
// ============================================================
//  pricing-suggest-lib.php — the pure decisions behind pricing-suggest.php.
//
//  THE ENGINE LOOKS FORWARD. A price can only be changed for a night that has not
//  happened yet, so a week, a month or a gap that is already behind us is not an
//  idea: it used to produce "Demand radar: week of 17 Aug … worth pricing it higher
//  next year" cards in October, five of them, each an "Opportunity" with nothing to
//  do. Every judgement here takes TODAY and refuses anything before it.
//
//  Pure (no DB, no session) so test-pricing-suggest.php drives it directly; the
//  endpoint calls require_admin() at the top and cannot be required by a test.
// ============================================================

// The Monday of the week $date falls in (Y-m-d).
function psug_week_start(string $date): string
{
    $t = strtotime($date . ' 12:00:00');
    $dow = (int) date('N', $t); // 1 = Monday
    return date('Y-m-d', $t - ($dow - 1) * 86400);
}

// Search weeks that are still ahead: the current week counts (some of its nights
// are still to come), anything that ended before this Monday does not. Returned in
// calendar order — the radar reads left to right — capped at $max by search count.
function psug_future_weeks(array $rows, string $today, int $max = 6): array
{
    $thisMonday = psug_week_start($today);
    $out = [];
    foreach ($rows as $r) {
        $wk = substr((string) ($r['week'] ?? ''), 0, 10);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $wk) || $wk < $thisMonday) {
            continue;
        }
        $out[] = ['week' => $wk, 'count' => max(0, (int) ($r['count'] ?? 0)), 'missed' => max(0, (int) ($r['missed'] ?? 0))];
    }
    usort($out, fn($a, $b) => $b['count'] <=> $a['count']);
    $out = array_slice($out, 0, $max);
    usort($out, fn($a, $b) => strcmp($a['week'], $b['week']));
    return $out;
}

// Months (YYYY-MM) with a real unmet signal that are not over yet.
function psug_future_months(array $rows, string $today, int $min = 3): array
{
    $cur = substr($today, 0, 7);
    return array_values(array_filter($rows, fn($r) => preg_match('/^\d{4}-\d{2}$/', (string) ($r['month'] ?? '')) && $r['month'] >= $cur && (int) ($r['count'] ?? 0) >= $min));
}

// ONE card for the weeks ahead where guests found nothing free — not one card per
// week (the radar section already lists them). Null when there is no real signal.
// An INSIGHT, never an "opportunity": every cottage is already full those weeks,
// so there is nothing to apply.
function psug_unmet_weeks_card(array $weeks, int $min = 3): ?array
{
    $hit = array_values(array_filter($weeks, fn($w) => (int) $w['missed'] >= $min));
    if (!$hit) {
        return null;
    }
    $missed = array_sum(array_map(fn($w) => (int) $w['missed'], $hit));
    $labels = array_map(fn($w) => date('j M', strtotime($w['week'])), $hit);
    $list = count($labels) > 1 ? implode(', ', array_slice($labels, 0, -1)) . ' and ' . end($labels) : $labels[0];
    return [
        'id' => 'radar-ahead',
        'prop_key' => '',
        'prop_name' => '',
        'severity' => 'info',
        'title' => count($hit) === 1 ? 'Guests found nothing free the week of ' . $labels[0] : 'Guests found nothing free in ' . count($hit) . ' weeks ahead',
        'detail' => $missed . ' search' . ($missed === 1 ? '' : 'es') . ' for the week' . (count($hit) === 1 ? '' : 's') . ' of ' . $list .
            ' found every cottage booked. Your free nights either side are where those guests can still land — hold their prices firm, and the waitlist will tell you if anything opens.',
        'apply' => null,
    ];
}

// Gaps of 1–2 nights between stays that START today or later.
function psug_future_orphans(array $merged, string $today): int
{
    $n = 0;
    for ($i = 0; $i < count($merged) - 1; $i++) {
        $from = $merged[$i][1];
        if ($from < $today) {
            continue;
        }
        $gap = (int) round((strtotime($merged[$i + 1][0]) - strtotime($from)) / 86400);
        if ($gap >= 1 && $gap <= 2) {
            $n += $gap;
        }
    }
    return $n;
}
