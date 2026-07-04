<?php
// ============================================================
//  activity-lib.php — shared event gathering for the back-office activity views.
//  No top-level side effects; safe to include from activity.php (the small
//  dashboard "Recent activity" feed) and activity-log.php (the full log page).
//
//  Two sources, one shape (['type','label','detail','at','prop_key','actor']):
//    - activity_business_events(): inbound events derived from existing tables
//      (bookings, payments, enquiries, reviews, photos, sign-ups). Every query is
//      individually guarded — a not-yet-migrated table just contributes nothing.
//    - activity_logged_events(): owner/admin actions + site changes recorded in
//      the activity_log table (db.php's log_activity()).
// ============================================================
require_once __DIR__ . '/db.php';

// Inbound business events (the "what happened while I was away" set).
function activity_business_events($per = 12)
{
    $events = [];
    $push = function ($type, $label, $detail, $at, $propKey = '') use (&$events) {
        if (!$at) {
            return;
        }
        $events[] = [
            'type' => $type,
            'label' => $label,
            'detail' => $detail,
            'at' => $at,
            'prop_key' => $propKey,
            'actor' => 'guest',
        ];
    };
    $per = max(1, min(200, (int) $per));

    // New bookings (direct + back office)
    try {
        foreach (
            db()
                ->query(
                    "SELECT id, name, prop_key, check_in, check_out, agreed_total, created_at
                     FROM bookings ORDER BY created_at DESC LIMIT $per",
                )
                ->fetchAll()
            as $r
        ) {
            $amount = $r['agreed_total'] !== null ? '£' . number_format((float) $r['agreed_total'], 2) : '';
            $push(
                'booking',
                'New booking — ' . $r['name'],
                trim($r['check_in'] . ' → ' . $r['check_out'] . ($amount ? ' · ' . $amount : '')),
                $r['created_at'],
                $r['prop_key'],
            );
        }
    } catch (\Throwable $e) {
    }

    // Card payments through Square (deposit / balance / refunds)
    try {
        foreach (
            db()
                ->query(
                    "SELECT p.kind, p.amount, p.created_at, b.name, b.prop_key
                     FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
                     ORDER BY p.created_at DESC LIMIT $per",
                )
                ->fetchAll()
            as $r
        ) {
            $kind =
                $r['kind'] === 'refund'
                    ? 'Refund issued'
                    : ($r['kind'] === 'balance' ? 'Balance paid' : 'Deposit paid');
            $push(
                'payment',
                $kind . ($r['name'] ? ' — ' . $r['name'] : ''),
                '£' . number_format((float) $r['amount'], 2),
                $r['created_at'],
                $r['prop_key'] ?? '',
            );
        }
    } catch (\Throwable $e) {
    }

    // New enquiries
    try {
        foreach (
            db()
                ->query(
                    "SELECT name, prop_key, check_in, check_out, created_at
                     FROM enquiries ORDER BY created_at DESC LIMIT $per",
                )
                ->fetchAll()
            as $r
        ) {
            $push('enquiry', 'Enquiry — ' . $r['name'], $r['check_in'] . ' → ' . $r['check_out'], $r['created_at'], $r['prop_key']);
        }
    } catch (\Throwable $e) {
    }

    // Guest reviews submitted
    try {
        foreach (
            db()
                ->query(
                    "SELECT r.stars, r.status, r.created_at, r.prop_key, g.name
                     FROM guest_reviews r JOIN guests g ON g.id = r.guest_id
                     ORDER BY r.created_at DESC LIMIT $per",
                )
                ->fetchAll()
            as $r
        ) {
            $push(
                'review',
                'Review — ' . $r['name'] . ' · ' . (int) $r['stars'] . '★',
                $r['status'] === 'pending' ? 'waiting for approval' : $r['status'],
                $r['created_at'],
                $r['prop_key'],
            );
        }
    } catch (\Throwable $e) {
    }

    // Guest photos shared
    try {
        foreach (
            db()
                ->query(
                    "SELECT guest_name, status, created_at, prop_key
                     FROM guest_photos WHERE status <> 'rejected'
                     ORDER BY created_at DESC LIMIT $per",
                )
                ->fetchAll()
            as $r
        ) {
            $push(
                'photo',
                'Guest photo — ' . $r['guest_name'],
                $r['status'] === 'pending' ? 'waiting for approval' : $r['status'],
                $r['created_at'],
                $r['prop_key'],
            );
        }
    } catch (\Throwable $e) {
    }

    // Newsletter sign-ups
    try {
        foreach (
            db()
                ->query("SELECT email, created_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT $per")
                ->fetchAll()
            as $r
        ) {
            $push('signup', 'Newsletter sign-up', $r['email'], $r['created_at']);
        }
    } catch (\Throwable $e) {
    }

    return $events;
}

// Owner/admin actions + site changes from the activity_log table.
function activity_logged_events($limit = 200)
{
    $limit = max(1, min(1000, (int) $limit));
    $out = [];
    try {
        foreach (
            db()
                ->query(
                    "SELECT actor, category, action, summary, prop_key, meta, created_at
                     FROM activity_log ORDER BY id DESC LIMIT $limit",
                )
                ->fetchAll()
            as $r
        ) {
            $detail = '';
            if (!empty($r['meta'])) {
                $m = json_decode((string) $r['meta'], true);
                if (is_array($m) && isset($m['detail'])) {
                    $detail = (string) $m['detail'];
                }
            }
            $out[] = [
                'type' => $r['category'] ?: 'other',
                'label' => $r['summary'] ?: $r['action'],
                'detail' => $detail,
                'at' => $r['created_at'],
                'prop_key' => $r['prop_key'] ?? '',
                'actor' => $r['actor'] ?: 'system',
            ];
        }
    } catch (\Throwable $e) {
        // table not migrated yet → no logged actions
    }
    return $out;
}

// Merge both sources, newest first, with optional category + text filters.
function activity_merged($opts = [])
{
    $category = isset($opts['category']) ? (string) $opts['category'] : '';
    $q = isset($opts['q']) ? mb_strtolower(trim((string) $opts['q'])) : '';
    $limit = max(1, min(500, (int) ($opts['limit'] ?? 150)));

    $events = array_merge(activity_business_events(60), activity_logged_events(400));

    if ($category !== '' && $category !== 'all') {
        // 'business' groups the inbound guest events; otherwise match the type.
        $businessTypes = ['booking', 'payment', 'enquiry', 'review', 'photo', 'signup'];
        $events = array_values(
            array_filter($events, function ($e) use ($category, $businessTypes) {
                return $category === 'business'
                    ? in_array($e['type'], $businessTypes, true)
                    : $e['type'] === $category;
            }),
        );
    }
    if ($q !== '') {
        $events = array_values(
            array_filter($events, function ($e) use ($q) {
                return strpos(mb_strtolower($e['label'] . ' ' . $e['detail'] . ' ' . $e['actor']), $q) !== false;
            }),
        );
    }

    usort($events, fn($a, $b) => strcmp((string) $b['at'], (string) $a['at']));
    return array_slice($events, 0, $limit);
}
