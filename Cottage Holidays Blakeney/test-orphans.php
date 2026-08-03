<?php
// ============================================================
//  test-orphans.php — guards the ORPHAN SWEEP (payments-reconcile.php):
//  money taken at Square that has no payment row here. Dev/CI only,
//  deploy-excluded. No DB, no clock-dependence, no network.
//
//  Why this one is worth writing carefully: it is the only check in the app
//  that looks at Square's side FIRST, so its failure modes are both expensive
//  and opposite. Too eager and it reports the owner's card-reader takings —
//  or, if the ledger read fails, their entire quarter — as lost money. Too shy
//  and a guest charged by a half-completed pay.php goes on being chased for
//  money they have already paid. So the cases that carry the most checks here
//  are the SILENCES: the payment that must not be reported, and the read that
//  must refuse to answer rather than answer wrongly.
//
//  STUB SQUARE AND THE DATABASE **BEFORE** the require, the test-payouts.php
//  pattern, so the code that pulls shapes out of Square's response is driven
//  for real. PHP resolves function calls at call time, so these win.
// ============================================================

$SQ_CALLS = []; // every request the library made, in order
$SQ_REPLY = ['status' => 200, 'body' => []];
$SQ_ENABLED = true;
$SQ_LOCATION = '';
$DB_QUERIES = []; // every statement the library ran — asserted read-only
$DB_PAYMENTS = []; // square_payment_id column of the ledger
$DB_BOOKINGS = []; // hold_payment_id column of the bookings table
$DB_FAIL = ''; // 'payments' | 'bookings' | ''

function square_enabled()
{
    global $SQ_ENABLED;
    return $SQ_ENABLED;
}
function square_api($method, $path, $payload = null)
{
    global $SQ_CALLS, $SQ_REPLY;
    $SQ_CALLS[] = $method . ' ' . $path;
    return $SQ_REPLY;
}
function square_location_id()
{
    global $SQ_LOCATION;
    return $SQ_LOCATION;
}

class OrphanFakeStmt
{
    private $rows;
    public function __construct($rows)
    {
        $this->rows = $rows;
    }
    public function fetchAll($mode = null, ...$rest)
    {
        return $this->rows;
    }
}
class OrphanFakeDb
{
    public function query($sql)
    {
        global $DB_QUERIES, $DB_PAYMENTS, $DB_BOOKINGS, $DB_FAIL;
        $DB_QUERIES[] = $sql;
        if (strpos($sql, 'FROM payments') !== false) {
            if ($DB_FAIL === 'payments') {
                throw new \RuntimeException('payments table not migrated');
            }
            return new OrphanFakeStmt($DB_PAYMENTS);
        }
        if ($DB_FAIL === 'bookings') {
            throw new \RuntimeException('hold_payment_id column missing');
        }
        return new OrphanFakeStmt($DB_BOOKINGS);
    }
    public function prepare($sql)
    {
        global $DB_QUERIES;
        $DB_QUERIES[] = $sql;
        return new OrphanFakeStmt([]);
    }
}
function db()
{
    return new OrphanFakeDb();
}

require_once __DIR__ . '/payments-reconcile.php';

$pass = 0;
$fail = 0;
function chk($label, $cond)
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  ✓ $label\n";
    } else {
        $fail++;
        echo "  ✗ $label\n";
    }
}

// A Square payment, with only the fields the sweep reads.
function sqp($id, $ref, $pence, $opts = [])
{
    return [
        'id' => $id,
        'reference_id' => $ref,
        'status' => $opts['status'] ?? 'COMPLETED',
        'created_at' => $opts['created_at'] ?? '2026-07-01T10:00:00Z',
        'amount_money' => ['amount' => $pence, 'currency' => $opts['currency'] ?? 'GBP'],
    ] + (isset($opts['refunded']) ? ['refunded_money' => ['amount' => $opts['refunded'], 'currency' => 'GBP']] : []);
}

echo "\n=== 1. Which reference names one of OUR bookings ===\n";
chk('a normal charge reference resolves to its booking', orphan_reference_booking('CHB-000042') === 42);
chk('the legacy card-hold reference resolves to the same booking', orphan_reference_booking('CHBHOLD-000042') === 42);
chk('case does not matter (Square echoes what it is given)', orphan_reference_booking('chb-000042') === 42);
chk('surrounding whitespace does not matter', orphan_reference_booking('  CHB-000042 ') === 42);
// The card reader, a Square invoice, a Square Online order: money in the same
// account that has no row here BY DESIGN. Claiming these are lost takings is how
// a money warning becomes noise, so each is a silence worth pinning.
chk('no reference at all names nothing', orphan_reference_booking('') === null);
chk('a reference this site did not write names nothing', orphan_reference_booking('Invoice #12') === null);
chk('a reference that merely CONTAINS ours names nothing', orphan_reference_booking('XCHB-000042') === null);
chk('a reference with anything trailing names nothing', orphan_reference_booking('CHB-000042-b') === null);
chk('a reference with no digits names nothing', orphan_reference_booking('CHB-') === null);
chk('booking zero is not a booking', orphan_reference_booking('CHB-000000') === null);
chk('a non-string is handled', orphan_reference_booking(null) === null);

echo "\n=== 2. The sweep finds money we do not hold ===\n";
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000)], []);
chk('an unrecorded completed charge is reported', count($r['rows']) === 1 && $r['total'] === 1);
chk('...naming its booking', $r['rows'][0]['booking_id'] === 42);
chk('...and its amount in pounds', abs($r['rows'][0]['amount'] - 450.0) < 0.005);
chk('...and the Square id, so the owner can find it', $r['rows'][0]['id'] === 'sq_a');
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000)], ['sq_a']);
chk('a charge we already hold is NOT reported', $r['total'] === 0);
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000)], ['  sq_a  ', '']);
chk('...and the known-id match tolerates stray whitespace and blanks', $r['total'] === 0);
// THE NOISE CASE, through the scan rather than the helper: the owner's card
// reader and Square invoices take money under the same account and have no row
// here by design. If those were reported, the warning would fire every week the
// owner used their reader and be scrolled past by the time it mattered.
$r = orphan_payments_scan(
    [sqp('sq_reader', '', 2500), sqp('sq_inv', 'Invoice #12', 9900), sqp('sq_a', 'CHB-000042', 45000)],
    [],
);
chk('takings that are not this site\'s are left alone', $r['total'] === 1 && $r['rows'][0]['id'] === 'sq_a');

echo "\n=== 3. Money that did not actually move is never reported ===\n";
foreach (
    [
        'APPROVED' => 'a legacy card HOLD is authorised, not captured',
        'PENDING' => 'a pending charge has taken nothing yet',
        'FAILED' => 'a failed charge took nothing',
        'CANCELED' => 'a cancelled charge took nothing',
    ] as $st => $why
) {
    $r = orphan_payments_scan([sqp('sq_x', 'CHB-000042', 45000, ['status' => $st])], []);
    chk($why . " ($st)", $r['total'] === 0);
}
$r = orphan_payments_scan([sqp('sq_x', 'CHB-000042', 45000, ['status' => 'completed'])], []);
chk('a lowercase COMPLETED still counts (the ledger case rule)', $r['total'] === 1);

echo "\n=== 4. Refunds: net, because money that came and went is not owed ===\n";
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000, ['refunded' => 45000])], []);
chk('a fully refunded charge is not money waiting to be recorded', $r['total'] === 0);
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000, ['refunded' => 50000])], []);
chk('an over-refunded charge is not reported as negative money', $r['total'] === 0);
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000, ['refunded' => 15000])], []);
chk('a PARTIAL refund still leaves money we hold no record of', $r['total'] === 1);
chk('...reported at the NET figure, not the gross', abs($r['rows'][0]['amount'] - 300.0) < 0.005);

echo "\n=== 5. Currency is carried, never converted ===\n";
$r = orphan_payments_scan([sqp('sq_a', 'CHB-000042', 45000, ['currency' => 'USD'])], []);
chk('a non-GBP charge is still an unrecorded payment', $r['total'] === 1);
chk('...and says which currency it is in', $r['rows'][0]['currency'] === 'USD');
chk('...with the figure left in that currency, not turned into pounds', abs($r['rows'][0]['amount'] - 450.0) < 0.005);
$r = orphan_payments_scan([['id' => 'sq_a', 'reference_id' => 'CHB-1', 'status' => 'COMPLETED', 'amount_money' => ['amount' => 100]]], []);
chk('a missing currency defaults to GBP rather than blank', $r['rows'][0]['currency'] === 'GBP');

echo "\n=== 6. Order, cap and the declared total ===\n";
$many = [];
for ($i = 1; $i <= 7; $i++) {
    $many[] = sqp('sq_' . $i, 'CHB-00000' . $i, 1000 * $i, ['created_at' => sprintf('2026-07-%02dT10:00:00Z', $i)]);
}
$r = orphan_payments_scan($many, []);
chk('the cap limits what is named', count($r['rows']) === 5);
chk('...while the TOTAL still says how many there really are', $r['total'] === 7);
chk('newest first, so a capped list shows the most fixable', $r['rows'][0]['id'] === 'sq_7' && $r['rows'][4]['id'] === 'sq_3');
$r = orphan_payments_scan($many, [], 0);
chk('cap 0 means no cap', count($r['rows']) === 7);

echo "\n=== 7. Rubbish in the list does not derail the sweep ===\n";
$r = orphan_payments_scan(['not an array', [], ['id' => ''], sqp('sq_ok', 'CHB-000042', 1000)], []);
chk('malformed entries are skipped and the real one survives', $r['total'] === 1 && $r['rows'][0]['id'] === 'sq_ok');
$r = orphan_payments_scan([], []);
chk('an empty list is not a finding', $r['total'] === 0);

echo "\n=== 8. Driving Square's real response shape ===\n";
$SQ_REPLY = ['status' => 200, 'body' => ['payments' => [sqp('sq_a', 'CHB-000042', 45000)]]];
$DB_PAYMENTS = [];
$DB_BOOKINGS = [];
$SQ_CALLS = [];
$out = reconcile_orphan_payments();
chk('the payments list is read out of body.payments', $out['ok'] === true && $out['total'] === 1);
chk('...and it asked ListPayments', count($SQ_CALLS) === 1 && strpos($SQ_CALLS[0], 'GET /v2/payments?') === 0);
chk('...bounded by a begin_time', strpos($SQ_CALLS[0], 'begin_time=') !== false);
chk('...and no location while none is set', strpos($SQ_CALLS[0], 'location_id') === false);
$SQ_LOCATION = 'LOC123';
$SQ_CALLS = [];
reconcile_orphan_payments();
chk('the read is scoped to the location this site trades under', strpos($SQ_CALLS[0], 'location_id=LOC123') !== false);
$SQ_LOCATION = '';

echo "\n=== 9. What we already hold suppresses the report ===\n";
$DB_PAYMENTS = ['sq_a'];
$out = reconcile_orphan_payments();
chk('a charge in the ledger is not an orphan', $out['ok'] === true && $out['total'] === 0);
// The legacy hold's id lives on the BOOKING, not in payments — reading only the
// ledger would report a captured card hold as money we never recorded.
$DB_PAYMENTS = [];
$DB_BOOKINGS = ['sq_a'];
$out = reconcile_orphan_payments();
chk('a captured card hold, whose id lives on the booking, is not an orphan', $out['total'] === 0);
$DB_BOOKINGS = [];

echo "\n=== 10. A read that cannot answer says so — it never answers wrongly ===\n";
// THE EXPENSIVE DIRECTION. With the ledger unreadable and an empty known-set,
// every genuine payment of the last sixty days reads as unrecorded and the sweep
// reports the owner's whole quarter as lost money.
$DB_FAIL = 'payments';
$out = reconcile_orphan_payments();
chk('an unreadable ledger refuses to answer', $out['ok'] === false);
chk('...and reports NOTHING rather than every payment as an orphan', $out['total'] === 0 && $out['rows'] === []);
chk('...in words the owner can act on', strpos($out['reason'], 'ledger') !== false);
// A hold column that was never migrated is a different matter: the ledger alone
// still answers the question, so degrade rather than refuse.
$DB_FAIL = 'bookings';
$out = reconcile_orphan_payments();
chk('an un-migrated hold column degrades to the ledger alone', $out['ok'] === true && $out['total'] === 1);
$DB_FAIL = '';

echo "\n=== 11. Square not answering is not a finding ===\n";
$SQ_ENABLED = false;
$SQ_CALLS = [];
$out = reconcile_orphan_payments();
chk('Square switched off reports nothing', $out['ok'] === false && $out['total'] === 0);
chk('...without making a request', count($SQ_CALLS) === 0);
$SQ_ENABLED = true;
$SQ_REPLY = ['status' => 403, 'body' => []];
$out = reconcile_orphan_payments();
chk('a 403 names the missing permission rather than showing an empty screen', $out['ok'] === false && strpos($out['reason'], "can't read payments") !== false);
$SQ_REPLY = ['status' => 500, 'body' => []];
$out = reconcile_orphan_payments();
chk('any other failure says what happened', $out['ok'] === false && strpos($out['reason'], '500') !== false);
$SQ_REPLY = ['status' => 200, 'body' => ['payments' => 'not a list']];
$out = reconcile_orphan_payments();
chk('a malformed body is an empty answer, not a crash', $out['ok'] === true && $out['total'] === 0);

echo "\n=== 12. The cap is declared, never silent ===\n";
$page = [];
for ($i = 1; $i <= ORPHAN_LIST_MAX; $i++) {
    $page[] = sqp('sq_p' . $i, 'CHB-000001', 1000);
}
$SQ_REPLY = ['status' => 200, 'body' => ['payments' => $page]];
$out = reconcile_orphan_payments();
chk('a full page says we did not see everything', $out['truncated'] === true);
$SQ_REPLY = ['status' => 200, 'body' => ['payments' => [sqp('sq_a', 'CHB-1', 100)], 'cursor' => 'more']];
$out = reconcile_orphan_payments();
chk('a cursor says the same', $out['truncated'] === true);
$SQ_REPLY = ['status' => 200, 'body' => ['payments' => [sqp('sq_a', 'CHB-1', 100)]]];
$out = reconcile_orphan_payments();
chk('one short page does not claim to be truncated', $out['truncated'] === false);

echo "\n=== 13. IT FLAGS, IT NEVER WRITES ===\n";
// The point of the whole design: recording money is the owner's decision. A
// sweep that quietly inserted a payment row would be inventing a fact about
// their books from a third party's list.
$DB_QUERIES = [];
$SQ_CALLS = [];
reconcile_orphan_payments();
$wrote = false;
foreach ($DB_QUERIES as $q) {
    if (preg_match('/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i', $q)) {
        $wrote = true;
    }
}
chk('no statement it ran writes anything', !$wrote && count($DB_QUERIES) >= 2);
$postish = false;
foreach ($SQ_CALLS as $c) {
    if (strpos($c, 'GET ') !== 0) {
        $postish = true;
    }
}
chk('and it only ever asks Square, never tells it', !$postish && count($SQ_CALLS) === 1);
// Read-only asserted from the SOURCE too, so a future edit inside the function
// cannot slip a write past a fixture that happens not to reach it.
$rf = new ReflectionFunction('reconcile_orphan_payments');
$src = implode('', array_slice(file($rf->getFileName()), $rf->getStartLine() - 1, $rf->getEndLine() - $rf->getStartLine() + 1));
chk('the sweep is read-only in the source as well', strlen($src) > 400 && !preg_match('/\b(INSERT|UPDATE|DELETE)\b/i', $src));

echo "\n=== 14. Wired into the daily self-repair, at the right severity ===\n";
// Testing the helper alone passes with the call site removed — the trap this
// codebase has walked into more than once. So the wiring is asserted too.
$sr = file_get_contents(__DIR__ . '/self-repair.php');
chk('self-repair requires the reconcile lib', strpos($sr, "require_once __DIR__ . '/payments-reconcile.php'") !== false);
chk('...and actually calls the sweep', strpos($sr, 'reconcile_orphan_payments()') !== false);
chk('...logging it as something that needs attention', preg_match('/selfrepair\.square_orphan.*?\n(.*?\n){0,12}?.*?warn/s', $sr) === 1);
chk('...against the booking, so the log row can route to it', strpos($sr, "'entity' => 'booking'") !== false);
// Raised ONCE per payment, not every night: a nightly repeat of the same sum is
// how an owner learns to scroll past the warnings that matter.
chk('a payment already reported is remembered', strpos($sr, "orphan_square") !== false && strpos($sr, 'in_array($row[\'id\'], $seen, true)') !== false);
chk('...and the remembered list is capped', preg_match('/array_slice\(\$seen, -\d+\)/', $sr) === 1);

echo "\n" . ($fail ? "✗ $fail FAILED, $pass passed\n" : "✓ ALL $pass CHECKS PASSED\n");
exit($fail ? 1 : 0);
