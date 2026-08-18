<?php
// ============================================================
//  nightshift-lib.php — the overnight queue's PURE judgements, with no DB
//  and no session, so test-nightshift.php can drive every one of them in CI.
//
//  THE MODEL. A machine on the owner's own network (see the proposal: a Mac
//  that is always on) does work while nobody is asking and POSTs what it
//  produced to nightshift.php. The app stores it, shows it once, and lets
//  the owner use it or bin it. That is the whole feature.
//
//  THREE RULES SHAPE EVERY FUNCTION BELOW, and they are the owner's, not
//  defaults:
//
//   1. IT NEVER SENDS. A row is a draft plus a DESTINATION — never an
//      instruction. There is deliberately no field a producer can set that
//      makes the app email anybody, charge anything or change a price: the
//      strongest thing an item can carry is `target`, which opens a screen
//      the owner is already allowed to open. So the worst a compromised or
//      broken producer can do is put words on a screen.
//
//   2. IT NEVER STATES MONEY OF ITS OWN. Nothing here parses a figure out
//      of `body`, and nothing downstream re-derives one from it. Prose is
//      prose; every number the app asserts still comes from the one
//      derivation that owns it.
//
//   3. IT IS NEVER THE ONLY COPY. With the setting off, or the producer
//      silent, or the table absent, the back office is exactly what it was
//      — the card simply does not render. Additive by construction.
//
//  WHY A TTL PER KIND rather than one number: what goes stale is what was
//  about a moment. A drafted reply to a live enquiry is worse than useless
//  after three days, because the enquiry has moved on and the draft has not.
//  A reading of last week, or an answer to a question guests keep asking,
//  is as true a fortnight later as it was the night it was written.
// ============================================================

// What a producer may send. Deliberately closed: an unrecognised kind is
// refused rather than stored as "other", because the kind decides the TTL
// and the wording, and a row nobody can describe is a row nobody acts on.
//   reply  — a drafted reply to a guest, for the owner to read and send
//   answer — a drafted answer to a question guests keep asking
//   note   — something it read and wants to tell the owner (the week, a trend)
//   price  — a case for changing a rate, for the owner to weigh
const NIGHT_KINDS = ['reply', 'answer', 'note', 'price'];

// Days each kind is worth keeping. See the header: staleness is about what
// the item was ABOUT, not about how long the owner has been busy.
const NIGHT_TTL_DAYS = [
    'reply'  => 3,
    'price'  => 7,
    'answer' => 14,
    'note'   => 14,
];

// How many OPEN items the queue may hold. A cap the producer cannot argue
// with: a machine that has gone wrong overnight fills a screen, not a disk,
// and the owner meets a queue they can still read rather than a page of
// four hundred rows. Ingest refuses beyond it and says so.
const NIGHT_OPEN_MAX = 24;

// How many items one POST may carry. A night's work is a handful; a
// thousand is a bug at the other end, and refusing the batch is how the
// other end finds out.
const NIGHT_BATCH_MAX = 12;

// Field limits. `body` is prose the owner reads on a phone — eight thousand
// characters is about three screens, and anything longer is a report that
// wanted to be a file.
const NIGHT_TITLE_MAX  = 200;
const NIGHT_SUB_MAX    = 255;
const NIGHT_BODY_MAX   = 8000;
const NIGHT_SOURCE_MAX = 255;
const NIGHT_REF_MAX    = 64;

// The statuses a row may hold. `expired` is written by the daily sweep
// rather than inferred at read time, so "why is this gone" has an answer.
const NIGHT_STATUSES = ['open', 'used', 'dismissed', 'expired'];

// What the owner may do to a row, and the status each lands on. Binning is
// reversible (`restore`) because the machine wrote it, not the owner: a
// dismissal made in one tap should be undoable in one tap.
const NIGHT_ACTS = [
    'use'     => 'used',
    'dismiss' => 'dismissed',
    'restore' => 'open',
];

// Days a used/dismissed/expired row is kept before the sweep deletes it.
// Long enough that "what did it say?" is answerable for a fortnight,
// short enough that the table never becomes an archive nobody asked for.
const NIGHT_KEEP_DAYS = 14;

// ── THE KEY THIS ROUTE ACCEPTS ───────────────────────────────────────────
//
// APP_SECRET IS THE WRONG KEY FOR A LAPTOP TO HOLD, and it was the only one
// this route took. That secret opens roughly twenty cron endpoints, and the
// list is not a list of small things: autopay-run.php COLLECTS INSTALMENTS
// FROM GUESTS' CARDS, payments-due.php and the three nudge scripts EMAIL
// EVERY GUEST, backup.php produces a full database dump, migrate.php runs
// migrations. Most take it in a query string, so a leaked one is a URL.
//
// The Mac app's whole job is "read the enquiries waiting and post some
// drafts". Giving it the key to charge cards to do that is a trade nobody
// would make on purpose; it happened because the secret was already there.
//
// So the route takes its OWN key. Once one is set, APP_SECRET stops working
// here — otherwise the hole is still open and the new key is decoration.
// Until one is set, APP_SECRET still works, because a security fix that
// silently stops the app running is a fix the owner reverses.
//
// Revoking is generating a new one. There is no list of devices because
// there is one machine; when there are two, this is where that goes.
const NIGHT_KEY_MIN = 24;

// Which key opens the door, decided in one place so `brief` and `ingest`
// cannot drift. Returns 'scoped' | 'master' | '' — the CALLER logs which,
// because "it still used the master secret" is worth being able to see.
function night_key_kind($given, $scoped, $master)
{
    $g = (string) $given;
    if ($g === '') {
        return '';
    }
    $s = (string) $scoped;
    if (strlen($s) >= NIGHT_KEY_MIN) {
        // A scoped key EXISTS, so it is the only one that opens this route.
        return hash_equals($s, $g) ? 'scoped' : '';
    }
    $m = (string) $master;
    if ($m === '') {
        return '';
    }
    return hash_equals($m, $g) ? 'master' : '';
}

// A new key. 32 bytes of randomness, hex — long enough that the throttle is
// belt and braces rather than the defence.
function night_key_make()
{
    return bin2hex(random_bytes(32));
}

// How long an item of this kind is worth keeping. Unknown kinds get the
// shortest window rather than the longest — an item nobody can describe
// should not outlive the ones that can.
function night_ttl_days($kind)
{
    $k = is_string($kind) ? $kind : '';
    return array_key_exists($k, NIGHT_TTL_DAYS) ? NIGHT_TTL_DAYS[$k] : 3;
}

// A `target` may only be something chbOpenTarget (app.js) already knows how
// to open, and this is the PHP statement of that vocabulary. Deliberately a
// shape test rather than a list of live ids: the app's own router answers
// `false` for a screen that does not exist, so an id that has since been
// deleted is a no-op there, while a target of the wrong SHAPE is a button
// that could never have worked and belongs refused at the door.
function night_target_problem($target)
{
    if (!is_string($target) || $target === '') {
        return ''; // no target is fine — plenty of items are just words
    }
    if (strlen($target) > 120) {
        return 'target is too long';
    }
    $ok = '/^(?:' .
        'settings:[a-z0-9-]{1,40}' . '|' .
        'accounts:[a-z0-9-]{1,40}' . '|' .
        'inbox:(?:enquiries|messages|email)(?::sent)?' . '|' .
        'view-[a-z0-9-]{1,40}' . '|' .
        '[a-z]{1,20}(?:-[0-9]{1,10})?' .
        ')$/';
    return preg_match($ok, $target) ? '' : 'target is not a screen this app can open';
}

// Everything wrong with one submitted item, as a sentence, or '' if it is
// fine. ONE function so ingest and the gate cannot disagree about what a
// valid item is — and it returns the reason rather than a boolean because
// the producer is a machine in another process: "refused" with no cause is
// a night's work lost to a typo nobody can see.
function night_item_problem($it)
{
    if (!is_array($it)) {
        return 'item is not an object';
    }
    $ref = isset($it['ref']) ? (string) $it['ref'] : '';
    if ($ref === '') {
        return 'ref is required (it is what makes a retried POST store once)';
    }
    if (strlen($ref) > NIGHT_REF_MAX) {
        return 'ref is longer than ' . NIGHT_REF_MAX . ' characters';
    }
    if (!preg_match('/^[A-Za-z0-9._:-]+$/', $ref)) {
        return 'ref may only hold letters, digits, dot, underscore, colon and hyphen';
    }
    $kind = isset($it['kind']) ? (string) $it['kind'] : '';
    if (!in_array($kind, NIGHT_KINDS, true)) {
        return 'kind must be one of: ' . implode(', ', NIGHT_KINDS);
    }
    $title = isset($it['title']) ? trim((string) $it['title']) : '';
    if ($title === '') {
        return 'title is required';
    }
    if (mb_strlen($title) > NIGHT_TITLE_MAX) {
        return 'title is longer than ' . NIGHT_TITLE_MAX . ' characters';
    }
    $body = isset($it['body']) ? (string) $it['body'] : '';
    if (trim($body) === '') {
        return 'body is required — an item with nothing to read is a row nobody can act on';
    }
    if (mb_strlen($body) > NIGHT_BODY_MAX) {
        return 'body is longer than ' . NIGHT_BODY_MAX . ' characters';
    }
    if (isset($it['sub']) && mb_strlen((string) $it['sub']) > NIGHT_SUB_MAX) {
        return 'sub is longer than ' . NIGHT_SUB_MAX . ' characters';
    }
    if (isset($it['source']) && mb_strlen((string) $it['source']) > NIGHT_SOURCE_MAX) {
        return 'source is longer than ' . NIGHT_SOURCE_MAX . ' characters';
    }
    return night_target_problem(isset($it['target']) ? (string) $it['target'] : '');
}

// The whole POST, before any of it is looked at individually. Separate from
// the per-item check because these two refusals mean different things to
// the producer: "your batch is the wrong size" is a bug in how it calls,
// "item 4 has no title" is a bug in what it wrote.
function night_batch_problem($items)
{
    if (!is_array($items) || !count($items)) {
        return 'no items were sent';
    }
    if (count($items) > NIGHT_BATCH_MAX) {
        return 'too many items in one go (' . count($items) . ', the most is ' . NIGHT_BATCH_MAX . ')';
    }
    return '';
}

// How much room is left in the queue. Returns 0 rather than a negative,
// because "how many may I store" is never less than none.
function night_room_left($openNow)
{
    $n = (int) $openNow;
    return $n >= NIGHT_OPEN_MAX ? 0 : NIGHT_OPEN_MAX - $n;
}

// Has this row's deadline passed? String comparison on 'Y-m-d H:i:s', the
// form the column holds, so no timezone is involved in the answer — the
// stamp was written by the same clock that is reading it.
function night_is_expired($expiresAt, $nowSql)
{
    $e = is_string($expiresAt) ? trim($expiresAt) : '';
    if ($e === '') {
        return false; // a row with no deadline is not one that has passed
    }
    return $e <= (string) $nowSql;
}

// The status an act lands on, or '' if the act is not one of ours.
function night_act_status($act)
{
    $a = is_string($act) ? $act : '';
    return array_key_exists($a, NIGHT_ACTS) ? NIGHT_ACTS[$a] : '';
}

// One item as the client will see it. Here rather than in the endpoint so
// the shape is stated once and the gate can assert it without a database.
// `body` is passed through UNESCAPED and the client escapes at the render
// boundary — the chbDuties rule, and the reason is the same one: escaping
// as you compose means a name with an apostrophe gets escaped twice.
function night_item_public(array $row)
{
    return [
        'id'      => (int) ($row['id'] ?? 0),
        'ref'     => (string) ($row['ref'] ?? ''),
        'kind'    => (string) ($row['kind'] ?? 'note'),
        'title'   => (string) ($row['title'] ?? ''),
        'sub'     => (string) ($row['sub'] ?? ''),
        'body'    => (string) ($row['body'] ?? ''),
        'source'  => (string) ($row['source'] ?? ''),
        'target'  => (string) ($row['target'] ?? ''),
        'created' => (string) ($row['created_at'] ?? ''),
        'expires' => (string) ($row['expires_at'] ?? ''),
    ];
}

// The count + on/off the boot payload carries, so Today can render the card
// with no request of its own and only fetch the rows when there ARE rows.
// Takes the PDO rather than calling db(), so the pure gate can drive every
// other function in this file with no database at all.
function night_summary($pdo, $on)
{
    $out = ['on' => $on ? 1 : 0, 'n' => 0];
    if (!$on || !$pdo) {
        return $out;
    }
    try {
        $st = $pdo->prepare("SELECT COUNT(*) FROM night_items WHERE status = 'open' AND expires_at > NOW()");
        $st->execute();
        $out['n'] = (int) $st->fetchColumn();
    } catch (\Throwable $e) {
        // An un-migrated install has no table. That is not an error the owner
        // needs to see: the feature is additive, so "no items" is the honest
        // answer and the back office is untouched.
        $out['n'] = 0;
    }
    return $out;
}

// ============================================================
//  THE OTHER DIRECTION — the brief a producer reads before it writes.
//
//  The ingest secret lets a machine put something IN and nothing more, which
//  is right, and it means a producer has no way to see the enquiries it is
//  meant to answer. This is that missing read, and its shape is the whole
//  safety argument for the feature:
//
//   * IT HANDS OVER THE FIGURES. `quote` and `deposit` are the site's own
//     derivation (price_breakdown), already formatted. `dates_free` is the
//     site's own clash check. So a producer is never in a position where
//     inventing a number or an availability answer is the only way to write
//     a sentence — it is quoting, not calculating. That is what makes "it
//     never states money" enforceable rather than hoped for.
//   * IT IS BOUNDED. A handful of waiting enquiries, a capped message, a
//     capped set of the cottage's own answers. A compromised secret reads a
//     page, not a history.
//   * IT NAMES NOTHING ELSE. No payments, no ledger, no other guests' stays,
//     no addresses, no phone numbers — nothing a drafted reply needs.
// ============================================================

// How many waiting enquiries one brief may carry.
const NIGHT_BRIEF_MAX = 8;
// Caps on the free text that rides with each one.
const NIGHT_BRIEF_MSG_MAX = 2000;
const NIGHT_BRIEF_FACTS_MAX = 12;
const NIGHT_BRIEF_FACT_Q_MAX = 200;
const NIGHT_BRIEF_FACT_A_MAX = 600;

// A first name for a greeting, from however the guest typed their name.
// Deliberately dumb: the first whitespace-separated word, trimmed of
// punctuation. A one-word name is its own first name.
function night_first_name($name)
{
    $n = trim(preg_replace('/\s+/', ' ', (string) $name));
    if ($n === '') {
        return '';
    }
    $first = explode(' ', $n)[0];
    return trim($first, " \t.,;:'\"");
}

// One enquiry as a producer sees it. PURE — every fact is passed in, so the
// gate can drive the whole shape with no database and no pricing engine.
//
// $price is price_breakdown()'s array (or null when the cottage has no rate
// row); $free is the site's own clash answer; $facts is the cottage's own
// published Q&A.
function night_brief_enquiry(array $row, $propName, $price, $free, array $facts = [])
{
    $out = [
        'id' => (int) ($row['id'] ?? 0),
        'name' => (string) ($row['name'] ?? ''),
        'first' => night_first_name($row['name'] ?? ''),
        'cottage' => (string) ($propName !== '' ? $propName : ($row['prop_key'] ?? '')),
        'prop' => (string) ($row['prop_key'] ?? ''),
        'received' => (string) ($row['created_at'] ?? ''),
        'check_in' => (string) ($row['check_in'] ?? ''),
        'check_out' => (string) ($row['check_out'] ?? ''),
        'adults' => (int) ($row['adults'] ?? 0),
        'children' => (int) ($row['children'] ?? 0),
        'message' => mb_substr(trim((string) ($row['message'] ?? '')), 0, NIGHT_BRIEF_MSG_MAX),
        // The site's own answer, not something to work out. `null` means the
        // site could not tell — which a producer must treat as "say nothing
        // about availability", never as a yes.
        'dates_free' => $free === null ? null : (bool) $free,
        'nights' => null,
        'quote' => '',
        'deposit' => '',
        'facts' => [],
    ];
    if (is_array($price)) {
        $out['nights'] = (int) ($price['nights'] ?? 0);
        // Already formatted, and formatted ONCE here, so a producer has no
        // reason to do arithmetic on it or re-render it.
        $out['quote'] = '£' . number_format((float) ($price['total'] ?? 0), 2);
        $dep = (float) ($price['damagesDeposit'] ?? 0);
        $out['deposit'] = $dep > 0 ? '£' . number_format($dep, 2) : '';
    }
    $n = 0;
    foreach ($facts as $f) {
        if ($n >= NIGHT_BRIEF_FACTS_MAX) {
            break;
        }
        $q = trim((string) (is_array($f) ? ($f['q'] ?? '') : ''));
        $a = trim((string) (is_array($f) ? ($f['a'] ?? '') : ''));
        if ($q === '' || $a === '') {
            continue;
        }
        $out['facts'][] = [
            'q' => mb_substr($q, 0, NIGHT_BRIEF_FACT_Q_MAX),
            'a' => mb_substr($a, 0, NIGHT_BRIEF_FACT_A_MAX),
        ];
        $n++;
    }
    return $out;
}
