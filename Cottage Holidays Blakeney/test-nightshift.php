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

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED ❌\n";
    exit(1);
}
echo "  ALL CHECKS PASSED ✅\n";
