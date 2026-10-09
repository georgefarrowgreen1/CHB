<?php
// ============================================================
//  money-lib.php — THE ONE MONEY LEDGER the Payments page reads.
//  Pure: no database, no clock unless one is passed. money.php gathers the
//  rows (the payments table, the Square payout cache, expenses, the sweep's
//  priced transactions and the accounts report) and these functions decide
//  what they say. Nothing here invents arithmetic: the position is the sweep's
//  own per-transaction figures, the books are the accounts report's own totals.
// ============================================================

// Statuses that mean money arrived (a card charge settled, or a payment the
// owner recorded by hand) and those that mean it never will.
const MONEY_IN_OK = ['COMPLETED', 'APPROVED', 'CAPTURED', 'MANUAL'];
const MONEY_FAILED = ['FAILED', 'REJECTED', 'CANCELED', 'CANCELLED'];

// One payments-table row as a ledger event, or null when it says nothing a
// person needs (a card charge that never completed, a zero row).
//   in      money from a guest (deposit / balance / a payment recorded by hand)
//   refund  a rental refund back to the guest
//   back    a refundable deposit returned
//   kept    a deposit the owner kept (income)
// `amount` for a card charge is what the CARD took: payments.amount is rental
// only, and the refundable deposit that rode the charge is added back (the sum
// the guest's statement shows), with `deposit` saying how much of it was that.
function money_event_from_payment(array $r): ?array
{
    $kind = (string) ($r['kind'] ?? '');
    $map = ['deposit' => 'in', 'balance' => 'in', 'manual' => 'in', 'refund' => 'refund', 'damages_return' => 'back', 'damages' => 'kept'];
    if (!isset($map[$kind])) {
        return null;
    }
    $type = $map[$kind];
    $status = strtoupper(trim((string) ($r['status'] ?? '')));
    $rental = round((float) ($r['amount'] ?? 0), 2);
    if ($rental <= 0.004) {
        return null;
    }
    if ($type === 'in' && !in_array($status, MONEY_IN_OK, true)) {
        return null; // a charge that did not complete moved no money
    }
    $carried = $type === 'in' ? round(max(0.0, (float) ($r['deposit_carried'] ?? 0)), 2) : 0.0;
    $what = [
        'deposit' => 'Deposit',
        'balance' => 'Balance',
        'manual' => 'Payment',
        'refund' => 'Refund',
        'damages_return' => 'Deposit returned',
        'damages' => 'Deposit kept',
    ][$kind];
    $note = trim((string) ($r['note'] ?? ''));
    return [
        'id' => 'p' . (int) ($r['id'] ?? 0),
        'at' => money_ts($r['created_at'] ?? ''),
        'kind' => $type,
        'what' => $what,
        'booking_id' => (int) ($r['booking_id'] ?? 0),
        'name' => (string) ($r['name'] ?? ''),
        'prop' => (string) ($r['prop_key'] ?? ''),
        'amount' => round($rental + $carried, 2),
        'deposit' => $carried,
        'fee' => ($r['fee'] ?? null) === null ? null : round((float) $r['fee'], 2),
        // A hand-recorded payment names how it came (its note holds the method).
        'method' => $kind === 'manual' ? ($note !== '' ? $note : 'Recorded by you') : 'card',
        'status' => in_array($status, MONEY_FAILED, true) ? 'failed' : (in_array($status, MONEY_IN_OK, true) ? 'done' : 'pending'),
        'sid' => (string) ($r['square_payment_id'] ?? ''),
    ];
}

// A Square payout from the cached Payouts API data. It is dated by its arrival
// day; one still to arrive is placed at `now` so the list shows it at the top,
// with its arrival named in words.
function money_event_from_payout(array $p, int $now): ?array
{
    $id = (string) ($p['id'] ?? '');
    $amount = $p['amount'] ?? null;
    if ($id === '' || $amount === null) {
        return null;
    }
    $arrival = (string) ($p['arrival_date'] ?? '');
    $status = strtoupper((string) ($p['status'] ?? ''));
    $landed = (int) ($p['landed_at'] ?? 0) > 0;
    $at = $arrival !== '' ? (int) strtotime($arrival . ' 06:00:00') : 0;
    $state = $status === 'FAILED' ? 'failed' : ($landed ? 'landed' : ($arrival !== '' ? 'way' : 'unknown'));
    return [
        'id' => 'o' . $id,
        'payout' => $id,
        'at' => $state === 'landed' ? $at : min($at ?: $now, $now),
        'kind' => 'payout',
        'amount' => round(abs((float) $amount), 2),
        'arrival' => $arrival,
        'state' => $state,
    ];
}

function money_event_from_expense(array $e): ?array
{
    $amount = round((float) ($e['amount'] ?? 0), 2);
    if ($amount <= 0.004) {
        return null;
    }
    return [
        'id' => 'x' . (int) ($e['id'] ?? 0),
        'at' => money_ts(($e['expense_date'] ?? '') . ' 12:00:00'),
        'kind' => 'expense',
        'what' => (string) ($e['category'] ?? 'General'),
        'who' => trim((string) ($e['description'] ?? '')),
        'prop' => (string) ($e['prop_key'] ?? ''),
        'amount' => $amount,
    ];
}

// The transfers the owner marked as moved out, one event per marking. The
// sweep's MOVED bucket carries each charge's movable figure and the time it was
// marked, so a marking reads as the sum it covered.
function money_moved_events(array $movedItems): array
{
    $by = [];
    foreach ($movedItems as $it) {
        $ts = (int) ($it['moved_at'] ?? 0);
        if ($ts <= 0) {
            continue;
        }
        $by[$ts] = ($by[$ts] ?? 0.0) + (float) ($it['movable'] ?? 0);
    }
    $out = [];
    foreach ($by as $ts => $sum) {
        if ($sum > 0.004) {
            $out[] = ['id' => 'm' . $ts, 'at' => $ts, 'kind' => 'moved', 'amount' => round($sum, 2)];
        }
    }
    return $out;
}

// Newest first, then capped. Ties keep a stable order by id so a refresh never
// shuffles two rows of the same minute.
function money_sort_events(array $events, int $limit = 80): array
{
    $events = array_values(array_filter($events));
    usort($events, fn($a, $b) => ($b['at'] <=> $a['at']) ?: strcmp((string) $b['id'], (string) $a['id']));
    return array_slice($events, 0, max(1, $limit));
}

// WHERE THE MONEY IS, read from the sweep's priced transactions (accounts.php's
// deposit_liability.payouts). Each item already knows its gross, Square's fee,
// what of its deposit has gone back and what is still fenced, and whether its
// payout has landed. Nothing is re-derived here:
//   with_square  settled money not yet in the bank (on its way, or not yet in a payout)
//   in_bank      settled money that has landed and has not been marked moved out,
//                less deposit money that has already gone back
//   ready        what of that is the owner's: the sweep's own movable figure
//   held         the gap between the two: guests' deposits still to go back
// A charge Square has not reported a payout for, taken more than this many days
// ago. Square pays out in a working day or two, so by then "with Square, in the next
// payout" is no longer a fair description of it — the screen asks the owner instead.
const MONEY_UNREPORTED_DAYS = 7;
function money_position(array $payouts, string $today = ''): array
{
    $items = is_array($payouts['items'] ?? null) ? $payouts['items'] : [];
    $sum = function (array $list, callable $f) {
        $t = 0.0;
        foreach ($list as $it) {
            $t += (float) $f($it);
        }
        return round($t, 2);
    };
    $inBankItems = $items['inBank'] ?? [];
    $waiting = array_merge($items['onWay'] ?? [], $items['unknown'] ?? []);
    $settled = fn($it) => (float) ($it['settled'] ?? 0) - (float) ($it['alreadyOut'] ?? 0);
    $inBank = $sum($inBankItems, $settled);
    $ready = round((float) ($payouts['inBank'] ?? 0), 2);
    $cut = $today !== '' ? gmdate('Y-m-d', (int) strtotime($today . ' 12:00:00 UTC') - MONEY_UNREPORTED_DAYS * 86400) : '';
    $unreported = array_values(array_filter($items['unknown'] ?? [], fn($it) => $cut !== '' && (string) ($it['paid_on'] ?? '') !== '' && (string) $it['paid_on'] < $cut));
    $lastMoved = 0;
    foreach ($items['moved'] ?? [] as $it) {
        $lastMoved = max($lastMoved, (int) ($it['moved_at'] ?? 0));
    }
    return [
        'with_square' => $sum($waiting, $settled),
        'with_square_count' => count($waiting),
        'unknown' => $sum($items['unknown'] ?? [], $settled),
        'unreported' => $sum($unreported, $settled),
        'unreported_count' => count($unreported),
        'next_arrival' => (string) ($payouts['nextArrival'] ?? ''),
        'in_bank' => $inBank,
        'ready' => min($ready, $inBank),
        'held' => round(max(0.0, $inBank - $ready), 2),
        'last_moved' => $lastMoved,
    ];
}

// UK tax-year quarter (0..3) of a Y-m-d date within the year that starts 6 April $year.
function money_quarter(string $ymd, int $year): ?int
{
    $t = strtotime($ymd . ' 12:00:00');
    if ($t === false) {
        return null;
    }
    $start = strtotime($year . '-04-06 00:00:00');
    $bounds = [strtotime($year . '-07-06'), strtotime($year . '-10-06'), strtotime(($year + 1) . '-01-06'), strtotime(($year + 1) . '-04-06')];
    if ($t < $start || $t >= $bounds[3]) {
        return null;
    }
    foreach ($bounds as $i => $b) {
        if ($t < $b) {
            return $i;
        }
    }
    return null;
}

// THE ONE PROFIT SUM. The accounts report's own totals (rental income on the day
// it arrived, deposits kept, Square's fees) less the year's expenses. The page,
// the statement and the CSV all read this rather than restating it.
function money_books(array $report, array $expenses, int $year): array
{
    $income = round((float) ($report['total'] ?? 0), 2);
    $kept = round((float) ($report['kept_deposits'] ?? 0), 2);
    $fees = round((float) ($report['card_fees'] ?? 0), 2);
    $byCat = [];
    $expTotal = 0.0;
    foreach ($expenses as $e) {
        $a = round((float) ($e['amount'] ?? 0), 2);
        $c = (string) ($e['category'] ?? 'General');
        $byCat[$c] = round(($byCat[$c] ?? 0) + $a, 2);
        $expTotal += $a;
    }
    arsort($byCat);
    $q = [0.0, 0.0, 0.0, 0.0];
    foreach (array_merge($report['income_days'] ?? [], $report['kept_days'] ?? []) as $d) {
        $i = money_quarter((string) ($d['date'] ?? ''), $year);
        if ($i !== null) {
            $q[$i] += (float) ($d['amount'] ?? 0);
        }
    }
    $expTotal = round($expTotal, 2);
    return [
        'year' => $year,
        'income' => $income,
        'kept' => $kept,
        'fees' => $fees,
        'expenses' => $expTotal,
        'profit' => round($income + $kept - $fees - $expTotal, 2),
        'quarters' => array_map(fn($v) => round($v, 2), $q),
        'by_category' => array_map(fn($k, $v) => ['category' => $k, 'amount' => $v], array_keys($byCat), array_values($byCat)),
        'undated' => $report['undated'] ?? null,
    ];
}

function money_ts($s): int
{
    $t = is_string($s) && trim($s) !== '' ? strtotime($s) : false;
    return $t === false ? 0 : (int) $t;
}
