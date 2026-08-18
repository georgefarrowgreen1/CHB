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
function nsk($label, $cond)
{
    global $fails;
    echo ($cond ? '  ✓ ' : '  ✗ ') . $label . "\n";
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
nsk('exactly the 2–4 night hole is a gap', count($gaps) === 1, json_encode($gaps));
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

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED ❌\n";
    exit(1);
}
echo "  ALL CHECKS PASSED ✅\n";
