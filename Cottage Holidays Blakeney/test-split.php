<?php
// test-split.php — whose money is whose (split-lib.php), with no database.
// Run: php test-split.php
require_once __DIR__ . '/split-lib.php';
require_once __DIR__ . '/statement-lib.php';

$pass = 0;
$fail = 0;
function spc(string $label, bool $ok): void
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        echo "  ✓ $label\n";
    } else {
        $fail++;
        echo "  ✗ $label\n";
    }
}

echo "== Settings, cleaned\n";
$cfg = split_config(['holder' => 2, 'hosts' => ['pp' => 1, '21a' => 2, 'jb' => 2, 'BAD KEY' => 1, 'x' => 0], 'payees' => [1 => ['George Farrow-Green', '', '  ', 'george farrow green'], 0 => ['Nobody'], 3 => 'not a list'], 'since' => '2026-04-06']);
spc('the holder is kept', $cfg['holder'] === 2);
spc('a cottage key that isn’t one is dropped, and a host of 0 is no host', array_keys($cfg['hosts']) === ['pp', '21a', 'jb']);
spc('payee names: blanks dropped, the same name in two spellings kept once', $cfg['payees'] === [1 => ['george farrow green']] || $cfg['payees'] === [1 => ['George Farrow-Green']]);
spc('a malformed start date reads as not set', split_config(['since' => 'yesterday'])['since'] === '');
spc('garbage reads as nothing set', split_config('nonsense') === ['holder' => 0, 'hosts' => [], 'payees' => [], 'since' => '']);

echo "== Who is paid out, and who holds the account\n";
spc('a host who isn’t the holder is paid out', split_paid_out($cfg) === [1]);
spc('George (1) is paid, Sophia (2) holds', split_role($cfg, 1) === 'paid' && split_role($cfg, 2) === 'holder');
spc('a third person with no cottage sees the account’s side', split_role($cfg, 3) === 'holder');
spc('with no holder set, nobody is paid out and the split is off', split_paid_out(split_config(['hosts' => ['pp' => 1]])) === [] && split_role(split_config(['hosts' => ['pp' => 1]]), 1) === 'none');
spc('when everyone’s cottages are the holder’s, the split is off', !split_on(split_config(['holder' => 2, 'hosts' => ['pp' => 2]])));
spc('George’s cottages', split_cottages_of($cfg, 1) === ['pp']);
spc('the holder’s cottages include one nobody hosts', split_holder_cottages($cfg, ['21a', 'jb', 'pp', 'new']) === ['21a', 'jb', 'new']);

echo "== Payments to a linked name\n";
$map = split_payee_map($cfg);
spc('the map is by name as letters only', isset($map['georgefarrowgreen']) || isset($map[split_norm('george farrow green')]));
spc('money OUT to exactly the name is theirs', split_payee_of('GEORGE FARROW-GREEN', -1640, $map) === 1);
spc('money IN from the same name is not (it waits to be sorted)', split_payee_of('George Farrow-Green', 200, $map) === 0);
spc('a different George is never matched', split_payee_of('George Ellis', -75, $map) === 0);
spc('a similar name is not matched by itself', split_payee_of('G Farrow-Green', -300, $map) === 0);
spc('…but it is offered as like the person', split_name_like('G Farrow-Green', 'George Farrow-Green'));
spc('another George is not like him', !split_name_like('George Ellis', 'George Farrow-Green'));
spc('the exact name is not "like" (it is the name)', !split_name_like('George Farrow-Green', 'George Farrow-Green'));
spc('a name nobody holds the account for maps to no one', split_payee_map(split_config(['holder' => 2, 'hosts' => ['pp' => 2], 'payees' => [2 => ['Sophia X']]])) === []);

echo "== Sorted by itself as it arrives (statement_auto)\n";
$a = statement_auto(['type' => 'Faster payment', 'name' => 'George Farrow-Green', 'description' => 'Pimpernel Sept', 'amount' => -1640], $map);
spc('a transfer to the linked name sorts as paid to them', $a === ['person', 'Paid to George Farrow-Green', 1]);
spc('without the map it’s left to sort (as before)', statement_auto(['type' => 'Faster payment', 'name' => 'George Farrow-Green', 'amount' => -1640]) === null);
spc('money in from the name is left to sort', statement_auto(['type' => 'Faster payment', 'name' => 'George Farrow-Green', 'amount' => 50], $map) === null);
spc('a Square payout still sorts as a Square payout', statement_auto(['type' => 'Faster payment', 'name' => 'SQUARE', 'amount' => 900], $map) === ['square', 'Square payout']);

echo "== Which bookings are still owed\n";
$items = [
    ['key' => 'b1', 'name' => 'Liam Foster', 'counted' => '2026-10-02 12:00:00', 'date' => '2026-10-02', 'amount' => 511.30],
    ['key' => 'b2', 'name' => 'Ellie Marsh', 'counted' => '2026-10-06 12:00:00', 'date' => '2026-10-06', 'amount' => 480.00],
    ['key' => 'b3', 'name' => 'Jo Walker', 'counted' => '2026-10-08 12:00:00', 'date' => '2026-10-08', 'amount' => 152.30],
];
$all = split_allocate($items, 0);
spc('nothing sent: every booking is owed', array_column($all, 'name') === ['Liam Foster', 'Ellie Marsh', 'Jo Walker']);
spc('…and the lines add up', abs(array_sum(array_column($all, 'amount')) - 1143.60) < 0.005);
spc('sending exactly the list clears it', split_allocate($items, 1143.60) === []);
$air = array_merge($items, [['key' => 'l9', 'name' => 'Airbnb stay', 'counted' => '2026-10-10 09:00:00', 'date' => '2026-10-05', 'amount' => 612.40]]);
$after = split_allocate($air, 1143.60);
spc('a payout matched AFTER the payment is what remains, though its money arrived earlier', count($after) === 1 && $after[0]['name'] === 'Airbnb stay' && abs($after[0]['amount'] - 612.40) < 0.005);
$part = split_allocate($items, 600);
spc('a part payment covers the earliest money first and leaves part of the next', $part[0]['name'] === 'Ellie Marsh' && abs($part[0]['amount'] - 391.30) < 0.005 && count($part) === 2);
spc('…and still adds up to what’s owed', abs(array_sum(array_column($part, 'amount')) - 543.60) < 0.005);
$two = split_allocate([
    ['key' => 'b5', 'name' => 'Ann', 'counted' => '2026-10-01 12:00:00', 'date' => '2026-10-01', 'amount' => 100],
    ['key' => 'b6', 'name' => 'Ben', 'counted' => '2026-10-02 12:00:00', 'date' => '2026-10-02', 'amount' => 50],
    ['key' => 'b5', 'name' => 'Ann', 'counted' => '2026-10-03 12:00:00', 'date' => '2026-10-03', 'amount' => 70],
], 0);
spc('two payments from one guest are one line', count($two) === 2 && $two[0]['name'] === 'Ann' && abs($two[0]['amount'] - 170) < 0.005);
$ref = split_allocate([
    ['key' => 'b7', 'name' => 'Cat', 'counted' => '2026-10-01 12:00:00', 'date' => '2026-10-01', 'amount' => 300],
    ['key' => 'b7', 'name' => 'Cat', 'counted' => '2026-10-02 12:00:00', 'date' => '2026-10-02', 'amount' => -100],
    ['key' => 'b8', 'name' => 'Dan', 'counted' => '2026-10-03 12:00:00', 'date' => '2026-10-03', 'amount' => 50],
], 0);
spc('money handed back to a guest reduces what is owed, never a line of its own', abs(array_sum(array_column($ref, 'amount')) - 250) < 0.005 && !in_array(-100.0, array_column($ref, 'amount'), true));
spc('sending more than is owed leaves nothing owed', split_allocate($items, 5000) === []);

echo "== Dates\n";
spc('a stay in one year', split_stay('2026-10-02', '2026-10-05') === '02/10–05/10/2026');
spc('a stay across the new year names both years', split_stay('2026-12-30', '2027-01-02') === '30/12/2026–02/01/2027');
spc('the tax year turns on 6 April', split_tax_year('2026-04-05') === 2025 && split_tax_year('2026-04-06') === 2026);

echo "\n== Summary ==\n";
echo $fail ? "  $fail FAILED, $pass passed ❌\n" : "  ALL $pass SPLIT CHECKS PASSED ✅\n";
exit($fail ? 1 : 0);
