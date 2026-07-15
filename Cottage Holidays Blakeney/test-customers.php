<?php
// test-customers.php — the server customer directory's grouping (customers-lib.php).
// Mirrors search-test §21c so the SAFEGUARDS hold on both sides: strong-identity
// unification and false-merge protection. Pure — no DB, no admin gate.
require_once __DIR__ . '/customers-lib.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok): void
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        echo "  \xE2\x9C\x93 $label\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $label\n";
    }
}

// Same fixtures as the client test: Sarah twice (same email, different case), two
// different John Smiths (different emails), and a name-only repeat (no contact).
$rows = [
    ['id' => 1, 'prop_key' => 'jollyboat', 'name' => 'Sarah Wingate', 'email' => 'SARAH@x.co', 'phone' => '', 'check_in' => '2025-06-01', 'check_out' => '2025-06-04', 'total' => 600],
    ['id' => 2, 'prop_key' => 'jollyboat', 'name' => 'Sarah Wingate', 'email' => 'sarah@x.co', 'phone' => '', 'check_in' => '2026-07-10', 'check_out' => '2026-07-13', 'total' => 660],
    ['id' => 3, 'prop_key' => 'jollyboat', 'name' => 'John Smith', 'email' => 'john1@x.co', 'phone' => '', 'check_in' => '2026-01-01', 'check_out' => '2026-01-03', 'total' => 300],
    ['id' => 4, 'prop_key' => 'jollyboat', 'name' => 'John Smith', 'email' => 'john2@x.co', 'phone' => '', 'check_in' => '2026-02-01', 'check_out' => '2026-02-03', 'total' => 300],
    ['id' => 5, 'prop_key' => 'jollyboat', 'name' => 'Nomail Ned', 'email' => '', 'phone' => '', 'check_in' => '2026-03-01', 'check_out' => '2026-03-02', 'total' => 100],
    ['id' => 6, 'prop_key' => 'jollyboat', 'name' => 'Nomail Ned', 'email' => '', 'phone' => '', 'check_in' => '2026-04-01', 'check_out' => '2026-04-02', 'total' => 100],
    // Phone-only repeat: same number formatted differently → ONE customer.
    ['id' => 7, 'prop_key' => 'pimpernel', 'name' => 'Phone Pat', 'email' => '', 'phone' => '+44 7700 900123', 'check_in' => '2026-05-01', 'check_out' => '2026-05-03', 'total' => 200],
    ['id' => 8, 'prop_key' => 'pimpernel', 'name' => 'Phone Pat', 'email' => '', 'phone' => '07700900123', 'check_in' => '2026-06-01', 'check_out' => '2026-06-02', 'total' => 100],
];

echo "== Customer directory (server grouping) ==\n";
$cust = customers_group($rows);
$byName = static function (array $cust, string $n): array {
    return array_values(array_filter($cust, static fn($c) => $c['name'] === $n));
};

$sarah = $byName($cust, 'Sarah Wingate');
check('same email (case-insensitive) unifies the stays', count($sarah) === 1 && $sarah[0]['stays'] === 2 && $sarah[0]['nights'] === 6 && (int) round($sarah[0]['revenue']) === 1260);
check('false-merge: two same-name guests with DIFFERENT emails stay separate', count($byName($cust, 'John Smith')) === 2);
check('false-merge: same name with NO email/phone is never merged', count($byName($cust, 'Nomail Ned')) === 2);
$pat = $byName($cust, 'Phone Pat');
check('same phone (different formatting) unifies on the digits', count($pat) === 1 && $pat[0]['stays'] === 2);
check('latest_id / last track the most recent stay', $sarah[0]['latest_id'] === 2 && $sarah[0]['last'] === '2026-07-10');

// Repeat-only + shaping (as the endpoint does).
$repeat = array_values(array_filter($cust, static fn($c) => $c['stays'] >= 2));
check('only repeat customers (>=2 stays) form a unified row', count($repeat) === 2); // Sarah + Pat

echo "\n== Summary ==\n";
if ($fail === 0) {
    echo "  ALL CUSTOMER CHECKS PASSED \xE2\x9C\x85\n";
    exit(0);
}
echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n";
exit(1);
