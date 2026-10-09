<?php
// ============================================================
//  money.php — the Payments page's ONE door (admin only).
//
//  POST {action:'summary'}            -> where the money is, the tax year's books
//        and the first page of activity, in one reply. The figures are
//        accounts.php's own report (included, so the arithmetic exists once)
//        read through money-lib.php.
//  POST {action:'activity', before}   -> the next page of money movements.
//  POST {action:'stay', id}           -> one booking's payments, each with what
//        Square says about its payout.
//  POST {action:'payout', id}         -> one Square payout and the payments in it.
//  POST {action:'books', year}        -> one tax year's books.
//
//  Reads only. Square is never asked from here: fees and refund states are
//  settled by the daily job, the webhooks and "Check Square now", so a page
//  visit never waits on Square.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/money-lib.php';
require_once __DIR__ . '/payouts-lib.php';
require_admin();

// The accounts report for a tax year, from accounts.php itself.
function money_report(int $year): array
{
    $_GET['year'] = (string) $year;
    if (!defined('CHB_ACCOUNTS_AS_LIB')) {
        define('CHB_ACCOUNTS_AS_LIB', true);
    }
    $out = include __DIR__ . '/accounts.php';
    return is_array($out) ? $out : [];
}

function money_tax_year(int $ts): int
{
    $y = (int) date('Y', $ts);
    return $ts < strtotime($y . '-04-06 00:00:00') ? $y - 1 : $y;
}

function money_year_expenses(int $year): array
{
    try {
        $s = db()->prepare('SELECT id, category, description, amount, prop_key, expense_date FROM expenses WHERE expense_date >= ? AND expense_date < ? ORDER BY expense_date');
        $s->execute([$year . '-04-06', ($year + 1) . '-04-06']);
        return $s->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}

// The payments rows the ledger reads, each with the refundable deposit that rode
// the charge (payments.amount is rental-only; the card took both).
function money_payment_rows(string $where, array $args, int $limit): array
{
    try {
        $s = db()->prepare(
            "SELECT p.id, p.booking_id, p.square_payment_id, p.kind, p.amount, p.fee, p.status, p.note, p.created_at,
                    COALESCE(b.name, p.guest_name, '') AS name, COALESCE(b.prop_key, p.prop_key, '') AS prop_key,
                    CASE WHEN b.hold_payment_id = p.square_payment_id AND p.kind IN ('deposit','balance')
                              AND b.hold_status IN ('charged','captured','returned','kept')
                         THEN COALESCE(b.hold_amount, 0) ELSE 0 END AS deposit_carried
               FROM payments p
               LEFT JOIN bookings b ON b.id = p.booking_id
              WHERE $where
              ORDER BY p.created_at DESC, p.id DESC
              LIMIT " . max(1, min(200, $limit)),
        );
        $s->execute($args);
        return $s->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}

function money_payout_state(array $map, string $sid): ?array
{
    if ($sid === '' || !isset($map[$sid])) {
        return null;
    }
    $c = $map[$sid];
    return [
        'payout' => (string) ($c['payout_id'] ?? ''),
        'arrival' => (string) ($c['arrival'] ?? ''),
        'landed' => $c['landed'] ?? null,
        'fee' => $c['fee'] ?? null,
    ];
}

// Every movement before $before, newest first.
function money_activity(int $before, array $movedItems, int $limit = 80): array
{
    $cache = payouts_cached();
    $map = is_array($cache) ? ($cache['charges'] ?? []) : [];
    $events = [];
    foreach (money_payment_rows('p.created_at < ?', [date('Y-m-d H:i:s', $before)], $limit) as $r) {
        $e = money_event_from_payment($r);
        if ($e) {
            $e['payout'] = money_payout_state(is_array($map) ? $map : [], (string) ($r['square_payment_id'] ?? ''));
            unset($e['sid']);
            $events[] = $e;
        }
    }
    foreach ((is_array($cache) ? ($cache['payouts'] ?? []) : []) as $p) {
        $e = money_event_from_payout($p, time());
        if ($e && $e['at'] < $before) {
            $events[] = $e;
        }
    }
    try {
        $s = db()->prepare('SELECT id, category, description, amount, prop_key, expense_date FROM expenses WHERE expense_date < ? ORDER BY expense_date DESC, id DESC LIMIT ' . max(1, min(200, $limit)));
        $s->execute([date('Y-m-d', $before + 86400)]);
        foreach ($s->fetchAll() as $x) {
            $e = money_event_from_expense($x);
            if ($e && $e['at'] < $before) {
                $events[] = $e;
            }
        }
    } catch (\Throwable $e) {
    }
    foreach (money_moved_events($movedItems) as $e) {
        if ($e['at'] < $before) {
            $events[] = $e;
        }
    }
    return money_sort_events($events, $limit);
}

// The priced transactions behind each figure, slimmed to what the screen shows.
function money_items(array $list): array
{
    return array_values(array_map(fn($it) => [
        // the key the owner's moved-out marks are stored under (sweep-moved)
        'txn_id' => (int) ($it['txn_id'] ?? 0),
        'booking_id' => (int) ($it['booking_id'] ?? 0),
        'name' => (string) ($it['name'] ?? ''),
        'prop' => (string) ($it['prop_key'] ?? ''),
        'paid_on' => (string) ($it['paid_on'] ?? ''),
        'gross' => round((float) ($it['gross'] ?? 0), 2),
        'fee' => round((float) ($it['fee'] ?? 0), 2),
        'settled' => round((float) ($it['settled'] ?? 0) - (float) ($it['alreadyOut'] ?? 0), 2),
        'fenced' => round((float) ($it['ringFence'] ?? 0), 2),
        'movable' => round((float) ($it['movable'] ?? 0), 2),
        'arrival' => (string) ($it['arrival'] ?? ''),
        'moved_at' => (int) ($it['moved_at'] ?? 0),
    ], $list));
}

route_actions([
    'summary' => function ($in) {
        $year = money_tax_year(time());
        $report = money_report($year);
        $liab = is_array($report['deposit_liability'] ?? null) ? $report['deposit_liability'] : [];
        $po = is_array($liab['payouts'] ?? null) ? $liab['payouts'] : [];
        $items = is_array($po['items'] ?? null) ? $po['items'] : [];
        json_out([
            'ok' => true,
            'at' => time(),
            'position' => money_position($po) + [
                'error' => !empty($liab['error']),
                'checked' => (int) ($po['checked'] ?? 0),
                'payout_error' => $po['error'] ?? null,
                'failed' => $po['failed'] ?? [],
                'disputes' => $liab['disputes'] ?? null,
                // Named only when there is ONE account: Square does not say which
                // of several it pays into (the bank-lib rule).
                'bank' => (int) ($liab['bank']['count'] ?? 0) === 1 ? (string) ($liab['bank']['label'] ?? '') : '',
            ],
            'bank_items' => money_items($items['inBank'] ?? []),
            // the WHOLE stored record of moved-out marks, which the page amends and
            // saves back (the payouts-lib rule: never rebuild it from visible rows)
            'moved_map' => $po['movedMap'] ?? (object) [],
            'way_items' => money_items(array_merge($items['onWay'] ?? [], $items['unknown'] ?? [])),
            'books' => money_books($report, money_year_expenses($year), $year),
            'years' => $report['years'] ?? [$year],
            'activity' => money_activity(time() + 86400 * 7, $items['moved'] ?? []),
        ]);
    },
    'activity' => function ($in) {
        $before = (int) ($in['before'] ?? 0);
        if ($before <= 0) {
            json_out(['error' => 'Missing the point to page from'], 400);
        }
        json_out(['ok' => true, 'activity' => money_activity($before, [])]);
    },
    'stay' => function ($in) {
        $id = (int) ($in['id'] ?? 0);
        if ($id <= 0) {
            json_out(['error' => 'Missing booking id'], 400);
        }
        $cache = payouts_cached();
        $map = is_array($cache) ? ($cache['charges'] ?? []) : [];
        $rows = [];
        foreach (array_reverse(money_payment_rows('p.booking_id = ?', [$id], 100)) as $r) {
            $e = money_event_from_payment($r);
            if (!$e) {
                // A card charge that failed still belongs in the stay's own story.
                if (strtoupper((string) ($r['status'] ?? '')) !== '' && in_array($r['kind'] ?? '', ['deposit', 'balance'], true)) {
                    $rows[] = ['id' => 'p' . (int) $r['id'], 'at' => money_ts($r['created_at'] ?? ''), 'kind' => 'in', 'what' => ucfirst((string) $r['kind']), 'amount' => round((float) $r['amount'], 2), 'status' => 'failed', 'method' => 'card'];
                }
                continue;
            }
            $e['payout'] = money_payout_state(is_array($map) ? $map : [], (string) ($r['square_payment_id'] ?? ''));
            unset($e['sid']);
            $rows[] = $e;
        }
        json_out(['ok' => true, 'id' => $id, 'events' => $rows]);
    },
    'payout' => function ($in) {
        $pid = trim((string) ($in['id'] ?? ''));
        if ($pid === '' || strlen($pid) > 80) {
            json_out(['error' => 'Missing payout id'], 400);
        }
        $cache = payouts_cached();
        $payout = null;
        foreach ((is_array($cache) ? ($cache['payouts'] ?? []) : []) as $p) {
            if ((string) ($p['id'] ?? '') === $pid) {
                $payout = money_event_from_payout($p, time());
            }
        }
        if (!$payout) {
            json_out(['error' => 'That payout is not in the last ' . PAYOUTS_LOOKBACK_DAYS . ' days of Square data'], 404);
        }
        $sids = [];
        foreach ((is_array($cache) ? ($cache['charges'] ?? []) : []) as $sid => $c) {
            if ((string) ($c['payout_id'] ?? '') === $pid) {
                $sids[(string) $sid] = $c['fee'] ?? null;
            }
        }
        $charges = [];
        if ($sids) {
            $marks = implode(',', array_fill(0, count($sids), '?'));
            foreach (money_payment_rows("p.square_payment_id IN ($marks)", array_keys($sids), 100) as $r) {
                $e = money_event_from_payment($r);
                if ($e) {
                    $fee = $sids[(string) $r['square_payment_id']] ?? null;
                    if ($fee !== null) {
                        $e['fee'] = round((float) $fee, 2);
                    }
                    unset($e['sid']);
                    $charges[] = $e;
                }
            }
        }
        json_out(['ok' => true, 'payout' => $payout, 'charges' => array_reverse($charges), 'unmatched' => max(0, count($sids) - count($charges))]);
    },
    'books' => function ($in) {
        $year = (int) ($in['year'] ?? 0);
        if ($year < 2000 || $year > 2100) {
            json_out(['error' => 'Missing the tax year'], 400);
        }
        $report = money_report($year);
        json_out(['ok' => true, 'books' => money_books($report, money_year_expenses($year), $year), 'years' => $report['years'] ?? [$year]]);
    },
]);
