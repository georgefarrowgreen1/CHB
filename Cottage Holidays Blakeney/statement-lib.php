<?php
// ============================================================
//  statement-lib.php — reading a bank statement the owner exports, PURE.
//
//  The Monzo Business account cannot be read live (Monzo's developer access is
//  built for personal and joint accounts), so the owner exports a CSV statement
//  and adds it on the Payments page. This file turns that text into payments,
//  and decides the few things that need no question: a Square payout and a move
//  to or from a pot. Everything else is for the owner to sort, with suggestions
//  worked out in the browser from the bookings and expenses it already holds.
//
//  No database, no clock: test-statements.php drives every function directly.
//  statements.php does the storing.
// ============================================================

// Split CSV text into rows of fields. Handles quoted fields (commas, quotes and
// line breaks inside them), CRLF, a lone CR and a byte-order mark.
// PHP's own fgetcsv does the splitting. A hand-written character loop did it
// before, and PHP 8.3's tracing JIT (on by default under setup-php, so in CI)
// miscompiled it: the first file read in a process came back with eight extra
// fields in its header, so "Currency" was looked for in the Balance column and
// every payment was refused as "another currency". C code is not JIT-compiled.
function statement_csv_rows(string $csv): array
{
    if (strncmp($csv, "\xEF\xBB\xBF", 3) === 0) {
        $csv = substr($csv, 3);
    }
    // fgetcsv ends a line at \n only; a file from an old Mac ends lines in \r.
    $csv = str_replace(["\r\n", "\r"], "\n", $csv);
    $fh = fopen('php://temp', 'r+');
    if ($fh === false) {
        return [];
    }
    fwrite($fh, $csv);
    rewind($fh);
    $rows = [];
    // No escape character: a quote inside a field is written twice, as in Excel and Monzo.
    while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
        $r = array_map(fn($v) => (string) $v, $r);
        if (count($r) > 1 || trim($r[0]) !== '') {
            $rows[] = $r;
        }
    }
    fclose($fh);
    return $rows;
}

// Which column holds what. Header names are matched loosely (case, spaces and
// punctuation ignored), because Monzo's personal, business and search exports
// name the same thing slightly differently.
function statement_columns(array $header): array
{
    $want = [
        'id' => ['transactionid', 'id'],
        'date' => ['date', 'created', 'transactiondate'],
        'time' => ['time'],
        'type' => ['type'],
        'name' => ['name', 'counterparty', 'payee'],
        'category' => ['category'],
        'amount' => ['amount'],
        'in' => ['moneyin', 'paidin'],
        'out' => ['moneyout', 'paidout'],
        'description' => ['description', 'reference'],
        'notes' => ['notesandtags', 'notes'],
        'balance' => ['balance', 'runningbalance'],
        'currency' => ['currency'],
    ];
    $norm = array_map(fn($h) => preg_replace('/[^a-z]/', '', strtolower((string) $h)), $header);
    $map = [];
    foreach ($want as $k => $names) {
        foreach ($names as $name) {
            $i = array_search($name, $norm, true);
            if ($i !== false) {
                $map[$k] = $i;
                break;
            }
        }
    }
    return $map;
}

// A file that is not a CSV statement, named for what it is. '' when it looks fine.
function statement_file_problem(string $filename, string $text): string
{
    $f = strtolower($filename);
    $head = ltrim(substr($text, 0, 64));
    if (str_ends_with($f, '.pdf') || strncmp($head, '%PDF', 4) === 0) {
        return 'That’s a PDF. Export the statement again and pick CSV.';
    }
    if (str_ends_with($f, '.qif') || strncmp($head, '!Type', 5) === 0) {
        return 'That’s a QIF file. Export the statement again and pick CSV.';
    }
    if (preg_match('/\.(xlsx?|numbers|ofx)$/', $f)) {
        return 'That isn’t a CSV file. Export the statement again and pick CSV.';
    }
    if (trim($text) === '') {
        return 'That file is empty.';
    }
    return '';
}

// "18/06/2024", "2024-06-18" or "2024-06-18T09:34:00Z" → "2024-06-18". '' if not a date.
function statement_date(string $s): string
{
    $s = trim($s);
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})#', $s, $m)) {
        return checkdate((int) $m[2], (int) $m[1], (int) $m[3]) ? sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]) : '';
    }
    if (preg_match('#^(\d{4})-(\d{2})-(\d{2})#', $s, $m)) {
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? "$m[1]-$m[2]-$m[3]" : '';
    }
    return '';
}

// "£1,045.81", "-86.40", "(86.40)" → a float; null when there is no number.
function statement_money(string $s): ?float
{
    $s = trim($s);
    if ($s === '') {
        return null;
    }
    $neg = false;
    if ($s[0] === '(' && substr($s, -1) === ')') {
        $neg = true;
        $s = substr($s, 1, -1);
    }
    $s = str_replace(['£', ',', ' ', "\u{00A0}", 'GBP'], '', $s);
    if (!preg_match('/^[-+]?\d+(\.\d+)?$/', $s)) {
        return null;
    }
    $v = (float) $s;
    return round($neg ? -abs($v) : $v, 2);
}

// The statement as payments. Returns ['ok', 'error', 'lines', 'from', 'to',
// 'money_in', 'money_out', 'balance', 'balance_at', 'other_currency'].
// A line with no date or no amount is skipped, never guessed at; so is a line in
// another currency, which Monzo shows in its own account currency anyway.
function statement_parse(string $csv, string $filename = ''): array
{
    $out = ['ok' => false, 'error' => '', 'lines' => [], 'from' => '', 'to' => '', 'money_in' => 0.0, 'money_out' => 0.0, 'balance' => null, 'balance_at' => '', 'other_currency' => 0, 'unreadable' => 0];
    $problem = statement_file_problem($filename, $csv);
    if ($problem !== '') {
        $out['error'] = $problem;
        return $out;
    }
    $rows = statement_csv_rows($csv);
    if (count($rows) < 1) {
        $out['error'] = 'That file is empty.';
        return $out;
    }
    $col = statement_columns($rows[0]);
    if (!isset($col['date']) || (!isset($col['amount']) && !isset($col['in']) && !isset($col['out']))) {
        $out['error'] = 'This doesn’t look like a bank statement: it has no Date and Amount columns.';
        return $out;
    }
    $get = fn(array $r, string $k) => isset($col[$k]) ? trim((string) ($r[$col[$k]] ?? '')) : '';
    $seen = [];
    $curSeen = [];
    $lastAt = '';
    for ($i = 1, $n = count($rows); $i < $n; $i++) {
        $r = $rows[$i];
        $date = statement_date($get($r, 'date'));
        if ($date === '') {
            $out['unreadable']++;
            continue;
        }
        $cur = strtoupper($get($r, 'currency'));
        if ($cur !== '' && $cur !== 'GBP') {
            $out['other_currency']++;
            $curSeen[mb_substr($cur, 0, 12)] = true;
            continue;
        }
        if (isset($col['amount'])) {
            $amt = statement_money($get($r, 'amount'));
        } else {
            $in = statement_money($get($r, 'in'));
            $o = statement_money($get($r, 'out'));
            $amt = $in === null && $o === null ? null : round(abs((float) $in) - abs((float) $o), 2);
        }
        if ($amt === null) {
            $out['unreadable']++;
            continue;
        }
        $time = preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?/', $get($r, 'time'), $tm) ? sprintf('%02d:%02d:%02d', $tm[1], $tm[2], $tm[3] ?? 0) : '';
        if ($time === '' && preg_match('/T(\d{2}):(\d{2}):(\d{2})/', $get($r, 'date'), $tm)) {
            $time = "$tm[1]:$tm[2]:$tm[3]";
        }
        $name = mb_substr($get($r, 'name'), 0, 160);
        $desc = mb_substr($get($r, 'description'), 0, 255);
        $id = $get($r, 'id');
        if ($id !== '') {
            $key = 'm:' . substr(preg_replace('/[^A-Za-z0-9_-]/', '', $id), 0, 76);
        } else {
            // No transaction id: the same payment twice in one file is two payments,
            // so the key carries how many times this exact line has been seen.
            $h = substr(sha1($date . '|' . $time . '|' . number_format($amt, 2, '.', '') . '|' . $name . '|' . $desc), 0, 32);
            $seen[$h] = ($seen[$h] ?? 0) + 1;
            $key = 'h:' . $h . ':' . $seen[$h];
        }
        $bal = statement_money($get($r, 'balance'));
        $line = [
            'ext_key' => $key,
            'date' => $date,
            'time' => $time,
            'type' => mb_substr($get($r, 'type'), 0, 40),
            'name' => $name,
            'category' => mb_substr($get($r, 'category'), 0, 60),
            'description' => $desc,
            'notes' => mb_substr($get($r, 'notes'), 0, 255),
            'amount' => $amt,
            'balance' => $bal,
        ];
        $out['lines'][] = $line;
        if ($amt > 0) {
            $out['money_in'] += $amt;
        } else {
            $out['money_out'] += -$amt;
        }
        if ($out['from'] === '' || $date < $out['from']) {
            $out['from'] = $date;
        }
        if ($out['to'] === '' || $date > $out['to']) {
            $out['to'] = $date;
        }
        // The balance after the LATEST payment is the statement's closing balance,
        // whichever order the file lists them in.
        $at = $date . ' ' . ($time ?: '00:00:00');
        if ($bal !== null && $at >= $lastAt) {
            $lastAt = $at;
            $out['balance'] = $bal;
            $out['balance_at'] = $at;
        }
    }
    $out['money_in'] = round($out['money_in'], 2);
    $out['money_out'] = round($out['money_out'], 2);
    if (!$out['lines']) {
        // Say WHY when rows were there but none could be read — "no payments" over a
        // file full of rows reads as the app being broken, and the count is what
        // tells an owner (and us) whether it was the dates, the amounts or the currency.
        $rowsIn = max(0, count($rows) - 1);
        if ($rowsIn > 0 && $out['unreadable'] > 0) {
            $out['error'] = $rowsIn === 1 ? 'The one row in that file couldn’t be read as a payment.' : 'None of the ' . $rowsIn . ' rows in that file could be read as a payment.';
        } elseif ($rowsIn > 0 && $out['other_currency'] > 0) {
            // Named, so a file in euros is told from a column we misread.
            $out['error'] = 'Every payment in that file is in another currency (' . implode(', ', array_slice(array_keys($curSeen), 0, 3)) . ').';
        } else {
            $out['error'] = 'There are no payments in that file.';
        }
        $out['rows_in'] = $rowsIn;
        $out['cols'] = $col; // which column was read as what: tells a misread from a foreign file
        return $out;
    }
    $out['ok'] = true;
    return $out;
}

// What needs no question. A Square payout is card money already in the books
// (counting it again would count it twice); a move to or from a pot is the
// owner's own money changing places; money out to a name a paid-out host has
// confirmed is theirs is their cottages' money reaching them (split-lib.php).
// $payees is split_payee_map(): [normalised name => person]. Returns
// [as, label] or [as, label, person] or null.
function statement_auto(array $line, array $payees = []): ?array
{
    $type = strtolower((string) ($line['type'] ?? ''));
    $name = strtolower((string) ($line['name'] ?? ''));
    $desc = strtolower((string) ($line['description'] ?? ''));
    $amt = (float) ($line['amount'] ?? 0);
    if ($payees && $amt < 0) {
        $who = $payees[(string) preg_replace('/[^a-z]/', '', $name)] ?? 0;
        if ($who > 0) {
            return ['person', 'Paid to ' . trim((string) ($line['name'] ?? '')), (int) $who];
        }
    }
    if (preg_match('/\bpot\b/', $type) || preg_match('/^(from|to) .*pot$|\bpot transfer\b/', $name . ' ' . $desc)) {
        return ['pot', $amt > 0 ? 'From a pot' : 'To a pot'];
    }
    if ($amt > 0 && preg_match('/\bsquare\b|squareup|sq \*payout/', $name . ' ' . $desc)) {
        return ['square', 'Square payout'];
    }
    return null;
}

// Is a statement due? One is due once the last statement stops short of the end
// of last month. 'from' is the first day the next export should start at, and
// 'month' names the month when exactly one whole month is missing.
function statement_due(?string $lastTo, string $today): array
{
    if (!$lastTo) {
        return ['due' => false, 'from' => '', 'month' => ''];
    }
    $endPrev = date('Y-m-d', strtotime(substr($today, 0, 7) . '-01 12:00:00') - 86400);
    $from = date('Y-m-d', strtotime($lastTo . ' 12:00:00') + 86400);
    $due = $lastTo < $endPrev;
    $month = '';
    if ($due && substr($from, 8, 2) === '01' && substr($from, 0, 7) === substr($endPrev, 0, 7)) {
        $month = date('F', strtotime($from . ' 12:00:00'));
    }
    return ['due' => $due, 'from' => $from, 'month' => $month];
}

// Send the monthly reminder? Once a month at most, only while statements are on
// and the reminder is wanted, and only when one is actually due. Never while the
// live link is bringing the payments in by itself ($live).
function statement_reminder_due(array $settings, ?string $lastTo, string $today, bool $live = false): bool
{
    if ($live || empty($settings['on'])) {
        return false;
    }
    if (array_key_exists('remind', $settings) && empty($settings['remind'])) {
        return false;
    }
    if ((string) ($settings['reminded'] ?? '') === substr($today, 0, 7)) {
        return false;
    }
    return statement_due($lastTo, $today)['due'];
}
