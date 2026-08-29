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
const NIGHT_KINDS = ['reply', 'answer', 'note', 'price', 'teach'];
// Ask kinds live in NIGHT_ASK_KINDS below — the queue's kinds and the ask
// channel's kinds are different vocabularies on purpose (a 'digest' is asked
// and answered in a minute; it never becomes a queue row).

// Days each kind is worth keeping. See the header: staleness is about what
// the item was ABOUT, not about how long the owner has been busy.
const NIGHT_TTL_DAYS = [
    'reply'  => 3,
    'price'  => 7,
    'answer' => 14,
    'note'   => 14,
    'teach'  => 14, // a phrasing suggestion is about the search box, not a moment
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
// $configured — is a scoped key ON FILE? Passed separately from its VALUE,
// because those are different questions and conflating them fails OPEN.
//
// enc_key() derives from APP_SECRET, so rotating APP_SECRET makes every
// encrypted value unreadable and decrypt_value() returns ''. Inferring
// "configured" from the value alone therefore read a perfectly present key as
// ABSENT and fell straight back to the master secret — which means rotating
// APP_SECRET after a leak silently re-opened this route to the new one. The
// wrong direction, at the worst possible moment.
//
// A key on file that cannot be read is a BROKEN state, not an absent one: it
// refuses everything and the owner regenerates. Failing closed costs a night's
// drafts; failing open costs the thing this key was introduced to protect.
function night_key_kind($given, $scoped, $master, $configured = null)
{
    $g = (string) $given;
    if ($g === '') {
        return '';
    }
    $s = (string) $scoped;
    $has = $configured === null ? (strlen($s) >= NIGHT_KEY_MIN) : (bool) $configured;
    if ($has) {
        // A scoped key EXISTS, so it is the only one that opens this route —
        // and if it is on file but unreadable, nothing does.
        if (strlen($s) < NIGHT_KEY_MIN) {
            return '';
        }
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

// A JSON-boundary string. `(string)` on an ARRAY is the literal word
// "Array" — the cottage-name bug that shipped "Array is a lovely cottage" —
// and the cast is what HID it, silencing a type error into a plausible
// string. DB columns are scalars so plain casts are safe there; anything
// read out of a JSON content row (published FAQs, the guest-question
// misses, both writable outside this file) goes through this instead, so a
// malformed entry becomes an ABSENT fact rather than the word "Array" in a
// guest-facing draft.
function night_str($v)
{
    return is_string($v) || is_int($v) || is_float($v) ? trim((string) $v) : '';
}

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
        $q = night_str(is_array($f) ? ($f['q'] ?? '') : '');
        $a = night_str(is_array($f) ? ($f['a'] ?? '') : '');
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

// ── THE PAIRED MACS ──────────────────────────────────────────────────────
//
// One key became a LIST, and that is a change in kind rather than degree.
// With a single stored key, two Macs work only by sharing it — which means
// they cannot be told apart, cannot be stopped separately, and nothing can
// say when either of them last did anything. Everything below follows from
// wanting those three.
//
// THE SITE STORES ONLY A HASH. It never needs the key again after the moment
// it hands it over: authentication is "does the hash of what arrived match a
// hash on file", so the plaintext has no reason to exist here. A copy of the
// content table then yields nothing that opens anything.
//
//   [ { h: sha256 hex, label, added: unix, seen: unix|0 }, … ]
//
// A LEGACY SINGLE STRING READS AS ONE DEVICE. Anyone who generated a key
// under the first version has it stored as the key itself; night_devices()
// turns that into a one-entry list on READ, so their Mac keeps working and
// the shape converts the next time anything is written.
const NIGHT_DEV_MAX = 8;          // more Macs than this is a different product
const NIGHT_DEV_LABEL_MAX = 40;
// How long a Mac may say nothing before the owner is told. THREE nights, not
// one: a Mac that was off for a night, or a night with no enquiries waiting,
// is not a fault and must not raise one.
const NIGHT_QUIET_NIGHTS = 3;

function night_key_hash($key)
{
    return hash('sha256', (string) $key);
}

// Whatever is stored → a clean list. Never throws, and anything it cannot
// make sense of becomes an empty list rather than a guess.
function night_devices($stored)
{
    // The legacy shape: the key itself, as a plain string.
    if (is_string($stored)) {
        $s = trim($stored);
        if (strlen($s) < NIGHT_KEY_MIN) {
            return [];
        }
        return [[
            'h' => night_key_hash($s),
            'label' => 'This Mac',
            'added' => 0,
            'seen' => 0,
            'legacy' => true,
        ]];
    }
    if (!is_array($stored)) {
        return [];
    }
    $out = [];
    foreach ($stored as $row) {
        if (!is_array($row)) {
            continue;
        }
        $h = strtolower((string) ($row['h'] ?? ''));
        if (!preg_match('/^[0-9a-f]{64}$/', $h)) {
            continue;   // not a hash we wrote
        }
        $out[] = [
            'h' => $h,
            'label' => night_dev_label($row['label'] ?? ''),
            'added' => max(0, (int) ($row['added'] ?? 0)),
            'seen' => max(0, (int) ($row['seen'] ?? 0)),
            // The build the Mac last reported (integration step 4) — a
            // string or nothing, through the same boundary guard as
            // everything else JSON-shaped.
            'build' => mb_substr(night_str($row['build'] ?? ''), 0, 60),
            'legacy' => false,
        ];
        if (count($out) >= NIGHT_DEV_MAX) {
            break;
        }
    }
    return $out;
}

// A label is the owner's own words and lands on a screen. Kept to plain text
// here so nothing downstream has to remember to.
function night_dev_label($raw)
{
    // WHITESPACE COLLAPSES FIRST, then the control characters go. The other
    // order strips a newline before it can become a space, so "Mac\nmini"
    // reads back as "Macmini" — a label the owner did not type.
    $s = preg_replace('/\s+/u', ' ', (string) $raw);
    $s = trim((string) preg_replace('/[\x00-\x1f\x7f]/u', '', (string) $s));
    if ($s === '') {
        return 'A Mac';
    }
    return mb_substr($s, 0, NIGHT_DEV_LABEL_MAX);
}

// Which device does this key belong to? Returns its index, or -1.
// hash_equals on both sides, so the comparison is not a timing oracle for
// which device exists.
function night_device_index($devices, $given)
{
    $g = (string) $given;
    if (strlen($g) < NIGHT_KEY_MIN) {
        return -1;
    }
    $gh = night_key_hash($g);
    foreach ((array) $devices as $i => $d) {
        if (isset($d['h']) && hash_equals((string) $d['h'], $gh)) {
            return $i;
        }
    }
    return -1;
}

// Has this Mac gone quiet? Returns the number of whole days since it was last
// heard from, or -1 when the question does not apply.
//
// IT ONLY APPLIES TO A MAC THAT HAS WORKED. A device paired an hour ago and a
// device that has never once posted are not faults — the first has not had a
// night yet and the second is mid-setup. Inventing a chore out of either is
// how a warning becomes something the owner learns to ignore.
function night_quiet_days($device, $nowTs)
{
    $seen = (int) (($device['seen'] ?? 0));
    if ($seen <= 0) {
        return -1;              // never heard from: not a fault, just not yet
    }
    $n = (int) $nowTs;
    if ($n <= $seen) {
        return 0;               // a clock that went backwards is not a warning
    }
    return (int) floor(($n - $seen) / 86400);
}

// The one decision about whether to raise the duty, so the badge, the strip
// and the brief cannot disagree about it.
// IS A MAC LISTENING RIGHT NOW? The ask channel polls every 20 seconds and
// the seen-stamp writes at five-minute granularity — so a Mac that is awake
// and running the app is never more than ~6 minutes stale, and one asleep
// drifts immediately. 'listening' is what the Draft-on-your-Mac button reads:
// offering a 90-second wait against a Mac known to be asleep is the dead ask
// this exists to pre-empt.
function night_mac_presence($devices, $nowTs)
{
    $seen = 0;
    foreach ((array) $devices as $d) {
        $s = (int) (is_array($d) ? ($d['seen'] ?? 0) : 0);
        if ($s > $seen) {
            $seen = $s;
        }
    }
    return ['seen' => $seen, 'listening' => $seen > 0 && ($nowTs - $seen) <= 360];
}

function night_quiet_problem($devices, $nowTs)
{
    $list = (array) $devices;
    if (!count($list)) {
        return -1;              // nothing paired: nothing to be quiet
    }
    $best = -1;
    foreach ($list as $d) {
        $q = night_quiet_days($d, $nowTs);
        if ($q < 0) {
            continue;
        }
        // The FRESHEST Mac decides. With two paired, one working, there is no
        // problem — the work is getting done.
        if ($best < 0 || $q < $best) {
            $best = $q;
        }
    }
    if ($best < 0 || $best < NIGHT_QUIET_NIGHTS) {
        return -1;
    }
    return $best;
}

// ── THE CONNECT CODE ─────────────────────────────────────────────────────
//
// So the owner types eight characters rather than pastes sixty-four.
//
// THE SITE MINTS IT, NOT THE APP. The other direction is how a television
// pairs, and it is worse here: for the app to show a code it must write to
// the site BEFORE it holds any credential, which means an anonymous endpoint
// that stores a row carrying text the requester chose and then renders it in
// the back office. This way the public endpoint stores nothing, shows nothing
// a stranger wrote, and grants nothing without a live code.
//
// The alphabet drops I, O, 0 and 1 — a code is read off a screen and typed on
// another machine, and those are the four that get read wrong.
const NIGHT_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const NIGHT_CODE_LEN = 8;
const NIGHT_CODE_TTL = 600;      // ten minutes: long enough to walk to the Mac

function night_code_make()
{
    $a = NIGHT_CODE_ALPHABET;
    $n = strlen($a);
    $out = '';
    for ($i = 0; $i < NIGHT_CODE_LEN; $i++) {
        $out .= $a[random_int(0, $n - 1)];
    }
    return $out;
}

// Typed by a person, so read it forgivingly: case, spaces and the dash the
// screen shows are all noise. What is NOT forgiven is a character outside the
// alphabet — that is a typo, and silently dropping it would make two different
// typings mean the same code.
function night_code_normalise($raw)
{
    $s = strtoupper(trim((string) $raw));
    $s = str_replace([' ', '-', "\t"], '', $s);
    if (!preg_match('/^[' . NIGHT_CODE_ALPHABET . ']{' . NIGHT_CODE_LEN . '}$/', $s)) {
        return '';
    }
    return $s;
}

// XXXX-XXXX, for reading aloud and typing.
function night_code_pretty($code)
{
    $s = (string) $code;
    if (strlen($s) !== NIGHT_CODE_LEN) {
        return $s;
    }
    return substr($s, 0, 4) . '-' . substr($s, 4);
}

// Is this code good, right now? Returns '' or a SENTENCE, because every one of
// these reaches the owner on the Mac's screen and "invalid" explains nothing.
//
// A USED CODE AND AN EXPIRED ONE ARE DIFFERENT FACTS. "Someone has already
// used this" is worth knowing — it means either you did, or somebody else did.
function night_code_problem($rec, $given, $nowTs)
{
    $code = night_code_normalise($given);
    if ($code === '') {
        return 'That is not a connect code — it is eight letters and numbers, as shown on the website.';
    }
    if (!is_array($rec) || empty($rec['h'])) {
        return 'There is no connect code waiting. Tap Connect a Mac on the website and try again.';
    }
    if (!empty($rec['used'])) {
        return 'That code has already been used. Tap Connect a Mac on the website for a new one.';
    }
    $exp = (int) ($rec['exp'] ?? 0);
    if ($exp <= 0 || (int) $nowTs > $exp) {
        return 'That code has expired. Tap Connect a Mac on the website for a new one.';
    }
    if (!hash_equals((string) $rec['h'], night_key_hash($code))) {
        return 'That code does not match the one on the website.';
    }
    return '';
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE OTHER JOBS' BRIEFS — the week, the gaps, the questions.
//
//  Same contract as night_brief_enquiry: PURE composers over rows the endpoint
//  fetches, every figure FORMATTED HERE so a producer has no arithmetic to do
//  and its guard can whitelist exactly what was handed over, and the same
//  withholding rule — no email, no phone, no address, no postcode, because a
//  note to the owner needs none of them.
// ═══════════════════════════════════════════════════════════════════════════

// The week note's window, and honest caps like the enquiry brief's.
const NIGHT_WEEK_DAYS = 7;
const NIGHT_WEEK_ROWS_MAX = 12;   // arrivals + departures each
const NIGHT_GAPS_MAX = 3;         // the price job weighs a couple, not a page
const NIGHT_GAP_WINDOW_DAYS = 45; // how far ahead a gap is worth selling
const NIGHT_QUESTIONS_MAX = 2;    // one good answer beats five thin ones

// "£123.45" — money leaves this file formatted, once, exactly as the enquiry
// brief's quote does. A producer that has to format money is one that can
// misformat it.
function night_money($n)
{
    return '£' . number_format((float) $n, 2);
}

// THE WEEK, from booking rows. $rows: [{prop_key,name,check_in,check_out,
// adults,children,due}] where `due` is the SITE's own outstanding figure
// (already derived; 0 means settled). $names maps prop_key → display name.
// End-exclusive throughout, like every calendar in this app.
function night_week_brief(array $rows, array $names, $fromIso, $days = NIGHT_WEEK_DAYS)
{
    $from = (string) $fromIso;
    $to = date('Y-m-d', strtotime($from . ' +' . (int) $days . ' days'));
    $arrivals = [];
    $departures = [];
    foreach ($rows as $r) {
        if (!is_array($r)) {
            continue;
        }
        $pk = (string) ($r['prop_key'] ?? '');
        $cottage = (string) ($names[$pk] ?? $pk);
        $in = (string) ($r['check_in'] ?? '');
        $out = (string) ($r['check_out'] ?? '');
        if ($in >= $from && $in < $to && count($arrivals) < NIGHT_WEEK_ROWS_MAX) {
            $due = (float) ($r['due'] ?? 0);
            $arrivals[] = [
                'first' => night_first_name($r['name'] ?? ''),
                'cottage' => $cottage,
                'date' => $in,
                'nights' => night_nights($in, $out),
                'adults' => (int) ($r['adults'] ?? 0),
                'children' => (int) ($r['children'] ?? 0),
                // Formatted or ABSENT — "£0.00 outstanding" is noise, and a
                // figure the site did not state must not exist here at all.
                'due' => $due > 0 ? night_money($due) : '',
            ];
        }
        // The window is [from, to) for BOTH lists — the first draft used
        // <= here, so a stay ARRIVING this week whose checkout lands exactly
        // on the window's edge was also reported as departing this week. Its
        // own gate caught it: Rachel arrived Friday and "departed" next Monday
        // in the same note.
        if ($out > $from && $out < $to && count($departures) < NIGHT_WEEK_ROWS_MAX) {
            $departures[] = [
                'first' => night_first_name($r['name'] ?? ''),
                'cottage' => $cottage,
                'date' => $out,
            ];
        }
    }
    return ['from' => $from, 'to' => $to, 'arrivals' => $arrivals, 'departures' => $departures];
}

// Nights between two ISO dates, end-exclusive; 0 for anything unparseable.
function night_nights($in, $out)
{
    $a = strtotime((string) $in);
    $b = strtotime((string) $out);
    if ($a === false || $b === false || $b <= $a) {
        return 0;
    }
    return (int) round(($b - $a) / 86400);
}

// THE GAPS a price note may weigh: 2–4 free nights between OCCUPIED spans
// (bookings and blocks together — an owner block occupies, so a hole the
// owner is deliberately holding never reads as a gap to sell), starting
// inside the window. Mirrors the back office's own chbGapScan bounds so the
// two surfaces cannot disagree about what a gap is.
//
// $occupied: [{prop_key, check_in, check_out}] — bookings AND blocks.
// $rateFor:  fn(prop_key) → rate row or null.
// $breakdown: fn(rate, in, out) → price_breakdown result (injected so this
//             stays pure and the gate can drive it with fixed maths).
function night_gap_brief(array $occupied, array $names, $rateFor, $breakdown, $todayIso, $windowDays = NIGHT_GAP_WINDOW_DAYS)
{
    $today = (string) $todayIso;
    $limit = date('Y-m-d', strtotime($today . ' +' . (int) $windowDays . ' days'));
    $byProp = [];
    foreach ($occupied as $r) {
        if (!is_array($r)) {
            continue;
        }
        $pk = (string) ($r['prop_key'] ?? '');
        $in = (string) ($r['check_in'] ?? '');
        $out = (string) ($r['check_out'] ?? '');
        if ($pk === '' || $in === '' || $out === '' || $out <= $today) {
            continue;
        }
        $byProp[$pk][] = ['in' => $in, 'out' => $out];
    }
    $gaps = [];
    foreach ($byProp as $pk => $spans) {
        usort($spans, function ($a, $b) { return strcmp($a['in'], $b['in']); });
        for ($i = 0; $i < count($spans) - 1; $i++) {
            $gapFrom = $spans[$i]['out'];
            $gapTo = $spans[$i + 1]['in'];
            $nights = night_nights($gapFrom, $gapTo);
            // 1 night is changeover slack; 5+ is space, not a gap — the same
            // judgement chbGapScan already ships.
            if ($nights < 2 || $nights > 4) {
                continue;
            }
            if ($gapFrom < $today || $gapFrom > $limit) {
                continue;
            }
            $rate = $rateFor($pk);
            if (!$rate) {
                continue; // no rate row → no honest figure → no gap here
            }
            $bd = $breakdown($rate, $gapFrom, $gapTo);
            $perNight = ($bd && !empty($bd['nights'])) ? (float) $bd['nightly'] / (int) $bd['nights'] : 0;
            if ($perNight <= 0) {
                continue;
            }
            // The offer depth is the back office's own rule: 20% when the gap
            // is imminent (≤7 days — last-minute price is the only lever
            // left), else 15%, floored at £20/night.
            $imminent = night_nights($today, $gapFrom) <= 7;
            $offer = max(20.0, round($perNight * ($imminent ? 0.80 : 0.85), 2));
            $gaps[] = [
                'cottage' => (string) ($names[$pk] ?? $pk),
                'from' => $gapFrom,
                'to' => $gapTo,
                'nights' => $nights,
                'rate' => night_money($perNight),
                'offer' => night_money($offer),
            ];
            if (count($gaps) >= NIGHT_GAPS_MAX) {
                return $gaps;
            }
        }
    }
    return $gaps;
}

// THE QUESTIONS guests kept asking that the site could not answer, most-asked
// first, each with that cottage's own published answers to ground a draft in.
// $misses is the guest-faq-misses list ({q,n,prop}); $faqsFor(prop) → [{q,a}].
function night_questions_brief($misses, array $names, $faqsFor, $max = NIGHT_QUESTIONS_MAX)
{
    if (!is_array($misses)) {
        return [];
    }
    $rows = array_values(array_filter($misses, function ($m) {
        return is_array($m) && night_str($m['q'] ?? '') !== '';
    }));
    usort($rows, function ($a, $b) {
        return (int) ($b['n'] ?? 0) <=> (int) ($a['n'] ?? 0);
    });
    $out = [];
    foreach ($rows as $m) {
        if (count($out) >= (int) $max) {
            break;
        }
        $pk = night_str($m['prop'] ?? '');
        $facts = [];
        foreach ((array) $faqsFor($pk) as $f) {
            if (count($facts) >= NIGHT_BRIEF_FACTS_MAX) {
                break;
            }
            $q = night_str(is_array($f) ? ($f['q'] ?? '') : '');
            $a = night_str(is_array($f) ? ($f['a'] ?? '') : '');
            if ($q !== '' && $a !== '') {
                $facts[] = ['q' => mb_substr($q, 0, NIGHT_BRIEF_FACT_Q_MAX), 'a' => mb_substr($a, 0, 500)];
            }
        }
        $out[] = [
            'q' => mb_substr(night_str($m['q']), 0, NIGHT_BRIEF_FACT_Q_MAX),
            'asked' => max(1, (int) ($m['n'] ?? 1)),
            'prop' => $pk,
            'cottage' => (string) ($names[$pk] ?? ($pk !== '' ? $pk : 'the cottages')),
            'facts' => $facts,
        ];
    }
    return $out;
}

// HOW GEORGE WRITES — up to two paragraphs from the owner's own reply
// library (the email-templates content key), handed to the producer as
// REGISTER examples: match the warmth, never copy the sentences. Ranked by
// `uses`, because the templates the owner actually sends are the voice the
// guests actually hear. The {{tokens}} are replaced with neutral words —
// a literal {{balance}} in an example reads as noise, and a figure-shaped
// word would tempt the model toward the one thing it may never do.
const NIGHT_VOICE_MAX = 2;
const NIGHT_VOICE_CHARS = 400;
function night_voice_examples($templates)
{
    if (!is_array($templates)) {
        return [];
    }
    $rows = array_values(array_filter($templates, function ($t) {
        return is_array($t) && night_str($t['body'] ?? '') !== '';
    }));
    usort($rows, function ($a, $b) {
        return (int) ($b['uses'] ?? 0) <=> (int) ($a['uses'] ?? 0);
    });
    $out = [];
    foreach ($rows as $t) {
        if (count($out) >= NIGHT_VOICE_MAX) {
            break;
        }
        $body = night_str($t['body']);
        $body = (string) preg_replace_callback('/\{\{([a-z]+)\}\}/i', function ($m) {
            $map = ['cottage' => 'the cottage', 'dates' => 'those dates',
                'balance' => 'the amount', 'total' => 'the amount', 'first' => 'there'];
            return $map[strtolower($m[1])] ?? '';
        }, $body);
        $body = trim((string) preg_replace('/\s+/', ' ', $body));
        if ($body === '') {
            continue;
        }
        $out[] = mb_substr($body, 0, NIGHT_VOICE_CHARS);
    }
    return $out;
}

// ── THE ASK CHANNEL'S JUDGEMENTS ─────────────────────────────────────────
//
// An ask is the owner, at a screen, wanting AI words NOW — so everything here
// is tuned to a moment, not a night. The TTL is minutes: past it the owner
// has moved on, and a machine must never spend a model run answering a
// question nobody is still asking (the endpoint sweeps on every touch, so an
// expired ask is REFUSED an answer rather than quietly accepting one late).
// The open cap is small for the same reason the queue's is: a runaway
// clicker, or a stuck Mac, must not turn the table into a pile.
const NIGHT_ASK_KINDS = ['reply', 'answer', 'chat', 'intent', 'digest', 'ownerchat'];
// The INTENT ask's list: the site's canonical questions. Small and bounded —
// this is a menu the model picks from, not a corpus.
const NIGHT_ASK_OPTS_MAX = 40;
const NIGHT_ASK_OPT_CHARS = 120;

// Whatever arrived as the options list → a clean list of strings, or [].
// The same boundary posture as everything JSON-shaped: garbage is absent.
function night_ask_options($raw)
{
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $o) {
        $s = night_str($o);
        if ($s === '' || mb_strlen($s) > NIGHT_ASK_OPT_CHARS) {
            continue;
        }
        $out[] = $s;
        if (count($out) >= NIGHT_ASK_OPTS_MAX) {
            break;
        }
    }
    return $out;
}
const NIGHT_ASK_TTL_MIN = 10;
const NIGHT_ASK_OPEN_MAX = 6;
const NIGHT_ASK_Q_MAX = 300;

// ── THE TEACH BRIEF — the week's dead-end searches beside the site's own ──
// menu of canonical questions, for the overnight teach job. Pure: the caller
// hands the four stored lists raw (they are owner-device JSON synced through
// the content table), and garbage at any level is ABSENT, never the word
// Array. A phrasing the owner already TAUGHT or made LITERAL is withheld —
// a suggestion about a solved problem teaches the owner to ignore the queue.
const NIGHT_TEACH_MAX = 10;
const NIGHT_TEACH_WINDOW_DAYS = 7;
function night_teach_brief($missesRaw, $canonRaw, $learnedRaw, $suppressedRaw, $todayIso)
{
    $opts = night_ask_options($canonRaw);
    if (!$opts) {
        return null; // no menu → a mapping could only be invented
    }
    $skip = [];
    if (is_array($learnedRaw)) {
        foreach ($learnedRaw as $l) {
            $t = is_array($l) ? night_str($l['t'] ?? '') : '';
            if ($t !== '') {
                $skip[mb_strtolower($t)] = true;
            }
        }
    }
    if (is_array($suppressedRaw)) {
        foreach ($suppressedRaw as $s) {
            $t = night_str($s);
            if ($t !== '') {
                $skip[mb_strtolower($t)] = true;
            }
        }
    }
    // The window is CALENDAR days on the miss's own date stamp (the client
    // writes todayDashed()), compared as strings — no timezone to mis-read.
    $floor = date('Y-m-d', strtotime(night_str($todayIso) . ' -' . NIGHT_TEACH_WINDOW_DAYS . ' days'));
    $out = [];
    if (is_array($missesRaw)) {
        foreach ($missesRaw as $m) {
            if (!is_array($m)) {
                continue;
            }
            $q = night_str($m['t'] ?? '');
            $at = night_str($m['at'] ?? '');
            if ($q === '' || mb_strlen($q) > 120 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $at) || $at < $floor) {
                continue;
            }
            if (isset($skip[mb_strtolower($q)])) {
                continue;
            }
            $out[] = ['q' => $q, 'n' => max(1, (int) ($m['n'] ?? 1))];
        }
    }
    if (!$out) {
        return null;
    }
    usort($out, fn ($a, $b) => $b['n'] <=> $a['n']);
    return ['misses' => array_slice($out, 0, NIGHT_TEACH_MAX), 'options' => $opts];
}

// May this ask be filed at all? '' = yes, else the sentence for the owner.
// ── THE DIGEST ASK'S ROWS — the history records the summary must be built ──
// FROM, and the whole grounding story: the model may only arrange what is in
// these rows, and the door re-checks the money on the way back. Bigger caps
// than the intent menu (a history record is a paragraph, not a label).
const NIGHT_ASK_ROWS_MAX = 8;
const NIGHT_ASK_ROW_CHARS = 300;
function night_ask_rows($raw)
{
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $r) {
        $s = night_str($r);
        if ($s === '') {
            continue;
        }
        $out[] = mb_substr($s, 0, NIGHT_ASK_ROW_CHARS);
        if (count($out) >= NIGHT_ASK_ROWS_MAX) {
            break;
        }
    }
    return $out;
}

// A DIGEST ANSWER IS CHECKED AGAINST ITS OWN ROWS at the door: every £figure
// it states must appear in the rows it was built from — the Mac's guard
// enforces this too, and the door re-checks because the door must never rely
// on the caller. Figures are compared with separators stripped, so £1,200 in
// the summary matches £1200 in a row.
function night_digest_answer_problem($text, $rows)
{
    $t = (string) (is_string($text) ? $text : '');
    if (!preg_match_all('/£\s*([\d,]+(?:\.\d+)?)/u', $t, $m)) {
        return '';
    }
    $hay = '';
    foreach ((is_array($rows) ? $rows : []) as $r) {
        $hay .= ' ' . night_str($r);
    }
    // ONE canonical form for both sides: £120 grounds £120.00 and the
    // reverse — trailing zeros are stripped ONLY after a decimal point.
    // An unconditional rtrim($n, '0') did it to INTEGERS too, so £450
    // grounded against rows containing only £45 (and £4500 likewise): the
    // door accepted figures 10x–100x what the records state, failing open
    // against exactly the buggy or hostile device it exists to catch. The
    // Mac's own checkDigest trims decimals only; the two now agree.
    $canon = function ($s) {
        return strpos($s, '.') !== false ? rtrim(rtrim($s, '0'), '.') : $s;
    };
    $hayNums = [];
    if (preg_match_all('/£\s*([\d,]+(?:\.\d+)?)/u', $hay, $hm)) {
        foreach ($hm[1] as $n) {
            $hayNums[$canon(str_replace(',', '', $n))] = true;
        }
    }
    foreach ($m[1] as $n) {
        if (!isset($hayNums[$canon(str_replace(',', '', $n))])) {
            return 'The summary states £' . $n . ', which appears in none of the records it was built from.';
        }
    }
    return '';
}

function night_ask_problem($kind, $entityId, $question)
{
    if (!in_array($kind, NIGHT_ASK_KINDS, true)) {
        return "That is not something the Mac can be asked for (kinds: '"
            . implode("', '", NIGHT_ASK_KINDS) . "').";
    }
    if ($kind === 'reply' && (int) $entityId <= 0) {
        return 'A reply ask needs the enquiry it is about.';
    }
    if ($kind === 'chat' && (int) $entityId <= 0) {
        return 'A chat ask needs the conversation it is about.';
    }
    if ($kind === 'intent' && night_str($question) === '') {
        return 'An intent ask needs the query to place.';
    }
    if ($kind === 'digest' && night_str($question) === '') {
        return 'A digest ask needs the question the summary answers.';
    }
    if ($kind === 'ownerchat' && night_str($question) === '') {
        return 'A chat message needs some words.';
    }
    if ($kind === 'answer') {
        $q = night_str($question);
        if ($q === '') {
            return 'An answer ask needs the question to answer.';
        }
        if (mb_strlen($q) > NIGHT_ASK_Q_MAX) {
            return 'That question is longer than ' . NIGHT_ASK_Q_MAX . ' characters.';
        }
    }
    return '';
}

// A CHAT CONVERSATION as the producer sees it: who said what, newest last,
// capped — and NOTHING else. No email, no phone, no token: a drafted chat
// reply needs the words and the first name, and the withholding rule is the
// same one the enquiry brief holds.
const NIGHT_CHAT_MSGS_MAX = 6;
const NIGHT_CHAT_MSG_CHARS = 300;
function night_chat_view($thread, $messages)
{
    $t = is_array($thread) ? $thread : [];
    $out = ['first' => night_first_name($t['name'] ?? ''), 'msgs' => []];
    $rows = array_values(array_filter(is_array($messages) ? $messages : [], 'is_array'));
    foreach (array_slice($rows, -NIGHT_CHAT_MSGS_MAX) as $m) {
        $text = night_str($m['body'] ?? '');
        if ($text === '') {
            continue;
        }
        $out['msgs'][] = [
            'who' => ($m['sender_role'] ?? '') === 'admin' ? 'you' : 'guest',
            'text' => mb_substr($text, 0, NIGHT_CHAT_MSG_CHARS),
        ];
    }
    return $out;
}

// May this text land as the answer? Same body cap as the queue — an answer is
// read on the same screens.
function night_ask_answer_problem($text)
{
    $t = trim((string) (is_string($text) ? $text : ''));
    if ($t === '') {
        return 'The answer is empty.';
    }
    if (mb_strlen($t) > NIGHT_BODY_MAX) {
        return 'The answer is longer than ' . NIGHT_BODY_MAX . ' characters.';
    }
    return '';
}

// ============================================================
//  THE CHAT'S TOOLS — the owner's own model looking things up.
//
//  The Mac's Chat screen may ask the site four READ-ONLY questions. Same door
//  as everything else here (the device key, the night-shift switch), same
//  posture as the brief: every figure formatted HERE by the site's own
//  derivations — the model quotes money, it never calculates it — and
//  contact details are withheld, because the tools widen what a stolen
//  device key can read and a chat answer needs none of them. Names DO
//  travel (unlike the brief's first-name rule): the reader is the owner,
//  and "which Sarah" is exactly the question a chat has to answer.
//
//  Pure: validation and shaping only. The endpoint owns the SQL.
// ============================================================

const NIGHT_TOOLS = ['today', 'bookings', 'availability', 'enquiries', 'cottages', 'money', 'performance', 'expenses', 'coast'];
const NIGHT_TOOL_ROWS_MAX = 12;    // a chat answer, not an export
const NIGHT_TOOL_RANGE_MAX = 62;   // nights a range may span — two months is a chat, more is a report
const NIGHT_TOOL_ARG_MAX = 60;     // any string argument's cap

// '' unless a real YYYY-MM-DD that round-trips (rejects 2026-02-31).
function night_tool_iso($v)
{
    $s = trim((string) (is_string($v) ? $v : ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        return '';
    }
    $t = strtotime($s . ' 12:00:00');
    return ($t !== false && date('Y-m-d', $t) === $s) ? $s : '';
}

// May this call run? '' or a sentence. The Mac validates too; the door
// re-checks because the door must never rely on the caller.
function night_tool_problem($tool, $args, $todayIso)
{
    if (!in_array($tool, NIGHT_TOOLS, true)) {
        // DERIVED from the whitelist, never restated by hand: the hand-written
        // list stopped at the original five, so the correction actively taught
        // a fumbling model that money/performance/expenses/coast do not exist.
        return 'No such tool — the tools are ' . implode(', ', NIGHT_TOOLS) . '.';
    }
    $a = is_array($args) ? $args : [];
    if ($tool === 'availability') {
        if (trim((string) ($a['cottage'] ?? '')) === '') {
            return 'Availability needs a cottage name.';
        }
        $from = night_tool_iso($a['from'] ?? '');
        $to = night_tool_iso($a['to'] ?? '');
        if ($from === '' || $to === '') {
            return 'Availability needs from and to as YYYY-MM-DD dates.';
        }
        if ($to <= $from) {
            return 'The to date must be after the from date.';
        }
        if ($from < (string) $todayIso) {
            return 'Availability is about the future — that range starts in the past.';
        }
        if (night_nights($from, $to) > NIGHT_TOOL_RANGE_MAX) {
            return 'That range is too long — ' . NIGHT_TOOL_RANGE_MAX . ' nights is the most one check can span.';
        }
        return '';
    }
    if ($tool === 'bookings') {
        $from = (string) ($a['from'] ?? '');
        $to = (string) ($a['to'] ?? '');
        if ($from !== '' && night_tool_iso($from) === '') {
            return 'The from date must be YYYY-MM-DD.';
        }
        if ($to !== '' && night_tool_iso($to) === '') {
            return 'The to date must be YYYY-MM-DD.';
        }
        if ($from !== '' && $to !== '' && $to <= $from) {
            return 'The to date must be after the from date.';
        }
        if (is_string($a['name'] ?? '') === false) {
            return 'The name filter must be text.';
        }
        return '';
    }
    if ($tool === 'coast') {
        // Tides and weather for ONE day. Optional `day`; the forecast's own
        // horizon is the bound — the past has no tide anyone can still catch.
        $day = (string) ($a['day'] ?? '');
        if ($day !== '') {
            if (night_tool_iso($day) === '') {
                return 'The day must be YYYY-MM-DD (or leave it out for today).';
            }
            if ($day < (string) $todayIso) {
                return 'The coast tool is about the days ahead — that day has gone.';
            }
            if (night_nights((string) $todayIso, $day) > 13) {
                return 'The forecast only reaches about two weeks out.';
            }
        }
        return '';
    }
    return ''; // today / enquiries take no arguments; extras are ignored
}

// ── COAST: tides + weather for one day, every figure formatted here ─────
// $tides is tide_extremes()'s result, $wx is weather_daily()'s, $arrivals
// the guests arriving that day — the cross-reference only this app can
// make. Each half is honestly ABSENT when its source cannot answer (no
// tide key, forecast horizon passed) rather than guessed at.
function night_tool_coast($dayIso, $tides, $wx, array $arrivals)
{
    $out = ['day' => (string) $dayIso, 'arrivals' => []];
    foreach ($arrivals as $nm) {
        if (night_str($nm) !== '') {
            $out['arrivals'][] = night_str($nm);
        }
    }
    $highs = [];
    $lows = [];
    if (is_array($tides) && !empty($tides['ok'])) {
        foreach ((array) ($tides['extremes'] ?? []) as $e) {
            $t = strtotime((string) ($e['time'] ?? ''));
            if ($t === false) {
                continue;
            }
            // The quay's own clock — WorldTides answers in UTC, and a summer
            // high water quoted an hour early is a walk cut short by the sea.
            $loc = (new DateTime('@' . $t))->setTimezone(new DateTimeZone('Europe/London'));
            if ($loc->format('Y-m-d') !== (string) $dayIso) {
                continue;
            }
            $hm = $loc->format('H:i');
            if (strcasecmp((string) ($e['type'] ?? ''), 'High') === 0) {
                $highs[] = $hm;
            } else {
                $lows[] = $hm;
            }
        }
    }
    if ($highs || $lows) {
        $out['tide'] = trim(($highs ? 'High water ' . implode(' and ', $highs) : '')
            . ($highs && $lows ? ' · ' : '') . ($lows ? 'low ' . implode(' and ', $lows) : ''));
    } else {
        $out['tide_note'] = is_array($tides) && ($tides['reason'] ?? '') === 'no_key'
            ? 'No tide key is set (Manage → System check), so tide times are not available.'
            : 'Tide times are not available for that day.';
    }
    $day = null;
    if (is_array($wx) && !empty($wx['ok'])) {
        foreach ((array) ($wx['days'] ?? []) as $d) {
            if ((string) ($d['date'] ?? '') === (string) $dayIso) {
                $day = $d;
                break;
            }
        }
    }
    if (is_array($day)) {
        $bits = [];
        if (night_str($day['summary'] ?? '') !== '') {
            $bits[] = night_str($day['summary']);
        }
        if (isset($day['tmax']) && is_numeric($day['tmax'])) {
            $bits[] = $day['tmax'] . '°C' . (isset($day['tmin']) && is_numeric($day['tmin']) ? ' (down to ' . $day['tmin'] . '°C)' : '');
        }
        if (isset($day['gust']) && is_numeric($day['gust']) && $day['gust'] >= 30) {
            $bits[] = 'gusts to ' . $day['gust'] . 'mph';
        }
        if (isset($day['rain']) && is_numeric($day['rain']) && $day['rain'] >= 1) {
            $bits[] = $day['rain'] . 'mm of rain expected';
        }
        if ($bits) {
            $out['weather'] = implode(' · ', $bits);
        }
    }
    if (!isset($out['weather'])) {
        $out['weather_note'] = 'The forecast does not reach that day.';
    }
    return $out;
}

// One stay, shaped for a chat answer. `due` arrives as the SITE's own
// outstanding figure (a float, already derived) and leaves formatted or
// ABSENT — "£0.00 outstanding" is noise, the week brief's rule.
function night_tool_stay(array $r, array $names)
{
    $pk = (string) ($r['prop_key'] ?? '');
    $in = (string) ($r['check_in'] ?? '');
    $out = (string) ($r['check_out'] ?? '');
    $due = (float) ($r['due'] ?? 0);
    return [
        // The booking id, as an opaque REF: a proposed action points at it
        // EXACTLY instead of resolving a guest name fuzzily. An id is not
        // contact detail — the withholding rule is about emails and phones.
        'ref' => (int) ($r['id'] ?? 0),
        'guest' => night_str($r['name'] ?? ''),
        'cottage' => night_str($names[$pk] ?? $pk),
        'check_in' => $in,
        'check_out' => $out,
        'nights' => night_nights($in, $out),
        'adults' => (int) ($r['adults'] ?? 0),
        'children' => (int) ($r['children'] ?? 0),
        'still_to_pay' => $due > 0 ? night_money($due) : '',
    ];
}

// TODAY: who arrives, who leaves, who is in residence, what waits. Rows are
// stays overlapping today; the split is end-exclusive like every calendar
// here (a checkout today is a departure, never "staying").
function night_tool_today(array $rows, array $names, $todayIso, $enquiriesWaiting)
{
    $today = (string) $todayIso;
    $arrivals = [];
    $departures = [];
    $staying = [];
    foreach ($rows as $r) {
        if (!is_array($r)) {
            continue;
        }
        $in = (string) ($r['check_in'] ?? '');
        $out = (string) ($r['check_out'] ?? '');
        $stay = night_tool_stay($r, $names);
        if ($in === $today && count($arrivals) < NIGHT_TOOL_ROWS_MAX) {
            $arrivals[] = $stay;
        } elseif ($out === $today && count($departures) < NIGHT_TOOL_ROWS_MAX) {
            $departures[] = $stay;
        } elseif ($in < $today && $out > $today && count($staying) < NIGHT_TOOL_ROWS_MAX) {
            $staying[] = $stay;
        }
    }
    return [
        'date' => $today,
        'arrivals' => $arrivals,
        'departures' => $departures,
        'staying' => $staying,
        'enquiries_waiting' => (int) $enquiriesWaiting,
    ];
}

// BOOKINGS in a range, capped WITH the cut said — a list that stops at 12
// silently reads as "that is all of them", the no-silent-caps rule.
function night_tool_bookings(array $rows, array $names, $fromIso, $toIso)
{
    $out = [];
    $more = 0;
    foreach ($rows as $r) {
        if (!is_array($r)) {
            continue;
        }
        if (count($out) < NIGHT_TOOL_ROWS_MAX) {
            $out[] = night_tool_stay($r, $names);
        } else {
            $more++;
        }
    }
    return ['from' => (string) $fromIso, 'to' => (string) $toIso, 'bookings' => $out, 'more' => $more];
}

// AVAILABILITY: the calendar's answer plus, when free, the site's own quote.
// $takenBy: guest names / "an external booking" strings the endpoint found —
// non-empty means taken. $price: a price_breakdown result or null; null on a
// free range means SAY NOTHING about money, never guess (the brief's
// dates_free rule, applied to a quote).
function night_tool_availability($cottage, $fromIso, $toIso, array $takenBy, $price)
{
    $free = count($takenBy) === 0;
    $out = [
        'cottage' => night_str($cottage),
        'from' => (string) $fromIso,
        'to' => (string) $toIso,
        'nights' => night_nights($fromIso, $toIso),
        'free' => $free,
    ];
    if (!$free) {
        $out['taken_by'] = array_slice(array_map('night_str', $takenBy), 0, 4);
    } elseif (is_array($price) && isset($price['total'])) {
        $out['price'] = night_money((float) $price['total']);
        $out['price_note'] = 'rental total for 2 adults — the deposit and any party changes move it';
    }
    return $out;
}

// THE COTTAGES THEMSELVES — the tool the first four forgot, found live: the
// owner asked the chat about a cottage and the model had nothing to see, not
// even the names. Each row: the display name, what it sleeps, the nightly
// rate formatted (or ABSENT — a cottage with no rate states no figure), and
// its own published Q&A, capped. Nothing here is guest data, so there is
// nothing to withhold beyond the caps.
const NIGHT_TOOL_FACTS_MAX = 6;
// The amenities / house-rules lists the cottages tool hands over per cottage.
const NIGHT_TOOL_LIST_MAX = 10;
function night_tool_cottages(array $rows)
{
    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r)) {
            continue;
        }
        $name = night_str($r['name'] ?? '');
        if ($name === '') {
            continue;
        }
        $one = ['cottage' => $name];
        $ad = (int) ($r['max_adults'] ?? 0);
        $ch = (int) ($r['max_children'] ?? 0);
        $tot = (int) ($r['max_total'] ?? 0);
        if ($ad > 0) {
            $one['sleeps'] = $ad . ' adults'
                . ($ch > 0 ? ' + ' . $ch . ' children' : '')
                . ($tot > 0 ? ' (' . $tot . ' at most)' : '');
        }
        $rate = (float) ($r['couple_rate'] ?? 0);
        if ($rate > 0) {
            $one['nightly'] = night_money($rate) . ' a night (base rate — seasons and weekends move it)';
        }
        $facts = [];
        foreach (array_slice(array_values(array_filter(
            is_array($r['facts'] ?? null) ? $r['facts'] : [],
            'is_array',
        )), 0, NIGHT_TOOL_FACTS_MAX) as $f) {
            $q = night_str($f['q'] ?? '');
            $a = night_str($f['a'] ?? '');
            if ($q === '' || $a === '') {
                continue;
            }
            $facts[] = [
                'q' => mb_substr($q, 0, NIGHT_BRIEF_FACT_Q_MAX),
                'a' => mb_substr($a, 0, NIGHT_BRIEF_FACT_A_MAX),
            ];
        }
        if ($facts) {
            $one['facts'] = $facts;
        }
        // WHAT THE COTTAGE HAS, AND WHAT GUESTS AGREE TO. Both are stores the
        // site already keeps per cottage and the model could not see: asked
        // "can guests bring a dog to Pimpernel?" it had nothing to answer from,
        // and the guard correctly drops a bluff — so the one question every
        // holiday let is asked most got a shrug about a fact the site holds.
        // Capped like the Q&A: the tool is where you go DEEP, but a fleet of
        // cottages with forty lines each would crowd out the answer.
        foreach ([['amenities', 'amenities'], ['rules', 'rules']] as [$src, $key]) {
            $list = [];
            foreach (is_array($r[$src] ?? null) ? $r[$src] : [] as $v) {
                if (!is_scalar($v)) {
                    continue;
                }
                $t = night_str($v);
                if ($t !== '') {
                    $list[] = mb_substr($t, 0, NIGHT_BRIEF_FACT_A_MAX);
                }
            }
            if ($list) {
                $one[$key] = array_slice($list, 0, NIGHT_TOOL_LIST_MAX);
            }
        }
        $out[] = $one;
    }
    return ['cottages' => array_slice($out, 0, NIGHT_TOOL_ROWS_MAX)];
}

// MONEY: who still owes, split by whether it is due NOW — the same judgement
// the payask makes (booking_within_balance_window / checked out), passed in
// as a flag so this stays pure — plus the deposits ready to go back. Figures
// formatted server-side; names travel, contact details never; each row
// carries `ref` (the booking id) so a proposed action can point EXACTLY at a
// booking rather than resolving a name fuzzily.
function night_tool_money(array $owed, array $deposits, array $names)
{
    $now = [];
    $later = [];
    foreach ($owed as $r) {
        if (!is_array($r)) {
            continue;
        }
        $row = night_tool_stay($r, $names);
        if (!empty($r['due_now']) && count($now) < NIGHT_TOOL_ROWS_MAX) {
            $now[] = $row;
        } elseif (empty($r['due_now']) && count($later) < NIGHT_TOOL_ROWS_MAX) {
            $later[] = $row;
        }
    }
    $dep = [];
    foreach ($deposits as $r) {
        if (!is_array($r) || count($dep) >= NIGHT_TOOL_ROWS_MAX) {
            continue;
        }
        $dep[] = [
            'guest' => night_str($r['name'] ?? ''),
            'cottage' => night_str($names[(string) ($r['prop_key'] ?? '')] ?? ($r['prop_key'] ?? '')),
            'left' => (string) ($r['check_out'] ?? ''),
            'deposit' => night_money((float) ($r['dep'] ?? 0)),
            'ref' => (int) ($r['id'] ?? 0),
        ];
    }
    // THE TRUTHFUL TOTALS, beside the capped rows. The row lists are trimmed to
    // NIGHT_TOOL_ROWS_MAX because a chat answer is not an export — but a COUNT
    // or a SUM taken over a trimmed list is not a short list, it is a WRONG
    // NUMBER, and the grounding pack states both as facts the model then quotes
    // to the owner. Counted over everything the gather returned; the rows stay
    // capped, and night_world reads these rather than recounting what it was
    // handed. (The tool answer carries them too, harmlessly — the same fact.)
    $nowN = 0;
    $nowSum = 0.0;
    $depN = 0;
    foreach ($owed as $r) {
        if (is_array($r) && !empty($r['due_now'])) {
            $nowN++;
            $nowSum += (float) ($r['still_to_pay'] ?? $r['balance'] ?? 0);
        }
    }
    foreach ($deposits as $r) {
        if (is_array($r)) {
            $depN++;
        }
    }
    return [
        'due_now' => $now,
        'due_later' => $later,
        'deposits_to_return' => $dep,
        'due_now_n' => $nowN,
        'due_now_sum' => round($nowSum, 2),
        'deposits_n' => $depN,
    ];
}

// PERFORMANCE: this month against last, from DIRECT bookings — and the frame
// SAYS so, because platform stays never touch this ledger and a number that
// silently omits them reads as the whole business.
function night_tool_performance(array $thisM, array $lastM, $monthLabel, $lastLabel)
{
    $sum = function (array $rows) {
        $stays = 0;
        $nights = 0;
        $rev = 0.0;
        foreach ($rows as $r) {
            if (!is_array($r)) {
                continue;
            }
            $stays++;
            $nights += night_nights((string) ($r['check_in'] ?? ''), (string) ($r['check_out'] ?? ''));
            $rev += (float) ($r['revenue'] ?? 0);
        }
        return ['stays' => $stays, 'nights' => $nights, 'revenue' => night_money($rev)];
    };
    return [
        'frame' => 'Direct bookings only, counted by the month the stay starts — platform stays (Airbnb etc.) are not in these figures.',
        'this_month' => ['month' => night_str($monthLabel)] + $sum($thisM),
        'last_month' => ['month' => night_str($lastLabel)] + $sum($lastM),
    ];
}

// EXPENSES: the tax year so far, by category — the frame the books use.
function night_tool_expenses(array $rows, $yearLabel)
{
    $total = 0.0;
    $cats = [];
    $n = 0;
    foreach ($rows as $r) {
        if (!is_array($r)) {
            continue;
        }
        $amt = (float) ($r['amount'] ?? 0);
        $total += $amt;
        $n++;
        $cat = night_str($r['category'] ?? '') ?: 'General';
        $cats[$cat] = ($cats[$cat] ?? 0) + $amt;
    }
    arsort($cats);
    $byCat = [];
    foreach (array_slice($cats, 0, NIGHT_TOOL_ROWS_MAX, true) as $c => $amt) {
        $byCat[] = ['category' => $c, 'total' => night_money($amt)];
    }
    return [
        'tax_year' => night_str($yearLabel),
        'logged' => $n,
        'total' => night_money($total),
        'by_category' => $byCat,
        'frame' => 'Only expenses logged in the app — the same caveat the Income & tax screen states.',
    ];
}

// ============================================================
//  ACTIONS THE MODEL MAY PROPOSE — and only ever propose.
//
//  THE SAFETY SHAPE, in one sentence: the model proposes, the phone disposes.
//  An act travels as data in the answer envelope, renders as a CARD in the
//  chat, and executes ONLY when the owner taps Confirm — on the phone,
//  through the same admin session, endpoints and refusals every back-office
//  button uses (clash check, resend guard, undo). The device key can execute
//  NOTHING: nothing here runs server-side, and no nightshift device action
//  writes business state. A closed whitelist, validated at the answer door
//  AND again by the thread sanitiser (defence in depth — the second guard
//  also covers a hand-edited content row), means an unknown or malformed act
//  is refused or dropped, never "tried". Money OUT (refunds, deposit
//  returns, cancellations) is deliberately not in the list, and the
//  validator refuses such kinds by name so their absence is a decision a
//  gate can see, not an oversight.
// ============================================================
const NIGHT_ACT_KINDS = ['block_dates', 'price_override', 'request_payment', 'add_booking', 'send_enquiry_reply',
    'add_expense', 'send_arrival_info', 'record_payment', 'remember'];
const NIGHT_ACT_NOTE_MAX = 120;
const NIGHT_ACT_RATE_MIN = 20;    // the price command's own sanity bounds
const NIGHT_ACT_RATE_MAX = 2000;
const NIGHT_ACT_NAME_MAX = 60;    // a proposed booking's guest name
const NIGHT_ACT_PRICE_MAX = 20000; // an agreed total's sanity ceiling

// Validate the STORED form (prop already a key). '' or a sentence. This is
// the sanitiser's guard, so it must hold on every re-read of the thread.
function night_act_problem($act)
{
    if (!is_array($act)) {
        return 'An action must be an object.';
    }
    $kind = $act['kind'] ?? '';
    if (!in_array($kind, NIGHT_ACT_KINDS, true)) {
        return 'The only actions are ' . implode(', ', NIGHT_ACT_KINDS) . '.';
    }
    $allowed = ['kind' => 1, 'done' => 1, 'doneAt' => 1];
    if ($kind === 'block_dates' || $kind === 'price_override') {
        $allowed += ['prop' => 1, 'cottage' => 1, 'from' => 1, 'to' => 1];
        $allowed += $kind === 'block_dates' ? ['note' => 1] : ['rate' => 1];
        $from = night_tool_iso($act['from'] ?? '');
        $to = night_tool_iso($act['to'] ?? '');
        if ($from === '' || $to === '' || $from > $to) {
            return 'The action needs from and to dates (YYYY-MM-DD), first night to last night.';
        }
        if (night_nights($from, $to) + 1 > NIGHT_TOOL_RANGE_MAX) {
            return 'That range is longer than ' . NIGHT_TOOL_RANGE_MAX . ' nights.';
        }
        if (!is_string($act['prop'] ?? null) || !preg_match('/^[a-z0-9-]{1,40}$/', $act['prop'])) {
            return 'The action names no cottage.';
        }
        if ($kind === 'price_override') {
            $rate = $act['rate'] ?? null;
            if (!is_numeric($rate) || $rate < NIGHT_ACT_RATE_MIN || $rate > NIGHT_ACT_RATE_MAX) {
                return 'The nightly rate must be between £' . NIGHT_ACT_RATE_MIN . ' and £' . NIGHT_ACT_RATE_MAX . '.';
            }
        }
        if ($kind === 'block_dates' && isset($act['note'])
            && (!is_string($act['note']) || mb_strlen($act['note']) > NIGHT_ACT_NOTE_MAX)) {
            return 'The note is not text under ' . NIGHT_ACT_NOTE_MAX . ' characters.';
        }
    }
    if ($kind === 'request_payment') {
        $allowed += ['booking' => 1];
        $b = $act['booking'] ?? null;
        if (!is_numeric($b) || (int) $b <= 0) {
            return 'request_payment needs the booking ref from a lookup result.';
        }
    }
    if ($kind === 'add_booking') {
        // Booking dates are the house's own check_in/check_out (leave-day
        // exclusive) — "12th to the 15th" in guest-speak IS arrive/leave, so
        // the inclusive from/to the other date acts use would be the trap.
        $allowed += ['prop' => 1, 'cottage' => 1, 'check_in' => 1, 'check_out' => 1,
            'name' => 1, 'adults' => 1, 'children' => 1, 'price' => 1];
        $ci = night_tool_iso($act['check_in'] ?? '');
        $co = night_tool_iso($act['check_out'] ?? '');
        if ($ci === '' || $co === '' || $co <= $ci) {
            return 'A booking needs check_in and check_out (YYYY-MM-DD), arrival day then leaving day.';
        }
        if (night_nights($ci, $co) > NIGHT_TOOL_RANGE_MAX) {
            return 'That stay is longer than ' . NIGHT_TOOL_RANGE_MAX . ' nights.';
        }
        if (!is_string($act['prop'] ?? null) || !preg_match('/^[a-z0-9-]{1,40}$/', $act['prop'])) {
            return 'The action names no cottage.';
        }
        if (!is_string($act['name'] ?? null) || trim($act['name']) === '') {
            return 'A booking needs the guest’s name.';
        }
        $ad = $act['adults'] ?? null;
        if (!is_numeric($ad) || (int) $ad < 1 || (int) $ad > 12) {
            return 'A booking needs adults, 1 to 12.';
        }
        if (isset($act['children']) && (!is_numeric($act['children']) || (int) $act['children'] < 0 || (int) $act['children'] > 12)) {
            return 'Children must be 0 to 12.';
        }
        if (isset($act['price']) && (!is_numeric($act['price']) || $act['price'] <= 0 || $act['price'] > NIGHT_ACT_PRICE_MAX)) {
            return 'An agreed price must be over £0 and under £' . NIGHT_ACT_PRICE_MAX . '.';
        }
    }
    if ($kind === 'send_enquiry_reply') {
        $allowed += ['enquiry' => 1];
        $e = $act['enquiry'] ?? null;
        if (!is_numeric($e) || (int) $e <= 0) {
            return 'send_enquiry_reply needs the enquiry id from a lookup result.';
        }
    }
    if ($kind === 'add_expense') {
        // A RECORD of money already spent — never money moving out, which is
        // why it may join the whitelist while refunds stay refused by name.
        $allowed += ['category' => 1, 'amount' => 1, 'note' => 1, 'date' => 1];
        if (!is_string($act['category'] ?? null) || trim($act['category']) === ''
            || mb_strlen($act['category']) > 64) {
            return 'An expense needs a category (up to 64 characters).';
        }
        $amt = $act['amount'] ?? null;
        if (!is_numeric($amt) || $amt <= 0 || $amt > NIGHT_ACT_PRICE_MAX) {
            return 'An expense amount must be over £0 and under £' . NIGHT_ACT_PRICE_MAX . '.';
        }
        if (isset($act['note']) && (!is_string($act['note']) || mb_strlen($act['note']) > NIGHT_ACT_NOTE_MAX)) {
            return 'The note is not text under ' . NIGHT_ACT_NOTE_MAX . ' characters.';
        }
        if (isset($act['date']) && night_tool_iso($act['date']) === '') {
            return 'The expense date must be YYYY-MM-DD (or left out for today).';
        }
    }
    if ($kind === 'send_arrival_info' || $kind === 'record_payment') {
        $allowed += ['booking' => 1];
        $b2 = $act['booking'] ?? null;
        if (!is_numeric($b2) || (int) $b2 <= 0) {
            return $kind . ' needs the booking ref from a lookup result.';
        }
    }
    if ($kind === 'remember') {
        // A PROPOSED memory — the invariant holds because it becomes a line
        // only when the owner confirms the card; the app still never writes
        // one of its own accord.
        $allowed += ['text' => 1];
        if (!is_string($act['text'] ?? null) || trim($act['text']) === ''
            || mb_strlen($act['text']) > NIGHT_OWNERCHAT_MEM_CHARS) {
            return 'A memory needs its text, up to ' . NIGHT_OWNERCHAT_MEM_CHARS . ' characters.';
        }
    }
    foreach (array_keys($act) as $k) {
        if (!isset($allowed[$k])) {
            return 'The action carries a field it may not: ' . night_str((string) $k) . '.';
        }
    }
    $done = $act['done'] ?? null;
    if ($done !== null && $done !== 'done' && $done !== 'dismissed') {
        return 'An action verdict is done or dismissed.';
    }
    return '';
}

// Resolve what the MODEL emitted ({action, args{...}}) into the stored form:
// cottage name → prop key (matched against the live list exactly as the
// availability tool does — ambiguity refused NAMING the choices), dates
// checked against today (the past is not proposable), everything else
// through night_act_problem. Returns ['act' => stored|null, 'problem' => ''].
function night_act_resolve($raw, array $names, $todayIso)
{
    if (!is_array($raw)) {
        return ['act' => null, 'problem' => 'An action must be an object.'];
    }
    $kind = night_str($raw['action'] ?? ($raw['kind'] ?? ''));
    if (!in_array($kind, NIGHT_ACT_KINDS, true)) {
        return ['act' => null, 'problem' => 'The only actions are ' . implode(', ', NIGHT_ACT_KINDS) . ' — nothing that moves money out or deletes.'];
    }
    $a = is_array($raw['args'] ?? null) ? $raw['args'] : [];
    $act = ['kind' => $kind];
    if ($kind === 'block_dates' || $kind === 'price_override') {
        $want = mb_strtolower(trim(night_str($a['cottage'] ?? '')));
        $hits = [];
        foreach ($names as $pk => $nm) {
            if (mb_strtolower((string) $nm) === $want || mb_strtolower((string) $pk) === $want
                || ($want !== '' && mb_stripos((string) $nm, $want) !== false)) {
                $hits[(string) $pk] = (string) $nm;
            }
        }
        if (count($hits) !== 1) {
            return ['act' => null, 'problem' => (count($hits) === 0 ? 'No cottage called that. ' : 'More than one cottage matches. ')
                . 'The cottages are: ' . implode(', ', array_values($names)) . '.'];
        }
        $act['prop'] = (string) array_key_first($hits);
        $act['cottage'] = $hits[$act['prop']];
        $act['from'] = night_tool_iso($a['from'] ?? '');
        $act['to'] = night_tool_iso($a['to'] ?? '');
        if ($act['from'] !== '' && $act['from'] < (string) $todayIso) {
            return ['act' => null, 'problem' => 'That starts in the past — actions are for dates from today on.'];
        }
        if ($kind === 'price_override') {
            $act['rate'] = round((float) ($a['rate'] ?? 0), 2);
        }
        if ($kind === 'block_dates' && night_str($a['note'] ?? '') !== '') {
            $act['note'] = mb_substr(night_str($a['note']), 0, NIGHT_ACT_NOTE_MAX);
        }
    }
    if ($kind === 'request_payment') {
        $act['booking'] = (int) ($a['booking'] ?? 0);
    }
    if ($kind === 'add_booking') {
        $want2 = mb_strtolower(trim(night_str($a['cottage'] ?? '')));
        $hits2 = [];
        foreach ($names as $pk => $nm) {
            if (mb_strtolower((string) $nm) === $want2 || mb_strtolower((string) $pk) === $want2
                || ($want2 !== '' && mb_stripos((string) $nm, $want2) !== false)) {
                $hits2[(string) $pk] = (string) $nm;
            }
        }
        if (count($hits2) !== 1) {
            return ['act' => null, 'problem' => (count($hits2) === 0 ? 'No cottage called that. ' : 'More than one cottage matches. ')
                . 'The cottages are: ' . implode(', ', array_values($names)) . '.'];
        }
        $act['prop'] = (string) array_key_first($hits2);
        $act['cottage'] = $hits2[$act['prop']];
        $act['check_in'] = night_tool_iso($a['check_in'] ?? '');
        $act['check_out'] = night_tool_iso($a['check_out'] ?? '');
        if ($act['check_in'] !== '' && $act['check_in'] < (string) $todayIso) {
            return ['act' => null, 'problem' => 'That arrival is in the past — actions are for dates from today on.'];
        }
        $act['name'] = mb_substr(night_str($a['name'] ?? ''), 0, NIGHT_ACT_NAME_MAX);
        $act['adults'] = (int) ($a['adults'] ?? 0);
        if (isset($a['children']) && is_numeric($a['children'])) {
            $act['children'] = (int) $a['children'];
        }
        if (isset($a['price']) && is_numeric($a['price'])) {
            $act['price'] = round((float) $a['price'], 2);
        }
    }
    if ($kind === 'send_enquiry_reply') {
        $act['enquiry'] = (int) ($a['enquiry'] ?? 0);
    }
    if ($kind === 'add_expense') {
        $act['category'] = mb_substr(night_str($a['category'] ?? ''), 0, 64);
        $act['amount'] = round((float) ($a['amount'] ?? 0), 2);
        if (night_str($a['note'] ?? '') !== '') {
            $act['note'] = mb_substr(night_str($a['note']), 0, NIGHT_ACT_NOTE_MAX);
        }
        $d = night_tool_iso($a['date'] ?? '');
        if ($d !== '') {
            // An expense is a record of money ALREADY spent — a receipt can
            // arrive late (the past is fine), a future one is a plan, not a fact.
            if ($d > (string) $todayIso) {
                return ['act' => null, 'problem' => 'An expense is dated when the money was spent — that date has not happened yet.'];
            }
            $act['date'] = $d;
        }
    }
    if ($kind === 'send_arrival_info' || $kind === 'record_payment') {
        $act['booking'] = (int) ($a['booking'] ?? 0);
    }
    if ($kind === 'remember') {
        $act['text'] = mb_substr(night_str($a['text'] ?? ''), 0, NIGHT_OWNERCHAT_MEM_CHARS);
    }
    $bad = night_act_problem($act);
    return $bad === '' ? ['act' => $act, 'problem' => ''] : ['act' => null, 'problem' => $bad];
}

// ============================================================
//  THE WEB CHAT — the owner talking to their Mac from anywhere.
//
//  The phone posts a turn as an ask; the Mac's existing poll answers it with
//  the SAME chat it runs locally. The site is only the meeting point: it
//  stores the conversation (so every device reads one thread), carries the
//  recent turns out and the answer back, and never composes a word itself.
//  No tunnel, no open port, no new credential — the Mac only ever dials out.
// ============================================================
const NIGHT_OWNERCHAT_TURNS_MAX = 16;    // turns that travel with one ask
const NIGHT_OWNERCHAT_TURN_CHARS = 1500; // an OLDER turn's cap in the payload
const NIGHT_OWNERCHAT_THREAD_MAX = 40;   // the stored thread's cap (content row)
const NIGHT_OWNERCHAT_TEXT_MAX = 8000;   // the answer's words
// The NEWEST turn travels WHOLE (up to the thread's own text cap): it is the
// question being asked, and an attached document rides inside it as a fenced
// block — cutting it at the history cap would hand the model half a file and
// let it answer confidently about the half it saw.
const NIGHT_OWNERCHAT_LAST_TURN_CHARS = NIGHT_OWNERCHAT_TEXT_MAX;
const NIGHT_OWNERCHAT_THINK_MAX = 6000;  // a reasoning model's passage
const NIGHT_OWNERCHAT_INSTR_MAX = 500;   // the standing instruction
const NIGHT_OWNERCHAT_FILE_MAX = 60;     // an attached document's shown name
const NIGHT_OWNERCHAT_SUM_MAX = 600;     // a conversation's condensed memory
const NIGHT_OWNERCHAT_SUM_CAP = 24;      // conversations that keep one (the rail's own cap)

// The rolling-summary store: a map convo → condensed text, owner-side JSON
// sanitised on every read (junk degrades to nothing, the same posture as
// every other content-row map). The SUMMARY is the model's own condensed
// memory of turns the payload cap has cut — it rides the next ask so a long
// conversation keeps its head, and it is only ever REQUESTED once the trim
// is real (dropped > 0): a summary of a fully-visible thread is paid-for
// context saying nothing new.
function night_ownerchat_sums($raw)
{
    $out = [];
    if (!is_array($raw)) {
        return $out;
    }
    foreach ($raw as $k => $v) {
        $cv = (int) $k;
        $txt = night_str($v);
        if ($cv >= 1 && $txt !== '') {
            $out[$cv] = mb_substr($txt, 0, NIGHT_OWNERCHAT_SUM_MAX);
        }
        if (count($out) >= NIGHT_OWNERCHAT_SUM_CAP) {
            break;
        }
    }
    return $out;
}

// A chat photo reference — the ONE shape chat_send mints (chat_photo_store in
// db.php) and the only shape chat_file will serve back. Everything else reads
// as no photo: the ref crosses two trust boundaries (owner-stored JSON, a
// device-key fetch) and a path is exactly the thing neither may compose.
function night_chat_ref_ok($ref)
{
    return is_string($ref) && preg_match('#^uploads/chat-photo-[0-9a-f]{12}\.jpg$#', $ref) === 1;
}

// Whatever the content row held → a clean thread. A message is who + words;
// a Mac message may carry think/used/model for the fold and the chip.
// ── HANDOFF: "you were just doing this over there" ───────────────────────
// Apple's Handoff has three parts — a rendezvous, an advertisement, and a
// resume that carries your unfinished state. We have no Bluetooth and no
// iCloud, but we have something that plays the rendezvous perfectly: the
// site, which BOTH devices already talk to constantly. So each surface
// advertises what it is doing, the other reads it on a call it was making
// anyway (the Mac's asks poll, the phone's chat_thread), and offers to
// continue. Proximity has no analogue here; RECENCY is the honest
// substitute — an activity older than a few minutes is not "what you were
// just doing", so it is never offered.
const NIGHT_HANDOFF_FRESH = 300;      // seconds an advertisement stays offerable
const NIGHT_HANDOFF_DRAFT_MAX = 2000; // the unsent words that travel with it
const NIGHT_HANDOFF_TITLE_MAX = 80;

// One device's activity, sanitised. '' for `dev` means unusable.
function night_handoff_one($raw)
{
    if (!is_array($raw)) {
        return null;
    }
    $dev = night_str($raw['dev'] ?? '');
    if ($dev !== 'mac' && $dev !== 'web') {
        return null;
    }
    $at = (int) ($raw['at'] ?? 0);
    if ($at <= 0) {
        return null;
    }
    // A LOCAL Mac thread and a web CONVERSATION are different addresses, and
    // only one of them the phone can open by itself: the site cannot serve a
    // conversation that lives on the Mac's own disk. `convo` is offerable to
    // either side; `thread` is the Mac's own bookmark, carried so the Mac can
    // recognise its own advertisement and never offer itself back.
    return [
        'dev' => $dev,
        'convo' => max(0, (int) ($raw['convo'] ?? 0)),
        'thread' => mb_substr(night_str($raw['thread'] ?? ''), 0, 40),
        'title' => mb_substr(night_str($raw['title'] ?? ''), 0, NIGHT_HANDOFF_TITLE_MAX),
        'draft' => mb_substr(night_str($raw['draft'] ?? ''), 0, NIGHT_HANDOFF_DRAFT_MAX),
        'at' => $at,
    ];
}

// The stored map {mac: {...}, web: {...}}, sanitised both ways.
function night_handoff_map($raw)
{
    $out = [];
    foreach (['mac', 'web'] as $d) {
        $one = night_handoff_one(is_array($raw) ? ($raw[$d] ?? null) : null);
        if ($one && $one['dev'] === $d) {
            $out[$d] = $one;
        }
    }
    return $out;
}

// What the OTHER device is doing, if it is fresh enough to offer. Null is
// the ordinary answer — nothing to continue is not a failure.
function night_handoff_offer($raw, $forDev, $now)
{
    $other = $forDev === 'mac' ? 'web' : 'mac';
    $map = night_handoff_map($raw);
    if (!isset($map[$other])) {
        return null;
    }
    $one = $map[$other];
    // A CONVERSATION THE OTHER SIDE CANNOT OPEN IS NOT AN OFFER. The phone
    // can only continue something the site holds, so a Mac advertising a
    // purely local thread (convo 0) is advertising to nobody — it must send
    // the conversation over first, which is a deliberate tap, not ambient.
    if ($forDev === 'web' && $one['convo'] <= 0) {
        return null;
    }
    if ((int) $now - $one['at'] > NIGHT_HANDOFF_FRESH) {
        return null;
    }
    return $one;
}

// ── LONG-POLL CONCURRENCY CAP ────────────────────────────────────────────
// The device-key long-poll doors (asks/chat_poll/ask_status) each hold a
// PHP-FPM worker for up to 25s. A request-count rate limit does NOT bound
// that — a held connection never releases its window slot — so a holder of
// the key could fire enough concurrent long-polls to exhaust a small FPM
// pool and stall guest-facing pages. This caps CONCURRENT holds using
// MySQL advisory locks (the book_lock mechanism — auto-freed if a worker
// dies): a door claims one of N slots without blocking; when all are taken
// it does NOT hold the request open (answers its snapshot now and the Mac
// re-arms in ~2s), so the pool can never be drained however many
// authenticated requests arrive. Best-effort where GET_LOCK is absent.
const NIGHT_POLL_SLOTS = 8;
function night_poll_slot()
{
    for ($i = 1; $i <= NIGHT_POLL_SLOTS; $i++) {
        try {
            $st = db()->prepare('SELECT GET_LOCK(?, 0)');
            $st->execute(['chb_nightpoll_' . $i]);
            $got = $st->fetchColumn();
            if ($got === null) {
                return 'chb_nightpoll_0'; // GET_LOCK unsupported — a non-empty sentinel so the caller still holds (unprotected, as before)
            }
            if ((int) $got === 1) {
                return 'chb_nightpoll_' . $i;
            }
        } catch (\Throwable $e) {
            return 'chb_nightpoll_0'; // best-effort: never let the cap itself break a poll
        }
    }
    return ''; // every slot busy — the caller must not hold
}

// ── THE IMPORTED CONVERSATION (chat continuity) — may this land? ─────────
// A local Mac chat becomes a web conversation ONLY through this door: refs
// are the exactly-once mechanism (a lost reply retries the same ref and the
// site answers "already"), the cap keeps a runaway producer from dumping a
// novel, and every message still passes the thread sanitiser at the append.
const NIGHT_CHAT_IMPORT_MAX = 40;
function night_chat_import_problem($ref, $msgs)
{
    if (!preg_match('/^[a-z0-9][a-z0-9-]{0,39}$/', (string) $ref)) {
        return 'That import reference is not usable.';
    }
    if (!is_array($msgs) || count($msgs) === 0) {
        return 'An import needs at least one message.';
    }
    if (count($msgs) > NIGHT_CHAT_IMPORT_MAX) {
        return 'An import carries at most ' . NIGHT_CHAT_IMPORT_MAX . ' messages — send the recent part.';
    }
    foreach ($msgs as $m) {
        if (!is_array($m)) {
            return 'That is not a message.';
        }
        $who = $m['who'] ?? '';
        if ($who !== 'you' && $who !== 'mac') {
            return "A message's who must be 'you' or 'mac'.";
        }
        if (night_str($m['text'] ?? '') === '') {
            return 'A message with no words cannot be imported.';
        }
    }
    return '';
}

function night_ownerchat_thread($raw)
{
    $msgs = [];
    $rows = is_array($raw) && is_array($raw['msgs'] ?? null) ? $raw['msgs'] : [];
    foreach ($rows as $m) {
        if (!is_array($m)) {
            continue;
        }
        $who = ($m['who'] ?? '') === 'mac' ? 'mac' : 'you';
        $text = night_str($m['text'] ?? '');
        if ($text === '') {
            continue;
        }
        $one = ['who' => $who, 'text' => mb_substr($text, 0, NIGHT_OWNERCHAT_TEXT_MAX),
            'at' => mb_substr(night_str($m['at'] ?? ''), 0, 16)];
        if ($who === 'you') {
            // Attachments SURVIVE the sanitiser — chat_poll re-writes the
            // thread through this function when an answer lands, so a field
            // dropped here would erase the photo the moment the Mac replied.
            // The ref is re-validated on every pass (owner-stored JSON).
            if (night_chat_ref_ok($m['img'] ?? null)) {
                $one['img'] = $m['img'];
            }
            $file = night_str($m['file'] ?? '');
            if ($file !== '') {
                $one['file'] = mb_substr($file, 0, NIGHT_OWNERCHAT_FILE_MAX);
            }
        }
        if ($who === 'mac') {
            $think = night_str($m['think'] ?? '');
            if ($think !== '') {
                $one['think'] = mb_substr($think, 0, NIGHT_OWNERCHAT_THINK_MAX);
            }
            $used = [];
            foreach ((is_array($m['used'] ?? null) ? $m['used'] : []) as $u) {
                if (is_string($u) && $u !== '') {
                    $used[] = mb_substr($u, 0, 24);
                }
            }
            if ($used) {
                $one['used'] = array_slice($used, 0, 4);
            }
            if (night_str($m['model'] ?? '') !== '') {
                $one['model'] = mb_substr(night_str($m['model']), 0, 80);
            }
            // A stop is part of the record: these words were cut short by the
            // owner, and every device's render must say so.
            if (!empty($m['stopped'])) {
                $one['stopped'] = true;
            }
            // A PROPOSED ACTION survives only if it still validates — the
            // second of the two guards (the answer door is the first), so a
            // hand-edited content row can never render a card the whitelist
            // does not know. Its done/dismissed verdict rides with it.
            if (isset($m['act']) && night_act_problem($m['act']) === '') {
                $one['act'] = $m['act'];
            }
        }
        $msgs[] = $one;
    }
    return [
        'instr' => mb_substr(night_str(is_array($raw) ? ($raw['instr'] ?? '') : ''), 0, NIGHT_OWNERCHAT_INSTR_MAX),
        'msgs' => array_slice($msgs, -NIGHT_OWNERCHAT_THREAD_MAX),
    ];
}

// The payload one ask carries OUT: the newest turns that fit, plus the
// standing instruction. The Mac composes its own system line — the site
// hands over facts, never prompt text.
function night_ownerchat_payload($thread)
{
    $t = night_ownerchat_thread($thread);
    $turns = [];
    $slice = array_slice($t['msgs'], -NIGHT_OWNERCHAT_TURNS_MAX);
    $lastIx = count($slice) - 1;
    foreach ($slice as $ix => $m) {
        // The FINAL turn is the ask itself and travels whole (an attached
        // document rides fenced inside it); history keeps the tight cap.
        $cap = $ix === $lastIx ? NIGHT_OWNERCHAT_LAST_TURN_CHARS : NIGHT_OWNERCHAT_TURN_CHARS;
        $one = ['who' => $m['who'], 'text' => mb_substr($m['text'], 0, $cap)];
        // A photo ref rides ONLY the final turn — the Mac feeds one image to
        // the model, and it must be the one the question is about, never an
        // older photo resurfacing because history happened to carry it.
        if ($ix === $lastIx && night_chat_ref_ok($m['img'] ?? null)) {
            $one['img'] = $m['img'];
        }
        $turns[] = $one;
    }
    $out = ['turns' => $turns];
    if ($t['instr'] !== '') {
        $out['instr'] = $t['instr'];
    }
    return $out;
}

// ── THE GROUNDING PACK ──────────────────────────────────────────────────
// The world sheet that rides EVERY ownerchat ask: the fleet, today's
// movements, the money picture — so the model's first generation is already
// grounded instead of spending a whole round deciding whether to look. The
// site hands over FACTS (the payload rule); the Mac composes its own words
// around them. SLIMMER than the tools on purpose: this rides every ask and
// pays context for it, so each list is cut hard — the tools remain the way
// to go deep. Names travel, contact details never (same withholding rule,
// same gate-by-absence).
const NIGHT_WORLD_LIST_MAX = 5;
const NIGHT_OWNERCHAT_MEM_MAX = 12;       // memories the owner may keep
const NIGHT_OWNERCHAT_MEM_CHARS = 200;    // one memory's cap

function night_world(array $fleet, array $today, array $money)
{
    $slimStay = function ($r) {
        $o = ['guest' => night_str($r['guest'] ?? ''), 'cottage' => night_str($r['cottage'] ?? '')];
        if (night_str($r['still_to_pay'] ?? '') !== '') {
            $o['still_to_pay'] = $r['still_to_pay'];
        }
        return $o;
    };
    $cut = function ($rows) use ($slimStay) {
        return array_map($slimStay, array_slice(is_array($rows) ? $rows : [], 0, NIGHT_WORLD_LIST_MAX));
    };
    $cots = [];
    foreach (array_slice($fleet, 0, 8) as $c) {
        if (!is_array($c) || night_str($c['cottage'] ?? '') === '') {
            continue;
        }
        $one = ['cottage' => night_str($c['cottage'])];
        foreach (['sleeps', 'nightly'] as $k) {
            if (night_str($c[$k] ?? '') !== '') {
                $one[$k] = $c[$k];
            }
        }
        $cots[] = $one;
    }
    $dueRows = $cut($money['due_now'] ?? []);
    // Count and sum from the TOTALS night_tool_money carries, not from the rows
    // it was handed: those are already trimmed to NIGHT_TOOL_ROWS_MAX, so
    // recounting them told the model "12 guests owe £X" whenever more than
    // twelve did — a figure short by however many were cut, stated as fact in
    // the pack that rides every ask. Falls back to counting the rows when the
    // totals are absent (an older caller), which is exactly the old behaviour.
    $dueTotal = 0.0;
    $dueCount = 0;
    if (isset($money['due_now_n'], $money['due_now_sum'])) {
        $dueCount = (int) $money['due_now_n'];
        $dueTotal = (float) $money['due_now_sum'];
    } else {
        foreach ((is_array($money['due_now'] ?? null) ? $money['due_now'] : []) as $r) {
            $dueCount++;
            $dueTotal += (float) str_replace(['£', ','], '', (string) ($r['still_to_pay'] ?? '0'));
        }
    }
    return [
        'cottages' => $cots,
        'today' => [
            'date' => night_str($today['date'] ?? ''),
            'arrivals' => $cut($today['arrivals'] ?? []),
            'departures' => $cut($today['departures'] ?? []),
            'staying' => $cut($today['staying'] ?? []),
            'enquiries_waiting' => (int) ($today['enquiries_waiting'] ?? 0),
        ],
        'money' => [
            'due_now_count' => $dueCount,
            'due_now_total' => night_money($dueTotal),
            'due_now' => $dueRows,
            'deposits_to_return' => isset($money['deposits_n'])
                ? (int) $money['deposits_n']
                : count(is_array($money['deposits_to_return'] ?? null) ? $money['deposits_to_return'] : []),
        ],
    ];
}

// The owner's memories, sanitised: strings only, trimmed, capped both ways.
// Memory the OWNER wrote — the app never adds a line of its own.
// A memory is DATED now — {t, at} — so the editor can whisper "remembered in
// March, still true?" instead of carrying a dead fact forever. Legacy plain
// strings are ADOPTED with an empty date (unknown is honest; inventing a
// date would defeat the staleness question). The MODEL only ever sees the
// texts (night_ownerchat_memory_texts) — a date per line is editor chrome,
// not context worth paying for.
function night_ownerchat_memories($raw)
{
    $out = [];
    foreach ((is_array($raw) ? $raw : []) as $m) {
        $t = night_str(is_array($m) ? ($m['t'] ?? '') : $m);
        if ($t === '') {
            continue;
        }
        $at = is_array($m) ? night_str($m['at'] ?? '') : '';
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $at)) {
            $at = '';
        }
        $out[] = ['t' => mb_substr($t, 0, NIGHT_OWNERCHAT_MEM_CHARS), 'at' => $at];
        if (count($out) >= NIGHT_OWNERCHAT_MEM_MAX) {
            break;
        }
    }
    return $out;
}
// The texts alone, for every payload and grounding line.
function night_ownerchat_memory_texts($items)
{
    $out = [];
    foreach ((is_array($items) ? $items : []) as $m) {
        $t = night_str(is_array($m) ? ($m['t'] ?? '') : $m);
        if ($t !== '') {
            $out[] = $t;
        }
    }
    return $out;
}

// May this land as a web-chat answer? The answer is a JSON envelope —
// { text, think?, used?, ms?, tps? } — because the fold and the chip need
// their facts beside the words. '' or a sentence; the generic 8000-char
// answer rule does not apply (think rides inside), so this owns its caps.
function night_ownerchat_answer_problem($raw)
{
    $j = json_decode((string) (is_string($raw) ? $raw : ''), true);
    if (!is_array($j)) {
        return 'A web-chat answer must be the JSON envelope this app posts.';
    }
    $text = $j['text'] ?? null;
    if (!is_string($text) || trim($text) === '') {
        return 'A web-chat answer needs its words.';
    }
    if (mb_strlen($text) > NIGHT_OWNERCHAT_TEXT_MAX) {
        return 'The answer is longer than ' . NIGHT_OWNERCHAT_TEXT_MAX . ' characters.';
    }
    if (isset($j['think']) && (!is_string($j['think']) || mb_strlen($j['think']) > NIGHT_OWNERCHAT_THINK_MAX)) {
        return 'The thinking is not text, or is over ' . NIGHT_OWNERCHAT_THINK_MAX . ' characters.';
    }
    if (isset($j['used']) && !is_array($j['used'])) {
        return 'The lookups must be a list of tool names.';
    }
    if (isset($j['sum']) && (!is_string($j['sum']) || mb_strlen($j['sum']) > NIGHT_OWNERCHAT_SUM_MAX)) {
        return 'The summary is not text, or is over ' . NIGHT_OWNERCHAT_SUM_MAX . ' characters.';
    }
    return '';
}
