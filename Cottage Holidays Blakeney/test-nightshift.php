<?php
// ============================================================
//  test-nightshift.php — the overnight queue's PURE judgements
//  (nightshift-lib.php), no DB and no session. CI-wired; deploy-excluded.
//
//  What it gates, and why each one is worth a check: the DOOR (what a
//  machine in another process may put into the owner's back office), the
//  DEADLINE (the only thing stopping this queue becoming a pile), and the
//  CAPS (what a producer that has gone wrong overnight can do to the table).
//
//  The target vocabulary gets the most attention because it is the one field
//  that survives into a CLICK: everything else is words on a screen, and a
//  target is a button. The rule is a SHAPE test against what chbOpenTarget
//  (app.js) can open — so the checks here are written from that function's
//  own branches, and anything outside them must be refused at the door.
//
//  NB the counter is nsk(), not ok()/chk()/ok2() — PHPStan analyses every
//  test file in this folder as ONE set, so a name already declared elsewhere
//  with a different signature is an error in a file that never loads beside
//  it (the lesson in the invoice notes). A unique name is the fix.
// ============================================================
require_once __DIR__ . '/nightshift-lib.php';

$fails = 0;
// The optional $why prints ONLY on failure — the same shape as the JS
// suites' ok(). It exists because a third argument was twice passed to the
// two-parameter version and silently discarded (PHPStan caught both);
// making the context real beats deleting it.
function nsk($label, $cond, $why = '')
{
    global $fails;
    echo ($cond ? '  ✓ ' : '  ✗ ') . $label . (!$cond && $why !== '' ? ' — ' . $why : '') . "\n";
    if (!$cond) {
        $fails++;
    }
}
// A valid item, so each check below can change exactly one thing.
function ns_item(array $over = [])
{
    return $over + [
        'ref' => 'mac-2026-08-17-01',
        'kind' => 'reply',
        'title' => 'Reply to Rachel Pemberton',
        'sub' => 'Jollyboat, week of 12 Oct',
        'body' => "Hello Rachel,\n\nThank you for getting in touch.",
        'source' => 'her enquiry and the cottage FAQs',
        'target' => 'enquiry-42',
    ];
}

echo "§1 a valid item is accepted, and every field that may be left out may be left out\n";
nsk('the whole thing passes', night_item_problem(ns_item()) === '');
nsk('sub is optional', night_item_problem(array_diff_key(ns_item(), ['sub' => 1])) === '');
nsk('source is optional', night_item_problem(array_diff_key(ns_item(), ['source' => 1])) === '');
nsk('target is optional — plenty of items are just words', night_item_problem(ns_item(['target' => ''])) === '');
foreach (NIGHT_KINDS as $k) {
    nsk("kind '$k' is accepted", night_item_problem(ns_item(['kind' => $k])) === '');
}

echo "§2 the door — what a machine in another process may NOT put on the owner's screen\n";
nsk('no ref refused', night_item_problem(ns_item(['ref' => ''])) !== '');
nsk('a ref with a space refused', night_item_problem(ns_item(['ref' => 'a b'])) !== '');
nsk('a ref with a slash refused', night_item_problem(ns_item(['ref' => '../x'])) !== '');
nsk('an over-long ref refused', night_item_problem(ns_item(['ref' => str_repeat('a', NIGHT_REF_MAX + 1)])) !== '');
nsk('a ref exactly at the limit accepted', night_item_problem(ns_item(['ref' => str_repeat('a', NIGHT_REF_MAX)])) === '');
nsk('an unknown kind refused', night_item_problem(ns_item(['kind' => 'invoice'])) !== '');
nsk('no kind refused', night_item_problem(ns_item(['kind' => ''])) !== '');
nsk('no title refused', night_item_problem(ns_item(['title' => ''])) !== '');
nsk('a whitespace-only title refused', night_item_problem(ns_item(['title' => "   \n"])) !== '');
nsk('an over-long title refused', night_item_problem(ns_item(['title' => str_repeat('t', NIGHT_TITLE_MAX + 1)])) !== '');
nsk('no body refused — a row with nothing to read is a row nobody can act on', night_item_problem(ns_item(['body' => ''])) !== '');
nsk('a whitespace-only body refused', night_item_problem(ns_item(['body' => "  \n \t "])) !== '');
nsk('an over-long body refused', night_item_problem(ns_item(['body' => str_repeat('b', NIGHT_BODY_MAX + 1)])) !== '');
nsk('a body exactly at the limit accepted', night_item_problem(ns_item(['body' => str_repeat('b', NIGHT_BODY_MAX)])) === '');
nsk('an over-long sub refused', night_item_problem(ns_item(['sub' => str_repeat('s', NIGHT_SUB_MAX + 1)])) !== '');
nsk('an over-long source refused', night_item_problem(ns_item(['source' => str_repeat('s', NIGHT_SOURCE_MAX + 1)])) !== '');
nsk('a string instead of an object refused', night_item_problem('reply') !== '');
nsk('null refused', night_item_problem(null) !== '');
// The refusal has to SAY something: a machine in another process cannot read a
// boolean, and "refused" with no cause is a night's work lost to a typo.
nsk('every refusal names its cause', strlen(night_item_problem(ns_item(['kind' => 'nope']))) > 12);
nsk('…and names the kinds that would work', strpos(night_item_problem(ns_item(['kind' => 'nope'])), 'reply') !== false);

echo "§3 target — the one field that becomes a BUTTON, so only what the app can open\n";
// Straight out of chbOpenTarget's own branches (app.js).
foreach (['booking-42', 'enquiry-7', 'arrival-9', 'today', 'inbox', 'messages', 'calendar', 'diagnostics', 'moderation',
    'settings:rates', 'settings:search-learning', 'accounts:sweep', 'inbox:email', 'inbox:email:sent',
    'inbox:enquiries', 'inbox:messages', 'view-experiences', 'view-main'] as $t) {
    nsk("'$t' accepted", night_target_problem($t) === '');
}
nsk("'' accepted (no destination is a fine thing to have)", night_target_problem('') === '');
foreach ([
    'https://evil.example/x' => 'an absolute URL',
    'javascript:alert(1)' => 'a javascript: URL',
    '../../etc/passwd' => 'a path',
    'booking-42; DROP TABLE' => 'anything with punctuation of its own',
    'inbox:outbox' => 'a folder the Inbox does not have',
    'settings:Rates' => 'a capitalised section (the router is lower-case)',
    'accounts:' => 'a prefix with nothing after it',
    'view-' => 'an empty view id',
    'booking-99999999999999' => 'an id longer than any real one',
    '<script>' => 'markup',
    'BOOKING-42' => 'the right shape in the wrong case',
] as $t => $why) {
    nsk($why . " refused ('$t')", night_target_problem($t) !== '');
}
nsk('an over-long target refused', night_target_problem('settings:' . str_repeat('a', 200)) !== '');
nsk('a bad target refuses the whole ITEM, not just the field', night_item_problem(ns_item(['target' => 'javascript:x'])) !== '');

echo "§4 the deadline — per kind, because what goes stale is what was about a moment\n";
nsk('a drafted reply lasts 3 days', night_ttl_days('reply') === 3);
nsk('a price case lasts 7', night_ttl_days('price') === 7);
nsk('an answer lasts 14', night_ttl_days('answer') === 14);
nsk('a reading of the week lasts 14', night_ttl_days('note') === 14);
// A reply is about a LIVE enquiry, so it must never outlive the slower kinds.
nsk('a reply is the shortest-lived kind', night_ttl_days('reply') === min(array_values(NIGHT_TTL_DAYS)));
nsk('an unknown kind gets the SHORTEST window, not the longest', night_ttl_days('made-up') === min(array_values(NIGHT_TTL_DAYS)));
nsk('null kind likewise', night_ttl_days(null) === min(array_values(NIGHT_TTL_DAYS)));

echo "§5 expiry is decided on the stamp, both sides of the boundary\n";
nsk('yesterday has passed', night_is_expired('2026-08-16 09:00:00', '2026-08-17 09:00:00'));
nsk('one second ago has passed', night_is_expired('2026-08-17 08:59:59', '2026-08-17 09:00:00'));
nsk('the same instant has passed (<=, so a deadline is a deadline)', night_is_expired('2026-08-17 09:00:00', '2026-08-17 09:00:00'));
nsk('one second from now has NOT', !night_is_expired('2026-08-17 09:00:01', '2026-08-17 09:00:00'));
nsk('tomorrow has not', !night_is_expired('2026-08-18 09:00:00', '2026-08-17 09:00:00'));
nsk('a row with no deadline is not one that has passed', !night_is_expired('', '2026-08-17 09:00:00'));
nsk('…nor is a null one', !night_is_expired(null, '2026-08-17 09:00:00'));
// The year boundary is where a naive comparison of the DAY would break.
nsk('31 Dec vs 1 Jan is decided correctly', night_is_expired('2025-12-31 23:59:59', '2026-01-01 00:00:00'));

echo "§6 caps — what a producer that has gone wrong overnight can do\n";
nsk('an empty batch refused', night_batch_problem([]) !== '');
nsk('a non-array batch refused', night_batch_problem('nope') !== '');
nsk('null batch refused', night_batch_problem(null) !== '');
nsk('one item is a fine batch', night_batch_problem([ns_item()]) === '');
nsk('a batch at the limit accepted', night_batch_problem(array_fill(0, NIGHT_BATCH_MAX, ns_item())) === '');
nsk('one over the limit refused', night_batch_problem(array_fill(0, NIGHT_BATCH_MAX + 1, ns_item())) !== '');
nsk('…and the refusal names both numbers', strpos(night_batch_problem(array_fill(0, NIGHT_BATCH_MAX + 1, ns_item())), (string) NIGHT_BATCH_MAX) !== false);
nsk('an empty queue has room for the whole cap', night_room_left(0) === NIGHT_OPEN_MAX);
nsk('a queue one short has room for one', night_room_left(NIGHT_OPEN_MAX - 1) === 1);
nsk('a full queue has no room', night_room_left(NIGHT_OPEN_MAX) === 0);
nsk('an over-full queue reports NO room, never a negative', night_room_left(NIGHT_OPEN_MAX + 50) === 0);

echo "§7 what the owner may do to a row — and what they may not\n";
nsk("'use' lands on used", night_act_status('use') === 'used');
nsk("'dismiss' lands on dismissed", night_act_status('dismiss') === 'dismissed');
nsk("'restore' lands back on open", night_act_status('restore') === 'open');
nsk('an unknown act is refused', night_act_status('publish') === '');
nsk('…including anything that would SEND', night_act_status('send') === '');
nsk('…or charge', night_act_status('charge') === '');
nsk('empty refused', night_act_status('') === '');
nsk('null refused', night_act_status(null) === '');
// The whole vocabulary is three words. If a fourth ever appears it has to be
// argued for here first, because every one of them is something a tap does to
// a row a machine wrote.
nsk('there are exactly three acts', count(NIGHT_ACTS) === 3);
nsk('and none of them is a verb that leaves the app', !array_intersect(array_keys(NIGHT_ACTS), ['send', 'email', 'publish', 'charge', 'apply', 'refund']));

echo "§8 the shape the client is handed\n";
$pub = night_item_public([
    'id' => '12', 'ref' => 'r1', 'kind' => 'note', 'title' => 'T', 'sub' => 'S',
    'body' => 'B', 'source' => 'src', 'target' => 'today',
    'created_at' => '2026-08-17 04:00:00', 'expires_at' => '2026-08-31 04:00:00',
]);
nsk('id comes back as an int', $pub['id'] === 12);
nsk('the dates are named for a reader, not a column', isset($pub['created'], $pub['expires']));
nsk('the row status is NOT handed out (the client only ever sees open ones)', !isset($pub['status']));
// The body is passed through RAW and escaped at the render boundary — the
// chbDuties rule. Escaping here would escape a guest's apostrophe twice.
$raw = night_item_public(['body' => "O'Brien & <b>Sons</b>"]);
nsk('the body is passed through unescaped, for the client to escape once', $raw['body'] === "O'Brien & <b>Sons</b>");
$missing = night_item_public([]);
nsk('a row missing everything degrades to empty strings, never a warning', $missing['title'] === '' && $missing['kind'] === 'note');

echo "§9 the brief — the read a producer gets, and what it deliberately withholds\n";
$eRow = [
    'id' => '42', 'prop_key' => 'jollyboat', 'name' => 'Rachel Pemberton',
    'check_in' => '2026-10-12', 'check_out' => '2026-10-19', 'adults' => 2, 'children' => 0,
    'message' => "Hi — is Jollyboat free that week, and do you take dogs?",
    'created_at' => '2026-08-16 23:39:00',
    // Everything below is present on the real row and must NOT come back:
    'email' => 'rachel@example.com', 'phone' => '07700 900123',
    'address' => '9 Test Lane, Norwich', 'postcode' => 'NR25 7AB',
];
$price = ['nights' => 7, 'total' => 892.5, 'damagesDeposit' => 75.0, 'perNight' => 127.5];
$b = night_brief_enquiry($eRow, 'Jollyboat', $price, true, [
    ['q' => 'Do you take dogs?', 'a' => 'We are afraid not, at any of the three cottages.'],
    ['q' => 'Is there parking?', 'a' => 'One car, on the gravel by the front gate.'],
]);
nsk('the id comes back as an int', $b['id'] === 42);
nsk('the guest is named', $b['name'] === 'Rachel Pemberton');
nsk('…and a first name is worked out for the greeting', $b['first'] === 'Rachel');
nsk('the cottage is named for a reader, not by key', $b['cottage'] === 'Jollyboat');
nsk('…with the key alongside it', $b['prop'] === 'jollyboat');
nsk('the message rides along', strpos($b['message'], 'do you take dogs') !== false);
nsk('the site answers availability ITSELF', $b['dates_free'] === true);
nsk('the site formats the QUOTE itself, once', $b['quote'] === '£892.50');
nsk('…and the refundable deposit', $b['deposit'] === '£75.00');
nsk('nights come from the price model, not from counting', $b['nights'] === 7);
nsk('the cottage answers ride along', count($b['facts']) === 2 && $b['facts'][0]['q'] === 'Do you take dogs?');
// WHAT A DRAFTED REPLY DOES NOT NEED. Every one of these is on the real row.
foreach (['email', 'phone', 'address', 'postcode', 'terms_accepted_at'] as $k) {
    nsk("'$k' is NOT in the brief", !array_key_exists($k, $b));
}
nsk('and nothing outside the stated shape leaks in', count(array_diff(array_keys($b), [
    'id', 'name', 'first', 'cottage', 'prop', 'received', 'check_in', 'check_out',
    'adults', 'children', 'message', 'dates_free', 'nights', 'quote', 'deposit', 'facts',
])) === 0);

echo "§10 what the brief does when the site cannot answer\n";
$noPrice = night_brief_enquiry($eRow, 'Jollyboat', null, null, []);
nsk('no rate row → an EMPTY quote, never a zero', $noPrice['quote'] === '');
nsk('…and no deposit figure either', $noPrice['deposit'] === '');
nsk('…and nights is null, not 0', $noPrice['nights'] === null);
nsk('a failed clash check is NULL, never a cheerful true', $noPrice['dates_free'] === null);
$taken = night_brief_enquiry($eRow, 'Jollyboat', $price, false, []);
nsk('taken dates say so', $taken['dates_free'] === false);
$noDep = night_brief_enquiry($eRow, 'Jollyboat', ['nights' => 3, 'total' => 400.0, 'damagesDeposit' => 0], true, []);
nsk('a cottage with no deposit gets no deposit sentence to write', $noDep['deposit'] === '');

echo "§11 the brief is bounded — a compromised secret reads a page, not a history\n";
$long = night_brief_enquiry(['name' => 'A', 'message' => str_repeat('x', NIGHT_BRIEF_MSG_MAX + 500)], '', null, null, []);
nsk('an over-long message is cut to the cap', mb_strlen($long['message']) === NIGHT_BRIEF_MSG_MAX);
$many = [];
for ($i = 0; $i < NIGHT_BRIEF_FACTS_MAX + 6; $i++) {
    $many[] = ['q' => 'Q' . $i, 'a' => 'A' . $i];
}
$capped = night_brief_enquiry($eRow, '', null, null, $many);
nsk('the cottage answers stop at the cap', count($capped['facts']) === NIGHT_BRIEF_FACTS_MAX);
$fat = night_brief_enquiry($eRow, '', null, null, [[
    'q' => str_repeat('q', NIGHT_BRIEF_FACT_Q_MAX + 50),
    'a' => str_repeat('a', NIGHT_BRIEF_FACT_A_MAX + 50),
]]);
nsk('a long question is cut', mb_strlen($fat['facts'][0]['q']) === NIGHT_BRIEF_FACT_Q_MAX);
nsk('…and a long answer is cut', mb_strlen($fat['facts'][0]['a']) === NIGHT_BRIEF_FACT_A_MAX);
$junk = night_brief_enquiry($eRow, '', null, null, [['q' => '', 'a' => 'orphan'], ['q' => 'orphan', 'a' => ''], 'nonsense']);
nsk('half-written or malformed answers are dropped rather than shipped', count($junk['facts']) === 0);
nsk('the brief cap is a handful, not a page', NIGHT_BRIEF_MAX > 0 && NIGHT_BRIEF_MAX <= 20);

echo "§12 first names, as people actually type them\n";
nsk('two words', night_first_name('Rachel Pemberton') === 'Rachel');
nsk('one word is its own first name', night_first_name('Rachel') === 'Rachel');
nsk('extra spaces', night_first_name('  Rachel   Pemberton ') === 'Rachel');
nsk('a title is NOT stripped (better a formal greeting than a wrong one)', night_first_name('Mrs Pemberton') === 'Mrs');
nsk('trailing punctuation goes', night_first_name('Rachel, Pemberton') === 'Rachel');
nsk('a double-barrelled first name survives', night_first_name('Mary-Anne Coe') === 'Mary-Anne');
nsk('empty is empty', night_first_name('') === '');
nsk('null is empty, never a warning', night_first_name(null) === '');

// ── §13 THE APP'S OWN KEY ─────────────────────────────────────────────────
// The route used to take APP_SECRET and nothing else — the key to ~20 cron
// endpoints, including the one that CHARGES GUESTS' CARDS. Its own key now.
echo "\n13) the key that opens this route\n";
$long = str_repeat('a', 64);
$master = str_repeat('m', 64);

nsk('a scoped key opens it', night_key_kind($long, $long, $master) === 'scoped');
nsk('the MASTER secret does NOT, once a scoped key exists',
    night_key_kind($master, $long, $master) === '');
nsk('...which is the whole point: the fix is not decoration',
    night_key_kind($master, $long, $master) !== 'master');
nsk('with NO scoped key the master still works, so nothing breaks on upgrade',
    night_key_kind($master, '', $master) === 'master');
nsk('a wrong key opens nothing either way',
    night_key_kind('nope', $long, $master) === '' && night_key_kind('nope', '', $master) === '');
nsk('an empty key opens nothing', night_key_kind('', $long, $master) === '');
nsk('...even when nothing is configured at all', night_key_kind('', '', '') === '');
// A SHORT stored value is not a key. Without this a one-character content row
// would become the only accepted key AND lock the master out.
nsk('a too-short stored key is ignored, not treated as the key',
    night_key_kind('ab', 'ab', $master) === '' && night_key_kind($master, 'ab', $master) === 'master');
// FAILS CLOSED, NOT OPEN. enc_key() derives from APP_SECRET, so ROTATING that
// secret — what you do after a leak — makes every encrypted value unreadable.
// Inferring "no key configured" from an empty VALUE therefore handed the route
// straight back to the new master secret.
nsk('a key ON FILE that will not decrypt refuses the master secret',
    night_key_kind($master, '', $master, true) === '');
nsk('…and refuses everything else too, rather than guessing',
    night_key_kind('anything', '', $master, true) === '');
nsk('…while a key on file that DOES decrypt still works',
    night_key_kind($long, $long, $master, true) === 'scoped');
nsk('with nothing on file the master still works',
    night_key_kind($master, '', $master, false) === 'master');
// The old inference is still the default when nothing is passed, so the
// signature stayed compatible.
nsk('the value-only inference survives as the default',
    night_key_kind($master, '', $master) === 'master' && night_key_kind($long, $long, $master) === 'scoped');

nsk('a generated key is long and random',
    strlen(night_key_make()) >= NIGHT_KEY_MIN && night_key_make() !== night_key_make());

// ── §14 THE PAIRED MACS ───────────────────────────────────────────────────
echo "\n14) one key per Mac, hashed, revocable\n";
$k1 = str_repeat('1', 64);
$k2 = str_repeat('2', 64);
$now = 1787000000;

// A LEGACY SINGLE KEY KEEPS WORKING. Anyone paired under the first version has
// the key itself stored; it must read as one device, not as nothing.
$legacy = night_devices($k1);
nsk('a legacy single key reads as one device', count($legacy) === 1);
nsk('…and its own key still opens it', night_device_index($legacy, $k1) === 0);
nsk('…while another key does not', night_device_index($legacy, $k2) === -1);
nsk('…and it is marked as legacy, so a write can convert it', !empty($legacy[0]['legacy']));

$list = [
    ['h' => night_key_hash($k1), 'label' => 'Mac mini', 'added' => $now - 86400 * 10, 'seen' => $now - 60],
    ['h' => night_key_hash($k2), 'label' => 'MacBook', 'added' => $now - 86400 * 2, 'seen' => 0],
];
$dev = night_devices($list);
nsk('two Macs are two devices', count($dev) === 2);
nsk('…each opened by its OWN key only',
    night_device_index($dev, $k1) === 0 && night_device_index($dev, $k2) === 1);
nsk('…and an unknown key by neither', night_device_index($dev, str_repeat('9', 64)) === -1);
// THE SITE STORES ONLY A HASH — the point of hashing at all.
nsk('the stored shape carries no key, only a hash',
    strpos(json_encode($dev), $k1) === false && strpos(json_encode($dev), $k2) === false);
nsk('garbage rows are dropped, not guessed at',
    count(night_devices([['h' => 'nope'], ['label' => 'no hash'], 'a string', ['h' => night_key_hash($k1)]])) === 1);
nsk('a label is plain text and bounded',
    night_dev_label("  a\nb  ") === 'a b' && mb_strlen(night_dev_label(str_repeat('x', 200))) === NIGHT_DEV_LABEL_MAX);
nsk('…and an empty one still names something', night_dev_label('') !== '');
nsk('the list is capped', count(night_devices(array_fill(0, 40, ['h' => night_key_hash($k1)]))) === NIGHT_DEV_MAX);

// ── §15 THE QUIET MAC ─────────────────────────────────────────────────────
// The failure the owner will actually live with is not a stolen key — it is a
// Mac that quietly stopped and nothing said so.
echo "\n15) a Mac that has gone quiet\n";
$fresh = ['h' => night_key_hash($k1), 'seen' => $now - 3600];
$stale = ['h' => night_key_hash($k1), 'seen' => $now - 86400 * 5];
$never = ['h' => night_key_hash($k1), 'seen' => 0];
nsk('a Mac heard from an hour ago is 0 days quiet', night_quiet_days($fresh, $now) === 0);
nsk('one heard from five days ago is 5', night_quiet_days($stale, $now) === 5);
// NEVER HEARD FROM IS NOT A FAULT: it is mid-setup, or has not had a night yet.
nsk('one never heard from is not measured at all', night_quiet_days($never, $now) === -1);
nsk('a clock that went backwards is not a warning', night_quiet_days(['seen' => $now + 9999], $now) === 0);

nsk('nothing paired raises nothing', night_quiet_problem([], $now) === -1);
nsk('a Mac that has never reported raises nothing', night_quiet_problem([$never], $now) === -1);
nsk('one night quiet raises nothing', night_quiet_problem([['seen' => $now - 86400]], $now) === -1);
nsk('two nights quiet raises nothing', night_quiet_problem([['seen' => $now - 86400 * 2]], $now) === -1);
nsk('THREE nights quiet raises it', night_quiet_problem([['seen' => $now - 86400 * 3]], $now) === 3);
// THE FRESHEST MAC DECIDES. With one working, the work is getting done.
nsk('a working Mac beside a silent one is no problem',
    night_quiet_problem([$stale, $fresh], $now) === -1);
nsk('…both silent and it is raised', night_quiet_problem([$stale, $stale], $now) === 5);

// ── §16 THE CONNECT CODE ──────────────────────────────────────────────────
echo "\n16) the connect code\n";
$code = night_code_make();
nsk('a code is eight characters', strlen($code) === NIGHT_CODE_LEN);
nsk('…from an alphabet with no I, O, 0 or 1', !preg_match('/[IO01]/', $code));
nsk('…and two are different', night_code_make() !== night_code_make());
nsk('it prints in halves for reading aloud', night_code_pretty('ABCD2345') === 'ABCD-2345');
nsk('typed back loosely, it still matches',
    night_code_normalise(' abcd-2345 ') === 'ABCD2345');
// A CHARACTER OUTSIDE THE ALPHABET IS A TYPO, not noise to drop: silently
// removing it would make two different typings mean one code.
nsk('a character outside the alphabet is refused', night_code_normalise('ABCD-234I') === '');
nsk('the wrong length is refused', night_code_normalise('ABCD') === '');

$good = ['h' => night_key_hash('ABCD2345'), 'exp' => $now + 300, 'used' => 0];
nsk('the right code, in time, is accepted', night_code_problem($good, 'abcd-2345', $now) === '');
nsk('the wrong code is refused', night_code_problem($good, 'ABCD2346', $now) !== '');
nsk('…and the refusal is a sentence, not "invalid"',
    strlen(night_code_problem($good, 'ABCD2346', $now)) > 20);
nsk('an expired code is refused, and says so',
    stripos(night_code_problem(['h' => $good['h'], 'exp' => $now - 1, 'used' => 0], 'ABCD2345', $now), 'expired') !== false);
// USED AND EXPIRED ARE DIFFERENT FACTS — "someone has already used this" is
// worth knowing, because either you did or somebody else did.
nsk('a used code says USED, not expired',
    stripos(night_code_problem(['h' => $good['h'], 'exp' => $now + 300, 'used' => 1], 'ABCD2345', $now), 'already been used') !== false);
nsk('no code waiting is refused with its own sentence',
    stripos(night_code_problem([], 'ABCD2345', $now), 'no connect code') !== false);
nsk('a malformed code never reaches the comparison',
    night_code_problem($good, 'nonsense', $now) !== '');

echo "\n17) the week, the gaps and the questions — the other jobs' briefs\n";

// THE WEEK. End-exclusive like every calendar here, contact details withheld,
// figures formatted once, a settled stay stating NO figure at all.
$names = ['jollyboat' => 'Jollyboat', '21a' => '21A Westgate'];
$wrows = [
    ['prop_key' => 'jollyboat', 'name' => 'Rachel Pemberton', 'check_in' => '2026-08-21', 'check_out' => '2026-08-24',
        'adults' => 2, 'children' => 1, 'due' => 340.0,
        'email' => 'rachel@x.test', 'phone' => '07700 900123'],
    ['prop_key' => '21a', 'name' => 'Tom Ashby', 'check_in' => '2026-08-10', 'check_out' => '2026-08-19',
        'adults' => 2, 'children' => 0, 'due' => 0.0],
    ['prop_key' => 'jollyboat', 'name' => 'Far Future', 'check_in' => '2026-10-01', 'check_out' => '2026-10-04',
        'adults' => 2, 'children' => 0, 'due' => 500.0],
];
$w = night_week_brief($wrows, $names, '2026-08-17');
nsk('the window is a week', $w['from'] === '2026-08-17' && $w['to'] === '2026-08-24');
nsk('an arrival inside it is named by FIRST name and cottage',
    count($w['arrivals']) === 1 && $w['arrivals'][0]['first'] === 'Rachel' && $w['arrivals'][0]['cottage'] === 'Jollyboat');
nsk('…with the site\'s own due figure, formatted once', $w['arrivals'][0]['due'] === '£340.00');
nsk('…and the nights end-exclusive', $w['arrivals'][0]['nights'] === 3);
nsk('a departure inside it rides too', count($w['departures']) === 1 && $w['departures'][0]['first'] === 'Tom');
nsk('a settled stay states NO figure — "£0.00 outstanding" is noise',
    $w['departures'][0]['cottage'] === '21A Westgate' && !isset($w['arrivals'][1]));
nsk('October is not this week', strpos(json_encode($w), 'Far') === false);
nsk('no contact detail survives into the week', strpos(json_encode($w), 'rachel@x.test') === false
    && strpos(json_encode($w), '900123') === false);

// THE GAPS. Occupied = bookings AND blocks; 2–4 nights only; window-bounded;
// the figures are the injected model's own, formatted here.
$occ = [
    ['prop_key' => 'jollyboat', 'check_in' => '2026-09-09', 'check_out' => '2026-09-12'],
    ['prop_key' => 'jollyboat', 'check_in' => '2026-09-15', 'check_out' => '2026-09-18'], // 3-night gap 12→15
    ['prop_key' => '21a', 'check_in' => '2026-08-20', 'check_out' => '2026-08-22'],
    ['prop_key' => '21a', 'check_in' => '2026-08-23', 'check_out' => '2026-08-26'],        // 1 night: changeover slack
    ['prop_key' => 'pimpernel', 'check_in' => '2026-09-01', 'check_out' => '2026-09-03'],
    ['prop_key' => 'pimpernel', 'check_in' => '2026-09-10', 'check_out' => '2026-09-12'],  // 7 nights: space, not a gap
];
$rateFor = function ($pk) { return $pk === 'pimpernel' ? null : ['couple_rate' => 120]; };
$bd = function ($rate, $in, $out) {
    $n = night_nights($in, $out);
    return ['nights' => $n, 'nightly' => 120.0 * $n];
};
$gaps = night_gap_brief($occ, $names, $rateFor, $bd, '2026-08-17');
nsk('exactly the 2–4 night hole is a gap', count($gaps) === 1);
nsk('…named, dated and sized', $gaps[0]['cottage'] === 'Jollyboat' && $gaps[0]['from'] === '2026-09-12'
    && $gaps[0]['to'] === '2026-09-15' && $gaps[0]['nights'] === 3);
nsk('…with the current rate formatted once', $gaps[0]['rate'] === '£120.00');
nsk('…and the offer at the back office\'s own 15% (not imminent)', $gaps[0]['offer'] === '£102.00');
nsk('an IMMINENT gap cuts 20% — last-minute price is the only lever left', (function () use ($names, $bd) {
    $occ2 = [
        ['prop_key' => 'jollyboat', 'check_in' => '2026-08-15', 'check_out' => '2026-08-18'],
        ['prop_key' => 'jollyboat', 'check_in' => '2026-08-21', 'check_out' => '2026-08-24'],
    ];
    $g = night_gap_brief($occ2, $names, function ($pk) { return ['couple_rate' => 120]; }, $bd, '2026-08-17');
    return count($g) === 1 && $g[0]['offer'] === '£96.00';
})());
nsk('a cottage with no rate row offers NO gap — no honest figure, no gap',
    strpos(json_encode($gaps), 'pimpernel') === false);
nsk('the floor holds at £20', (function () use ($names) {
    $occ3 = [
        ['prop_key' => 'jollyboat', 'check_in' => '2026-09-09', 'check_out' => '2026-09-12'],
        ['prop_key' => 'jollyboat', 'check_in' => '2026-09-15', 'check_out' => '2026-09-18'],
    ];
    $g = night_gap_brief($occ3, $names, function ($pk) { return ['couple_rate' => 10]; },
        function ($rate, $in, $out) { $n = night_nights($in, $out); return ['nights' => $n, 'nightly' => 10.0 * $n]; },
        '2026-08-17');
    return count($g) === 1 && $g[0]['offer'] === '£20.00';
})());

// THE QUESTIONS. Most-asked first, capped, grounded in that cottage's own
// published answers.
$misses = [
    ['q' => 'Do you have an EV charger?', 'n' => 2, 'prop' => 'jollyboat'],
    ['q' => 'Can we bring a dog?', 'n' => 5, 'prop' => '21a'],
    ['q' => 'Is there a cot?', 'n' => 1, 'prop' => ''],
];
$faqsFor = function ($pk) {
    return $pk === '21a' ? [['q' => 'Do you take dogs?', 'a' => 'We are afraid not.']] : [];
};
$qs = night_questions_brief($misses, $names, $faqsFor);
nsk('most-asked first, capped at ' . NIGHT_QUESTIONS_MAX, count($qs) === NIGHT_QUESTIONS_MAX && $qs[0]['q'] === 'Can we bring a dog?');
nsk('…carrying how often it was asked', $qs[0]['asked'] === 5);
nsk('…the cottage NAMED, never a raw key', $qs[0]['cottage'] === '21A Westgate');
nsk('…and grounded in that cottage\'s own answers', count($qs[0]['facts']) === 1
    && $qs[0]['facts'][0]['a'] === 'We are afraid not.');
nsk('garbage in the store is dropped, not guessed at',
    count(night_questions_brief([['x' => 1], 'a string', null], $names, $faqsFor)) === 0);
nsk('a no-cottage question still says something for the label',
    night_questions_brief([['q' => 'Is there a cot?', 'n' => 1, 'prop' => '']], $names, $faqsFor)[0]['cottage'] === 'the cottages');

// ── §18 THE WORD "Array" CAN NEVER REACH A DRAFT ─────────────────────────
// The cottage-name bug's whole class: `(string)` on an array is the literal
// word "Array", and the JSON content rows (published FAQs, the guest-question
// misses) are the two inputs written OUTSIDE this file — one by the owner,
// one by a public rate-limited endpoint. Hostile shapes go in; the sweep
// asserts the word appears NOWHERE in the composed output, and that the
// malformed entry became an ABSENT fact while its well-formed neighbour
// survived (dropping everything would pass the sweep and lose the feature).
echo "\n== §18 hostile JSON at the brief\'s boundaries ==\n";
$hostileFaqs = [
    ['q' => ['an', 'array'], 'a' => 'real answer'],          // array q
    ['q' => 'Do you take dogs?', 'a' => ['nested' => 'no']], // array a
    ['q' => 'Is there parking?', 'a' => 'Yes, beside the cottage.'], // survives
    ['q' => 3.5, 'a' => 'numeric q is a string fact'],       // numeric is fine
];
$enq = night_brief_enquiry(
    ['id' => 9, 'name' => 'Pat Doe', 'prop_key' => 'jollyboat', 'adults' => 2, 'children' => 0,
     'check_in' => '2026-09-04', 'check_out' => '2026-09-07', 'message' => 'Hello'],
    'Jollyboat', null, true, $hostileFaqs,
);
nsk('a malformed fact is absent, its neighbour survives', count($enq['facts']) === 2
    && $enq['facts'][0]['q'] === 'Is there parking?', json_encode($enq['facts']));
nsk('…and the word Array appears nowhere in the enquiry brief',
    strpos(json_encode($enq), 'Array') === false, json_encode($enq['facts']));
$hq = night_questions_brief(
    [
        ['q' => ['not', 'a', 'string'], 'n' => 9, 'prop' => '21a'],   // array q → dropped
        ['q' => 'Is there an EV charger?', 'n' => 3, 'prop' => ['x']], // array prop → label falls back
        ['q' => 'Can we park?', 'n' => 2, 'prop' => '21a'],
    ],
    ['21a' => '21A Westgate'],
    function ($pk) use ($hostileFaqs) { return $pk === '21a' ? $hostileFaqs : []; },
);
nsk('an array question is dropped, not printed as Array', count($hq) === 2
    && $hq[0]['q'] === 'Is there an EV charger?', json_encode(array_column($hq, 'q')));
nsk('an array prop falls back to the honest label', $hq[0]['cottage'] === 'the cottages', $hq[0]['cottage']);
nsk('…and the word Array appears nowhere in the questions brief',
    strpos(json_encode($hq), 'Array') === false, json_encode($hq));
nsk('…while the well-formed question keeps its grounded facts',
    $hq[1]['cottage'] === '21A Westgate' && count($hq[1]['facts']) === 2, json_encode($hq[1]));

// ── §19 THE ASK CHANNEL\'S JUDGEMENTS ─────────────────────────────────────
echo "\n== §19 the ask channel\'s judgements ==\n";
nsk('a reply ask with its enquiry is fine', night_ask_problem('reply', 42, '') === '');
nsk('a reply ask with NO enquiry is refused', night_ask_problem('reply', 0, '') !== '');
nsk('an answer ask with a question is fine', night_ask_problem('answer', 0, 'Is there an EV charger?') === '');
nsk('an answer ask with no question is refused', night_ask_problem('answer', 0, '  ') !== '');
nsk('an answer ask whose question is an ARRAY is refused, never the word Array',
    night_ask_problem('answer', 0, ['not', 'a', 'string']) !== '');
nsk('an unknown kind is refused and the refusal names the real ones',
    strpos(night_ask_problem('invoice', 1, ''), 'reply') !== false);
nsk('an over-long question is refused', night_ask_problem('answer', 0, str_repeat('q', NIGHT_ASK_Q_MAX + 1)) !== '');
nsk('a real answer lands', night_ask_answer_problem('There is a charger in the lane.') === '');
nsk('an empty answer is refused', night_ask_answer_problem("  \n ") !== '');
nsk('a non-string answer is refused', night_ask_answer_problem(['x']) !== '');
nsk('an answer over the queue\'s own body cap is refused',
    night_ask_answer_problem(str_repeat('a', NIGHT_BODY_MAX + 1)) !== '');
nsk('the TTL is minutes, not days — an ask is about a moment', NIGHT_ASK_TTL_MIN <= 15);

// ── §20 THE INTENT ASK — the model places a phrasing on the site's menu ──
echo "\n== §20 the intent ask ==\n";
nsk("'intent' is an ask kind, needing its query", night_ask_problem('intent', 0, 'who is due money right now?') === ''
    && night_ask_problem('intent', 0, '   ') !== '');
nsk('an intent query that is an ARRAY is refused, never the word Array',
    night_ask_problem('intent', 0, ['who', 'owes']) !== '');
$opts = night_ask_options(['who owes me money', '  leaving today  ', '', ['not', 'a', 'string'], 42, str_repeat('x', NIGHT_ASK_OPT_CHARS + 1)]);
nsk('the menu is cleaned at the boundary — strings kept, garbage absent',
    count($opts) === 3 && $opts[0] === 'who owes me money' && $opts[1] === 'leaving today', json_encode($opts));
nsk('…the number 42 survives as its words (a string is a string)', $opts[2] === '42', json_encode($opts));
nsk('an over-long entry is dropped, not truncated to a near-miss the byte-exact check would then refuse',
    !in_array(str_repeat('x', NIGHT_ASK_OPT_CHARS), $opts, true), json_encode($opts));
nsk('a non-array menu is [], never the word Array',
    night_ask_options('who owes me money') === [] && night_ask_options(null) === []);
nsk('the menu caps at ' . NIGHT_ASK_OPTS_MAX,
    count(night_ask_options(array_map(fn ($i) => 'q' . $i, range(1, NIGHT_ASK_OPTS_MAX + 10)))) === NIGHT_ASK_OPTS_MAX);

// ── §20b THE DIGEST ASK — a summary grounded in its own records ───────────
echo "\n== §20b the digest ask ==\n";
nsk("'digest' is an ask kind, needing its question",
    night_ask_problem('digest', 0, 'what did guests say about the boiler?') === ''
    && night_ask_problem('digest', 0, '  ') !== '');
$rows20 = night_ask_rows(['Sarah said the boiler took £120 to fix.', '', ['array'], str_repeat('long ', 100), 42]);
nsk('the rows are cleaned at the boundary — an over-long one is CUT, not dropped (a record is evidence)',
    count($rows20) === 3 && $rows20[0] === 'Sarah said the boiler took £120 to fix.'
    && mb_strlen($rows20[1]) === NIGHT_ASK_ROW_CHARS && $rows20[2] === '42', json_encode(array_map('mb_strlen', $rows20)));
nsk('the rows cap at ' . NIGHT_ASK_ROWS_MAX . ', and a non-array is []',
    count(night_ask_rows(array_fill(0, 20, 'r'))) === NIGHT_ASK_ROWS_MAX && night_ask_rows('x') === []);
$dr = ['Sarah paid £120 for the boiler.', 'Tom said the pressure kept dropping, refund of £1,200 agreed.'];
nsk('a summary whose money is IN the records passes',
    night_digest_answer_problem('Two boiler mentions — a £120 fix and a £1200 refund.', $dr) === '');
nsk('…separators and trailing .00 forgiven both ways',
    night_digest_answer_problem('The fix cost £120.00.', $dr) === '');
nsk('a figure the records never state is refused, named in the sentence',
    strpos(night_digest_answer_problem('Repairs ran to about £450 overall.', $dr), '£450') !== false);
nsk('a summary with no money at all sails through', night_digest_answer_problem('Mostly boiler grumbles.', $dr) === '');
// TRAILING ZEROS ARE ONLY FORGIVEN AFTER A DECIMAL POINT. An unconditional
// rtrim stripped them off INTEGERS, so £450 grounded against rows holding
// only £45 (and £4,500 likewise) — the door accepting figures 10x-100x the
// records, against exactly the buggy or hostile device it exists to catch.
$drz = ['The deposit back to Hannah is £45.'];
nsk('an integer 10x the records is refused — 450 never grounds on 45',
    strpos(night_digest_answer_problem('Returned £450 to Hannah.', $drz), '£450') !== false
    && strpos(night_digest_answer_problem('Returned £4,500 to Hannah.', $drz), '£4,500') !== false);
nsk('…while £45.00 still legitimately grounds on £45, and the reverse',
    night_digest_answer_problem('Returned £45.00 to Hannah.', $drz) === ''
    && night_digest_answer_problem('Returned £45 today.', ['Deposit of £45.00 held.']) === '');

// ── §20b CHAT CONTINUITY — may an imported conversation land? ────────────
echo "\n== §20b the import door ==\n";
$imOk = [['who' => 'you', 'text' => 'What did we decide about the boiler?'], ['who' => 'mac', 'text' => 'Colin quoted for it.']];
nsk('a well-shaped import passes', night_chat_import_problem('imp-c1755-3', $imOk) === '');
nsk('a junk ref is refused in a sentence',
    night_chat_import_problem('IMP UPPER!', $imOk) !== '' && night_chat_import_problem('', $imOk) !== '');
nsk('an empty import is refused', night_chat_import_problem('imp-1', []) !== '');
nsk('the cap refuses the 41st message, named',
    strpos(night_chat_import_problem('imp-1', array_fill(0, 41, $imOk[0])), (string) NIGHT_CHAT_IMPORT_MAX) !== false);
nsk("a who outside you/mac is refused", night_chat_import_problem('imp-1', [['who' => 'guest', 'text' => 'x']]) !== '');
nsk('a wordless message is refused', night_chat_import_problem('imp-1', [['who' => 'you', 'text' => '  ']]) !== '');

// ── §20c HANDOFF — what each surface is doing, and what may be offered ───
echo "\n== §20c the handoff advertisement ==\n";
$hoNow = 1000000;
$hoWeb = ['dev' => 'web', 'convo' => 4, 'thread' => '', 'title' => 'the boiler', 'draft' => 'what did colin', 'at' => $hoNow];
$hoMac = ['dev' => 'mac', 'convo' => 7, 'thread' => 'c99-1', 'title' => 'pricing', 'draft' => '', 'at' => $hoNow];
nsk('a well-shaped activity sanitises whole',
    (night_handoff_one($hoWeb)['title'] ?? '') === 'the boiler'
    && (night_handoff_one($hoWeb)['draft'] ?? '') === 'what did colin');
nsk('an unknown device is refused, and so is an undated one',
    night_handoff_one(['dev' => 'watch', 'at' => $hoNow]) === null
    && night_handoff_one(['dev' => 'web', 'at' => 0]) === null);
nsk('the draft and title are CAPPED, never carried whole',
    mb_strlen(night_handoff_one(['dev' => 'web', 'at' => $hoNow, 'draft' => str_repeat('x', 5000)])['draft']) === NIGHT_HANDOFF_DRAFT_MAX
    && mb_strlen(night_handoff_one(['dev' => 'web', 'at' => $hoNow, 'title' => str_repeat('t', 400)])['title']) === NIGHT_HANDOFF_TITLE_MAX);
nsk('a device cannot claim to be the other one — the map is keyed by device',
    night_handoff_map(['mac' => $hoWeb, 'web' => $hoWeb]) === ['web' => night_handoff_one($hoWeb)]);
$hoMap = ['web' => $hoWeb, 'mac' => $hoMac];
nsk('each side is offered the OTHER\'s activity, never its own',
    (night_handoff_offer($hoMap, 'mac', $hoNow)['dev'] ?? '') === 'web'
    && (night_handoff_offer($hoMap, 'web', $hoNow)['dev'] ?? '') === 'mac');
// RECENCY is our substitute for Handoff's proximity: what you were doing
// minutes ago is offerable; an hour ago is not "what you were just doing".
nsk('a stale activity is not offered — recency is the whole gate',
    night_handoff_offer($hoMap, 'mac', $hoNow + NIGHT_HANDOFF_FRESH + 1) === null
    && night_handoff_offer($hoMap, 'mac', $hoNow + NIGHT_HANDOFF_FRESH - 1) !== null);
// A Mac sitting in a LOCAL thread advertises convo 0 — the site cannot serve
// a conversation that lives on its disk, so the phone is never offered one.
nsk('a local-only Mac thread is never offered to the phone',
    night_handoff_offer(['mac' => ['dev' => 'mac', 'convo' => 0, 'thread' => 'c1', 'title' => 'local', 'at' => $hoNow]], 'web', $hoNow) === null);
nsk('…while the MAC may still be offered a phone conversation', night_handoff_offer($hoMap, 'mac', $hoNow) !== null);
nsk('nothing stored is the ordinary answer, not a failure',
    night_handoff_offer([], 'mac', $hoNow) === null && night_handoff_offer('junk', 'web', $hoNow) === null);

// ── §21 HOW GEORGE WRITES — the voice examples (integration step 3) ──────
echo "\n== §21 the voice examples ==\n";
$tpls = [
    ['id' => 'a', 'body' => 'Just a reminder that {{balance}} is still to pay for {{cottage}} ({{dates}}).', 'uses' => 2],
    ['id' => 'b', 'body' => 'Good news — {{cottage}} is free and we would love to have you.', 'uses' => 9],
    ['id' => 'c', 'body' => 'A third paragraph that the cap must exclude.', 'uses' => 1],
];
$v = night_voice_examples($tpls);
nsk('capped at two, most-USED first', count($v) === 2 && strpos($v[0], 'Good news') === 0, json_encode($v));
nsk('the {{tokens}} become neutral words, never braces',
    strpos($v[1], 'the amount') !== false && strpos($v[1], 'the cottage') !== false
    && strpos(json_encode($v), '{{') === false, json_encode($v));
nsk('garbage rows are absent, not the word Array',
    strpos(json_encode(night_voice_examples([['body' => ['not', 'a', 'string']], 'x', null])), 'Array') === false
    && night_voice_examples('nonsense') === []);
nsk('an over-long paragraph is capped, not shipped whole',
    mb_strlen(night_voice_examples([['body' => str_repeat('word ', 200), 'uses' => 1]])[0]) <= NIGHT_VOICE_CHARS);

// ── §22 THE CHAT VIEW — words and a first name, nothing else ─────────────
echo "\n== §22 the chat view ==\n";
$cv = night_chat_view(
    ['name' => 'Sophie Grant', 'email' => 'sophie@gmail.com'],
    [
        ['sender_role' => 'guest', 'body' => 'What time can we get in on Saturday?'],
        ['sender_role' => 'admin', 'body' => 'From 3pm — see you then!'],
        ['sender_role' => 'guest', 'body' => ['an', 'array']],
        ['sender_role' => 'guest', 'body' => 'And is the key safe code the same as last year?'],
    ],
);
nsk('the first name is worked out and the roles translated', $cv['first'] === 'Sophie'
    && $cv['msgs'][0]['who'] === 'guest' && $cv['msgs'][1]['who'] === 'you', json_encode($cv));
nsk('a malformed message is absent, not the word Array',
    count($cv['msgs']) === 3 && strpos(json_encode($cv), 'Array') === false, json_encode($cv));
nsk('the email never enters the view', strpos(json_encode($cv), 'sophie@gmail.com') === false);
nsk('the view is capped at ' . NIGHT_CHAT_MSGS_MAX . ' messages', count(night_chat_view(
    ['name' => 'A'],
    array_map(fn($i) => ['sender_role' => 'guest', 'body' => 'm' . $i], range(1, 10)),
)['msgs']) === NIGHT_CHAT_MSGS_MAX);
nsk("'chat' is an ask kind and needs its conversation",
    night_ask_problem('chat', 5, '') === '' && night_ask_problem('chat', 0, '') !== '');

// ── §23 THE TEACH BRIEF — dead ends onto the site's own menu ─────────────
echo "\n== §23 the teach brief ==\n";
$canon23 = ['who owes me money', 'leaving today'];
$mi23 = [
    ['t' => 'anyone owing us?', 'n' => 3, 'at' => '2026-08-18'],
    ['t' => 'who is leaving', 'n' => 5, 'at' => '2026-08-15'],
    ['t' => 'stale one', 'n' => 9, 'at' => '2026-08-01'],          // outside the window
    ['t' => 'already taught', 'n' => 4, 'at' => '2026-08-18'],     // learned
    ['t' => 'made literal', 'n' => 4, 'at' => '2026-08-18'],       // suppressed
    ['t' => ['an', 'array'], 'n' => 2, 'at' => '2026-08-18'],      // garbage
    'not even a row',
];
$tb = night_teach_brief($mi23, $canon23, [['t' => 'already taught', 'c' => 'x']], ['made literal'], '2026-08-19');
nsk('the brief carries the live misses, most-searched first, with the menu',
    $tb !== null && count($tb['misses']) === 2 && $tb['misses'][0]['q'] === 'who is leaving'
    && $tb['misses'][1]['q'] === 'anyone owing us?' && $tb['options'] === $canon23, json_encode($tb));
nsk('a miss outside the seven-day window is withheld',
    !in_array('stale one', array_column($tb['misses'], 'q'), true));
nsk('a phrasing already taught or made literal is withheld — a suggestion about a solved problem',
    !in_array('already taught', array_column($tb['misses'], 'q'), true)
    && !in_array('made literal', array_column($tb['misses'], 'q'), true));
nsk('garbage rows are absent, never the word Array', strpos(json_encode($tb), 'Array') === false);
nsk('no menu → null (a mapping could only be invented)',
    night_teach_brief($mi23, [], [], [], '2026-08-19') === null
    && night_teach_brief($mi23, 'junk', [], [], '2026-08-19') === null);
nsk('no live misses → null, never an empty section',
    night_teach_brief([['t' => 'old', 'n' => 1, 'at' => '2026-01-01']], $canon23, [], [], '2026-08-19') === null);
nsk('the misses cap at ' . NIGHT_TEACH_MAX, count(night_teach_brief(
    array_map(fn ($i) => ['t' => 'miss number ' . $i, 'n' => $i, 'at' => '2026-08-19'], range(1, 15)),
    $canon23, [], [], '2026-08-19',
)['misses']) === NIGHT_TEACH_MAX);
nsk("'teach' is a queue kind with the fourteen-day window",
    in_array('teach', NIGHT_KINDS, true) && night_ttl_days('teach') === 14);

// ── §24 THE CHAT'S TOOLS — read-only, grounded, refused in sentences ──────
echo "\n== §24 the chat's tools ==\n";

// The whitelist and the refusals — each a sentence, never a code.
// The correction is DERIVED from NIGHT_TOOLS, never restated by hand — the
// hand-written list stopped at the original five, so a fumbling model was
// actively taught that money/performance/expenses/coast do not exist.
nsk('an unknown tool is refused naming EVERY real one, derived from the whitelist',
    strpos(night_tool_problem('delete_booking', [], '2026-08-19'), implode(', ', NIGHT_TOOLS)) !== false);
nsk('cottages takes no arguments and passes', night_tool_problem('cottages', [], '2026-08-19') === '');
nsk('today and enquiries take no arguments and pass',
    night_tool_problem('today', ['junk' => 1], '2026-08-19') === ''
    && night_tool_problem('enquiries', [], '2026-08-19') === '');
nsk('availability without a cottage is refused',
    night_tool_problem('availability', ['from' => '2026-09-01', 'to' => '2026-09-04'], '2026-08-19') !== '');
nsk('availability with a malformed date is refused',
    night_tool_problem('availability', ['cottage' => 'Jollyboat', 'from' => '2026-02-31', 'to' => '2026-03-04'], '2026-08-19') !== ''
    && night_tool_problem('availability', ['cottage' => 'Jollyboat', 'from' => 'next friday', 'to' => '2026-03-04'], '2026-08-19') !== '');
nsk('availability with to before from is refused',
    night_tool_problem('availability', ['cottage' => 'Jollyboat', 'from' => '2026-09-04', 'to' => '2026-09-01'], '2026-08-19') !== '');
nsk('availability about the past is refused — history is not availability',
    night_tool_problem('availability', ['cottage' => 'Jollyboat', 'from' => '2026-08-01', 'to' => '2026-08-05'], '2026-08-19') !== '');
nsk('a range over ' . NIGHT_TOOL_RANGE_MAX . ' nights is refused',
    night_tool_problem('availability', ['cottage' => 'Jollyboat', 'from' => '2026-09-01', 'to' => '2026-12-01'], '2026-08-19') !== '');
nsk('a valid availability ask passes',
    night_tool_problem('availability', ['cottage' => 'Jollyboat', 'from' => '2026-09-01', 'to' => '2026-09-04'], '2026-08-19') === '');
nsk('bookings with no arguments passes; a bad optional date is still refused',
    night_tool_problem('bookings', [], '2026-08-19') === ''
    && night_tool_problem('bookings', ['from' => 'garbage'], '2026-08-19') !== '');

// The shapes: names travel, contact details never, money formatted or absent.
$names24 = ['jollyboat' => 'Jollyboat Cottage', '21a' => '21A Westgate Street'];
$rows24 = [
    ['prop_key' => 'jollyboat', 'name' => 'Sarah Pemberton', 'email' => 'sarah@example.com', 'phone' => '07700 900123',
     'address' => '1 Quay Lane', 'postcode' => 'NR25 7NE',
     'check_in' => '2026-08-19', 'check_out' => '2026-08-23', 'adults' => 2, 'children' => 1, 'due' => 340.5],
    ['prop_key' => '21a', 'name' => 'Dan Rowe', 'check_in' => '2026-08-16', 'check_out' => '2026-08-19',
     'adults' => 2, 'children' => 0, 'due' => 0],
    ['prop_key' => '21a', 'name' => 'Priya Patel', 'check_in' => '2026-08-17', 'check_out' => '2026-08-21',
     'adults' => 3, 'children' => 0, 'due' => 0],
    'not even a row',
];
$td = night_tool_today($rows24, $names24, '2026-08-19', 2);
nsk('today splits arrival / departure / staying end-exclusively',
    count($td['arrivals']) === 1 && $td['arrivals'][0]['guest'] === 'Sarah Pemberton'
    && count($td['departures']) === 1 && $td['departures'][0]['guest'] === 'Dan Rowe'
    && count($td['staying']) === 1 && $td['staying'][0]['guest'] === 'Priya Patel'
    && $td['enquiries_waiting'] === 2, json_encode($td));
nsk('money leaves formatted, and a settled stay states no figure at all',
    $td['arrivals'][0]['still_to_pay'] === '£340.50' && $td['departures'][0]['still_to_pay'] === '');
$flat24 = json_encode($td);
nsk('no email, phone, address or postcode in the payload — names are the line',
    strpos($flat24, 'example.com') === false && strpos($flat24, '900123') === false
    && strpos($flat24, 'Quay Lane') === false && strpos($flat24, 'NR25') === false);
nsk('garbage rows are absent, never the word Array', strpos($flat24, 'Array') === false);
nsk('the cottage name is the display name, not the key',
    $td['arrivals'][0]['cottage'] === 'Jollyboat Cottage');

$many24 = array_map(fn ($i) => ['prop_key' => '21a', 'name' => 'Guest ' . $i,
    'check_in' => '2026-09-0' . (($i % 9) + 1), 'check_out' => '2026-09-2' . (($i % 9) + 1),
    'adults' => 2, 'children' => 0, 'due' => 0], range(1, 15));
$bk = night_tool_bookings($many24, $names24, '2026-09-01', '2026-09-30');
nsk('bookings cap at ' . NIGHT_TOOL_ROWS_MAX . ' WITH the cut said — no silent caps',
    count($bk['bookings']) === NIGHT_TOOL_ROWS_MAX && $bk['more'] === 3, json_encode(['n' => count($bk['bookings']), 'more' => $bk['more']]));

$av = night_tool_availability('Jollyboat Cottage', '2026-09-01', '2026-09-04', [], ['total' => 440.0]);
nsk('a free range carries the site\'s own quote, formatted, with its framing named',
    $av['free'] === true && $av['price'] === '£440.00' && $av['nights'] === 3
    && strpos($av['price_note'], '2 adults') !== false, json_encode($av));
nsk('a free range with NO price says nothing about money — never a guessed quote',
    !isset(night_tool_availability('Jollyboat Cottage', '2026-09-01', '2026-09-04', [], null)['price']));
$avT = night_tool_availability('Jollyboat Cottage', '2026-09-01', '2026-09-04', ['Bob Carter'], ['total' => 440.0]);
nsk('a taken range names who has it and states NO price — pricing the unsellable is a lie',
    $avT['free'] === false && $avT['taken_by'] === ['Bob Carter'] && !isset($avT['price']));

// The cottages tool — the fleet itself, capped and never invented.
$ct = night_tool_cottages([
    ['name' => 'Jollyboat Cottage', 'couple_rate' => 130, 'max_adults' => 2, 'max_children' => 2, 'max_total' => 4,
     'facts' => array_merge([['q' => 'Parking?', 'a' => 'One car outside.'], ['q' => 'Dogs?', 'a' => 'We are afraid not.']],
         array_map(fn ($i) => ['q' => 'Q' . $i, 'a' => 'A' . $i], range(1, 8)))],
    ['name' => '21A Westgate Street', 'couple_rate' => 0, 'max_adults' => 0, 'max_children' => 0, 'max_total' => 0, 'facts' => 'junk'],
    'not a row',
]);
nsk('a cottage carries its name, sleeps, base rate FRAMED, and its own Q&A',
    $ct['cottages'][0]['cottage'] === 'Jollyboat Cottage'
    && $ct['cottages'][0]['sleeps'] === '2 adults + 2 children (4 at most)'
    && strpos($ct['cottages'][0]['nightly'], '£130.00') === 0
    && strpos($ct['cottages'][0]['nightly'], 'seasons and weekends move it') !== false
    && $ct['cottages'][0]['facts'][0]['q'] === 'Parking?', json_encode($ct['cottages'][0] ?? null));
nsk('the Q&A caps at ' . NIGHT_TOOL_FACTS_MAX . ' facts', count($ct['cottages'][0]['facts']) === NIGHT_TOOL_FACTS_MAX);
nsk('no rate → no figure, no occupancy → no sleeps claim, garbage absent',
    !isset($ct['cottages'][1]['nightly']) && !isset($ct['cottages'][1]['sleeps'])
    && !isset($ct['cottages'][1]['facts']) && count($ct['cottages']) === 2
    && strpos(json_encode($ct), 'Array') === false, json_encode($ct));

// WHAT THE COTTAGE HAS, AND WHAT GUESTS AGREE TO. Both are stores the site keeps
// per cottage and the model could not see: asked "can guests bring a dog to
// Pimpernel?" it had nothing to answer from, and its guard correctly drops a
// bluff — so the question every holiday let is asked most got a shrug about a
// fact the site holds. Capped like the Q&A, and NEVER invented.
$cl = night_tool_cottages([
    ['name' => 'Pimpernel', 'couple_rate' => 175, 'max_adults' => 4, 'max_children' => 2, 'max_total' => 4,
     'amenities' => array_merge(['Wood-burning stove', 'Sea view'], array_map(fn ($i) => 'Thing ' . $i, range(1, 12))),
     'rules' => ['No smoking indoors', 'Sorry, no dogs at Pimpernel', '', '   ', ['nested'], null]],
    ['name' => 'Bare Cottage', 'couple_rate' => 100, 'amenities' => 'junk', 'rules' => null],
]);
nsk('a cottage carries its amenities and its house rules',
    ($cl['cottages'][0]['amenities'][0] ?? '') === 'Wood-burning stove'
    && in_array('Sorry, no dogs at Pimpernel', $cl['cottages'][0]['rules'] ?? [], true),
    json_encode($cl['cottages'][0] ?? null));
nsk('both lists cap at ' . NIGHT_TOOL_LIST_MAX,
    count($cl['cottages'][0]['amenities']) === NIGHT_TOOL_LIST_MAX);
nsk('junk rows are dropped, the good ones stand',
    count($cl['cottages'][0]['rules']) === 2 && strpos(json_encode($cl), 'Array') === false, json_encode($cl['cottages'][0]['rules'] ?? null));
nsk('a cottage with neither claims neither — no empty keys to reason from',
    !isset($cl['cottages'][1]['amenities']) && !isset($cl['cottages'][1]['rules']), json_encode($cl['cottages'][1] ?? null));

// ── §25 THE WEB CHAT — the owner's Mac from anywhere, validated pure ──────
echo "\n== §25 the web chat ==\n";

nsk("'ownerchat' is an ask kind and a message needs words",
    in_array('ownerchat', NIGHT_ASK_KINDS, true)
    && night_ask_problem('ownerchat', 0, '') !== ''
    && night_ask_problem('ownerchat', 0, 'who arrives today?') === '');

// The thread sanitiser: garbage absent, caps held, the Mac's extras kept.
$wt = night_ownerchat_thread(['instr' => '  short answers  ', 'msgs' => array_merge([
    ['who' => 'you', 'text' => 'who arrives today?', 'at' => '14:22'],
    ['who' => 'mac', 'text' => 'Sarah does.', 'think' => 'checking the day', 'used' => ['today', ''], 'model' => 'gemma.gguf'],
    ['who' => 'martian', 'text' => 'wrong role reads as you'],
    ['who' => 'you', 'text' => ''],
    'junk',
], array_map(fn ($i) => ['who' => 'you', 'text' => 'filler ' . $i], range(1, 50)))]);
nsk('the thread keeps words, thinking, lookups and the instruction — junk absent, caps held',
    $wt['instr'] === 'short answers'
    && count($wt['msgs']) === NIGHT_OWNERCHAT_THREAD_MAX
    && $wt['msgs'][0]['who'] === 'you'
    && strpos(json_encode($wt), 'Array') === false, json_encode(array_slice($wt['msgs'], 0, 3)));
$wt2 = night_ownerchat_thread(['msgs' => [
    ['who' => 'mac', 'text' => 'Free.', 'think' => 'x', 'used' => ['today'], 'model' => 'm'],
    ['who' => 'you', 'text' => 'q'],
]]);
nsk('a Mac message keeps think/used/model; a your-message never carries them',
    isset($wt2['msgs'][0]['think']) && $wt2['msgs'][0]['used'] === ['today']
    && !isset($wt2['msgs'][1]['think']));

// The payload one ask carries out: the NEWEST turns, capped, instruction riding.
$pl = night_ownerchat_payload(['instr' => 'be brief', 'msgs' => array_map(
    fn ($i) => ['who' => $i % 2 ? 'mac' : 'you', 'text' => 'turn ' . $i], range(1, 30))]);
nsk('the ask carries the newest ' . NIGHT_OWNERCHAT_TURNS_MAX . ' turns and the instruction',
    count($pl['turns']) === NIGHT_OWNERCHAT_TURNS_MAX
    && $pl['turns'][NIGHT_OWNERCHAT_TURNS_MAX - 1]['text'] === 'turn 30'
    && $pl['instr'] === 'be brief', json_encode(array_slice($pl['turns'], -2)));

// The answer rule: a JSON envelope with words — anything else refused in a sentence.
nsk('a web-chat answer must be the JSON envelope, with its words',
    night_ownerchat_answer_problem('just prose') !== ''
    && night_ownerchat_answer_problem('{"think":"only thinking"}') !== ''
    && night_ownerchat_answer_problem(json_encode(['text' => 'Sarah arrives.', 'think' => 'ok', 'used' => ['today']])) === '');
nsk('…and its caps are its own — over-long words or thinking refused',
    night_ownerchat_answer_problem(json_encode(['text' => str_repeat('x', NIGHT_OWNERCHAT_TEXT_MAX + 1)])) !== ''
    && night_ownerchat_answer_problem(json_encode(['text' => 'ok', 'think' => str_repeat('x', NIGHT_OWNERCHAT_THINK_MAX + 1)])) !== '');

// ── ATTACHMENTS ──────────────────────────────────────────────────────────
// The photo ref is ONE shape — the one chat_photo_store mints — and anything
// else reads as no photo, because the ref crosses two trust boundaries.
nsk('a chat photo ref is exactly the minted shape, and nothing else',
    night_chat_ref_ok('uploads/chat-photo-0123456789ab.jpg')
    && !night_chat_ref_ok('uploads/chat-photo-0123456789ab.png')
    && !night_chat_ref_ok('uploads/../config.php')
    && !night_chat_ref_ok('uploads/chat-photo-XYZ.jpg')
    && !night_chat_ref_ok('uploads/deposit-evidence-3-0123456789ab.jpg')
    && !night_chat_ref_ok(null));
// Attachments SURVIVE the sanitiser (chat_poll re-writes the thread through
// it when an answer lands — a dropped field would erase the photo the moment
// the Mac replied), and a junk ref reads as no photo on every pass.
$at = night_ownerchat_thread(['msgs' => [
    ['who' => 'you', 'text' => 'what is this?', 'img' => 'uploads/chat-photo-0123456789ab.jpg', 'file' => 'boiler.jpg'],
    ['who' => 'you', 'text' => 'and this?', 'img' => 'uploads/../secrets.jpg'],
    ['who' => 'mac', 'text' => 'A boiler.', 'img' => 'uploads/chat-photo-0123456789ab.jpg'],
]]);
$at2 = night_ownerchat_thread($at); // the round trip chat_poll performs
nsk('img and file survive the sanitiser — twice — and junk or mac-side refs are dropped',
    ($at['msgs'][0]['img'] ?? '') === 'uploads/chat-photo-0123456789ab.jpg'
    && ($at['msgs'][0]['file'] ?? '') === 'boiler.jpg'
    && !isset($at['msgs'][1]['img'])
    && !isset($at['msgs'][2]['img'])
    && ($at2['msgs'][0]['img'] ?? '') === 'uploads/chat-photo-0123456789ab.jpg'
    && ($at2['msgs'][0]['file'] ?? '') === 'boiler.jpg', json_encode($at2['msgs']));
// The FINAL turn travels whole — a fenced document must reach the Mac intact,
// never cut at the history cap and answered confidently about the half seen —
// while history keeps the tight cap, and the photo ref rides ONLY the ask.
$doc = "summarise this\n\n--- attached file: notes.txt ---\n" . str_repeat('y', 5000) . "\n--- end of notes.txt ---";
$pl2 = night_ownerchat_payload(['msgs' => [
    ['who' => 'you', 'text' => str_repeat('a', 3000), 'img' => 'uploads/chat-photo-0123456789ab.jpg'],
    ['who' => 'mac', 'text' => 'Noted.'],
    ['who' => 'you', 'text' => $doc, 'img' => 'uploads/chat-photo-ba9876543210.jpg'],
]]);
nsk('the newest turn travels WHOLE (the fenced document intact); history keeps the tight cap',
    mb_strlen($pl2['turns'][2]['text']) === mb_strlen($doc)
    && strpos($pl2['turns'][2]['text'], '--- end of notes.txt ---') !== false
    && mb_strlen($pl2['turns'][0]['text']) === NIGHT_OWNERCHAT_TURN_CHARS,
    'last=' . mb_strlen($pl2['turns'][2]['text']) . ' first=' . mb_strlen($pl2['turns'][0]['text']));
nsk('a photo ref rides ONLY the final turn — an older photo never resurfaces on a new question',
    ($pl2['turns'][2]['img'] ?? '') === 'uploads/chat-photo-ba9876543210.jpg'
    && !isset($pl2['turns'][0]['img']), json_encode($pl2['turns'][0]));
// A STOP is part of the record: the flag survives the sanitiser (and so the
// chat_poll round trip) on a mac message, and never invents itself on the
// owner's side.
$sp = night_ownerchat_thread(night_ownerchat_thread(['msgs' => [
    ['who' => 'mac', 'text' => 'The weekend looks', 'stopped' => true],
    ['who' => 'mac', 'text' => 'A full answer.'],
    ['who' => 'you', 'text' => 'busy weekend?', 'stopped' => true],
]]));
nsk('a stopped answer STAYS stopped through the round trip, and only a mac message can be',
    ($sp['msgs'][0]['stopped'] ?? false) === true
    && !isset($sp['msgs'][1]['stopped'])
    && !isset($sp['msgs'][2]['stopped']), json_encode($sp['msgs']));

// ── §26 THE WIDER READS AND THE PROPOSED ACTIONS ─────────────────────────
echo "\n== §26 tier 1 reads + tier 2 proposals ==\n";
$nm = ['jollyboat' => 'Jollyboat', '21a' => '21A Westgate Street', 'pimpernel' => 'Pimpernel'];
nsk('the whitelist gained the three whole-business reads',
    in_array('money', NIGHT_TOOLS, true) && in_array('performance', NIGHT_TOOLS, true)
    && in_array('expenses', NIGHT_TOOLS, true)
    && night_tool_problem('money', [], '2026-08-20') === '');
$mn = night_tool_money(
    [['id' => 7, 'name' => 'Sarah Pemberton', 'prop_key' => 'jollyboat', 'check_in' => '2026-08-22', 'check_out' => '2026-08-25', 'due' => 340.5, 'due_now' => true, 'email' => 'leak@x.com'],
     ['id' => 8, 'name' => 'Dan Rowe', 'prop_key' => '21a', 'check_in' => '2026-10-01', 'check_out' => '2026-10-04', 'due' => 200.0, 'due_now' => false]],
    [['id' => 5, 'name' => 'Eve Hart', 'prop_key' => 'pimpernel', 'check_out' => '2026-08-18', 'dep' => 75.0]],
    $nm,
);
nsk('money splits due-now from later, carries the booking REF, and NO contact detail travels',
    ($mn['due_now'][0]['ref'] ?? 0) === 7 && ($mn['due_now'][0]['still_to_pay'] ?? '') === '£340.50'
    && ($mn['due_later'][0]['guest'] ?? '') === 'Dan Rowe'
    && ($mn['deposits_to_return'][0]['deposit'] ?? '') === '£75.00'
    && strpos(json_encode($mn), 'leak@x.com') === false, json_encode($mn));
$pf = night_tool_performance(
    [['check_in' => '2026-08-03', 'check_out' => '2026-08-07', 'revenue' => 500.0]],
    [['check_in' => '2026-07-10', 'check_out' => '2026-07-12', 'revenue' => 200.0],
     ['check_in' => '2026-07-20', 'check_out' => '2026-07-23', 'revenue' => 300.0]],
    'August 2026', 'July 2026',
);
nsk('performance sums stays, nights and money — and STATES its direct-only frame',
    $pf['this_month']['nights'] === 4 && $pf['this_month']['revenue'] === '£500.00'
    && $pf['last_month']['stays'] === 2 && $pf['last_month']['nights'] === 5
    && strpos($pf['frame'], 'platform stays') !== false, json_encode($pf));
$ex = night_tool_expenses([
    ['amount' => 60, 'category' => 'Cleaning'], ['amount' => 40, 'category' => 'Cleaning'],
    ['amount' => 25, 'category' => 'Repairs'],
], '2026/27');
nsk('expenses total by category, biggest first',
    $ex['total'] === '£125.00' && $ex['by_category'][0]['category'] === 'Cleaning'
    && $ex['by_category'][0]['total'] === '£100.00' && $ex['logged'] === 3, json_encode($ex));

// THE PROPOSALS. The whitelist is closed, the past is not proposable, a
// cottage resolves exactly as the availability tool resolves one, and money
// OUT is refused BY NAME — its absence is a decision, not an oversight.
$ok1 = night_act_resolve(['action' => 'block_dates', 'args' => ['cottage' => 'jolly', 'from' => '2026-09-01', 'to' => '2026-09-04', 'note' => 'boiler service']], $nm, '2026-08-20');
nsk('a block resolves its cottage to the key and stores normalised',
    $ok1['problem'] === '' && $ok1['act']['prop'] === 'jollyboat' && $ok1['act']['cottage'] === 'Jollyboat'
    && $ok1['act']['from'] === '2026-09-01' && $ok1['act']['note'] === 'boiler service', json_encode($ok1));
$ok2 = night_act_resolve(['action' => 'price_override', 'args' => ['cottage' => 'Pimpernel', 'from' => '2026-09-01', 'to' => '2026-09-08', 'rate' => 150]], $nm, '2026-08-20');
nsk('a price override carries its bounded rate', $ok2['problem'] === '' && $ok2['act']['rate'] === 150.0, json_encode($ok2));
nsk('the refusals, each in a sentence: unknown kind (refund BY NAME), ambiguous cottage, the past, a silly rate, a guessed booking',
    night_act_resolve(['action' => 'refund', 'args' => []], $nm, '2026-08-20')['problem'] !== ''
    && strpos(night_act_resolve(['action' => 'refund', 'args' => []], $nm, '2026-08-20')['problem'], 'moves money out') !== false
    && strpos(night_act_resolve(['action' => 'block_dates', 'args' => ['cottage' => 'e', 'from' => '2026-09-01', 'to' => '2026-09-02']], $nm, '2026-08-20')['problem'], 'More than one') !== false
    && night_act_resolve(['action' => 'block_dates', 'args' => ['cottage' => 'jolly', 'from' => '2026-08-01', 'to' => '2026-08-22']], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'price_override', 'args' => ['cottage' => 'jolly', 'from' => '2026-09-01', 'to' => '2026-09-02', 'rate' => 5]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'request_payment', 'args' => []], $nm, '2026-08-20')['problem'] !== '');
nsk('the stored-form guard: an extra field is refused, and a verdict is done or dismissed',
    night_act_problem(['kind' => 'block_dates', 'prop' => 'jollyboat', 'cottage' => 'J', 'from' => '2026-09-01', 'to' => '2026-09-02', 'email' => 'x@y.z']) !== ''
    && night_act_problem(['kind' => 'request_payment', 'booking' => 7, 'done' => 'maybe']) !== ''
    && night_act_problem(['kind' => 'request_payment', 'booking' => 7, 'done' => 'done', 'doneAt' => '14:22']) === '');
// The sanitiser is the SECOND guard: a valid act (verdict included) survives
// the round trip on a mac message; junk is dropped; a you-message never
// carries one however the row was assembled.
$ta = night_ownerchat_thread(night_ownerchat_thread(['msgs' => [
    ['who' => 'mac', 'text' => 'I can block that.', 'act' => ['kind' => 'block_dates', 'prop' => 'jollyboat', 'cottage' => 'Jollyboat', 'from' => '2026-09-01', 'to' => '2026-09-04', 'done' => 'done', 'doneAt' => '14:22']],
    ['who' => 'mac', 'text' => 'And this.', 'act' => ['kind' => 'refund', 'amount' => 999]],
    ['who' => 'you', 'text' => 'block it', 'act' => ['kind' => 'block_dates', 'prop' => 'jollyboat', 'cottage' => 'J', 'from' => '2026-09-01', 'to' => '2026-09-02']],
]]));
nsk('a valid act survives the sanitiser twice with its verdict; junk and you-side acts are dropped',
    ($ta['msgs'][0]['act']['done'] ?? '') === 'done'
    && !isset($ta['msgs'][1]['act'])
    && !isset($ta['msgs'][2]['act']), json_encode($ta['msgs']));
// THE TWO DAILY WORKERS. A booking speaks the house's own check_in/check_out
// (leave-day exclusive — guest-speak "12th to the 15th" IS arrive/leave);
// an enquiry reply points at a looked-up id.
$ab = night_act_resolve(['action' => 'add_booking', 'args' => ['cottage' => 'jolly',
    'check_in' => '2026-09-12', 'check_out' => '2026-09-15', 'name' => 'Sarah Pemberton',
    'adults' => 2, 'children' => 1, 'price' => 400]], $nm, '2026-08-20');
nsk('an add_booking resolves whole — cottage to key, party and the agreed price along',
    $ab['problem'] === '' && $ab['act']['prop'] === 'jollyboat'
    && $ab['act']['name'] === 'Sarah Pemberton' && $ab['act']['adults'] === 2
    && $ab['act']['children'] === 1 && $ab['act']['price'] === 400.0, json_encode($ab));
nsk('…and its refusals: leave before arrive, no name, no adults, a past arrival, a silly price',
    night_act_resolve(['action' => 'add_booking', 'args' => ['cottage' => 'jolly', 'check_in' => '2026-09-15', 'check_out' => '2026-09-12', 'name' => 'S', 'adults' => 2]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'add_booking', 'args' => ['cottage' => 'jolly', 'check_in' => '2026-09-12', 'check_out' => '2026-09-15', 'name' => '  ', 'adults' => 2]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'add_booking', 'args' => ['cottage' => 'jolly', 'check_in' => '2026-09-12', 'check_out' => '2026-09-15', 'name' => 'S', 'adults' => 0]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'add_booking', 'args' => ['cottage' => 'jolly', 'check_in' => '2026-08-01', 'check_out' => '2026-08-05', 'name' => 'S', 'adults' => 2]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'add_booking', 'args' => ['cottage' => 'jolly', 'check_in' => '2026-09-12', 'check_out' => '2026-09-15', 'name' => 'S', 'adults' => 2, 'price' => 999999]], $nm, '2026-08-20')['problem'] !== '');
$sr = night_act_resolve(['action' => 'send_enquiry_reply', 'args' => ['enquiry' => 31]], $nm, '2026-08-20');
nsk('a send_enquiry_reply carries its id, and a guessed nothing is refused',
    $sr['problem'] === '' && $sr['act']['enquiry'] === 31
    && night_act_resolve(['action' => 'send_enquiry_reply', 'args' => []], $nm, '2026-08-20')['problem'] !== '');
// THE CAPABILITY THREE. An expense is a RECORD of money already spent (that
// is why it may join while refunds stay refused by name): the future is not
// recordable, the amount is bounded, the category required.
$ex1 = night_act_resolve(['action' => 'add_expense', 'args' => ['category' => 'Cleaning', 'amount' => 45.5, 'note' => 'changeover deep clean', 'date' => '2026-08-18']], $nm, '2026-08-20');
nsk('an add_expense resolves whole — category, rounded amount, note, dated when spent',
    $ex1['problem'] === '' && $ex1['act']['category'] === 'Cleaning' && $ex1['act']['amount'] === 45.5
    && $ex1['act']['note'] === 'changeover deep clean' && $ex1['act']['date'] === '2026-08-18', json_encode($ex1));
nsk('…and a dateless expense stores none — the executor dates it today',
    night_act_resolve(['action' => 'add_expense', 'args' => ['category' => 'Fees', 'amount' => 12]], $nm, '2026-08-20')['problem'] === ''
    && !isset(night_act_resolve(['action' => 'add_expense', 'args' => ['category' => 'Fees', 'amount' => 12]], $nm, '2026-08-20')['act']['date']));
nsk('…and its refusals: no category, £0, over the ceiling, a FUTURE date (a plan is not a fact)',
    night_act_resolve(['action' => 'add_expense', 'args' => ['amount' => 45]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'add_expense', 'args' => ['category' => 'Fees', 'amount' => 0]], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'add_expense', 'args' => ['category' => 'Fees', 'amount' => 99999]], $nm, '2026-08-20')['problem'] !== ''
    && strpos(night_act_resolve(['action' => 'add_expense', 'args' => ['category' => 'Fees', 'amount' => 12, 'date' => '2026-09-01']], $nm, '2026-08-20')['problem'], 'not happened yet') !== false);
nsk('send_arrival_info and record_payment each carry a looked-up booking ref, and a guess is refused',
    night_act_resolve(['action' => 'send_arrival_info', 'args' => ['booking' => 7]], $nm, '2026-08-20')['act']['booking'] === 7
    && night_act_resolve(['action' => 'record_payment', 'args' => ['booking' => 9]], $nm, '2026-08-20')['act']['booking'] === 9
    && night_act_resolve(['action' => 'send_arrival_info', 'args' => []], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'record_payment', 'args' => ['booking' => 0]], $nm, '2026-08-20')['problem'] !== '');
nsk('the stored-form guard holds on all three — an extra field is refused',
    night_act_problem(['kind' => 'add_expense', 'category' => 'Fees', 'amount' => 12, 'payee' => 'x']) !== ''
    && night_act_problem(['kind' => 'send_arrival_info', 'booking' => 7, 'email' => 'x@y.z']) !== ''
    && night_act_problem(['kind' => 'record_payment', 'booking' => 7, 'amount' => 100]) !== '');

// ── THE COAST TOOL — tides + weather for one day, formatted at the source ──
nsk('coast: today needs no arguments; a named day must be real, future and inside the horizon',
    night_tool_problem('coast', [], '2026-08-20') === ''
    && night_tool_problem('coast', ['day' => '2026-08-22'], '2026-08-20') === ''
    && night_tool_problem('coast', ['day' => '2026-02-31'], '2026-08-20') !== ''
    && night_tool_problem('coast', ['day' => '2026-08-19'], '2026-08-20') !== ''
    && night_tool_problem('coast', ['day' => '2026-09-20'], '2026-08-20') !== '');
$cst = night_tool_coast('2026-08-22',
    ['ok' => true, 'extremes' => [
        ['time' => '2026-08-22T05:41+0000', 'type' => 'High'],   // 06:41 BST
        ['time' => '2026-08-22T11:55+0000', 'type' => 'Low'],
        ['time' => '2026-08-22T18:08+0000', 'type' => 'High'],
        ['time' => '2026-08-23T00:30+0000', 'type' => 'Low'],    // the NEXT day — filtered
    ]],
    ['ok' => true, 'days' => [['date' => '2026-08-22', 'summary' => 'sunny spells', 'tmax' => 18, 'tmin' => 11, 'gust' => 34, 'rain' => 0.2]]],
    ['Wren Marsh', '']);
nsk('coast: high/low water in the QUAY\'s clock (UTC+1 in summer), the next day filtered out',
    ($cst['tide'] ?? '') === 'High water 06:41 and 19:08 · low 12:55', json_encode($cst));
nsk('coast: the weather is one formatted line — gusts named at 30mph+, sub-1mm rain left unsaid',
    ($cst['weather'] ?? '') === 'sunny spells · 18°C (down to 11°C) · gusts to 34mph', json_encode($cst));
nsk('coast: the arrivals cross-reference travels, blanks dropped', $cst['arrivals'] === ['Wren Marsh']);
$cst2 = night_tool_coast('2026-08-22', ['ok' => false, 'reason' => 'no_key'], ['ok' => true, 'days' => []], []);
nsk('coast: no tide key and a passed horizon are honest ABSENCES with a sentence each, never guesses',
    !isset($cst2['tide']) && strpos((string) ($cst2['tide_note'] ?? ''), 'No tide key') !== false
    && !isset($cst2['weather']) && ($cst2['weather_note'] ?? '') !== '');

// ── THE ROLLING SUMMARY — owner-side JSON sanitised on every read ────────
$smx = night_ownerchat_sums(['2' => ' decisions so far ', 'x' => 'junk key', '0' => 'zero key',
    '4' => str_repeat('a', 700), '5' => '', '6' => ['not' => 'text']]);
nsk('sums sanitise: real convo keys only, trimmed, overlong cut to the cap, blanks and objects dropped',
    ($smx[2] ?? '') === 'decisions so far' && !isset($smx[0]) && !isset($smx[5]) && !isset($smx[6])
    && mb_strlen($smx[4] ?? '') === 600, json_encode(array_map(fn ($v) => mb_substr($v, 0, 20), $smx)));
$smBig = [];
for ($i = 1; $i <= 30; $i++) {
    $smBig[$i] = 'summary ' . $i;
}
nsk('sums cap at ' . NIGHT_OWNERCHAT_SUM_CAP . ' — the head is kept',
    count(night_ownerchat_sums($smBig)) === NIGHT_OWNERCHAT_SUM_CAP);
nsk('the envelope validates a summary: text under the cap passes, junk and overlong are refused in sentences',
    night_ownerchat_answer_problem(json_encode(['text' => 'ok', 'sum' => 'the week so far'])) === ''
    && night_ownerchat_answer_problem(json_encode(['text' => 'ok', 'sum' => ['x']])) !== ''
    && night_ownerchat_answer_problem(json_encode(['text' => 'ok', 'sum' => str_repeat('a', 700)])) !== '');

// ── THE GROUNDING PACK + MEMORY ──────────────────────────────────────────
$wldToday = ['date' => '2026-08-20',
    'arrivals' => array_map(fn ($i) => ['guest' => 'Guest ' . $i, 'cottage' => 'Jollyboat', 'still_to_pay' => '£100.00', 'email' => 'x@y.z', 'ref' => $i], range(1, 9)),
    'departures' => [], 'staying' => [['guest' => 'Eve Hart', 'cottage' => 'Pimpernel']], 'enquiries_waiting' => 2];
$wldMoney = ['due_now' => [
    ['guest' => 'Sarah Pemberton', 'cottage' => 'Jollyboat', 'still_to_pay' => '£340.50', 'ref' => 7],
    ['guest' => 'Dan Rowe', 'cottage' => '21A Westgate Street', 'still_to_pay' => '£200.00', 'ref' => 8],
], 'due_later' => [], 'deposits_to_return' => [['guest' => 'Eve Hart']]];
$wld = night_world(
    [['cottage' => 'Jollyboat', 'sleeps' => '2 adults', 'nightly' => '£130.00 a night'], ['cottage' => '']],
    $wldToday, $wldMoney,
);
nsk('the world sheet SLIMS: lists cut to ' . NIGHT_WORLD_LIST_MAX . ', a nameless cottage dropped, the money totalled',
    count($wld['today']['arrivals']) === NIGHT_WORLD_LIST_MAX
    && count($wld['cottages']) === 1
    && $wld['money']['due_now_count'] === 2 && $wld['money']['due_now_total'] === '£540.50'
    && $wld['money']['deposits_to_return'] === 1
    && $wld['today']['enquiries_waiting'] === 2, json_encode($wld['money']));
nsk('…and NO contact detail or ref survives into the pack — names and figures only',
    strpos(json_encode($wld), '@') === false && strpos(json_encode($wld), '"ref"') === false, json_encode($wld));
// THE COUNT AND THE TOTAL ARE OF EVERYONE, not of the rows that fitted.
// night_tool_money trims its row lists to NIGHT_TOOL_ROWS_MAX (a chat answer is
// not an export) and night_world used to COUNT AND SUM whatever it was handed —
// so with more than twelve guests owing, the pack that rides EVERY ask told the
// model "12 owe £X", short by however many were cut, and the model quoted it.
// The tool now carries the true totals; the pack reads those.
$manyOwed = [];
for ($i = 1; $i <= 15; $i++) {
    $manyOwed[] = ['name' => 'Guest ' . $i, 'prop_key' => 'jollyboat', 'due_now' => true, 'still_to_pay' => 100.0,
        'check_in' => '2026-09-0' . (($i % 9) + 1), 'check_out' => '2026-09-10', 'id' => $i];
}
$manyDeps = [];
for ($i = 1; $i <= 14; $i++) {
    $manyDeps[] = ['name' => 'Left ' . $i, 'prop_key' => 'jollyboat', 'check_out' => '2026-08-01', 'dep' => 75.0, 'id' => 500 + $i];
}
$mTool = night_tool_money($manyOwed, $manyDeps, ['jollyboat' => 'Jollyboat']);
nsk('the money TOOL still trims its rows to ' . NIGHT_TOOL_ROWS_MAX . ' (a chat answer, not an export)',
    count($mTool['due_now']) === NIGHT_TOOL_ROWS_MAX && count($mTool['deposits_to_return']) === NIGHT_TOOL_ROWS_MAX);
nsk('…but carries the TRUE count and sum beside them (15 owing, £1500.00)',
    $mTool['due_now_n'] === 15 && abs($mTool['due_now_sum'] - 1500.0) < 0.005 && $mTool['deposits_n'] === 14,
    json_encode(['n' => $mTool['due_now_n'], 'sum' => $mTool['due_now_sum'], 'dep' => $mTool['deposits_n']]));
$wldMany = night_world([['cottage' => 'Jollyboat', 'sleeps' => '2 adults', 'nightly' => '£130.00 a night']], $wldToday, $mTool);
nsk('…and the GROUNDING PACK states all fifteen and the whole £1,500.00, not the twelve that fitted',
    $wldMany['money']['due_now_count'] === 15
    && $wldMany['money']['due_now_total'] === '£1,500.00'
    && $wldMany['money']['deposits_to_return'] === 14,
    json_encode($wldMany['money']));
nsk('…while the ROWS it carries stay slim (' . NIGHT_WORLD_LIST_MAX . ') — the tools are how you go deep',
    count($wldMany['money']['due_now']) === NIGHT_WORLD_LIST_MAX);
// An older caller with no totals falls back to counting its rows — the exact
// pre-fix behaviour, so nothing regresses on a payload built the old way.
$legacyMoney = ['due_now' => [['guest' => 'A', 'still_to_pay' => '£10.00'], ['guest' => 'B', 'still_to_pay' => '£5.00']],
    'due_later' => [], 'deposits_to_return' => [['guest' => 'C']]];
$wldLegacy = night_world([['cottage' => 'Jollyboat', 'sleeps' => '2', 'nightly' => '£130.00 a night']], $wldToday, $legacyMoney);
nsk('a payload with no totals still counts its own rows, exactly as before',
    $wldLegacy['money']['due_now_count'] === 2 && $wldLegacy['money']['due_now_total'] === '£15.00'
    && $wldLegacy['money']['deposits_to_return'] === 1, json_encode($wldLegacy['money']));
// A memory is DATED now ({t, at}); legacy plain strings are ADOPTED with an
// empty date — unknown is honest, an invented date would defeat the
// staleness question — and the MODEL only ever sees the texts.
nsk('memories sanitise: dated shape, legacy strings adopted, trimmed, junk dropped, capped both ways',
    night_ownerchat_memories(['  never dogs  ', '', ['x'], str_repeat('m', 300)])
        === [['t' => 'never dogs', 'at' => ''], ['t' => str_repeat('m', NIGHT_OWNERCHAT_MEM_CHARS), 'at' => '']]
    && night_ownerchat_memories([['t' => 'boiler man is Colin', 'at' => '2026-03-01']])
        === [['t' => 'boiler man is Colin', 'at' => '2026-03-01']]
    && count(night_ownerchat_memories(array_fill(0, 30, 'x'))) === NIGHT_OWNERCHAT_MEM_MAX
    && night_ownerchat_memories('junk') === []);
nsk('…a junk date degrades to unknown, never garbage — and texts() strips to what the model reads',
    night_ownerchat_memories([['t' => 'x', 'at' => 'last tuesday']]) === [['t' => 'x', 'at' => '']]
    && night_ownerchat_memory_texts([['t' => 'never dogs', 'at' => '2026-03-01'], 'legacy line', ['t' => '', 'at' => '2026-01-01']])
        === ['never dogs', 'legacy line']);
// THE REMEMBER ACT — the proposal that becomes a line only on the owner's
// confirm, so the app still never writes one of its own accord.
$rm = night_act_resolve(['action' => 'remember', 'args' => ['text' => '  Never dogs — allergy promise  ']], $nm, '2026-08-20');
nsk('a remember act carries its trimmed text; empty and overlong are refused in sentences',
    $rm['problem'] === '' && $rm['act']['text'] === 'Never dogs — allergy promise'
    && night_act_resolve(['action' => 'remember', 'args' => []], $nm, '2026-08-20')['problem'] !== ''
    && night_act_resolve(['action' => 'remember', 'args' => ['text' => str_repeat('m', 300)]], $nm, '2026-08-20')['problem'] === ''
    && mb_strlen(night_act_resolve(['action' => 'remember', 'args' => ['text' => str_repeat('m', 300)]], $nm, '2026-08-20')['act']['text']) === NIGHT_OWNERCHAT_MEM_CHARS
    && night_act_problem(['kind' => 'remember', 'text' => 'x', 'amount' => 5]) !== '');

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED ❌\n";
    exit(1);
}
echo "  ALL CHECKS PASSED ✅\n";
