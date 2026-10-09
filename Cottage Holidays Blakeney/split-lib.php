<?php
// ============================================================
//  split-lib.php — whose money is whose, PURE.
//
//  Every guest payment lands in one bank account, the HOLDER's. Each cottage has a
//  host. A host who is not the holder is PAID OUT: the holder sends them their
//  cottages' money by bank transfer, to a name they have confirmed is theirs.
//  So, for each paid-out person:
//      their money  = their cottages' booking money, after Square's card fees
//                     (and any platform payout matched to those cottages)
//      sent         = transfers out of the account to their linked name
//      still owed   = their money − sent, and the bookings it is for
//  The holder keeps everything else and pays every cost from it.
//
//  No database, no network, no clock: test-split.php drives every function here.
//  split.php reads the figures and answers the page.
// ============================================================

const SPLIT_KEY = 'money-split';

// The stored settings, cleaned: who holds the account, who hosts each cottage,
// the names each paid-out person is paid as, and the day the split starts.
// Anything malformed reads as "not set", never as somebody's money.
function split_config($raw): array
{
    $c = is_array($raw) ? $raw : [];
    $hosts = [];
    foreach ((is_array($c['hosts'] ?? null) ? $c['hosts'] : []) as $k => $id) {
        $k = (string) $k;
        if (preg_match('/^[a-z0-9_]{1,32}$/', $k) && (int) $id > 0) {
            $hosts[$k] = (int) $id;
        }
    }
    $payees = [];
    foreach ((is_array($c['payees'] ?? null) ? $c['payees'] : []) as $id => $names) {
        if ((int) $id <= 0 || !is_array($names)) {
            continue;
        }
        $keep = [];
        foreach ($names as $n) {
            $n = trim((string) $n);
            if ($n !== '' && split_norm($n) !== '' && mb_strlen($n) <= 160) {
                $keep[split_norm($n)] = $n;
            }
        }
        if ($keep) {
            $payees[(int) $id] = array_values(array_slice($keep, 0, 6));
        }
    }
    $since = (string) ($c['since'] ?? '');
    return [
        'holder' => max(0, (int) ($c['holder'] ?? 0)),
        'hosts' => $hosts,
        'payees' => $payees,
        'since' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $since) ? $since : '',
    ];
}

// A name as the bank might spell it, reduced to letters: "FARROW-GREEN G." and
// "farrow green g" are the same name; "George Ellis" is a different one.
function split_norm(string $s): string
{
    return (string) preg_replace('/[^a-z]/', '', strtolower($s));
}

// Who is paid out: everyone hosting a cottage who isn't the holder.
function split_paid_out(array $cfg): array
{
    if ($cfg['holder'] <= 0) {
        return [];
    }
    $ids = [];
    foreach ($cfg['hosts'] as $id) {
        if ($id !== $cfg['holder']) {
            $ids[$id] = true;
        }
    }
    return array_map('intval', array_keys($ids));
}
function split_on(array $cfg): bool
{
    return (bool) split_paid_out($cfg);
}
function split_cottages_of(array $cfg, int $id): array
{
    return array_values(array_map('strval', array_keys(array_filter($cfg['hosts'], fn($h) => $h === $id))));
}
// The holder's cottages: every cottage not hosted by a paid-out person (an
// unassigned cottage is the account's, so nothing ever falls between two people).
function split_holder_cottages(array $cfg, array $allKeys): array
{
    $paid = array_flip(split_paid_out($cfg));
    return array_values(array_filter($allKeys, fn($k) => !isset($cfg['hosts'][$k]) || !isset($paid[$cfg['hosts'][$k]])));
}
// A person's role in the split: 'paid' (sent their money), 'holder', or 'none'.
function split_role(array $cfg, int $id): string
{
    if (!split_on($cfg)) {
        return 'none';
    }
    return in_array($id, split_paid_out($cfg), true) ? 'paid' : 'holder';
}

// [normalised name => person] for every name a paid-out person is paid as.
function split_payee_map(array $cfg): array
{
    $out = [];
    $paid = array_flip(split_paid_out($cfg));
    foreach ($cfg['payees'] as $id => $names) {
        if (!isset($paid[$id])) {
            continue;
        }
        foreach ($names as $n) {
            $out[split_norm($n)] = (int) $id;
        }
    }
    return $out;
}
// Money going OUT to exactly a linked name: whose it is, or 0. Only an exact
// name counts — a similar one is offered, never assumed.
function split_payee_of(string $name, float $amount, array $map): int
{
    if ($amount >= 0) {
        return 0;
    }
    $n = split_norm($name);
    return $n !== '' && isset($map[$n]) ? (int) $map[$n] : 0;
}
// A name that is like a person's but not exactly it ("G Farrow-Green" for
// "George Farrow-Green"): shares their surname, at least four letters long.
function split_name_like(string $name, string $personName): bool
{
    $a = split_norm($name);
    $b = split_norm($personName);
    if ($a === '' || $b === '' || $a === $b) {
        return false;
    }
    $words = preg_split('/[\s]+/', trim(strtolower($personName))) ?: [];
    $last = split_norm((string) end($words));
    return strlen($last) >= 4 && strpos($a, $last) !== false;
}

// Which bookings a person's money is still owed for. Items are the money as it
// was COUNTED (a guest's payment on the day it arrived; a platform payout on the
// day it was matched), each after its card fee. Transfers to the person cover
// the earliest-counted money first, so a payment sent for the list on screen
// ticks off exactly that list, and money counted afterwards (an Airbnb payout
// matched later) is what remains. Returns the items still owed, merged per
// booking, with the part of each still to send.
function split_allocate(array $items, float $sent): array
{
    usort($items, fn($a, $b) => strcmp((string) $a['counted'], (string) $b['counted']) ?: strcmp((string) $a['date'], (string) $b['date']));
    $left = round($sent, 2);
    $due = [];
    foreach ($items as $it) {
        $amt = round((float) $it['amount'], 2);
        if ($amt <= 0) {
            // Money handed back to a guest reduces what is owed, never a line of its
            // own: off the same booking first, then the newest lines, and only what
            // is left over counts as sent ahead.
            $back = -$amt;
            $key = (string) ($it['key'] ?? '');
            $order = array_reverse(array_keys($due));
            if ($key !== '' && isset($due[$key])) {
                array_unshift($order, $key);
            }
            foreach (array_unique($order) as $k) {
                if ($back <= 0.004) {
                    break;
                }
                $cut = min($due[$k]['amount'], $back);
                $due[$k]['amount'] = round($due[$k]['amount'] - $cut, 2);
                $back = round($back - $cut, 2);
                if ($due[$k]['amount'] <= 0.004) {
                    unset($due[$k]);
                }
            }
            $left = round($left + max(0.0, $back), 2);
            continue;
        }
        $take = min($amt, max(0.0, $left));
        $left = round($left - $take, 2);
        $rest = round($amt - $take, 2);
        if ($rest > 0.004) {
            $key = (string) ($it['key'] ?? '');
            if ($key !== '' && isset($due[$key])) {
                $due[$key]['amount'] = round($due[$key]['amount'] + $rest, 2);
            } else {
                $due[$key !== '' ? $key : 'i' . count($due)] = array_merge($it, ['amount' => $rest]);
            }
        }
    }
    return array_values($due);
}

// The dates of a stay, as a screen shows them: "02/10–05/10/2026".
function split_stay(string $in, string $out): string
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $in, $a) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $out, $b)) {
        return '';
    }
    return $a[3] . '/' . $a[2] . ($a[1] !== $b[1] ? '/' . $a[1] : '') . '–' . $b[3] . '/' . $b[2] . '/' . $b[1];
}

// The UK tax year a date falls in (6 April boundary).
function split_tax_year(string $ymd): int
{
    $y = (int) substr($ymd, 0, 4);
    return substr($ymd, 5) < '04-06' ? $y - 1 : $y;
}
