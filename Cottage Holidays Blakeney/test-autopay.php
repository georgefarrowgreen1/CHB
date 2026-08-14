<?php
// ============================================================
//  test-autopay.php — guards the automatic balance collection. Dev/CI only,
//  deploy-excluded. No DB, no network, and every case passes an explicit "today".
//
//  This is the only code in the app that takes money with nobody pressing
//  anything, so the asymmetry it is built on is the thing to test: not
//  collecting is an inconvenience the ordinary chase already covers, while
//  charging someone who did not agree — or twice, or a figure they never saw —
//  is a different kind of failure. So the SILENCES carry more checks than the
//  collections, and every refusal is break-tested.
//
//  Square and the database are stubbed BEFORE the require (the test-payouts
//  pattern) so the code that builds the Square request and reads its reply is
//  driven for real. PHP resolves calls at call time, so these definitions win.
// ============================================================

$SQ_CALLS = []; // [method.' '.path, payload] per request, in order
$SQ_REPLY = []; // path fragment => ['status'=>int,'body'=>array]
$CONTENT = []; // content-table rows (item_key => value) for ApContentStmt
$SQ_ENABLED = true;
$DB_WRITES = []; // [sql, args]
$DB_ROW = []; // what SELECT * FROM bookings returns
$DB_LIST = []; // what the run's candidate query returns
$LOCKED = true; // book_lock's answer

function square_enabled()
{
    global $SQ_ENABLED;
    return $SQ_ENABLED;
}
function square_api($method, $path, $payload = null)
{
    global $SQ_CALLS, $SQ_REPLY;
    $SQ_CALLS[] = [$method . ' ' . $path, $payload];
    foreach ($SQ_REPLY as $frag => $res) {
        if (strpos($path, $frag) !== false) {
            return $res;
        }
    }
    return ['status' => 404, 'body' => []];
}
function square_location_id()
{
    return 'LOC1';
}
function book_lock($k)
{
    global $LOCKED;
    return $LOCKED;
}
function book_unlock($k)
{
    return true;
}
function log_activity($c, $a, $s, $o = [])
{
    return true;
}

class ApStmt
{
    private $rows;
    public function __construct($rows)
    {
        $this->rows = $rows;
    }
    public function execute($args = null)
    {
        return true;
    }
    public function fetch()
    {
        return $this->rows ? $this->rows[0] : false;
    }
    public function fetchAll($m = null, ...$r)
    {
        return $this->rows;
    }
    public function fetchColumn($i = 0)
    {
        return $this->rows ? reset($this->rows[0]) : false;
    }
}
class ApWrite extends ApStmt
{
    private $sql;
    public function __construct($sql)
    {
        parent::__construct([]);
        $this->sql = $sql;
    }
    public function execute($args = null)
    {
        global $DB_WRITES;
        $DB_WRITES[] = [$this->sql, $args];
        return true;
    }
}
// The content table, as instalment_floor_months (and square_deposit_pct) read
// it — keyed off the bound param so a test can set the floor and leave every
// other key answering "nothing stored" exactly as the empty stub always has.
class ApContentStmt extends ApStmt
{
    private $key = '';
    public function __construct()
    {
        parent::__construct([]);
    }
    public function execute($args = null)
    {
        $this->key = is_array($args) ? (string) ($args[0] ?? '') : '';
        return true;
    }
    public function fetch()
    {
        global $CONTENT;
        return isset($CONTENT[$this->key]) ? ['item_value' => json_encode($CONTENT[$this->key])] : false;
    }
}
class ApDb
{
    public function prepare($sql)
    {
        global $DB_ROW, $DB_LIST;
        if (stripos($sql, 'FROM content') !== false) {
            return new ApContentStmt();
        }
        if (stripos($sql, 'SELECT * FROM bookings WHERE id') !== false) {
            return new ApStmt($DB_ROW ? [$DB_ROW] : []);
        }
        if (stripos($sql, 'SELECT * FROM bookings') !== false) {
            return new ApStmt($DB_LIST);
        }
        if (preg_match('/^\s*(UPDATE|INSERT)/i', $sql)) {
            return new ApWrite($sql);
        }
        return new ApStmt([]);
    }
    public function query($sql)
    {
        return $this->prepare($sql);
    }
}
function db()
{
    return new ApDb();
}

// The handful of db.php helpers pricing.php reaches for. db.php itself cannot be
// required here — it declares db(), which is the thing being stubbed — so these
// are the seam. Each is the identity/no-op that keeps the money arithmetic
// honest rather than a second implementation of it.
function booking_paid_so_far($b)
{
    return round((float) ($b['deposit_paid'] ?? 0), 2);
}
function booking_ledger_net($id)
{
    return 0.0;
}
function uk_date($iso)
{
    $t = strtotime((string) $iso);
    return $t ? date('d/m/Y', $t) : (string) $iso;
}
function payment_status_norm($s)
{
    return strtoupper(trim((string) $s));
}
// The mail seam. Captured rather than sent, so the RECEIPT and the NOTICE can be
// asserted on their real payloads without an SMTP server — the two things this
// feature was missing entirely, and both are now checked for what they SAY.
$MAIL = [];
$MAIL_OK = true;
function send_payment_receipt($b)
{
    global $MAIL, $MAIL_OK;
    $MAIL[] = ['receipt', $b];
    return ['ok' => $MAIL_OK];
}
function send_autopay_notice($b, $payUrl = null)
{
    global $MAIL, $MAIL_OK;
    $MAIL[] = ['notice', $b];
    return ['ok' => $MAIL_OK];
}
function send_autopay_failure($b, $why, $stopped, $today = null, $charge = null, $restNow = null)
{
    global $MAIL, $MAIL_OK;
    $MAIL[] = ['failure', $b, $stopped, $charge, $restNow];
    return ['ok' => $MAIL_OK];
}
function prop_display($k)
{
    return ['name' => 'Jollyboat'];
}
function site_base_url()
{
    return 'https://example.test/';
}
function invoice_token($id)
{
    return 'tok' . (int) $id;
}
function mailed($kind)
{
    global $MAIL;
    foreach ($MAIL as $m) {
        if ($m[0] === $kind) {
            return $m[1];
        }
    }
    return null;
}

require_once __DIR__ . '/pricing.php';
require_once __DIR__ . '/autopay-lib.php';

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
function wrote($needle)
{
    global $DB_WRITES;
    foreach ($DB_WRITES as $w) {
        if (stripos($w[0], $needle) !== false) {
            return $w;
        }
    }
    return null;
}
function sqCall($frag)
{
    global $SQ_CALLS;
    foreach ($SQ_CALLS as $c) {
        if (strpos($c[0], $frag) !== false) {
            return $c;
        }
    }
    return null;
}
$TODAY = '2026-08-03';
// A booking with the arrangement live and the day arrived. £300 rental left, no
// damages deposit outstanding (it rode the first payment), agreed on those terms.
function apbk($over = [])
{
    return array_merge(
        [
            'id' => 42,
            'name' => 'Sarah Pemberton',
            'email' => 's@example.com',
            'prop_key' => 'jollyboat',
            'check_in' => '2026-09-10',
            'check_out' => '2026-09-17',
            'adults' => 2,
            'children' => 0,
            'agreed_total' => 400.0,
            'price_override' => null,
            'deposit_paid' => 100.0,
            'damages_deposit' => 0.0,
            'hold_status' => 'charged',
            'hold_amount' => 0.0,
            'deposit_pct_override' => 25.0,
            'deposit_amount_override' => null,
            'balance_due_date' => '2026-08-03',
            'autopay_consent_at' => '2026-07-01 10:00:00',
            'autopay_revoked_at' => null,
            'autopay_card_id' => 'ccof:abc',
            'autopay_customer_id' => 'CUST1',
            'autopay_amount' => 300.0,
            'autopay_due' => '2026-08-03',
            'autopay_attempts' => 0,
            'autopay_last_try' => null,
            'autopay_last_error' => null,
        ],
        $over,
    );
}
function reset_env($row = null)
{
    global $SQ_CALLS, $DB_WRITES, $DB_ROW, $SQ_REPLY, $LOCKED, $SQ_ENABLED;
    $SQ_CALLS = [];
    $DB_WRITES = [];
    $LOCKED = true;
    $SQ_ENABLED = true;
    $DB_ROW = $row === null ? apbk() : $row;
    $SQ_REPLY = ['/v2/payments' => ['status' => 200, 'body' => ['payment' => ['id' => 'sq_new', 'status' => 'COMPLETED']]]];
}

echo "\n=== 1. Is this failure worth trying again? ===\n";
// Default HARD, deliberately: an unrecognised decline retried three times is
// three presentations of a card that may be refusing for a reason the guest
// would rather we noticed the first time. Treating a blip as final merely falls
// back to the chase that would have happened anyway — the cheap direction.
chk('a declined card is final', autopay_decline_kind('CARD_DECLINED') === 'hard');
chk('an expired card is final', autopay_decline_kind('CARD_EXPIRED') === 'hard');
chk('insufficient funds is final', autopay_decline_kind('INSUFFICIENT_FUNDS') === 'hard');
chk("Square's own \"try again\" is soft", autopay_decline_kind('TEMPORARY_ERROR') === 'soft');
chk('a rate limit is soft', autopay_decline_kind('RATE_LIMITED') === 'soft');
chk('a gateway timeout is soft', autopay_decline_kind('GATEWAY_TIMEOUT') === 'soft');
chk('case and padding do not matter', autopay_decline_kind('  temporary_error ') === 'soft');
chk('an UNRECOGNISED code is treated as final', autopay_decline_kind('SOMETHING_NEW') === 'hard');
chk('an empty code is treated as final', autopay_decline_kind('') === 'hard');

echo "\n=== 2. The state machine says when it may run at all ===\n";
chk('armed on the day', booking_autopay_state(apbk(), $TODAY)[0] === 'armed');
chk('never agreed → off', booking_autopay_state(apbk(['autopay_consent_at' => null]), $TODAY)[0] === 'off');
chk('turned off → revoked', booking_autopay_state(apbk(['autopay_revoked_at' => '2026-07-05']), $TODAY)[0] === 'revoked');
chk('no saved card → nocard', booking_autopay_state(apbk(['autopay_card_id' => '']), $TODAY)[0] === 'nocard');
// The amount or the day moving means the figure the guest saw is not the figure
// we would take, and consent does not stretch to cover it.
chk('the agreed AMOUNT no longer matches → stale', booking_autopay_state(apbk(['autopay_amount' => 250.0]), $TODAY)[0] === 'stale');
chk('the agreed DAY no longer matches → stale', booking_autopay_state(apbk(['autopay_due' => '2026-08-20']), $TODAY)[0] === 'stale');
chk('already settled → settled', booking_autopay_state(apbk(['deposit_paid' => 400.0]), $TODAY)[0] === 'settled');
// GIVEN UP. Without a counter the only retry policy is "for ever", which on a
// declined card is how a guest collects bank fees.
chk('out of attempts → failed', booking_autopay_state(apbk(['autopay_attempts' => AUTOPAY_MAX_TRIES]), $TODAY)[0] === 'failed');
chk('...and it says what went wrong', strpos(booking_autopay_state(apbk(['autopay_attempts' => 3, 'autopay_last_error' => 'Your bank declined it.']), $TODAY)[1], 'declined') !== false);
chk('failed does NOT clear consent — "changed their mind" stays a different fact',
    !empty(apbk(['autopay_attempts' => 3])['autopay_consent_at']) && booking_autopay_state(apbk(['autopay_attempts' => 3]), $TODAY)[0] !== 'revoked');
chk('nothing may be charged unless armed', booking_autopay_may_charge(apbk(['autopay_revoked_at' => '2026-07-05']), $TODAY) === false);
chk('nothing may be charged before the agreed day', booking_autopay_may_charge(apbk(['autopay_due' => '2026-08-04', 'balance_due_date' => '2026-08-04']), $TODAY) === false);
// `>=`, the watchers_due rule: a pass that fails on the due date must still
// collect the next day rather than skip the payment altogether.
chk('a missed day is collected LATE, never skipped', booking_autopay_may_charge(apbk(), '2026-08-09') === true);

echo "\n=== 3. One go a day, not one a tick ===\n";
chk('never tried → try now', autopay_try_due(apbk(), $TODAY) === true);
chk('tried today → not again today', autopay_try_due(apbk(['autopay_last_try' => $TODAY]), $TODAY) === false);
chk('tried yesterday → try again', autopay_try_due(apbk(['autopay_last_try' => '2026-08-02']), $TODAY) === true);
chk('the date shift survives a DST boundary', ukShiftDaysPhp('2026-03-28', 1) === '2026-03-29' && ukShiftDaysPhp('2026-10-24', 1) === '2026-10-25');
chk('...and a year end', ukShiftDaysPhp('2026-12-31', 1) === '2027-01-01');

echo "\n=== 4. Collecting, for real, through the Square request it builds ===\n";
reset_env();
[$v, $line] = autopay_collect_one(apbk(), $TODAY);
chk('it collects', $v === 'ok');
chk('...saying how much and from whom', strpos($line, '300.00') !== false && strpos($line, 'Sarah') !== false);
$call = sqCall('/v2/payments');
chk('...charging the SAVED card, not a nonce', $call && $call[1]['source_id'] === 'ccof:abc');
chk("...against the guest's Square customer", $call && $call[1]['customer_id'] === 'CUST1');
chk('...for the agreed sum, in pence', $call && $call[1]['amount_money']['amount'] === 30000);
chk('...in sterling', $call && $call[1]['amount_money']['currency'] === 'GBP');
// The reference is what the orphan sweep matches on; without it a collection
// that failed to write its row would be invisible to that check.
chk('...carrying the reference the orphan sweep reads', $call && $call[1]['reference_id'] === 'CHB-000042');
chk('...scoped to the trading location', $call && $call[1]['location_id'] === 'LOC1');
// MERCHANT-INITIATED, and it has to say so: nobody is at the keyboard, and
// telling the issuer otherwise is both untrue and what gets a card-on-file
// charge declined.
chk('...and declaring that the guest did NOT initiate it', $call && $call[1]['customer_details']['customer_initiated'] === false);
// Deterministic and keyed on booking + day + sum: a retry of the same attempt
// collapses at Square, a genuinely different collection does not.
chk('the idempotency key names the booking, the day and the sum', $call && $call[1]['idempotency_key'] === 'chb-auto-42-2026-08-03-30000');
$led = wrote('INSERT IGNORE INTO payments');
chk('the ledger gets the same row shape a manual payment writes', $led && in_array('balance', $led[1], true) && in_array(300.0, $led[1], true));
chk('the booking is moved to paid', wrote('SET deposit_paid') && in_array('paid', wrote('SET deposit_paid')[1], true));

echo "\n=== 5. The silences — every one of them costs nothing to be wrong about ===\n";
foreach (
    [
        ['revoked', ['autopay_revoked_at' => '2026-07-05']],
        ['never agreed', ['autopay_consent_at' => null]],
        ['no card', ['autopay_card_id' => '']],
        ['terms moved', ['autopay_amount' => 250.0]],
        ['already settled', ['deposit_paid' => 400.0]],
        ['out of attempts', ['autopay_attempts' => 3]],
        ['already tried today', ['autopay_last_try' => $TODAY]],
        ['the day has not come', ['autopay_due' => '2026-08-20', 'balance_due_date' => '2026-08-20']],
    ] as [$why, $over]
) {
    reset_env(apbk($over));
    [$v] = autopay_collect_one(apbk($over), $TODAY);
    chk("$why → nothing is charged", $v === 'skip' && sqCall('/v2/payments') === null);
}
// THE RACE THAT ACTUALLY HAPPENS: the row changes between the pass reading it
// and reaching the lock. Everything before the lock is an index; the state is
// asked AGAIN inside it, and that is what makes it safe.
reset_env(apbk(['deposit_paid' => 400.0]));
[$v] = autopay_collect_one(apbk(), $TODAY);
chk('a guest who paid between the read and the lock is not charged again', $v === 'skip' && sqCall('/v2/payments') === null);
// …and the case that ONLY the re-check can catch. The one above is also stopped
// by the zero-charge floor, so on its own it proves the floor rather than the
// re-read: a guest who REVOKES in that window still owes exactly £300, so
// nothing about the money has moved and the state is the only thing that knows.
reset_env(apbk(['autopay_revoked_at' => '2026-08-03 09:00:00']));
[$v] = autopay_collect_one(apbk(), $TODAY);
chk('a guest who turns it off between the read and the lock is not charged', $v === 'skip' && sqCall('/v2/payments') === null);
reset_env();
$LOCKED = false;
[$v] = autopay_collect_one(apbk(), $TODAY);
chk('a cottage already mid-payment is left alone', $v === 'skip' && sqCall('/v2/payments') === null);

echo "\n=== 6. When the card says no ===\n";
reset_env();
$SQ_REPLY = ['/v2/payments' => ['status' => 402, 'body' => ['errors' => [['code' => 'CARD_DECLINED', 'detail' => 'raw square detail']]]]];
[$v, $line] = autopay_collect_one(apbk(), $TODAY);
chk('a decline is reported as a failure', $v === 'fail');
// The owner reads this. payment_decline_message is the house voice for a Square
// code, and it is used here for the same reason pay.php uses it.
// The house voice for a Square code is payment_decline_message, gated in
// test-payrail; what is at risk HERE is whether this path consults it at all
// rather than printing whatever Square sent. db.php cannot be loaded in this
// file (it declares db()), so the wiring is what gets asserted.
chk('...through the house voice rather than raw Square detail', (function () {
    $r = new ReflectionFunction('autopay_square_why');
    $src = implode('', array_slice(file($r->getFileName()), $r->getStartLine() - 1, $r->getEndLine() - $r->getStartLine() + 1));
    return strpos($src, 'payment_decline_message') !== false && strpos($src, "\$res['body']") !== false;
})());
$w = wrote('autopay_attempts = ?');
chk('a HARD decline stops it dead rather than re-presenting the card', $w && (int) $w[1][0] === AUTOPAY_MAX_TRIES);
reset_env();
$SQ_REPLY = ['/v2/payments' => ['status' => 500, 'body' => ['errors' => [['code' => 'TEMPORARY_ERROR']]]]];
[$v] = autopay_collect_one(apbk(), $TODAY);
chk('a SOFT failure costs one attempt, not all three', $v === 'fail' && wrote('autopay_attempts = autopay_attempts + 1') !== null);
chk('...and it is dated, so the retry is tomorrow', wrote('autopay_attempts = autopay_attempts + 1')[1][0] === $TODAY);

echo "\n=== 7. Saving the card, and never at the payment's expense ===\n";
reset_env();
$SQ_REPLY = ['/v2/cards' => ['status' => 200, 'body' => ['card' => ['id' => 'ccof:new']]]];
$terms = ['amount' => 300.0, 'due' => '2026-08-03'];
$r = autopay_vault(apbk(['autopay_customer_id' => 'CUST1']), 'sq_paid', $terms);
chk('a completed payment is a valid source for the saved card', $r['ok'] === true && $r['card_id'] === 'ccof:new');
$c = sqCall('/v2/cards');
chk('...vaulted from that payment', $c && $c[1]['source_id'] === 'sq_paid');
$w = wrote('autopay_card_id = ?');
chk('consent and its TERMS are written together', $w && in_array(300.0, $w[1], true) && in_array('2026-08-03', $w[1], true));
chk('...and any earlier revocation is cleared, so re-agreeing works', $w && strpos($w[0], 'autopay_revoked_at = NULL') !== false);
chk('...and the attempt counter is reset with it', $w && strpos($w[0], 'autopay_attempts = 0') !== false);
// COALESCE: re-paying must never re-date an older agreement, or the audit trail
// says they agreed on a day they did not.
chk('the original consent date is never overwritten', $w && strpos($w[0], 'COALESCE(autopay_consent_at') !== false);
// NO TERMS, NO CONSENT: a saved card with no agreed sum or date is a stored card
// the guest was never asked about.
reset_env();
chk('nothing to schedule → no card is saved', autopay_vault(apbk(), 'sq_paid', null)['ok'] === false && sqCall('/v2/cards') === null);
chk('no payment to save from → no card is saved', autopay_vault(apbk(), '', $terms)['ok'] === false && sqCall('/v2/cards') === null);
reset_env();
$SQ_ENABLED = false;
chk('Square switched off → no card, and it says why', autopay_vault(apbk(), 'sq_paid', $terms)['ok'] === false);
reset_env();
$SQ_REPLY = ['/v2/cards' => ['status' => 400, 'body' => ['errors' => [['code' => 'CARD_EXPIRED']]]]];
$r = autopay_vault(apbk(['autopay_customer_id' => 'CUST1']), 'sq_paid', $terms);
chk("a refusal from Square leaves no consent recorded", $r['ok'] === false && wrote('autopay_card_id = ?') === null);
chk('...explained rather than left blank', trim((string) $r['reason']) !== '');
// A customer per BOOKING, not per guest: reusing one across a guest's stays
// would let consent given for one authorise a charge on another.
reset_env();
$SQ_REPLY = [
    '/v2/customers' => ['status' => 200, 'body' => ['customer' => ['id' => 'CUSTNEW']]],
    '/v2/cards' => ['status' => 200, 'body' => ['card' => ['id' => 'ccof:x']]],
];
$r = autopay_vault(apbk(['autopay_customer_id' => null]), 'sq_paid', $terms);
chk('a booking with no customer yet gets its own', $r['ok'] === true && $r['customer_id'] === 'CUSTNEW');
chk('...keyed so a retry cannot make a second one', sqCall('/v2/customers')[1]['idempotency_key'] === 'chb-cust-42');

echo "\n=== 8. The daily pass ===\n";
reset_env();
$DB_LIST = [apbk(), apbk(['id' => 43, 'autopay_revoked_at' => '2026-07-05'])];
$out = autopay_run($TODAY);
chk('it collects what it can and skips what it must', $out['collected'] === 1 && $out['skipped'] === 1);
$DB_LIST = [];
reset_env();
$SQ_ENABLED = false;
$out = autopay_run($TODAY);
chk('Square off → the pass does nothing and says so', $out['ok'] === false && $out['collected'] === 0);

echo "\n=== 9. Wiring — the helper is not the feature ===\n";
$cron = file_get_contents(__DIR__ . '/cron.php');
chk('the pass runs daily', strpos($cron, 'autopay-run.php?cron=') !== false);
// Collect BEFORE chasing, or a guest is emailed for money taken ten seconds later.
chk('...BEFORE the chasers', strpos($cron, 'autopay-run.php') < strpos($cron, 'payments-due.php'));
$due = file_get_contents(__DIR__ . '/payments-due.php');
chk('an ARMED balance is not chased', substr_count($due, "booking_autopay_state(\$b)[0] === 'armed'") === 2);
// Only 'armed' suppresses — anything else must chase exactly as before, which is
// what makes the fallback real rather than a hole.
chk("...and nothing else suppresses the chase", strpos($due, "!== 'off'") === false && strpos($due, "'failed'") === false);
// EVERY COLUMN THE COLLECTOR WRITES MUST EXIST. The harness's ApWrite accepts any
// SQL string and returns true, so a statement naming a column that is not there
// passed every check here while throwing against the real database — and because
// autopay_record_success wraps its write AND its fallback in catches, a successful
// Square charge then wrote nothing back at all: autopay_next_at never advanced, so
// a monthly plan re-collected the next morning, and every morning after. Read the
// real column list out of schema.sql + the migrations and hold the source to it.
$apLibSrc = file_get_contents(__DIR__ . '/autopay-lib.php');
$schemaAll = file_get_contents(__DIR__ . '/schema.sql');
foreach (glob(__DIR__ . '/migration-*.sql') as $mg) {
    $schemaAll .= "\n" . file_get_contents($mg);
}
$bkBlock = '';
if (preg_match('/CREATE TABLE IF NOT EXISTS bookings \((.*?)\n\) ENGINE/s', $schemaAll, $mm)) {
    $bkBlock = $mm[1];
}
$bookingCols = [];
foreach (preg_split('/\r?\n/', $bkBlock) as $ln) {
    if (preg_match('/^\s*([a-z_][a-z0-9_]*)\s+(INT|VARCHAR|DECIMAL|DATE|DATETIME|ENUM|TEXT|TINYINT)/i', $ln, $cm)) {
        $bookingCols[strtolower($cm[1])] = true;
    }
}
foreach (['ALTER TABLE bookings\s+ADD COLUMN\s+([a-z_][a-z0-9_]*)'] as $re) {
    if (preg_match_all('/' . $re . '/i', $schemaAll, $am)) {
        foreach ($am[1] as $c) {
            $bookingCols[strtolower($c)] = true;
        }
    }
}
// NB chk() takes TWO arguments — a third is accepted at runtime and silently
// ignored, so any detail has to ride the label.
chk('(fixture) the bookings column list parsed — ' . count($bookingCols) . ' columns', count($bookingCols) > 25);
$badCols = [];
if (preg_match_all('/UPDATE bookings SET (.+?) WHERE/s', $apLibSrc, $um)) {
    foreach ($um[1] as $setClause) {
        if (preg_match_all('/([a-z_][a-z0-9_]*)\s*=/i', $setClause, $sm)) {
            foreach ($sm[1] as $col) {
                $col = strtolower($col);
                if (!isset($bookingCols[$col])) {
                    $badCols[$col] = true;
                }
            }
        }
    }
}
chk('every column the collector writes to bookings exists in the schema'
    . ($badCols ? ' — unknown: ' . implode(', ', array_keys($badCols)) : ''), !$badCols);
// And the write-back must not be able to fail in silence over money already taken.
chk('a swallowed write-back after a SUCCESSFUL charge is reported, not swallowed',
    strpos($apLibSrc, 'autopay.writeback_failed') !== false);

$paySrc = file_get_contents(__DIR__ . '/pay.php');
// The screen passes the stage IT resolved ($kind) rather than letting the helper
// derive a second one — a screen settling the whole stay must not offer to schedule
// the very money it is collecting.
chk('the pay screen offers the arrangement', strpos($paySrc, "'autopayTerms' => booking_autopay_terms(\$b, 1, \$kind)") !== false);
chk('...and the monthly offer beside it', strpos($paySrc, "'instalmentOffer' => \$kind === 'hold' ? null : booking_instalment_offer(\$b)") !== false);
// THE RUN LOADS ITS OWN DECISIONS. autopay-run.php never required pricing.php,
// and autopay_run → booking_autopay_state lives there — every cron run FATALED
// on the first candidate, latent only because no consent existed in production.
chk('the collection run loads pricing, where its decisions live', strpos(file_get_contents(__DIR__ . '/autopay-run.php'), "require_once __DIR__ . '/pricing.php';") !== false);
// CONSENT NEVER RIDES A SLICE. booking_autopay_terms describes the rest after
// the FULL ask; recorded beside a part payment, the agreed sum can never match
// what booking_autopay_state derives at collection — the arrangement would sit
// "agreed" and silently never fire. The client hides the offer while a slice is
// armed (ui-test-pay); this is the server's half, for the stale tab that sends both.
chk('...and vaults only when asked, never on a slice', strpos($paySrc, "if (!empty(\$in['autopay']) && !\$partial)") !== false);
// THE PAYMENT MUST NEVER BE LOST BECAUSE THE CONVENIENCE FAILED: the vault runs
// after the money is taken and the ledger written, and cannot reach the response.
chk('...after the ledger is written', strpos($paySrc, 'autopay_vault(') > strpos($paySrc, 'INSERT IGNORE INTO payments'));
// The instalment lines sit between the require and the call now — what must
// stay true is that the WHOLE consent path lives inside the one try.
chk('...wrapped so it cannot fail the payment', preg_match('/try \{\s*require_once __DIR__ \. .\/autopay-lib\.php.;[\s\S]{0,700}\$vault = autopay_vault/', $paySrc) === 1);
chk('the guest can turn it off from the screen that offered it', strpos($paySrc, "\$action === 'autopay_off'") !== false);
$appSrc = file_get_contents(__DIR__ . '/app.js');
// The consent card is a three-way decision now — the sum and the day still
// live IN the words: the caption carries the sum, the lead and the one-payment
// option carry the day.
chk('the card names the sum and the day', preg_match('/The \$\{gbp\(t\.amount\)\} that.s left/', $appSrc) === 1 && preg_match('/taken automatically on \$\{fmtDate\(t\.due\)\}/', $appSrc) === 1);
chk('...and is only offered when there is something to schedule', strpos($appSrc, "s.autopayState === 'off'") !== false);
chk('...read at the moment of paying, not from the render', strpos($appSrc, "autopay: payState.autopayChoice === 'one' || payState.autopayChoice === 'monthly'") !== false);
chk("...and the DEFAULT is \"I'll pay it myself\" — consent is opted into", strpos($appSrc, "payState.autopayChoice = 'self';") !== false);
chk('My Stays shows an arranged balance as arranged, not as owing', strpos($appSrc, "b.autopayState === 'armed'") !== false);
chk('...with the off switch beside it', strpos($appSrc, 'guestAutopayOff') !== false);
chk('turning it off asks first, in terms of the consequence', preg_match("/glassConfirm\(\s*\"We'll stop collecting/", $appSrc) === 1);

// ============================================================
//  THE THREE THINGS AUTOMATIC COLLECTION DID NOT SAY
// ============================================================

echo "\n-- a collection tells the guest --\n";
// This was the ONE charge in the app that sent nothing. Every other payment ends
// in send_payment_receipt, and the path where the guest was not at the keyboard
// is exactly the one where silence is worst: the first they would know is their
// statement, and an unrecognised charge is what a chargeback is made of.
$MAIL = [];
$DB_WRITES = [];
$SQ_CALLS = [];
$SQ_REPLY = ['/v2/payments' => ['status' => 200, 'body' => ['payment' => ['id' => 'sq_auto1', 'status' => 'COMPLETED', 'processing_fee' => [['amount_money' => ['amount' => 512]]]]]]];
$b = apbk();
$DB_ROW = $b;
autopay_collect_one($b, $TODAY);
$rc = mailed('receipt');
chk('a successful collection emails the guest a receipt', is_array($rc));
chk('...for the sum actually taken', $rc && abs((float) $rc['amount'] - 300.0) < 0.005);
chk('...to their address, naming the cottage', $rc && $rc['email'] === 's@example.com' && $rc['prop_name'] === 'Jollyboat');
chk('...carrying the invoice link, like every other receipt', $rc && strpos((string) $rc['invoice_url'], 'invoice.php?b=42') !== false);
// The flag that makes the wording honest. Without it the guest is thanked for a
// payment they did not make, which reads as an acknowledgement of something they
// just did — see the composer.
chk('...and MARKED automatic, so it cannot be worded as a thank-you', $rc && !empty($rc['automatic']));
// A mail failure must never propagate: the money is taken and the ledger is
// written by the time this runs.
$MAIL_OK = false;
$MAIL = [];
$DB_WRITES = [];
$ok = true;
try {
    autopay_collect_one(apbk(), $TODAY);
} catch (\Throwable $e) {
    $ok = false;
}
chk('a failing mail server never breaks a collection that already happened', $ok);
$MAIL_OK = true;

echo "\n-- they are warned before the money moves --\n";
// They consented to a sum on a date, possibly months earlier. A dispute on a
// card-on-file charge costs the fee AND gets the money ring-fenced, so the
// notice is the cheap insurance as well as the decent thing.
$due = '2026-08-20';
$armed = apbk(['autopay_due' => $due, 'balance_due_date' => $due, 'autopay_amount' => 300.0]);
chk('no notice while the charge is still far off', !autopay_notice_due($armed, '2026-08-01'));
chk('a notice falls due three days before', autopay_notice_due($armed, '2026-08-17'));
chk('...and on the two days after that', autopay_notice_due($armed, '2026-08-18') && autopay_notice_due($armed, '2026-08-19'));
// On the day itself the charge speaks for itself; a "heads-up" arriving with the
// money is not a warning.
chk('no notice on the day the money is taken', !autopay_notice_due($armed, $due));
chk('and none after it', !autopay_notice_due($armed, '2026-08-21'));
chk('never twice for the same date', !autopay_notice_due(apbk(['autopay_due' => $due, 'balance_due_date' => $due, 'autopay_notified_at' => $due]), '2026-08-18'));
// Keyed on the DATE, not a flag: an owner moving the balance date makes the
// notice already sent describe a day that is no longer the day.
chk('but a MOVED due date earns a fresh one', autopay_notice_due(apbk(['autopay_due' => '2026-08-19', 'balance_due_date' => '2026-08-19', 'autopay_notified_at' => $due]), '2026-08-17'));
// Warning about a payment that is not going to happen is worse than not warning.
chk('no notice for an arrangement that has gone stale', !autopay_notice_due(apbk(['autopay_due' => $due, 'balance_due_date' => $due, 'autopay_amount' => 999.0]), '2026-08-18'));
chk('no notice once it has been switched off', !autopay_notice_due(apbk(['autopay_due' => $due, 'balance_due_date' => $due, 'autopay_revoked_at' => '2026-08-01 10:00:00']), '2026-08-18'));
chk('no notice with no card to charge', !autopay_notice_due(apbk(['autopay_due' => $due, 'balance_due_date' => $due, 'autopay_card_id' => '']), '2026-08-18'));

$MAIL = [];
$DB_WRITES = [];
$DB_LIST = [apbk(['autopay_due' => $due, 'balance_due_date' => $due, 'autopay_amount' => 300.0])];
$n = autopay_notice_run('2026-08-18');
chk('the pass sends one', $n['sent'] === 1 && is_array(mailed('notice')));
$stamp = wrote('autopay_notified_at');
chk('...and stamps the DUE DATE it warned about', $stamp && in_array($due, (array) $stamp[1], true));
// A failed email that stamped anyway would take the money three days later
// having told nobody — the exact failure this exists to prevent, reached by
// bookkeeping.
$MAIL_OK = false;
$MAIL = [];
$DB_WRITES = [];
$n = autopay_notice_run('2026-08-18');
chk('a notice that did not send is not stamped as sent', $n['sent'] === 0 && wrote('autopay_notified_at') === null);
$MAIL_OK = true;
$DB_LIST = [];

echo "\n-- an unknown decline is recorded as unknown --\n";
$DB_WRITES = [];
$SQ_REPLY = ['/v2/payments' => ['status' => 402, 'body' => ['errors' => [['code' => 'CARD_EXPIRED', 'detail' => 'expired']]]]];
autopay_collect_one(apbk(), $TODAY);
$w = wrote('autopay_last_code');
chk('the raw Square code is stored beside the prose', $w && in_array('CARD_EXPIRED', (array) $w[1], true));
$DB_WRITES = [];
$SQ_REPLY = ['/v2/payments' => ['status' => 402, 'body' => ['errors' => [['code' => 'SOME_NEW_CODE_2027']]]]];
autopay_collect_one(apbk(), $TODAY);
$w = wrote('autopay_last_code');
chk('an unrecognised code is stored too', $w && in_array('SOME_NEW_CODE_2027', (array) $w[1], true));
// Fatal-by-default is RIGHT — re-presenting a card damages a merchant account —
// so what was missing is not a behaviour change but the ability to see it.
chk('...and is still fatal, as it must be', autopay_decline_kind('SOME_NEW_CODE_2027') === 'hard');
chk('a code we have a name for is fatal in the same way', autopay_decline_kind('CARD_DECLINED') === 'hard');
chk('but only the unnamed one is FLAGGED as new', !in_array('SOME_NEW_CODE_2027', AUTOPAY_KNOWN_HARD, true) && in_array('CARD_DECLINED', AUTOPAY_KNOWN_HARD, true));
$apSrc = file_get_contents(__DIR__ . '/autopay-lib.php');
chk('the log line says which it was', strpos($apSrc, "', not seen before'") !== false);
chk('a soft failure still only costs one attempt', autopay_decline_kind('TEMPORARY_ERROR') === 'soft');

echo "\n-- a dead card can be replaced --\n";
// The offer used to be gated on state 'off' alone, so a card that expired, one
// that never saved, or terms the owner had since changed left an arrangement
// that could never be repaired — the only screen that can save a card would not
// offer to.
chk('the pay screen offers again after a failure', preg_match("/REPAIR = \['failed', 'nocard', 'stale'\]/", $appSrc) === 1);
chk('...and says why it is asking twice', strpos($appSrc, "We couldn't use the card you saved before") !== false);
// Deliberately NOT re-offered: they turned it off on purpose, and asking every
// time they pay is nagging.
chk("a guest who switched it off is not asked again", strpos($appSrc, "'revoked'") === false || !preg_match("/REPAIR = \[[^\]]*revoked/", $appSrc));
chk('saving a new card clears the old failure', preg_match('/autopay_attempts = 0, autopay_last_error = NULL, autopay_last_code = NULL/', $apSrc) === 1);

// ============================================================
//  MONTHLY INSTALMENTS — the schedule is the agreement. Same asymmetry as the
//  rest of this file: a collection may take LESS than agreed (a guest who pays
//  some by hand shrinks the remainder), never more, and every refusal is
//  break-tested. NULL/1-instalment rows must behave byte-identically to the
//  pre-instalment code — that guarantee is the whole existing suite above
//  passing unchanged, plus the explicit dark checks below.
// ============================================================

echo "\n=== 10. The month arithmetic the schedule stands on ===\n";
chk('a month step lands the same day', ukShiftMonthsPhp('2026-08-28', 1) === '2026-09-28');
chk('...backwards too', ukShiftMonthsPhp('2026-10-28', -2) === '2026-08-28');
chk('the 31st clamps into a shorter month, never overflows', ukShiftMonthsPhp('2026-01-31', 1) === '2026-02-28');
chk('...and a leap February keeps its 29th', ukShiftMonthsPhp('2028-01-31', 1) === '2028-02-29');
chk('a year boundary carries forward', ukShiftMonthsPhp('2026-12-15', 1) === '2027-01-15');
chk('...and backward', ukShiftMonthsPhp('2027-01-15', -2) === '2026-11-15');
chk('the DST months are pure date-part arithmetic', ukShiftMonthsPhp('2026-03-28', 1) === '2026-04-28' && ukShiftMonthsPhp('2026-10-25', -1) === '2026-09-25');
$sched = booking_instalment_schedule('2026-10-28', 3);
chk('the schedule ANCHORS ON THE DUE DATE and steps back', $sched === ['2026-08-28', '2026-09-28', '2026-10-28']);
chk('a 31st-anchored schedule clamps each month independently', booking_instalment_schedule('2026-05-31', 3) === ['2026-03-31', '2026-04-30', '2026-05-31']);

echo "\n=== 11. The offer — one derivation of what monthly could be ===\n";
// A FAR-OUT deposit-stage booking (relative dates on purpose: the balance
// window reads the wall clock, and a pinned check-in would cross it one day
// and change the stage under the test — the July-only-greenness lesson).
$OF_IN = date('Y-m-d', strtotime('+220 days'));
$OF_DUE = date('Y-m-d', strtotime('+190 days'));
function ofbk($over = [])
{
    global $OF_IN, $OF_DUE;
    return array_merge(
        [
            'id' => 77, 'name' => 'Cara Nunn', 'email' => 'c@example.com', 'prop_key' => 'jollyboat',
            'check_in' => $OF_IN, 'check_out' => date('Y-m-d', strtotime($OF_IN . ' +4 days')),
            'adults' => 2, 'children' => 0,
            'agreed_total' => 700.0, 'price_override' => null, 'deposit_paid' => 0.0,
            'damages_deposit' => 0.0, 'hold_status' => 'none', 'hold_amount' => 0.0,
            'deposit_pct_override' => 25.0, 'deposit_amount_override' => null,
            'balance_due_date' => $OF_DUE, 'autopay_offer' => null,
            'autopay_consent_at' => null, 'autopay_revoked_at' => null,
            'autopay_card_id' => null, 'autopay_customer_id' => null,
            'autopay_amount' => null, 'autopay_due' => null, 'autopay_instalments' => null,
            'autopay_next_at' => null, 'autopay_attempts' => 0, 'autopay_last_try' => null,
        ],
        $over,
    );
}
$NOW = date('Y-m-d');
$of = booking_instalment_offer(ofbk(), $NOW);
// £700 stay, 25% deposit → £525 rest. Auto picks the most spreading n that fits.
chk('a far-out balance is offered monthly', is_array($of) && $of['n'] === 4);
chk('...whose sum CLOSES exactly', $of && abs($of['per'] * ($of['n'] - 1) + $of['last'] - 525.0) < 0.005);
chk('...whose final collection lands ON the due date', $of && end($of['dates']) === $OF_DUE && $of['due'] === $OF_DUE);
chk('...with one date per instalment, monthly apart', $of && count($of['dates']) === 4 && $of['dates'][2] === ukShiftMonthsPhp($OF_DUE, -1));
chk('the per-instalment ceiling is rest ÷ n rounded UP', $of && abs($of['per'] - ceil((525.0 / 4) * 100) / 100) < 0.005);
// The owner's say: 0 = never, N = at most N, NULL = automatic.
chk('the owner can switch the offer off', booking_instalment_offer(ofbk(['autopay_offer' => 0]), $NOW) === null);
$of3 = booking_instalment_offer(ofbk(['autopay_offer' => 3]), $NOW);
chk('...or pin the count — 3 × £175.00 exactly', $of3 && $of3['n'] === 3 && abs($of3['per'] - 175.0) < 0.005 && abs($of3['last'] - 175.0) < 0.005);
// The £50 floor: a small balance spreads less, or not at all.
chk('a small balance shrinks n to keep every instalment over the floor',
    booking_instalment_offer(ofbk(['agreed_total' => 180.0]), $NOW)['n'] === 2); // rest £135 → 3× would be £45
chk('...and one the floor cannot fit at all is not offered', booking_instalment_offer(ofbk(['agreed_total' => 120.0]), $NOW) === null); // rest £90 → 2× £45
// The first collection needs room for its notice.
chk('a due date too close for the first notice is not offered monthly',
    booking_instalment_offer(ofbk(['balance_due_date' => date('Y-m-d', strtotime('+40 days'))]), $NOW) === null
    || booking_instalment_offer(ofbk(['balance_due_date' => date('Y-m-d', strtotime('+40 days'))]), $NOW)['n'] === 2);
chk('...and inside the balance window there is no offer at all',
    booking_instalment_offer(ofbk(['balance_due_date' => date('Y-m-d', strtotime('-1 day'))]), $NOW) === null);
// Terms honour the pick ONLY when it matches the offer.
$t3 = booking_autopay_terms(ofbk(['autopay_offer' => 3]), 3);
chk('terms for the agreed pick carry the ceiling, count and first date',
    $t3 && abs($t3['amount'] - 175.0) < 0.005 && $t3['instalments'] === 3 && $t3['next'] === ukShiftMonthsPhp($OF_DUE, -2) && $t3['due'] === $OF_DUE);
chk('a pick the offer never made returns NO terms — nothing to consent to',
    booking_autopay_terms(ofbk(['autopay_offer' => 3]), 4) === null);
chk('n = 1 keeps the single-collection terms byte for byte',
    abs(booking_autopay_terms(ofbk())['amount'] - 525.0) < 0.005 && !isset(booking_autopay_terms(ofbk())['instalments']));

echo "\n=== 11b. The owner's floor under the offer ===\n";
// Monthly is only OFFERED with at least N months of runway before the due
// date ('instalment-floor-months', Manage → Payments). The floor gates the
// OFFER and the CONSENT — never a plan already running, and never the
// single-collection option. Boundary inclusive: exactly N months out is
// "at least N months away".
$CONTENT = ['instalment-floor-months' => 2];
chk('a far-out offer clears the floor untouched', booking_instalment_offer(ofbk(), $NOW)['n'] === 4);
$edge = ukShiftMonthsPhp($NOW, 2);
chk('due EXACTLY N months out is still offered — "at least" includes the day',
    is_array(booking_instalment_offer(ofbk(['balance_due_date' => $edge]), $NOW)));
$inside = date('Y-m-d', strtotime($edge . ' -1 day'));
chk('one day inside the floor and monthly is gone',
    booking_instalment_offer(ofbk(['balance_due_date' => $inside]), $NOW) === null);
chk('...even where a 2-payment plan would still physically fit',
    booking_instalment_offer(ofbk(['balance_due_date' => date('Y-m-d', strtotime('+45 days'))]), $NOW) === null);
chk('...and a consent posted from inside it vaults NOTHING — refused where recorded',
    booking_autopay_terms(ofbk(['balance_due_date' => $inside]), 2) === null);
chk('the single-collection terms are untouched by the floor',
    is_array(booking_autopay_terms(ofbk(['balance_due_date' => $inside]))));
$CONTENT = ['instalment-floor-months' => 3];
chk('a taller floor cuts deeper', booking_instalment_offer(ofbk(['balance_due_date' => ukShiftMonthsPhp($NOW, 2)]), $NOW) === null
    && is_array(booking_instalment_offer(ofbk(['balance_due_date' => ukShiftMonthsPhp($NOW, 3)]), $NOW)));
// Garbage degrades to no floor — never to "no offer".
$CONTENT = ['instalment-floor-months' => 99];
chk('an out-of-range stored value means no floor', booking_instalment_offer(ofbk(['balance_due_date' => date('Y-m-d', strtotime('+45 days'))]), $NOW)['n'] === 2);
// A PLAN ALREADY AGREED keeps running whatever the floor says: the collector
// and the state machine read the stored consent, never the offer.
$CONTENT = ['instalment-floor-months' => 6];
chk('a running plan still collects under any floor',
    abs(booking_autopay_collect_amount(mpbk(), '2026-09-28')['charge'] - 175.0) < 0.005);
chk('...and stays ARMED', booking_autopay_state(mpbk(), $TODAY)[0] === 'armed');
$CONTENT = [];

echo "\n=== 12. The state machine, mid-plan ===\n";
// A COHERENT plan, one collection in: £700 stay, £175 deposit paid at consent
// plus the 28/08 instalment = £350 in, £350 left = exactly the two remaining
// £175 collections, final (= the due date) 28/10. Wall-clock safe: the kind
// resolves 'balance' via deposit-settled, not via the window.
function mpbk($over = [])
{
    return array_merge(
        apbk([
            'agreed_total' => 700.0, 'deposit_paid' => 350.0,
            'balance_due_date' => '2026-10-28',
            'autopay_amount' => 175.0, 'autopay_due' => '2026-10-28',
            'autopay_instalments' => 3, 'autopay_next_at' => '2026-09-28',
        ]),
        $over,
    );
}
$st = booking_autopay_state(mpbk(), $TODAY);
chk('mid-plan, matching → ARMED', $st[0] === 'armed');
chk('...and the sentence says monthly and names the NEXT date', strpos($st[1], 'monthly') !== false && strpos($st[1], uk_date('2026-09-28')) !== false);
chk('...but the next date has not arrived, so it may not charge yet', booking_autopay_may_charge(mpbk(), $TODAY) === false);
chk('on the next date it may', booking_autopay_may_charge(mpbk(), '2026-09-28') === true);
// A guest who paid some by hand SHRINKS the plan — never stands it down.
chk('a manual part-payment does not stand the plan down', booking_autopay_state(mpbk(['deposit_paid' => 400.0]), $TODAY)[0] === 'armed');
chk('everything paid → settled', booking_autopay_state(mpbk(['deposit_paid' => 700.0]), $TODAY)[0] === 'settled');
// The owner raising the price PAST what the schedule can collect needs re-asking.
chk('a raised price the remaining collections cannot cover → STALE',
    booking_autopay_state(mpbk(['agreed_total' => 1000.0]), $TODAY)[0] === 'stale');
chk('...but one the collections still cover stays armed — the manual overpayment made room',
    booking_autopay_state(mpbk(['deposit_paid' => 400.0, 'agreed_total' => 740.0]), $TODAY)[0] === 'armed');
chk('a moved due date is stale, as it always was', booking_autopay_state(mpbk(['balance_due_date' => '2026-11-15']), $TODAY)[0] === 'stale');
// A COMPLETED monthly plan (next_at cleared) must NOT re-arm when the owner
// raises the price before check-in — it charged the top-up unconsented. Empty
// next means zero collections left, so a fresh charge is stale, not armed.
chk('a completed plan raised in price is STALE, never armed',
    booking_autopay_state(mpbk(['deposit_paid' => 700.0, 'agreed_total' => 800.0, 'autopay_next_at' => null]), $TODAY)[0] === 'stale');
chk('...and cannot charge', booking_autopay_may_charge(mpbk(['deposit_paid' => 700.0, 'agreed_total' => 800.0, 'autopay_next_at' => null]), $TODAY) === false);
// What a collection may TAKE, decided in one place.
$take = booking_autopay_collect_amount(mpbk(), '2026-09-28');
chk('a mid-plan collection takes the agreed ceiling', abs($take['charge'] - 175.0) < 0.005 && $take['final'] === false);
chk('...never more than is owed', abs(booking_autopay_collect_amount(mpbk(['deposit_paid' => 600.0]), '2026-09-28')['charge'] - 100.0) < 0.005);
chk('...and no damages ride an instalment', $take['damages'] === 0.0);
// The final date takes the remainder — here smaller than the ceiling because
// the guest paid a little by hand along the way.
$takeF = booking_autopay_collect_amount(mpbk(['deposit_paid' => 560.0, 'autopay_next_at' => '2026-10-28']), '2026-10-28');
chk('ON the final date it takes whatever remains', abs($takeF['charge'] - 140.0) < 0.005 && $takeF['final'] === true);
chk('advancing follows the schedule the guest was shown',
    booking_autopay_next_after(mpbk(), '2026-08-28') === '2026-09-28'
    && booking_autopay_next_after(mpbk(), '2026-10-28') === null);

echo "\n=== 13. Collecting an instalment, all the way through ===\n";
reset_env(mpbk());
$DB_LIST = [];
$out = autopay_collect_one(mpbk(), '2026-09-28');
$call = sqCall('/v2/payments');
chk('the instalment collects on its scheduled day', $out[0] === 'ok');
chk('...for the CEILING, in pence', $call && $call[1]['amount_money']['amount'] === 17500);
$adv = wrote('autopay_next_at');
chk('success ADVANCES the plan to its next date', $adv && in_array('2026-10-28', $adv[1], true));
chk('...and resets the attempt counter — each instalment earns its own tries', $adv && strpos($adv[0], 'autopay_attempts = 0') !== false);
chk('...and the guest gets the shared receipt', mailed('receipt') !== null);
// The FINAL collection: remainder, then the plan closes (next NULL).
$fin = mpbk(['deposit_paid' => 560.0, 'autopay_next_at' => '2026-10-28']);
reset_env($fin);
$out = autopay_collect_one($fin, '2026-10-28');
$call = sqCall('/v2/payments');
chk('the final collection takes the remainder', $out[0] === 'ok' && $call && $call[1]['amount_money']['amount'] === 14000);
$adv = wrote('autopay_next_at');
chk('...and closes the plan', $adv && in_array(null, $adv[1], true));

echo "\n=== 14. Every instalment earns its own notice ===\n";
$nb = mpbk(['autopay_next_at' => ukShiftDaysPhp($TODAY, 2)]);
chk('a notice is due before the NEXT collection, not only the final one', autopay_notice_due($nb, $TODAY) === true);
chk('...and not resent once stamped FOR THAT DATE', autopay_notice_due(array_merge($nb, ['autopay_notified_at' => ukShiftDaysPhp($TODAY, 2)]), $TODAY) === false);
chk('...but the plan advancing makes the stamp stale by construction',
    autopay_notice_due(array_merge($nb, ['autopay_notified_at' => '2026-07-28']), $TODAY) === true);
chk('too far out is not warned yet', autopay_notice_due(mpbk(['autopay_next_at' => ukShiftDaysPhp($TODAY, 10)]), $TODAY) === false);

echo "\n=== 15. Consent stores the schedule, or refuses ===\n";
reset_env(ofbk(['autopay_offer' => 3]));
// The vault talks to Square twice before it writes anything.
$SQ_REPLY['/v2/customers'] = ['status' => 200, 'body' => ['customer' => ['id' => 'CUST9']]];
$SQ_REPLY['/v2/cards'] = ['status' => 200, 'body' => ['card' => ['id' => 'ccof:new']]];
$v = autopay_vault(ofbk(['autopay_offer' => 3]), 'sq_pay_1', booking_autopay_terms(ofbk(['autopay_offer' => 3]), 3));
$w = wrote('autopay_instalments');
chk('a monthly consent stores the count and the first date', $v['ok'] && $w && in_array(3, $w[1], true) && in_array(ukShiftMonthsPhp($OF_DUE, -2), $w[1], true));
chk('...and the per-instalment ceiling as the agreed amount', $w && in_array(175.0, $w[1]));
reset_env(ofbk());
$SQ_REPLY['/v2/customers'] = ['status' => 200, 'body' => ['customer' => ['id' => 'CUST9']]];
$SQ_REPLY['/v2/cards'] = ['status' => 200, 'body' => ['card' => ['id' => 'ccof:new']]];
$v = autopay_vault(ofbk(), 'sq_pay_1', booking_autopay_terms(ofbk()));
$w = wrote('autopay_instalments');
chk('a single-collection consent writes NULLs into the new columns', $v['ok'] && $w && in_array(null, $w[1], true));
chk('a pick that matches no offer vaults NOTHING', autopay_vault(ofbk(['autopay_offer' => 3]), 'sq_pay_1', booking_autopay_terms(ofbk(['autopay_offer' => 3]), 4))['ok'] === false);

echo "\n=== 16. Dark by construction ===\n";
// The whole suite above this section drives NULL-instalment rows through the
// unchanged paths — these pin the seams the instalment code touched.
chk('no offer exists inside the balance window, so the old screens see nothing new',
    booking_instalment_offer(apbk(), $TODAY) === null);
$one = booking_autopay_collect_amount(apbk(), $TODAY);
chk('a single collection still takes rest + damages in one go', abs($one['charge'] - 300.0) < 0.005 && $one['final'] === true);
chk('...and still keys on the due date', booking_autopay_may_charge(apbk(), $TODAY) === true);
$apSrc2 = file_get_contents(__DIR__ . '/autopay-lib.php');
chk('the run picks candidates by the NEXT collection date', substr_count($apSrc2, 'COALESCE(autopay_next_at, autopay_due)') >= 3);
$paySrc2 = file_get_contents(__DIR__ . '/pay.php');
chk('pay.php honours a requested count only through the terms derivation',
    strpos($paySrc2, 'booking_autopay_terms($b, $apNPre > 1 ? $apNPre : 1, $kind)') !== false);
// AND IT DERIVES THEM BEFORE THE MONEY MOVES. booking_autopay_terms resolves the
// stage through the LIVE ledger, so derived after the charge the deposit reads
// settled, the stage is 'balance' and the terms come back null — every consenting
// guest was told the plan could not be set up. Assert the ORDER, which is the fix.
// NB anchored on the charge's own $pence line, not on square_api — the legacy hold
// flow posts to /v2/payments FIRST, so a strpos against that would compare the
// snapshot to the wrong charge and pass (or fail) for the wrong reason.
chk('...and derives them BEFORE the charge, while the stage is still the deposit',
    strpos($paySrc2, '$apTermsPre = booking_autopay_terms(') !== false
        && strpos($paySrc2, '$apTermsPre = booking_autopay_terms(') < strpos($paySrc2, '$pence = (int) round($chargeTotal * 100);')
        && strpos($paySrc2, '$apTerms = $apTermsPre;') !== false);

echo "\n=== 17. The guest hears first — failure emails from the collector ===\n";
// Sent on the FIRST soft failure ("we'll try again") and on the failure that
// STOPS the plan (a hard decline, or the soft one reaching the cap); the middle
// attempt is silence — they already know. The silences carry checks too.
$FAIL_REPLY = ['/v2/payments' => ['status' => 402, 'body' => ['errors' => [['code' => 'TEMPORARY_ERROR', 'detail' => 'x']]]]];
$failMails = function () {
    global $MAIL;
    return array_values(array_filter($MAIL, fn($m) => $m[0] === 'failure'));
};
reset_env(mpbk(['autopay_attempts' => 0]));
$SQ_REPLY = $FAIL_REPLY;
$MAIL = [];
$out = autopay_collect_one(mpbk(['autopay_attempts' => 0]), '2026-09-28');
$fm = $failMails();
chk('the FIRST soft failure emails the guest', $out[0] === 'fail' && count($fm) === 1);
chk('...as a retry, not a stop', $fm && $fm[0][2] === false);
chk('...carrying the attempted charge', $fm && abs((float) $fm[0][3] - 175.0) < 0.005);
reset_env(mpbk(['autopay_attempts' => 1]));
$SQ_REPLY = $FAIL_REPLY;
$MAIL = [];
autopay_collect_one(mpbk(['autopay_attempts' => 1]), '2026-09-28');
chk('the MIDDLE attempt is silence — they already know', count($failMails()) === 0);
reset_env(mpbk(['autopay_attempts' => 2]));
$SQ_REPLY = $FAIL_REPLY;
$MAIL = [];
autopay_collect_one(mpbk(['autopay_attempts' => 2]), '2026-09-28');
$fm = $failMails();
chk('the soft failure that reaches the cap says the plan STOPPED', count($fm) === 1 && $fm[0][2] === true);
reset_env(mpbk(['autopay_attempts' => 0]));
$SQ_REPLY = ['/v2/payments' => ['status' => 402, 'body' => ['errors' => [['code' => 'CARD_DECLINED', 'detail' => 'x']]]]];
$MAIL = [];
autopay_collect_one(mpbk(['autopay_attempts' => 0]), '2026-09-28');
$fm = $failMails();
chk('a HARD decline stops on its first failure and says so', count($fm) === 1 && $fm[0][2] === true);

echo "\n=== 18. A new card for an existing consent ===\n";
// autopay_replace_card stores a card and touches NO money. Only a LIVE consent
// is repairable — every refusal is in words, because pay.php shows them.
chk('no consent → nothing to repair',
    autopay_replace_card(mpbk(['autopay_consent_at' => null]), 'cnon_x')['ok'] === false
    && strpos(autopay_replace_card(mpbk(['autopay_consent_at' => null]), 'cnon_x')['reason'], 'no automatic payment') !== false);
chk('revoked → a new card must not quietly re-arm it',
    autopay_replace_card(mpbk(['autopay_revoked_at' => '2026-08-01']), 'cnon_x')['ok'] === false);
chk('settled → nothing left to collect', autopay_replace_card(mpbk(['deposit_paid' => 700.0]), 'cnon_x')['ok'] === false);
chk('stale → the terms moved, not the card', autopay_replace_card(mpbk(['balance_due_date' => '2026-11-15']), 'cnon_x')['ok'] === false);
chk('no card supplied → refused', autopay_replace_card(mpbk(['autopay_attempts' => 3]), '')['ok'] === false);
reset_env(mpbk(['autopay_attempts' => 3]));
$SQ_REPLY['/v2/cards'] = ['status' => 200, 'body' => ['card' => ['id' => 'ccof_new']]];
$r = autopay_replace_card(mpbk(['autopay_attempts' => 3]), 'cnon_tok');
$cardCall = sqCall('/v2/cards');
$w = wrote('autopay_card_id');
chk('a STOPPED plan takes the new card', $r['ok'] === true && $r['card_id'] === 'ccof_new');
chk('...stored from the tokenised card, against the existing customer',
    $cardCall && $cardCall[1]['source_id'] === 'cnon_tok' && !empty($cardCall[1]['card']['customer_id']));
chk('...and fresh card means fresh tries', $w && stripos($w[0], 'autopay_attempts = 0') !== false && in_array('ccof_new', $w[1], true));
chk('...with no payment made', sqCall('/v2/payments') === null);
reset_env(mpbk(['autopay_attempts' => 3, 'autopay_customer_id' => null]));
$SQ_REPLY['/v2/customers'] = ['status' => 200, 'body' => ['customer' => ['id' => 'cust_new']]];
$SQ_REPLY['/v2/cards'] = ['status' => 200, 'body' => ['card' => ['id' => 'ccof_new2']]];
$r = autopay_replace_card(mpbk(['autopay_attempts' => 3, 'autopay_customer_id' => null]), 'cnon_tok2');
chk('a nocard repair creates the customer first, the vault way', $r['ok'] === true && sqCall('/v2/customers') !== null);
reset_env(mpbk(['autopay_attempts' => 3]));
$SQ_REPLY['/v2/cards'] = ['status' => 402, 'body' => ['errors' => [['code' => 'INVALID_CARD', 'detail' => 'Card nonce not found']]]];
$r = autopay_replace_card(mpbk(['autopay_attempts' => 3]), 'cnon_bad');
chk("Square's refusal comes back in words, and nothing is written",
    $r['ok'] === false && $r['reason'] !== '' && wrote('autopay_card_id') === null);
// The wiring: pay.php routes the action through the lib and the summary carries
// the repair object — the helper alone proving nothing is the recurring trap.
$paySrc3 = file_get_contents(__DIR__ . '/pay.php');
chk('pay.php routes update_card through autopay_replace_card',
    strpos($paySrc3, "if (\$action === 'update_card')") !== false && strpos($paySrc3, 'autopay_replace_card($b,') !== false);
chk('...and the summary carries autopayRepair', strpos($paySrc3, "'autopayRepair' => \$apRepair,") !== false);
chk('update_card is rate-limited like the other card actions — no card-testing oracle',
    preg_match("/\\\$action === 'charge' \\|\\| \\\$action === 'authorize' \\|\\| \\\$action === 'update_card'\\)\\s*\\{\\s*rate_limit/", $paySrc3) === 1);
chk('the collector notifies through the guarded send',
    strpos($apSrc2, "function_exists('send_autopay_failure')") !== false && strpos($apSrc2, 'send_autopay_failure($now, $why, $stopped, $today, $charge, $restNow)') !== false);
// The account payload keeps a TROUBLED plan on the guest's card (states
// 'retrying'/'stopped' + why + the retry day) — ui-test-yourstay drives the
// rendering from a stubbed payload, so the server half is pinned here.
$mbSrc = file_get_contents(__DIR__ . '/my-bookings.php');
chk('the account payload keeps a troubled plan on the card',
    strpos($mbSrc, "in_array(\$ap[0], ['armed', 'failed'], true)") !== false
    && strpos($mbSrc, "'stopped' : (\$apAtt > 0 ? 'retrying' : 'on')") !== false);
// The repair writes UNDER book_lock so a collection in flight can't walk it
// back to 'stopped' — the collector holds the same lock across its read→write.
chk('autopay_replace_card takes book_lock around its write',
    strpos($apSrc2, "\$held = \$plock !== '' && function_exists('book_lock') ? book_lock(\$plock) : false;") !== false
    && strpos($apSrc2, 'if ($held) {') !== false
    && strpos($apSrc2, 'book_unlock($plock)') !== false);

echo "\n=== 19. The owner notification quotes the right line on a mixed pass ===\n";
// autopay_run kept ok and fail lines in ONE positional list, and autopay-run.php
// read lines[0] for a collection and lines[count-1] for a failure — so a pass
// with one of each swapped the two bodies. Separate buckets fix it.
// next_at = TODAY so the collection is DUE (may_charge true) and the 402 makes
// it a real 'fail', not a 'skip'.
$runBk = mpbk(['autopay_attempts' => 0, 'autopay_next_at' => $TODAY]);
reset_env($runBk);
$SQ_REPLY = ['/v2/payments' => ['status' => 402, 'body' => ['errors' => [['code' => 'CARD_DECLINED', 'detail' => 'x']]]]];
$DB_LIST = [$runBk];
$MAIL = [];
$run = autopay_run($TODAY);
chk('a failing pass fills failLines, not okLines', count($run['failLines']) === 1 && count($run['okLines']) === 0);
$run2 = autopay_run($TODAY); // empty candidate list path still returns both buckets
chk('the run always returns both buckets', is_array($run['okLines']) && is_array($run['failLines']));
$runSrc = file_get_contents(__DIR__ . '/autopay-run.php');
chk('the collected alert reads the OK bucket, the failed alert the FAIL bucket',
    strpos($runSrc, "\$res['okLines'][0]") !== false && strpos($runSrc, "\$res['failLines'][0]") !== false
    && strpos($runSrc, "\$res['lines'][count(\$res['lines']) - 1]") === false);

echo "\n" . ($fail ? "✗ $fail FAILED, $pass passed\n" : "✓ ALL $pass CHECKS PASSED\n");
exit($fail ? 1 : 0);
