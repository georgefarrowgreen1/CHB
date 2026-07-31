<?php
// ============================================================
//  test-sms.php — how Twilio settings RESOLVE, and what the settings page is
//  allowed to say. DEV/CI only (deploy-excluded with the other test-*.php).
//
//      php test-sms.php
//
//  NO NETWORK and NO DATABASE. sms_send() reaches Twilio, and a test that
//  depends on their uptime fails for reasons that have nothing to do with this
//  codebase. What IS worth pinning is the judgement, because it is where this
//  change can go quietly wrong:
//
//    * a config.php CONSTANT still wins, so an install already configured that
//      way keeps working — and an EMPTY constant counts as UNSET, because
//      config.php ships all four as '' and treating those as explicit blanks
//      would permanently shadow the settings page;
//    * sms_status() never carries the auth TOKEN, only whether one is stored;
//    * sms_enabled() needs the switch AND all three details, so a half-filled
//      form can never make the enquiry form offer texts.
//
//  content_value() is stubbed BEFORE the require, the test-payouts.php trick —
//  the real one needs a database, and the resolution rules are the point.
// ============================================================

$GLOBALS['__sms_store'] = [];
$GLOBALS['__sms_reads'] = 0;
function content_value($key)
{
    $GLOBALS['__sms_reads']++;
    return (string) ($GLOBALS['__sms_store'][$key] ?? '');
}
// THE EMPTY-CONSTANT CASE IS THE SHIPPED DEFAULT, and define() cannot be undone
// inside one process — so it gets its own run. `php test-sms.php --empty`
// defines all four exactly as config.php ships them and asserts the stored
// settings still apply; the main run below spawns it and reports the result.
$EMPTY_MODE = in_array('--empty', $argv ?? [], true);
if ($EMPTY_MODE) {
    define('SMS_ENABLED', false);
    define('TWILIO_SID', '');
    define('TWILIO_TOKEN', '');
    define('TWILIO_FROM', '');
}

// sms.php's `require_once __DIR__ . '/db.php'` would pull in the real database
// bootstrap, so load the source with that require stripped. The functions under
// test are pure once content_value() exists.
$src = file_get_contents(__DIR__ . '/sms.php');
$src = preg_replace('/^\s*require_once __DIR__ \. \'\/db\.php\';\s*$/m', '', (string) $src);
$src = preg_replace('/^<\?php\s*/', '', (string) $src);
eval($src);

$fails = 0;
function schk($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  ✓ $name\n";
    } else {
        $fails++;
        echo "  ✗ $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}
function sms_store($map)
{
    $GLOBALS['__sms_store'] = $map;
    // The resolved values are memoised per REQUEST (an uncached SELECT read in
    // loops); this test is many "requests" in one process, so clear it.
    sms_settings_reset();
}
$FULL = [
    'sms-enabled' => '1',
    'apikey-twilio-sid' => 'ACtest0000000000000000000000abcd',
    'apikey-twilio-token' => 'sekrit-token-value',
    'sms-from' => '+447700900000',
];

// ---- THE EMPTY-CONSTANT RUN ------------------------------------------------
// config.php ships SMS_ENABLED=false and all three TWILIO_* as ''. If an empty
// constant counted as an explicit blank, those defaults would permanently shadow
// the settings page and NOTHING the owner typed would ever apply — the settings
// would save, the page would look right, and no text would ever send. This is
// the single most important behaviour in the file, and it needs its own process
// because define() cannot be undone.
if ($EMPTY_MODE) {
    echo "\n== SMS: config.php's shipped empty constants do not shadow the page ==\n";
    sms_store([]);
    schk('empty consts, nothing stored → off', sms_enabled() === false);
    sms_store($FULL);
    schk('empty consts + saved settings → USABLE (the whole point)', sms_enabled() === true);
    schk('…the stored SID is what resolves', sms_setting('TWILIO_SID', 'apikey-twilio-sid') === $FULL['apikey-twilio-sid']);
    schk('…the stored number is what resolves', sms_setting('TWILIO_FROM', 'sms-from') === '+447700900000');
    schk('…and the page does NOT claim to be config-driven', sms_status()['from_config'] === false);
    echo "\n== Summary (empty-consts run) ==\n";
    echo $fails ? "  $fails CHECK(S) FAILED ❌\n" : "  empty-constant run passed ✅\n";
    exit($fails ? 1 : 0);
}

echo "\n== SMS: settings resolve, and the secret stays server-side ==\n";

// ---- 1. Off by default -----------------------------------------------------
// The shipped state. This is what made the enquiry form's opt-in box a promise
// nothing could keep: the box showed regardless of this being false.
sms_store([]);
schk('nothing configured → not switched on', sms_switched_on() === false);
schk('nothing configured → not usable', sms_enabled() === false);

// ---- 2. The settings page turns it on --------------------------------------
sms_store($FULL);
schk('all four settings → switched on', sms_switched_on() === true);
schk('all four settings → usable', sms_enabled() === true);

// ---- 3. HALF-FILLED IS NOT ON ----------------------------------------------
// Each detail is load-bearing. Missing any one of them must read as unusable, or
// the guest form would offer texts that every send then refuses.
foreach (['apikey-twilio-sid', 'apikey-twilio-token', 'sms-from'] as $missing) {
    $partial = $FULL;
    unset($partial[$missing]);
    sms_store($partial);
    schk("switched on but no $missing → still unusable", sms_enabled() === false);
    schk("…and the page can say WHY (on, not ready)", sms_switched_on() === true);
}

// ---- 4. The switch alone is not enough, and neither are the details alone ---
sms_store(['sms-enabled' => '1']);
schk('switch on, no details → unusable', sms_enabled() === false);
$noSwitch = $FULL;
unset($noSwitch['sms-enabled']);
sms_store($noSwitch);
schk('details filled, switch off → unusable (the owner decides when it starts)', sms_enabled() === false);

// ---- 5. THE AUTH TOKEN NEVER LEAVES THE SERVER -----------------------------
// The whole reason the settings field is write-only. A status payload that
// carried the token would put it in every admin browser session.
sms_store($FULL);
$st = sms_status();
$flat = json_encode($st);
schk('status reports a token IS stored', $st['token_set'] === true);
schk('…but never the token itself', strpos((string) $flat, 'sekrit-token-value') === false, (string) $flat);
schk('…and no key in the payload holds it', !in_array('sekrit-token-value', $st, true));
// The SID is an identifier, not a credential — but only its tail is sent, which
// is enough to confirm WHICH account without handing the whole thing back.
schk('the SID is reported as set', $st['sid_set'] === true);
schk('…by its last 4 only', $st['sid_tail'] === 'abcd' && strpos((string) $flat, 'ACtest0000') === false, (string) $flat);
schk('the sender number IS returned (the owner must be able to correct it)', $st['from'] === '+447700900000');
schk('status agrees with sms_enabled', $st['ready'] === true && $st['on'] === true);

// ---- 5b. THE MEMO ACTUALLY CACHES -----------------------------------------
// A memo that resolved every time would pass every check above and quietly cost
// four uncached SELECTs per booking in the payments-due chase loop. Counted at
// the stub, which is the only place a real read can be observed.
$reads = 0;
$GLOBALS['__sms_count'] = true;
sms_store($FULL);
sms_enabled();
$first = $GLOBALS['__sms_reads'];
sms_enabled();
sms_enabled();
sms_status();
schk('repeat lookups cost no further reads', $GLOBALS['__sms_reads'] === $first, "first=$first now={$GLOBALS['__sms_reads']}");
schk('…and the first call did read (the counter works)', $first > 0);
sms_store($FULL); // a reset must make it read again, or the test suite lies to itself
sms_enabled();
schk('a reset re-reads', $GLOBALS['__sms_reads'] > $first);

// ---- 6. A CONFIG CONSTANT STILL WINS ---------------------------------------
// An install that already had SMS in config.php must keep working with an empty
// settings table — that is the whole compatibility promise.
sms_store([]);
define('TWILIO_SID', 'ACfromconfig000000000000000000ff');
define('TWILIO_TOKEN', 'config-token');
define('TWILIO_FROM', '+447700111222');
define('SMS_ENABLED', true);
schk('consts alone → usable with nothing stored', sms_enabled() === true);
schk('…and the page says it is config-driven', sms_status()['from_config'] === true);
schk('…so the owner is not invited to edit fields that cannot apply', sms_status()['ready'] === true);
schk('the const value is used, not a stored one', sms_setting('TWILIO_FROM', 'sms-from') === '+447700111222');
// …and a stored value does NOT override a const that is set.
sms_store(['sms-from' => '+447700999888']);
schk('a stored value cannot override a set const', sms_setting('TWILIO_FROM', 'sms-from') === '+447700111222');

echo "\n== SMS: every message is ONE segment ==\n";
// A text is BILLED PER SEGMENT: GSM-7 fits 160 characters in one, but a single
// character outside that alphabet switches the whole message to UCS-2, where a
// segment holds 70. Measured before this was fixed, an em dash made the balance
// nudge bill as THREE texts and the arrival nudge as TWO. Driving the REAL
// builders (not copies of the strings) is what makes this a gate: reword a
// message with a curly apostrophe and it fails here rather than on the bill.
$bodies = [
    'balance, with an amount' => sms_body_balance('15/08/2026', 340),
    'balance, no amount' => sms_body_balance('15/08/2026', null),
    'arrival info' => sms_body_arrival('15/08/2026'),
    'test message' => sms_body_test(),
    // The longest figure this business could plausibly chase — the fixed prose
    // is what eats the budget, so a bigger number must not tip it over.
    'balance, £10,000.00' => sms_body_balance('15/08/2026', 10000),
];
foreach ($bodies as $label => $body) {
    $seg = sms_segments($body);
    schk("$label is ONE segment", $seg['segments'] === 1, "{$seg['chars']} chars, {$seg['encoding']}, {$seg['segments']} segments");
    schk("…and stays in GSM-7", $seg['encoding'] === 'GSM-7', $seg['encoding']);
}

// The alphabet itself. `$` and `¥` are the two that a PHP double-quoted string
// silently eats — identifiers may contain bytes >= 0x80, so `$¥` parses as a
// VARIABLE. Losing them would make any message containing one measure as UCS-2.
schk('the GSM-7 alphabet kept its dollar sign', strpos(SMS_GSM7, '$') !== false);
schk('…and its yen sign', mb_strpos(SMS_GSM7, '¥') !== false);
schk('a pound sign is GSM-7 (it is IN the alphabet)', sms_segments('£340.00')['encoding'] === 'GSM-7');

// The normaliser, on the characters English prose actually picks up.
schk('em dash becomes a hyphen', sms_plain('due — pay') === 'due - pay');
schk('en dash too', sms_plain('7–14 days') === '7-14 days');
schk('curly apostrophe becomes straight', sms_plain("We\u{2019}ve") === "We've");
schk('curly quotes become straight', sms_plain("\u{201C}hi\u{201D}") === '"hi"');
schk('an ellipsis becomes three dots', sms_plain("wait\u{2026}") === 'wait...');
schk('a non-breaking space becomes a space', sms_plain("a\u{00A0}b") === 'a b');
schk('a soft hyphen is removed (invisible, and still UCS-2)', sms_plain("co\u{00AD}ttage") === 'cottage');
// …and what it must NOT do. A guest's name spelled with an unusual accent should
// arrive CORRECT as two segments rather than mangled into one.
schk('an accented name is left alone, not stripped', sms_plain('Zoë Ferrão') === 'Zoë Ferrão');
schk('plain text is untouched', sms_plain('Balance due 15/08/2026.') === 'Balance due 15/08/2026.');

// And the choke point applies it, so a message composed anywhere benefits —
// including one written later by someone who never reads this file.
$normalised = sms_plain('Cottage Holidays Blakeney: your balance — please pay.');
schk('the normaliser makes a dashed sentence one segment', sms_segments($normalised)['segments'] === 1);
schk('…which it was NOT before normalising', sms_segments('Cottage Holidays Blakeney: your balance — please pay.')['encoding'] === 'UCS-2');

echo "\n== SMS: UK numbers in, E.164 out ==\n";
// sms_send() refuses anything this returns '' for, so a malformed number is
// skipped rather than sent — worth pinning because the owner types the FROM
// number by hand on the new page.
schk('07 trunk → +44', sms_normalize_uk('07700 900123') === '+447700900123');
schk('spaces and punctuation are ignored', sms_normalize_uk('(07700) 900-123') === '+447700900123');
schk('44 without a plus → +44', sms_normalize_uk('447700900123') === '+447700900123');
schk('already E.164 passes through', sms_normalize_uk('+447700900123') === '+447700900123');
schk('empty → refused', sms_normalize_uk('') === '');
schk('nonsense → refused, not mangled', sms_normalize_uk('not a number') === '');
schk('too short → refused', sms_normalize_uk('0770') === '');

// The empty-constant run, in its own process (see the top of the file).
$out = [];
$rc = 0;
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --empty 2>&1', $out, $rc);
foreach ($out as $line) {
    if (strpos($line, '  ✓') === 0 || strpos($line, '  ✗') === 0 || strpos($line, '==') === 0) {
        echo $line . "\n";
    }
}
schk('the empty-constant run passed', $rc === 0, implode(' | ', $out));

// NOTHING IN THE APP MAY CLEAR THE MEMO. sms_settings_reset() exists for this
// file alone — a production caller would mean some request mutates settings
// mid-flight, which this app does not do, and would silently reintroduce the
// per-booking query cost the memo removes.
$callers = 0;
foreach (glob(__DIR__ . '/*.php') ?: [] as $f) {
    if (basename($f) === 'sms.php' || strpos(basename($f), 'test-') === 0) {
        continue;
    }
    if (strpos((string) file_get_contents($f), 'sms_settings_reset') !== false) {
        $callers++;
        echo "    (called from " . basename($f) . ")\n";
    }
}
schk('sms_settings_reset() is test-only — nothing in the app calls it', $callers === 0);

echo "\n== Summary ==\n";
echo $fails ? "  $fails SMS CHECK(S) FAILED ❌\n\n" : "  ALL SMS CHECKS PASSED ✅\n\n";
exit($fails ? 1 : 0);
