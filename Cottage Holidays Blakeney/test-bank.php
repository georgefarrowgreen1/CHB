<?php
// ============================================================
//  test-bank.php — guards "is there anywhere for the money to GO?" (bank-lib.php).
//  Dev/CI only, deploy-excluded. No DB, no clock, no network.
//
//  Why these cases and not others: this library exists to replace a GUESS on the
//  Move-money-out screen ("usually payouts paused, or no bank account linked") with
//  a fact, and the way to get that wrong is to state the wrong fact confidently.
//  Telling an owner they have no bank account when the truth is that we could not
//  ask is worse than the guess it replaced — so the cases with the most checks here
//  are the ones where the honest answer is "I don't know".
// ============================================================

// STUB SQUARE AND THE CONTENT STORE **BEFORE** the require, so bank_refresh()'s own
// body — the part that pulls `bank_accounts` out of Square's reply — runs for real.
// Same reasoning as test-payouts.php: get the nesting wrong and the list comes back
// empty, which reads on screen as the legitimate (and alarming) "no bank account".
$SQ_CALLS = [];
$SQ_REPLY = [];
$SQ_STORE = [];
$SQ_ENABLED = true;
function square_enabled()
{
    global $SQ_ENABLED;
    return $SQ_ENABLED;
}
function square_api($method, $path, $payload = null)
{
    global $SQ_CALLS, $SQ_REPLY;
    $SQ_CALLS[] = $method . ' ' . $path;
    foreach ($SQ_REPLY as $frag => $res) {
        if (strpos($path, $frag) !== false) {
            return $res;
        }
    }
    return ['status' => 404, 'body' => []];
}
function content_value($key)
{
    global $SQ_STORE;
    return $SQ_STORE[$key] ?? '';
}
// Which location the site trades under. The real one lives in db.php, which this test
// deliberately does not load (no DB) — so it is stubbed like square_api and the content
// store, and driven by $SQ_LOCATION.
$SQ_LOCATION = '';
function square_location_id()
{
    global $SQ_LOCATION;
    return $SQ_LOCATION;
}
function content_set_scalar($key, $val)
{
    global $SQ_STORE;
    $SQ_STORE[$key] = $val;
}

require_once __DIR__ . '/bank-lib.php';

$pass = 0;
$fail = 0;
function chk($name, $cond)
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $name\n";
    } else {
        $fail++;
        echo "  \u{2717} $name\n";
    }
}

$acct = function ($status, $creditable = true, $bank = 'Barclays', $tail = '4471') {
    return ['status' => $status, 'creditable' => $creditable, 'bank_name' => $bank, 'account_number_suffix' => $tail];
};

echo "== What the list MEANS ==\n";
$r = bank_read([$acct('VERIFIED')]);
chk('a verified, creditable account is READY', $r['state'] === 'ready');
chk('…and is named the way the owner\'s statement names it', $r['label'] === 'Barclays ending 4471');

chk('no accounts at all is NONE — the state that explains a silent payout feed',
    bank_read([])['state'] === 'none');

// THE DISTINCTION THIS LIBRARY EXISTS FOR. "We could not ask" must never render as
// "you have no bank account": one is a shrug, the other tells the owner their money
// has nowhere to go.
chk('a failed read is UNKNOWN, never none',
    bank_read(null, 'the access token can\'t read bank accounts')['state'] === 'unknown');
chk('…and carries the reason through, so the screen can say what went wrong',
    bank_read(null, 'Square didn\'t answer (500)')['why'] === 'Square didn\'t answer (500)');
chk('an error alongside a list still refuses to read the list',
    bank_read([$acct('VERIFIED')], 'boom')['state'] === 'unknown');
chk('never asked is unknown too, not none', bank_read(null)['state'] === 'unknown');

echo "\n== VERIFIED and CREDITABLE are both required ==\n";
// creditable is the PAYOUT direction. An account Square may take money from but not
// send it to pays out nothing, so it is not "ready" however verified it is.
chk('verified but NOT creditable is blocked, not ready',
    bank_read([$acct('VERIFIED', false)])['state'] === 'blocked');
chk('creditable but still being verified is VERIFYING',
    bank_read([$acct('VERIFICATION_IN_PROGRESS', true)])['state'] === 'verifying');
chk('a disabled account is blocked', bank_read([$acct('DISABLED', true)])['state'] === 'blocked');
chk('a missing creditable flag is treated as NOT creditable — the cautious way round',
    bank_read([['status' => 'VERIFIED', 'bank_name' => 'B', 'account_number_suffix' => '1']])['state'] === 'blocked');
chk('lower-case status from a cache round trip still reads',
    bank_read([$acct('verified')])['state'] === 'ready');

echo "\n== More than one account ==\n";
chk('one ready among several is READY',
    bank_read([$acct('DISABLED', true), $acct('VERIFIED', true, 'Lloyds', '9902')])['state'] === 'ready');
chk('…and the READY one is the one named, not merely the first in the list',
    bank_read([$acct('DISABLED', true), $acct('VERIFIED', true, 'Lloyds', '9902')])['label'] === 'Lloyds ending 9902');
chk('verifying beats blocked when nothing is ready',
    bank_read([$acct('DISABLED', true), $acct('VERIFICATION_IN_PROGRESS', true)])['state'] === 'verifying');
chk('the count is reported', bank_read([$acct('VERIFIED'), $acct('DISABLED')])['count'] === 2);

echo "\n== Square does NOT say which account it pays into ==\n";
// The defect this section exists for, reported from the live account: with a Lloyds
// and a Monzo both linked, the screen named Lloyds as "your bank account" because it
// came back first. Square keeps ONE primary payout account and ListBankAccounts does
// not flag it (primary_bank_identification_number is a SORT CODE, not a primary-account
// marker), so every linked account has to be carried and named.
$two = bank_read([$acct('VERIFIED', true, 'Lloyds Bank Plc', '968'), $acct('VERIFIED', true, 'Monzo', '1234')]);
chk('both accounts are carried, not just the one that came back first', count($two['all']) === 2);
chk('…with the second named too', $two['all'][1]['label'] === 'Monzo ending 1234');
chk('…and each carries its own verdict', $two['all'][0]['state'] === 'ready' && $two['all'][1]['state'] === 'ready');
$mixed = bank_read([$acct('VERIFIED', true, 'Lloyds Bank Plc', '968'), $acct('VERIFICATION_IN_PROGRESS', true, 'Monzo', '1234')]);
chk('a half-verified pair reports each state separately',
    $mixed['all'][0]['state'] === 'ready' && $mixed['all'][1]['state'] === 'verifying');
chk('…while the overall state is still READY, because one of them can be paid into',
    $mixed['state'] === 'ready');
chk('a single account still carries its one entry', count(bank_read([$acct('VERIFIED')])['all']) === 1);
chk('none carries an empty list rather than a missing key', bank_read([])['all'] === []);
chk('unknown carries one too, so the client can rely on the key',
    bank_read(null, 'boom')['all'] === []);

echo "\n== A CUSTOMER's bank account is never the owner's ==\n";
// ListBankAccounts returns customer bank accounts alongside the seller's, told apart
// by customer_id. Naming a GUEST's bank on the owner's money screen would be worse
// than any confusion this file exists to prevent.
$SQ_CALLS = [];
$SQ_REPLY = ['/v2/bank-accounts' => ['status' => 200, 'body' => ['bank_accounts' => [
    ['status' => 'VERIFIED', 'creditable' => true, 'bank_name' => 'Monzo', 'account_number_suffix' => '1234', 'location_id' => 'L1'],
    ['status' => 'VERIFIED', 'creditable' => true, 'bank_name' => 'A Guest Bank', 'account_number_suffix' => '9999', 'customer_id' => 'CUST1'],
]]]];
bank_refresh();
$cache = bank_cached();
chk('the customer account is dropped', count($cache['accounts']) === 1);
chk('…and it is the SELLER account that survives', $cache['accounts'][0]['bank_name'] === 'Monzo');
$r = bank_read($cache['accounts'], $cache['error']);
chk('…so the guest bank is never named to the owner', strpos(json_encode($r), 'A Guest Bank') === false);

echo "\n== Naming an account with pieces missing ==\n";
chk('no bank name still gives the digits', bank_label(['account_number_suffix' => '4471']) === 'ending 4471');
chk('no digits still gives the bank', bank_label(['bank_name' => 'Barclays']) === 'Barclays');
chk('neither is an empty label, not a stray word', bank_label([]) === '');
chk('a non-array is handled', bank_label(null) === '');

echo "\n== Staleness ==\n";
chk('never filled is stale', bank_stale(null) === true);
chk('at=0 (a failed first fetch) is stale', bank_stale(['at' => 0]) === true);
chk('just fetched is fresh', bank_stale(['at' => 1000], 1000 + BANK_TTL - 1) === false);
chk('past the TTL is stale', bank_stale(['at' => 1000], 1000 + BANK_TTL + 1) === true);

echo "\n== bank_refresh() against a real reply shape ==\n";
// The part a pure test cannot see: whether the library reads Square's actual
// nesting. Wrong key => empty list => the screen says "no bank account linked",
// which is the most alarming thing it can say and would be our bug, not Square's.
$SQ_CALLS = []; // this section counts the calls, so it starts from zero
$SQ_REPLY = ['/v2/bank-accounts' => ['status' => 200, 'body' => ['bank_accounts' => [
    ['id' => 'ba1', 'status' => 'VERIFIED', 'creditable' => true, 'debitable' => false,
     'bank_name' => 'Barclays', 'account_number_suffix' => '4471', 'currency' => 'GBP',
     'holder_name' => 'G Farrow-Green', 'primary_bank_identification_number' => '20-00-00'],
]]]];
$res = bank_refresh();
chk('a good fetch reports ok', !empty($res['ok']) && $res['accounts'] === 1);
chk('…and it actually asked Square for the bank accounts',
    count($SQ_CALLS) === 2 && strpos($SQ_CALLS[0], 'GET /v2/bank-accounts') === 0);
// The location list rides the same refresh so the picker has names without a settings
// screen waiting on Square.
chk('…and for the locations, in the same refresh', strpos($SQ_CALLS[1], 'GET /v2/locations') === 0);
$cache = bank_cached();
chk('the cache holds the account', is_array($cache) && count($cache['accounts']) === 1);
chk('…read from Square\'s OWN nesting (bank_accounts), not a guessed key',
    $cache['accounts'][0]['account_number_suffix'] === '4471');
chk('…and the decision comes out READY end to end',
    bank_read($cache['accounts'], $cache['error'])['state'] === 'ready');
// Only what the screen needs is kept. The holder's name and the sort code are in
// Square's reply and have no business sitting in our content table.
chk('the holder name is NOT cached', !isset($cache['accounts'][0]['holder_name']));
chk('nor the bank identification number', !isset($cache['accounts'][0]['primary_bank_identification_number']));

echo "\n== Scoped to ONE location ==\n";
// Square scopes payouts and bank accounts per location and defaults to the seller's
// MAIN one when you don't say — "By default, payouts are returned for the default
// (main) location associated with the seller". On a multi-location account that is a
// confident answer about the wrong shop: measured, sixty days of "no payouts at all"
// while the money moved under a location called Online CHB.
chk('the location is recorded on the cache, so the screen can say whose data it is',
    array_key_exists('location', bank_cached()));
chk('…and the list of locations is cached for the picker',
    is_array(bank_cached()['locations']));

$SQ_LOCATION = 'LOC_ONLINE_CHB';
$SQ_CALLS = [];
bank_refresh();
chk('a chosen location is sent with the request',
    strpos($SQ_CALLS[0], 'location_id=LOC_ONLINE_CHB') !== false);
chk('…and stored alongside the answer', bank_cached()['location'] === 'LOC_ONLINE_CHB');
$SQ_LOCATION = '';
$SQ_CALLS = [];
bank_refresh();
chk('no chosen location sends none, keeping Square\'s own default',
    strpos($SQ_CALLS[0], 'location_id=') === false);

echo "\n== The locations list ==\n";
$ls = locations_slim([
    ['id' => 'L1', 'name' => 'Online CHB', 'status' => 'ACTIVE'],
    ['id' => 'L2', 'name' => '', 'status' => 'INACTIVE'],
    ['id' => '', 'name' => 'no id'],
    'not an array',
]);
chk('rows without an id are dropped', count($ls) === 2);
chk('a named location keeps its name', $ls[0]['name'] === 'Online CHB');
chk('an unnamed one falls back to its id rather than an empty label', $ls[1]['name'] === 'L2');
chk('the status rides along, so an inactive location can be shown as such', $ls[1]['status'] === 'INACTIVE');

echo "\n== A genuinely empty list is not an error ==\n";
$SQ_CALLS = [];
$SQ_REPLY = ['/v2/bank-accounts' => ['status' => 200, 'body' => []]];
$res = bank_refresh();
chk('Square answering with no accounts is a SUCCESSFUL fetch', !empty($res['ok']) && $res['accounts'] === 0);
$cache = bank_cached();
chk('…and reads as NONE, which is the answer the owner needs',
    bank_read($cache['accounts'], $cache['error'])['state'] === 'none');
chk('…with no error recorded, because nothing went wrong', $cache['error'] === null);

echo "\n== Failure keeps the last good copy ==\n";
// The loadContent rule. A 403 must not empty the list, or a token problem would
// render as "your bank account has gone".
$SQ_REPLY = ['/v2/bank-accounts' => ['status' => 200, 'body' => ['bank_accounts' => [
    ['status' => 'VERIFIED', 'creditable' => true, 'bank_name' => 'Barclays', 'account_number_suffix' => '4471'],
]]]];
bank_refresh();
$SQ_REPLY = ['/v2/bank-accounts' => ['status' => 403, 'body' => []]];
$res = bank_refresh();
chk('a 403 fails', empty($res['ok']));
chk('…and NAMES the scope, so it is actionable', strpos($res['reason'], "can't read bank accounts") !== false);
$cache = bank_cached();
chk('…while the last known account is still there', count($cache['accounts']) === 1);
chk('…and the state is UNKNOWN, not the "no bank account" alarm',
    bank_read($cache['accounts'], $cache['error'])['state'] === 'unknown');

$SQ_REPLY = ['/v2/bank-accounts' => ['status' => 500, 'body' => []]];
$res = bank_refresh();
chk('a 500 says Square did not answer', strpos($res['reason'], "didn't answer (500)") !== false);

$SQ_ENABLED = false;
$SQ_CALLS = [];
$res = bank_refresh();
chk('Square switched off does not even call out', empty($res['ok']) && count($SQ_CALLS) === 0);
chk('…and says so plainly', strpos($res['reason'], 'not switched on') !== false);
$SQ_ENABLED = true;

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail BANK CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass BANK CHECKS PASSED \u{2705}\n";
