<?php
// ============================================================
//  test-statements.php — the business bank statements: read once, never counted
//  twice, and the reminder that asks for the next one. No database, no network:
//  statement-lib.php is pure, and the endpoint's wiring is read as source.
//  Run: php test-statements.php
// ============================================================
require_once __DIR__ . '/statement-lib.php';

$fails = 0;
$passes = 0;
function stc(string $label, bool $ok, string $extra = ''): void
{
    global $fails, $passes;
    if ($ok) {
        $passes++;
        echo "  ✓ $label\n";
    } else {
        $fails++;
        echo "  ✗ $label" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

// A Monzo Business CSV as exported since June 2024: the personal columns plus a
// running Balance at the end. Listed newest first, as the app shows it.
$BIZ = "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Balance,Balance currency\r\n"
    . "tx_0003,06/10/2026,09:12:00,Faster payment,SQUARE,,Income,1045.81,GBP,1045.81,GBP,,,,SQUARE PAYOUT ABC,,3284.12,GBP\r\n"
    . "tx_0002,03/10/2026,14:02:11,Faster payment,M HILL,,Income,377.50,GBP,377.50,GBP,,,,\"CHB-000041, balance\",,2238.31,GBP\r\n"
    . "tx_0001,02/10/2026,08:00:00,Card payment,NORFOLK LINEN SERVICES,,General,-86.40,GBP,-86.40,GBP,,,,NORFOLK LINEN,,1860.81,GBP\r\n"
    . "tx_0000,29/09/2026,10:30:00,Pot transfer,Tax Pot,,Savings,-250.00,GBP,-250.00,GBP,,,,,,1947.21,GBP\r\n";

echo "\n§1 A Monzo Business statement reads as payments\n";
$p = statement_parse($BIZ, 'MonzoBusiness.csv');
stc('it reads', $p['ok'], $p['error']);
stc('four payments', count($p['lines']) === 4, (string) count($p['lines']));
stc('dates are day-first: 06/10/2026 is 6 October', ($p['lines'][0]['date'] ?? '') === '2026-10-06');
stc('the date range covers the file', $p['from'] === '2026-09-29' && $p['to'] === '2026-10-06', $p['from'] . '..' . $p['to']);
stc('money in adds up', abs($p['money_in'] - 1423.31) < 0.001, (string) $p['money_in']);
stc('money out adds up (the pot move included)', abs($p['money_out'] - 336.40) < 0.001, (string) $p['money_out']);
stc('a quoted reference with a comma stays one field', ($p['lines'][1]['description'] ?? '') === 'CHB-000041, balance');
stc('the bank’s own id is the key', ($p['lines'][0]['ext_key'] ?? '') === 'm:tx_0003');
stc('the closing balance is the one after the LATEST payment, whatever the order', $p['balance'] === 3284.12 && $p['balance_at'] === '2026-10-06 09:12:00', var_export($p['balance'], true) . ' ' . $p['balance_at']);
$asc = implode("\r\n", array_merge([explode("\r\n", $BIZ)[0]], array_reverse(array_slice(array_filter(explode("\r\n", $BIZ)), 1))));
$pa = statement_parse($asc, 'x.csv');
stc('…and the same when the file is oldest first', $pa['balance'] === 3284.12, var_export($pa['balance'], true));
stc('a byte-order mark is ignored', statement_parse("\xEF\xBB\xBF" . $BIZ, 'x.csv')['ok']);

echo "\n§2 Other shapes of statement\n";
$PERSONAL = "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split\n"
    . "tx_9,12/09/2026,10:00:00,Card payment,TESCO,,Groceries,-23.10,GBP,-23.10,GBP,,,,TESCO STORES,\n";
$pp = statement_parse($PERSONAL, 'p.csv');
stc('a statement with no Balance column still reads', $pp['ok'] && count($pp['lines']) === 1);
stc('…and says it has no balance rather than inventing one', $pp['balance'] === null);
$INOUT = "Date,Name,Money In,Money Out,Reference\n01/10/2026,J CARTER,250.00,,CHB-000052\n02/10/2026,OCTOPUS ENERGY,,142.18,\n";
$pi = statement_parse($INOUT, 'io.csv');
stc('Money In / Money Out columns work too', $pi['ok'] && $pi['lines'][0]['amount'] === 250.0 && $pi['lines'][1]['amount'] === -142.18, json_encode(array_column($pi['lines'], 'amount')));
stc('a file without ids gets a fingerprint key', strpos($pi['lines'][0]['ext_key'], 'h:') === 0);
$dup = "Date,Name,Amount\n01/10/2026,PARKING,-2.00\n01/10/2026,PARKING,-2.00\n";
$pd = statement_parse($dup, 'd.csv');
stc('the same payment twice in one file is two payments', count($pd['lines']) === 2 && $pd['lines'][0]['ext_key'] !== $pd['lines'][1]['ext_key']);
$pd2 = statement_parse($dup, 'd.csv');
stc('…and reading the file again gives the same two keys (so a re-upload adds nothing)', array_column($pd['lines'], 'ext_key') === array_column($pd2['lines'], 'ext_key'));
$fx = "Transaction ID,Date,Amount,Currency,Name\ntx_a,01/10/2026,-10.00,EUR,HOTEL\ntx_b,01/10/2026,-5.00,GBP,CAFE\n";
$pf = statement_parse($fx, 'f.csv');
stc('a line in another currency is left out and counted', count($pf['lines']) === 1 && $pf['other_currency'] === 1);
$bad = "Date,Name,Amount\nnot a date,X,-1.00\n02/10/2026,Y,abc\n03/10/2026,Z,-3.00\n";
$pb = statement_parse($bad, 'b.csv');
stc('a line with no date or no amount is skipped, never guessed', count($pb['lines']) === 1 && $pb['unreadable'] === 2, json_encode([count($pb['lines']), $pb['unreadable']]));
stc('ISO dates read too', statement_date('2026-10-06T09:12:00Z') === '2026-10-06');
stc('an impossible date is refused', statement_date('31/02/2026') === '');
stc('money: a pound sign and commas', statement_money('£1,045.81') === 1045.81);
stc('money: brackets are a negative', statement_money('(86.40)') === -86.4);
stc('money: words are not money', statement_money('n/a') === null);

echo "\n§3 The wrong file is named\n";
stc('a PDF', strpos(statement_parse('%PDF-1.7 …', 'statement.pdf')['error'], 'PDF') !== false);
stc('a QIF file', strpos(statement_parse("!Type:Bank\nD01/10/2026\n", 'statement.qif')['error'], 'QIF') !== false);
stc('a spreadsheet', strpos(statement_parse('PK…', 'statement.xlsx')['error'], 'CSV') !== false);
stc('a CSV that isn’t a statement', strpos(statement_parse("Guest,Nights\nAnna,3\n", 'guests.csv')['error'], 'no Date and Amount') !== false);
stc('an empty file', statement_parse('', 'x.csv')['ok'] === false);
stc('a header with no payments', strpos(statement_parse("Date,Amount\n", 'x.csv')['error'], 'no payments') !== false);

echo "\n§4 What needs no question\n";
$auto = fn($type, $name, $amt, $desc = '') => statement_auto(['type' => $type, 'name' => $name, 'amount' => $amt, 'description' => $desc]);
stc('a Square payout in is card money already in the books', ($auto('Faster payment', 'SQUARE', 1045.81)[0] ?? '') === 'square');
stc('a purchase at a Square shop is NOT a payout', $auto('Card payment', 'SQ *COFFEE SHOP', -3.20) === null);
stc('a pot transfer is the owner’s own money moving', ($auto('Pot transfer', 'Tax Pot', -250)[0] ?? '') === 'pot');
stc('a guest’s transfer needs the owner', $auto('Faster payment', 'M HILL', 377.5, 'CHB-000041') === null);
stc('an Airbnb payout needs the owner (it is income to sort, not card money)', $auto('Faster payment', 'AIRBNB PAYMENTS UK', 612.4) === null);
stc('"deposit" is not a pot', $auto('Faster payment', 'DEPOSIT', 50) === null);

echo "\n§5 When a statement is due\n";
$d = statement_due('2026-10-08', '2026-11-01');
stc('8 Oct on 1 Nov: due, from 9 Oct', $d['due'] && $d['from'] === '2026-10-09' && $d['month'] === '', json_encode($d));
$d = statement_due('2026-09-30', '2026-11-01');
stc('30 Sep on 1 Nov: due, and it is October’s', $d['due'] && $d['month'] === 'October', json_encode($d));
$d = statement_due('2026-10-31', '2026-11-01');
stc('31 Oct on 1 Nov: not due', !$d['due']);
$d = statement_due('2026-10-08', '2026-10-20');
stc('8 Oct on 20 Oct: not due (the month isn’t over)', !$d['due']);
$d = statement_due('2026-12-31', '2027-01-15');
stc('across a year end', !$d['due']);
$d = statement_due('2026-11-30', '2027-01-01');
stc('…and December’s is due on 1 Jan', $d['due'] && $d['month'] === 'December', json_encode($d));
stc('no statement yet: nothing is due', !statement_due(null, '2026-11-01')['due']);

echo "\n§6 The reminder: once a month, only when wanted\n";
stc('due and wanted: yes', statement_reminder_due(['on' => true], '2026-10-08', '2026-11-01'));
stc('statements off: no', !statement_reminder_due(['on' => false], '2026-10-08', '2026-11-01'));
stc('reminder turned off: no', !statement_reminder_due(['on' => true, 'remind' => false], '2026-10-08', '2026-11-01'));
stc('already reminded this month: no', !statement_reminder_due(['on' => true, 'reminded' => '2026-11'], '2026-10-08', '2026-11-03'));
stc('reminded last month, still due: yes', statement_reminder_due(['on' => true, 'reminded' => '2026-10'], '2026-09-12', '2026-11-01'));
stc('not due: no', !statement_reminder_due(['on' => true], '2026-10-31', '2026-11-01'));

echo "\n§7 The wiring\n";
$src = (string) file_get_contents(__DIR__ . '/statements.php');
stc('import rides the op ledger', strpos($src, 'op_claim($in)') !== false && strpos($src, 'op_finish($opTok') !== false);
$store = (string) file_get_contents(__DIR__ . '/split-store.php');
stc('a payment already stored is never added again (INSERT IGNORE on the unique key, in the one shared insert)', strpos($src, 'split_bank_insert(') !== false && substr_count($store, 'INSERT IGNORE INTO bank_lines') === 2);
stc('preview writes nothing', (function () use ($src) {
    $i = strpos($src, "'preview' =>");
    $j = strpos($src, "'import' =>");
    $body = $i !== false && $j !== false ? substr($src, $i, $j - $i) : 'INSERT';
    return strpos($body, 'INSERT') === false && strpos($body, 'UPDATE') === false;
})());
stc('the automatic sorts come from statement_auto', strpos($store, 'statement_auto($l, ') !== false);
stc('only known ways to sort are accepted', strpos($src, 'in_array($as, STMT_SORTS, true)') !== false);
stc('it is owner-only', strpos($src, 'require_admin()') !== false);
$mig = (string) @file_get_contents(__DIR__ . '/migration-135-bank-statements.sql');
stc('the key is unique in the database', strpos($mig, 'UNIQUE KEY uq_ext (ext_key)') !== false);
$sr = (string) file_get_contents(__DIR__ . '/self-repair.php');
stc('the daily job sends the reminder through statement_reminder_due', strpos($sr, 'statement_reminder_due($stSet') !== false);
stc('…and records the month it went', strpos($sr, "\$stSet['reminded'] = substr(\$stToday, 0, 7)") !== false);
$db = (string) file_get_contents(__DIR__ . '/db.php');
stc('the setting is classified, never public', strpos($db, "\$key === 'bank-statements'") !== false);
$pl = (string) file_get_contents(__DIR__ . '/people-lib.php');
stc('only someone with Money overview can reach it', strpos($pl, "'statements.php' => ['*' => 'money']") !== false);

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails FAILED, $passes passed ❌\n";
    exit(1);
}
echo "  ALL $passes CHECKS PASSED ✅\n";
