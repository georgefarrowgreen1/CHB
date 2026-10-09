<?php
// ============================================================
//  test-monzo.php — the Monzo Business live link's decisions, with no database,
//  no network and no clock (monzo-lib.php is pure). The talking and storing are
//  gated end to end by test-integration §54 against a fake Monzo.
//
//  Covers: the connect address, a client refused in words (and a non-confidential
//  one, which Monzo never keeps connected), the token reply, refreshing early, the
//  business account chosen and a personal one NEVER taken, what Monzo shared said
//  in words, how far back to ask (the five-minute window, then 90 days with an
//  overlap), a transaction as a bank line (declined, pending, nothing, another
//  currency skipped; pots named; London time; the id shared with the statements),
//  the health states, and the statement reminder standing down while live.
//  Counter named mzc() — PHPStan analyses every test file as one set.
// ============================================================
require __DIR__ . '/monzo-lib.php';
require __DIR__ . '/statement-lib.php';

$fail = 0;
$pass = 0;
function mzc($name, $cond, $detail = '')
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}

echo "\n== §1 Connecting ==\n";
$u = monzo_auth_url('oauth2client_00009abc', 'https://example.test/monzo-callback.php', 'abc123');
parse_str((string) parse_url($u, PHP_URL_QUERY), $q);
mzc('the address is Monzo’s sign-in with the four parameters it asks for', strpos($u, 'https://auth.monzo.com/?') === 0 && $q === ['client_id' => 'oauth2client_00009abc', 'redirect_uri' => 'https://example.test/monzo-callback.php', 'response_type' => 'code', 'state' => 'abc123'], $u);
mzc('a missing secret is refused in words', monzo_client_problem('oauth2client_00009abc', '') === 'Paste both the client ID and the client secret.');
mzc('a pasted sentence is not a client', strpos(monzo_client_problem('my client id', 'secret here'), 'doesn’t look like') !== false);
mzc('a non-confidential client is refused, because Monzo would not keep it connected', strpos(monzo_client_problem('oauth2client_00009abc', 'mnzpub.abcdefghijklmnop'), 'Confidential') !== false);
mzc('a confidential client is accepted', monzo_client_problem('oauth2client_00009abc', 'mnzconf.abcdefghijklmnop+/=') === '');

echo "\n== §2 Tokens ==\n";
$t = monzo_token_read(['access_token' => 'acc', 'refresh_token' => 'ref', 'expires_in' => 21600, 'user_id' => 'user_1'], 1000);
mzc('a token reply is kept with when it lapses', $t === ['access' => 'acc', 'refresh' => 'ref', 'expires_at' => 22600, 'user_id' => 'user_1'], json_encode($t));
mzc('a reply with no access token is nothing', monzo_token_read(['error' => 'invalid_grant'], 1000) === null);
mzc('a reply with no lifetime assumes Monzo’s six hours', monzo_token_read(['access_token' => 'a'], 0)['expires_at'] === 21600);
mzc('a token is refreshed five minutes before it lapses', monzo_refresh_due(['expires_at' => 1300], 1000) && !monzo_refresh_due(['expires_at' => 1301], 1000));

echo "\n== §3 Which account ==\n";
$personal = ['id' => 'acc_p', 'type' => 'uk_retail', 'closed' => false, 'account_number' => '11112222'];
$joint = ['id' => 'acc_j', 'type' => 'uk_retail_joint', 'closed' => false];
$business = ['id' => 'acc_b', 'type' => 'uk_business', 'closed' => false, 'account_number' => '87654471'];
$closedBiz = ['id' => 'acc_old', 'type' => 'uk_business', 'closed' => true];
mzc('the business account is chosen from among the others', (monzo_pick_account([$personal, $joint, $business])['id'] ?? '') === 'acc_b');
mzc('a personal or joint account is NEVER taken in its place', monzo_pick_account([$personal, $joint]) === null);
mzc('a closed business account is not chosen', monzo_pick_account([$closedBiz, $personal]) === null && (monzo_pick_account([$closedBiz, $business])['id'] ?? '') === 'acc_b');
mzc('it is named by the last four digits', monzo_account_label($business) === 'Business account ending 4471' && monzo_account_label(['id' => 'x']) === 'Business account');
mzc('what Monzo shared is said in words', monzo_shared_words([$personal]) === 'a personal account' && monzo_shared_words([$personal, $joint]) === 'a personal account and a joint account' && monzo_shared_words([]) === 'no accounts');

echo "\n== §4 How far back ==\n";
$now = strtotime('2026-10-09 12:00:00 UTC');
mzc('within five minutes of connecting, the whole tax year is asked for', monzo_since(null, $now - 60, $now, '2026-04-06') === '2026-04-06T00:00:00Z');
mzc('after five minutes, only the last 90 days', monzo_since(null, $now - 3600, $now, '2026-04-06') === gmdate('Y-m-d\TH:i:s\Z', $now - 89 * 86400));
mzc('with payments already here, ten days behind the newest, so a late card payment still arrives', monzo_since('2026-10-05 23:59:59', $now - 86400 * 30, $now, '2026-04-06') === '2026-09-25T23:59:59Z');
mzc('…never before the floor', monzo_since('2026-04-08 23:59:59', $now - 60, $now, '2026-04-06') === '2026-04-06T00:00:00Z');

echo "\n== §5 A transaction as a bank line ==\n";
$fp = ['id' => 'tx_0000AbC', 'created' => '2026-10-06T12:01:00.123Z', 'amount' => 37750, 'currency' => 'GBP', 'description' => 'M HILL', 'notes' => 'CHB-000006', 'category' => 'general', 'scheme' => 'payport_faster_payments', 'settled' => '2026-10-06T12:01:00Z', 'counterparty' => ['name' => 'Marcus Hill'], 'account_balance' => 195000];
$l = monzo_line($fp);
mzc('a faster payment in: its own id, London time, the payer, the reference, pounds and the balance after',
    $l === ['ext_key' => 'm:tx_0000AbC', 'date' => '2026-10-06', 'time' => '13:01:00', 'type' => 'Faster payment', 'name' => 'Marcus Hill', 'category' => 'general', 'description' => 'M HILL', 'notes' => 'CHB-000006', 'amount' => 377.5, 'balance' => 1950.0], json_encode($l));
mzc('the key is the one a statement’s Transaction ID makes, so a payment that arrives both ways is one payment',
    $l['ext_key'] === statement_parse("Transaction ID,Date,Amount\ntx_0000AbC,06/10/2026,377.50\n")['lines'][0]['ext_key']);
mzc('a payment just after midnight in summer is that London day', monzo_line(['id' => 'tx_1', 'created' => '2026-07-31T23:30:00Z', 'amount' => -100, 'settled' => 'x'])['date'] === '2026-08-01');
mzc('a declined card payment never moved money', monzo_line(['id' => 'tx_2', 'created' => '2026-10-06T10:00:00Z', 'amount' => -2310, 'decline_reason' => 'INSUFFICIENT_FUNDS']) === null);
mzc('a card payment still waiting to settle waits', monzo_line(['id' => 'tx_3', 'created' => '2026-10-06T10:00:00Z', 'amount' => -2310, 'settled' => '', 'scheme' => 'mastercard']) === null);
mzc('a £0 card check is not a payment', monzo_line(['id' => 'tx_4', 'created' => '2026-10-06T10:00:00Z', 'amount' => 0, 'settled' => 'x']) === null);
mzc('another currency is left out, as the statements do', monzo_line(['id' => 'tx_5', 'created' => '2026-10-06T10:00:00Z', 'amount' => -500, 'currency' => 'EUR', 'settled' => 'x']) === null);
mzc('a line with no id or no time is not guessed at', monzo_line(['created' => '2026-10-06T10:00:00Z', 'amount' => 5]) === null && monzo_line(['id' => 'tx_6', 'amount' => 5]) === null);
$card = monzo_line(['id' => 'tx_7', 'created' => '2026-10-06T10:00:00Z', 'amount' => -2310, 'settled' => '2026-10-07T00:00:00Z', 'scheme' => 'mastercard', 'description' => 'TESCO STORES 2231', 'merchant' => ['name' => 'Tesco']]);
mzc('a card payment names the shop, keeping the bank’s description', $card['type'] === 'Card payment' && $card['name'] === 'Tesco' && $card['description'] === 'TESCO STORES 2231' && $card['amount'] === -23.1, json_encode($card));
$pot = monzo_line(['id' => 'tx_8', 'created' => '2026-10-06T10:00:00Z', 'amount' => -63144, 'settled' => 'x', 'scheme' => 'uk_retail_pot', 'description' => 'pot_0000Tax', 'metadata' => ['pot_id' => 'pot_0000Tax']], ['pot_0000Tax' => 'Tax']);
mzc('a move to a pot is named for the pot, and sorts itself', $pot['type'] === 'Pot transfer' && $pot['name'] === 'To Tax pot' && $pot['description'] === '' && (statement_auto($pot)[0] ?? '') === 'pot', json_encode($pot));
$pot2 = monzo_line(['id' => 'tx_9', 'created' => '2026-10-06T10:00:00Z', 'amount' => 5000, 'settled' => 'x', 'description' => 'pot_0000Unknown']);
mzc('…and one from a pot Monzo didn’t name still reads as a pot', $pot2['name'] === 'From a pot' && (statement_auto($pot2)[0] ?? '') === 'pot');
$sq = monzo_line(['id' => 'tx_10', 'created' => '2026-10-06T10:00:00Z', 'amount' => 61240, 'settled' => 'x', 'scheme' => 'payport_faster_payments', 'description' => 'SQ *PAYOUT', 'counterparty' => ['name' => 'SQUARE EUROPE LTD']]);
mzc('a Square payout in sorts itself, as from a statement', (statement_auto($sq)[0] ?? '') === 'square');
mzc('a transaction with no account balance has none', monzo_line(['id' => 'tx_11', 'created' => '2026-10-06T10:00:00Z', 'amount' => 100, 'settled' => 'x'])['balance'] === null);

echo "\n== §6 How the link stands ==\n";
$n = 2000000000;
mzc('no client: nothing to say', monzo_health([], false, false, $n)['state'] === 'off');
mzc('a client and no token: not connected yet', monzo_health([], true, false, $n)['state'] === 'ready');
mzc('connected, no account yet: approve in the app', monzo_health(['connected_at' => $n], true, true, $n)['state'] === 'approve');
$nb = monzo_health(['no_business' => true, 'shared' => 'a personal account'], true, true, $n);
mzc('no business account shared: said, and statements stay the way in', $nb['state'] === 'no_business' && strpos($nb['say'], 'a personal account') !== false && strpos($nb['say'], 'Statements') !== false, $nb['say']);
mzc('an account and no sync yet: fetching', monzo_health(['account_id' => 'acc_b'], true, true, $n)['state'] === 'syncing');
mzc('an account and a first sync that failed: the reason', monzo_health(['account_id' => 'acc_b', 'last_error' => 'Couldn’t reach Monzo.'], true, true, $n) === ['state' => 'error', 'say' => 'Couldn’t reach Monzo.']);
mzc('synced within a day and a half: live', monzo_health(['account_id' => 'acc_b', 'last_ok' => $n - 3600 * 35], true, true, $n)['state'] === 'live');
mzc('not synced for longer: stale, with the reason when there is one', monzo_health(['account_id' => 'acc_b', 'last_ok' => $n - 3600 * 37, 'last_error' => 'Monzo answered 500.'], true, true, $n) === ['state' => 'stale', 'say' => 'Monzo answered 500.']);
mzc('a refused refresh needs the owner, whatever else is stored', monzo_health(['account_id' => 'acc_b', 'last_ok' => $n, 'reconnect' => true], true, false, $n)['state'] === 'reconnect');

echo "\n== §7 The statement reminder stands down while live ==\n";
$set = ['on' => true];
mzc('a due statement is asked for when there is no live link', statement_reminder_due($set, '2026-08-31', '2026-10-01'));
mzc('…and not while the live link brings the payments in', !statement_reminder_due($set, '2026-08-31', '2026-10-01', true));
mzc('live means the state is live, nothing else', monzo_is_live(['state' => 'live']) && !monzo_is_live(['state' => 'stale']) && !monzo_is_live([]));

echo "\n== §8 The wiring ==\n";
$strip = fn($f) => preg_replace('#^\s*//.*$#m', '', (string) file_get_contents(__DIR__ . '/' . $f));
$cb = $strip('monzo-callback.php');
mzc('the return is checked against the stored state, in constant time', strpos($cb, "hash_equals(\$pending, hash('sha256', \$state))") !== false);
mzc('…which is single-use, removed before the code is exchanged', strpos($cb, "unset(\$l['pending'], \$l['pending_at'])") !== false && strpos($cb, "unset(\$l['pending']") < strpos($cb, "'grant_type' => 'authorization_code'"));
mzc('…and lasts fifteen minutes', strpos($cb, "time() - 900") !== false);
$sy = $strip('monzo-sync.php');
mzc('payments go in once, keyed by Monzo’s id (INSERT IGNORE)', strpos($sy, 'INSERT IGNORE INTO bank_lines') !== false);
mzc('a sync holds a lock, because a refresh is one-time', strpos($sy, "GET_LOCK('chb_monzo_sync'") !== false && strpos($sy, "RELEASE_LOCK('chb_monzo_sync')") !== false);
mzc('the token and the client are written encrypted', strpos($sy, "content_set_secret('monzo-auth'") !== false && strpos($strip('monzo.php'), "content_set_secret('monzo-client'") !== false);
$st = $strip('monzo.php');
mzc('the status never carries a token or secret', strpos($sy, "'access'") === false || !preg_match("/function monzo_status\(\).*?'(access|refresh|secret)'\s*=>/s", $sy));
mzc('self-repair syncs daily and passes live to the reminder', strpos($strip('self-repair.php'), 'statement_reminder_due($stSet, $stLast, $stToday, $stLive)') !== false && strpos($strip('self-repair.php'), 'monzo_sync()') !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass MONZO CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
