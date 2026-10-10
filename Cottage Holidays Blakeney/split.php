<?php
// ============================================================
//  split.php — whose money is whose (Payments). The decisions are split-lib.php.
//
//  POST {action:'status'}                    -> the figures for whoever is signed in:
//        a paid-out host gets their cottages' money, what has been sent to them and
//        the bookings still owed; anyone else gets the account's cottages, costs and
//        profit, and what each paid-out host is still owed
//  POST {action:'settings', holder, hosts}   -> whose account it is, and who hosts
//                                               each cottage (full access)
//  POST {action:'link', admin_id, name}      -> payments out to this name are this
//                                               person's money (full access)
//  POST {action:'unlink', admin_id, name}    -> not any more (full access)
//
//  The figures come from the books (accounts.php, read as a library, so the
//  income arithmetic exists once), the payments ledger's card fees, and the bank
//  lines: platform payouts matched to a cottage, and transfers to a person.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/split-store.php';
require_admin();

function split_report(int $year): array
{
    static $memo = [];
    if (!isset($memo[$year])) {
        $_GET['year'] = (string) $year;
        if (!defined('CHB_ACCOUNTS_AS_LIB')) {
            define('CHB_ACCOUNTS_AS_LIB', true);
        }
        $out = include __DIR__ . '/accounts.php';
        $memo[$year] = is_array($out) ? $out : [];
    }
    return $memo[$year];
}
function split_people(): array
{
    $out = [];
    try {
        foreach (db()->query('SELECT * FROM admins WHERE removed_at IS NULL ORDER BY id')->fetchAll() as $r) {
            $out[(int) $r['id']] = ['id' => (int) $r['id'], 'name' => people_display_name($r), 'first' => people_first_name($r)];
        }
    } catch (\Throwable $e) {
    }
    return $out;
}
// $all: archived cottages too. The FIGURES need them — an archived cottage still
// earned this year's money, and leaving it out dropped its income from the holder's
// profit while its costs stayed — but nobody is asked to host one.
function split_cottage_list(bool $all = false): array
{
    $out = [];
    try {
        foreach (db()->query('SELECT prop_key, name FROM properties' . ($all ? '' : ' WHERE archived_at IS NULL') . ' ORDER BY sort_order, prop_key')->fetchAll() as $r) {
            $out[(string) $r['prop_key']] = (string) $r['name'];
        }
    } catch (\Throwable $e) {
        try {
            foreach (db()->query('SELECT prop_key, name FROM properties ORDER BY prop_key')->fetchAll() as $r) {
                $out[(string) $r['prop_key']] = (string) $r['name'];
            }
        } catch (\Throwable $e2) {
        }
    }
    return $out;
}
function split_in(array $ids): string
{
    return implode(',', array_fill(0, max(1, count($ids)), '?'));
}
// Card fees per cottage between two dates (Square keeps them; a cost of the stay).
function split_fees_by_prop(string $from, string $to): array
{
    $out = [];
    try {
        // LEFT JOIN: a cancelled stay's booking is gone but its fee was still taken,
        // and the ledger row carries the cottage.
        $q = db()->prepare("SELECT COALESCE(b.prop_key, p.prop_key) k, ROUND(SUM(p.fee),2) f FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
            WHERE p.fee IS NOT NULL AND p.fee > 0 AND p.kind NOT IN ('refund','damages_return')
              AND UPPER(p.status) IN ('COMPLETED','APPROVED','CAPTURED') AND p.created_at >= ? AND p.created_at < ?
            GROUP BY COALESCE(b.prop_key, p.prop_key)");
        $q->execute([$from, $to]);
        foreach ($q->fetchAll() as $r) {
            $out[(string) $r['k']] = (float) $r['f'];
        }
    } catch (\Throwable $e) {
    }
    return $out;
}
// Platform payouts matched to a cottage on the bank page, between two dates.
function split_platform_lines(string $from, string $to): array
{
    if (!split_cols_ready()) {
        return [];
    }
    try {
        $q = db()->prepare("SELECT id, txn_date, amount, name, sorted_label, sorted_at, prop_key FROM bank_lines
            WHERE sorted_as = 'platform' AND prop_key IS NOT NULL AND prop_key <> '' AND txn_date >= ? AND txn_date < ? ORDER BY txn_date");
        $q->execute([$from, $to]);
        return $q->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}
// Transfers to a person since a date, newest first.
function split_sent_lines(int $id, string $since): array
{
    if (!split_cols_ready()) {
        return [];
    }
    try {
        $q = db()->prepare("SELECT id, txn_date, amount, name, description, notes FROM bank_lines
            WHERE sorted_as = 'person' AND admin_id = ? AND txn_date >= ? ORDER BY txn_date DESC, id DESC");
        $q->execute([$id, $since]);
        return $q->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}
// The money a person's cottages brought in since a date, as it was counted: each
// booking's income on the days it arrived (accounts.php's own allocation), less
// the card fee taken that day, plus each platform payout matched to the cottages.
// $kept: accounts.php's kept deposits per booking (kept_by_booking), every year.
function split_items(array $props, string $since, string $until, array $kept = []): array
{
    $items = [];
    if (!$props || !function_exists('allocate_income_by_day')) {
        return $items;
    }
    try {
        // A stay refunded in full reads £0 paid but still has money in and money out.
        $q = db()->prepare("SELECT * FROM bookings b WHERE (b.deposit_paid > 0 OR EXISTS (SELECT 1 FROM payments r WHERE r.booking_id = b.id AND r.kind = 'refund')) AND b.prop_key IN (" . split_in($props) . ')');
        $q->execute($props);
        $bookings = $q->fetchAll();
    } catch (\Throwable $e) {
        return $items;
    }
    $ids = array_map(fn($b) => (int) $b['id'], $bookings);
    $card = [];
    $fees = [];
    $refunds = [];
    if ($ids) {
        try {
            $c = db()->prepare("SELECT booking_id, DATE(created_at) d, ROUND(SUM(amount),2) a FROM payments
                WHERE ((kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')) OR (kind = 'manual' AND UPPER(status) = 'MANUAL'))
                  AND booking_id IN (" . split_in($ids) . ') GROUP BY booking_id, DATE(created_at) ORDER BY booking_id, d');
            $c->execute($ids);
            foreach ($c->fetchAll() as $r) {
                $card[(int) $r['booking_id']][] = [$r['d'], (float) $r['a']];
            }
            $f = db()->prepare("SELECT booking_id, DATE(created_at) d, ROUND(SUM(fee),2) f FROM payments
                WHERE fee IS NOT NULL AND fee > 0 AND kind NOT IN ('refund','damages_return') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
                  AND booking_id IN (" . split_in($ids) . ') GROUP BY booking_id, DATE(created_at)');
            $f->execute($ids);
            foreach ($f->fetchAll() as $r) {
                $fees[(int) $r['booking_id']][(string) $r['d']] = (float) $r['f'];
            }
            $rf = db()->prepare("SELECT booking_id, DATE(created_at) d, ROUND(SUM(amount),2) a FROM payments
                WHERE kind = 'refund' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED'))
                  AND booking_id IN (" . split_in($ids) . ') GROUP BY booking_id, DATE(created_at) ORDER BY booking_id, d');
            $rf->execute($ids);
            foreach ($rf->fetchAll() as $r) {
                $refunds[(int) $r['booking_id']][] = [$r['d'], (float) $r['a']];
            }
        } catch (\Throwable $e) {
        }
    }
    foreach ($bookings as $b) {
        $bid = (int) $b['id'];
        $received = (float) $b['deposit_paid'];
        $rental = booking_rental_price($b);
        $income = $rental > 0 ? min($received, $rental) : $received;
        // Refunds come off on the day they went back (the books' rule), so money handed
        // back reduces what the host is owed rather than vanishing from the figures.
        $days = allocate_income_by_day($income, $card[$bid] ?? [], $b['payment_date'], $refunds[$bid] ?? []);
        $bf = $fees[$bid] ?? [];
        $lastIn = -1;
        foreach ($days as $i => $row) {
            if ((float) $row['a'] > 0) {
                $lastIn = $i;
            }
        }
        foreach ($days as $i => $row) {
            $d = (string) $row['d'];
            $amt = (float) $row['a'] - ($bf[$d] ?? 0);
            unset($bf[$d]);
            if ($i === ($lastIn >= 0 ? $lastIn : count($days) - 1)) {
                $amt -= array_sum($bf); // a fee on a day the income didn't land: the stay's cost all the same
                $bf = [];
            }
            if ($d < $since || $d >= $until) {
                continue;
            }
            $items[] = [
                'key' => 'b' . $bid, 'booking_id' => $bid, 'name' => (string) $b['name'], 'prop' => (string) $b['prop_key'],
                'stay' => split_stay((string) $b['check_in'], (string) $b['check_out']),
                'date' => $d, 'counted' => $d . ' 12:00:00', 'amount' => round($amt, 2),
            ];
        }
    }
    // CANCELLED STAYS on these cottages. Cancelling deletes the booking, but its ledger
    // rows keep the cottage, and what was kept (less its card fee) is still this
    // cottage's money: it used to land on the account holder, fee dropped. Each day as
    // it happened, refunds included (the books' rule), so a stay refunded in full nets
    // to its fee. Refunds beyond what the ledger shows came in leave only the fees.
    try {
        $oq = db()->prepare("SELECT booking_id, MAX(guest_name) nm, MAX(prop_key) pk, DATE(created_at) d,
              ROUND(COALESCE(SUM(CASE WHEN (kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')) OR (kind = 'manual' AND UPPER(status) = 'MANUAL') THEN amount ELSE 0 END),0),2) charged,
              ROUND(COALESCE(SUM(CASE WHEN kind = 'refund' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0),2) refunded,
              ROUND(COALESCE(SUM(CASE WHEN fee IS NOT NULL AND fee > 0 AND kind NOT IN ('refund','damages_return') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED') THEN fee ELSE 0 END),0),2) fee
            FROM payments WHERE prop_key IN (" . split_in($props) . ') AND booking_id NOT IN (SELECT id FROM bookings)
            GROUP BY booking_id, DATE(created_at) ORDER BY booking_id, d');
        $oq->execute($props);
        $orph = [];
        foreach ($oq->fetchAll() as $r) {
            $orph[(int) $r['booking_id']][] = $r;
        }
        foreach ($orph as $obid => $orows) {
            $kept0 = array_sum(array_map(fn($r) => (float) $r['charged'] - (float) $r['refunded'], $orows)) >= -0.005;
            foreach ($orows as $r) {
                $d = (string) $r['d'];
                $amt = round(($kept0 ? (float) $r['charged'] - (float) $r['refunded'] : 0.0) - (float) $r['fee'], 2);
                if (abs($amt) <= 0.005 || $d < $since || $d >= $until) {
                    continue;
                }
                $items[] = [
                    'key' => 'c' . $obid, 'booking_id' => $obid, 'name' => trim((string) $r['nm']) . ' (cancelled)', 'prop' => (string) $r['pk'],
                    'stay' => '', 'date' => $d, 'counted' => $d . ' 12:00:00', 'amount' => $amt,
                ];
            }
        }
    } catch (\Throwable $e) {
    }
    // KEPT DEPOSITS are income (the books count them), so a deposit kept for damage at
    // a host's cottage is that host's money; it used to count for nobody.
    $live = [];
    foreach ($bookings as $b) {
        $live[(int) $b['id']] = (string) $b['name'];
    }
    foreach ($kept as $kbid => $k) {
        if (!in_array((string) ($k['prop'] ?? ''), $props, true)) {
            continue;
        }
        foreach ((array) ($k['days'] ?? []) as $kd) {
            $d = (string) ($kd[0] ?? '');
            if ($d < $since || $d >= $until) {
                continue;
            }
            $kbid = (int) $kbid;
            $items[] = [
                'key' => (isset($live[$kbid]) ? 'b' : 'c') . $kbid, 'booking_id' => $kbid, 'name' => ($live[$kbid] ?? 'A guest') . ' · deposit kept', 'prop' => (string) $k['prop'],
                'stay' => '', 'date' => $d, 'counted' => $d . ' 12:00:00', 'amount' => round((float) ($kd[1] ?? 0), 2),
            ];
        }
    }
    foreach (split_platform_lines($since, $until) as $l) {
        if (!in_array((string) $l['prop_key'], $props, true)) {
            continue;
        }
        $items[] = [
            'key' => 'l' . (int) $l['id'], 'booking_id' => 0, 'name' => (string) ($l['sorted_label'] ?: $l['name']), 'prop' => (string) $l['prop_key'],
            'stay' => '', 'date' => (string) $l['txn_date'], 'counted' => (string) ($l['sorted_at'] ?: $l['txn_date'] . ' 12:00:00'), 'amount' => round((float) $l['amount'], 2),
        ];
    }
    return $items;
}
// One paid-out person's figures.
function split_person(array $cfg, array $person, array $names, string $since, string $yearFrom, string $until, array $kept = []): array
{
    $props = split_cottages_of($cfg, $person['id']);
    $items = split_items($props, $since, $until, $kept);
    $share = round(array_sum(array_column($items, 'amount')), 2);
    $lines = split_sent_lines($person['id'], $since);
    $sent = round(-array_sum(array_map(fn($l) => (float) $l['amount'], $lines)), 2);
    $sentYear = round(-array_sum(array_map(fn($l) => (float) $l['amount'], array_filter($lines, fn($l) => (string) $l['txn_date'] >= $yearFrom))), 2);
    $due = array_map(fn($it) => ['booking_id' => $it['booking_id'], 'name' => $it['name'], 'prop' => $it['prop'], 'stay' => $it['stay'], 'amount' => $it['amount']], split_allocate($items, $sent));
    return [
        'id' => $person['id'],
        'name' => $person['name'],
        'first' => $person['first'],
        'cottages' => array_map(fn($k) => ['k' => $k, 'name' => $names[$k] ?? $k], $props),
        'payees' => $cfg['payees'][$person['id']] ?? [],
        'share' => $share,
        'sent' => $sent,
        'sent_year' => $sentYear,
        'owed' => round($share - $sent, 2),
        'due' => $due,
        'payments' => array_map(fn($l) => [
            'id' => (int) $l['id'], 'date' => (string) $l['txn_date'], 'amount' => round(-(float) $l['amount'], 2),
            'ref' => trim((string) ($l['description'] ?: $l['notes'] ?: $l['name'])),
        ], array_slice($lines, 0, 60)),
    ];
}
// Unsorted payments out that look like a person's own name: offered, never assumed.
function split_candidates(array $person): array
{
    if (!split_cols_ready()) {
        return ['exact' => ['count' => 0, 'total' => 0, 'name' => ''], 'like' => []];
    }
    $exact = ['count' => 0, 'total' => 0.0, 'name' => ''];
    $like = [];
    try {
        foreach (db()->query('SELECT id, name, amount FROM bank_lines WHERE sorted_as IS NULL AND amount < 0 ORDER BY txn_date DESC LIMIT 500')->fetchAll() as $l) {
            if (split_norm((string) $l['name']) === split_norm($person['name'])) {
                $exact['count']++;
                $exact['total'] += -(float) $l['amount'];
                $exact['name'] = $exact['name'] ?: (string) $l['name'];
            } elseif (split_name_like((string) $l['name'], $person['name'])) {
                $like[(string) $l['name']] = true;
            }
        }
    } catch (\Throwable $e) {
    }
    $exact['total'] = round($exact['total'], 2);
    return ['exact' => $exact, 'like' => array_slice(array_keys($like), 0, 5)];
}

route_actions([
    'status' => function ($in) {
        $cfg = split_cfg();
        $me = (int) ($_SESSION['admin_id'] ?? 0);
        $people = split_people();
        $names = split_cottage_list();
        $today = date('Y-m-d');
        $year = split_tax_year($today);
        $yearFrom = $year . '-04-06';
        $until = ($year + 1) . '-04-06';
        $since = $cfg['since'] ?: $yearFrom;
        $role = split_cols_ready() ? split_role($cfg, $me) : 'none';
        $out = [
            'ok' => true,
            'ready' => split_cols_ready(),
            'on' => $role !== 'none',
            'role' => $role,
            'year' => $year,
            'since' => $since,
            'holder' => $cfg['holder'],
            'hosts' => (object) $cfg['hosts'],
            'payees' => (object) $cfg['payees'],
            'people' => array_values($people),
            'cottages' => array_map(fn($k, $n) => ['k' => $k, 'name' => $n], array_keys($names), array_values($names)),
        ];
        if ($role === 'none') {
            json_out($out);
        }
        $report = split_report($year);
        $kept = (array) ($report['kept_by_booking'] ?? []);
        // The figures include archived cottages (their money and costs are still this
        // year's); the cottage list above, for choosing hosts, does not.
        $allNames = split_cottage_list(true) ?: $names;
        if ($role === 'paid') {
            $person = $people[$me] ?? ['id' => $me, 'name' => 'You', 'first' => 'You'];
            $out['me'] = split_person($cfg, $person, $allNames, $since, $yearFrom, $until, $kept);
            if (!$out['me']['payees']) {
                $out['me']['candidates'] = split_candidates($person);
            }
            $h = $people[$cfg['holder']] ?? null;
            $out['holder_first'] = $h ? $h['first'] : 'the account holder';
            json_out($out);
        }
        // Everyone else sees the account's side: its cottages, costs and profit.
        $income = [];
        $other = 0.0;
        foreach ((array) ($report['payments'] ?? []) as $r) {
            $k = (string) ($r['prop_key'] ?? '');
            if ($k === '') {
                $other += (float) ($r['income_part'] ?? 0);
            } else {
                $income[$k] = ($income[$k] ?? 0) + (float) ($r['income_part'] ?? 0);
            }
        }
        $fees = split_fees_by_prop($yearFrom, $until);
        $plat = [];
        foreach (split_platform_lines($yearFrom, $until) as $l) {
            $plat[(string) $l['prop_key']] = ($plat[(string) $l['prop_key']] ?? 0) + (float) $l['amount'];
        }
        // Deposits kept for damage this tax year, by cottage: income, as the books say.
        $keptBy = [];
        foreach ($kept as $kk) {
            foreach ((array) ($kk['days'] ?? []) as $kd) {
                $d = (string) ($kd[0] ?? '');
                if ($d >= $yearFrom && $d < $until) {
                    $keptBy[(string) ($kk['prop'] ?? '')] = ($keptBy[(string) ($kk['prop'] ?? '')] ?? 0) + (float) ($kd[1] ?? 0);
                }
            }
        }
        $other += $keptBy[''] ?? 0;
        $mine = split_holder_cottages($cfg, array_keys($allNames));
        $rows = [];
        $sum = 0.0;
        foreach ($mine as $k) {
            $net = round(($income[$k] ?? 0) + ($plat[$k] ?? 0) + ($keptBy[$k] ?? 0) - ($fees[$k] ?? 0), 2);
            $rows[] = ['k' => $k, 'name' => $allNames[$k] ?? $k, 'net' => $net, 'host' => $cfg['hosts'][$k] ?? 0];
            $sum += $net;
        }
        // The account's costs: every expense recorded, except one tagged to a cottage
        // somebody else is paid out for (that host pays its costs from their own money).
        $costs = 0.0;
        $theirs = array_values(array_diff(array_keys($allNames), $mine));
        try {
            $q = db()->prepare('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE expense_date >= ? AND expense_date < ?'
                . ($theirs ? ' AND (prop_key IS NULL OR prop_key NOT IN (' . split_in($theirs) . '))' : ''));
            $q->execute(array_merge([$yearFrom, $until], $theirs));
            $costs = (float) $q->fetchColumn();
        } catch (\Throwable $e) {
        }
        $out['mine'] = $rows;
        $out['other'] = round($other, 2);
        $out['costs'] = round($costs, 2);
        $out['profit'] = round($sum + $other - $costs, 2);
        $out['paid_out'] = array_map(
            fn($id) => split_person($cfg, $people[$id] ?? ['id' => $id, 'name' => 'Someone', 'first' => 'Someone'], $allNames, $since, $yearFrom, $until, $kept),
            split_paid_out($cfg),
        );
        json_out($out);
    },

    'settings' => function ($in) {
        if (!admin_is_full()) {
            json_out(['error' => 'Only a Super User changes whose money is whose.', 'code' => 'not_allowed'], 403);
        }
        if (!split_cols_ready()) {
            json_out(['error' => 'This needs a database update first. Open Manage → Status and run the updates.'], 409);
        }
        $people = split_people();
        $names = split_cottage_list();
        $cfg = split_cfg();
        $holder = (int) ($in['holder'] ?? $cfg['holder']);
        if ($holder && !isset($people[$holder])) {
            json_out(['error' => 'That person can’t hold the account.'], 400);
        }
        $hosts = $cfg['hosts'];
        foreach ((is_array($in['hosts'] ?? null) ? $in['hosts'] : []) as $k => $id) {
            $k = (string) $k;
            if (!isset($names[$k])) {
                json_out(['error' => 'There’s no cottage like that.'], 400);
            }
            $id = (int) $id;
            if ($id <= 0) {
                unset($hosts[$k]);
            } elseif (!isset($people[$id])) {
                json_out(['error' => 'That person can’t host a cottage.'], 400);
            } else {
                $hosts[$k] = $id;
            }
        }
        $cfg['holder'] = $holder;
        $cfg['hosts'] = $hosts;
        if ($cfg['since'] === '') {
            $cfg['since'] = split_tax_year(date('Y-m-d')) . '-04-06';
        }
        split_cfg_save($cfg);
        log_activity('payment', 'split.settings', 'Whose money is whose was changed', ['entity' => 'split']);
        json_out(['ok' => true]);
    },

    'link' => function ($in) {
        if (!admin_is_full()) {
            json_out(['error' => 'Only a Super User links a name to someone.', 'code' => 'not_allowed'], 403);
        }
        if (!split_cols_ready()) {
            json_out(['error' => 'This needs a database update first. Open Manage → Status and run the updates.'], 409);
        }
        $cfg = split_cfg();
        $id = (int) ($in['admin_id'] ?? 0);
        $name = trim(clean((string) ($in['name'] ?? '')));
        if (!in_array($id, split_paid_out($cfg), true)) {
            json_out(['error' => 'Only someone who is paid out can have a name linked.'], 400);
        }
        if ($name === '' || split_norm($name) === '' || mb_strlen($name) > 160) {
            json_out(['error' => 'Type the name the bank shows.'], 400);
        }
        $cfg['payees'][$id] = array_values(array_unique(array_merge($cfg['payees'][$id] ?? [], [$name])));
        split_cfg_save($cfg);
        // Payments already here to exactly that name are theirs too.
        $n = 0;
        $total = 0.0;
        $ids = [];
        $up = db()->prepare("UPDATE bank_lines SET sorted_as = 'person', admin_id = ?, sorted_label = ?, sorted_at = NOW() WHERE id = ? AND sorted_as IS NULL");
        foreach (db()->query('SELECT id, name, amount FROM bank_lines WHERE sorted_as IS NULL AND amount < 0')->fetchAll() as $l) {
            if (split_norm((string) $l['name']) === split_norm($name)) {
                $up->execute([$id, 'Paid to ' . (string) $l['name'], (int) $l['id']]);
                if ($up->rowCount() > 0) {
                    $n++;
                    $total += -(float) $l['amount'];
                    $ids[] = (int) $l['id'];
                }
            }
        }
        log_activity('payment', 'split.link', 'Payments to ' . $name . ' now count as paid to ' . (split_people()[$id]['name'] ?? 'them'), ['entity' => 'split']);
        // Which lines THIS link sorted, so its Undo puts back only those.
        json_out(['ok' => true, 'count' => $n, 'total' => round($total, 2), 'ids' => $ids]);
    },

    'unlink' => function ($in) {
        if (!admin_is_full()) {
            json_out(['error' => 'Only a Super User unlinks a name.', 'code' => 'not_allowed'], 403);
        }
        $cfg = split_cfg();
        $id = (int) ($in['admin_id'] ?? 0);
        $name = trim((string) ($in['name'] ?? ''));
        $cfg['payees'][$id] = array_values(array_filter($cfg['payees'][$id] ?? [], fn($x) => split_norm($x) !== split_norm($name)));
        if (!$cfg['payees'][$id]) {
            unset($cfg['payees'][$id]);
        }
        split_cfg_save($cfg);
        $n = 0;
        // An UNDO of a link names the lines that link sorted: only those go back to sort,
        // never one sorted to this person by hand before the name was linked (that used
        // to drop it too, and "sent to George" fell from £400 to £0 instead of back to £400).
        $only = isset($in['ids']) && is_array($in['ids']) ? array_map('intval', $in['ids']) : null;
        if (split_cols_ready()) {
            $up = db()->prepare('UPDATE bank_lines SET sorted_as = NULL, admin_id = NULL, sorted_label = NULL, sorted_at = NULL WHERE id = ?');
            $q = db()->prepare("SELECT id, name FROM bank_lines WHERE sorted_as = 'person' AND admin_id = ?");
            $q->execute([$id]);
            foreach ($q->fetchAll() as $l) {
                if ($only !== null && !in_array((int) $l['id'], $only, true)) {
                    continue;
                }
                if (split_norm((string) $l['name']) === split_norm($name)) {
                    $up->execute([(int) $l['id']]);
                    $n++;
                }
            }
        }
        log_activity('payment', 'split.unlink', 'Payments to ' . $name . ' no longer count as paid to anyone', ['entity' => 'split']);
        json_out(['ok' => true, 'count' => $n]);
    },
]);
