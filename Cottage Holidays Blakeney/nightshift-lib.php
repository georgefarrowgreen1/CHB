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
const NIGHT_ASK_KINDS = ['reply', 'answer', 'chat', 'intent', 'digest'];
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
    $hayNums = [];
    if (preg_match_all('/£\s*([\d,]+(?:\.\d+)?)/u', $hay, $hm)) {
        foreach ($hm[1] as $n) {
            $hayNums[str_replace(',', '', $n)] = true;
        }
    }
    foreach ($m[1] as $n) {
        $norm = str_replace(',', '', $n);
        // £120 in a row grounds £120.00 in the summary, and the reverse.
        $trim = rtrim(rtrim($norm, '0'), '.');
        $ok = isset($hayNums[$norm]) || isset($hayNums[$norm . '.00']) || isset($hayNums[$trim]) || isset($hayNums[$trim . '.00']);
        if (!$ok) {
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

const NIGHT_TOOLS = ['today', 'bookings', 'availability', 'enquiries', 'cottages'];
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
        return 'No such tool — the tools are today, bookings, availability, enquiries and cottages.';
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
    return ''; // today / enquiries take no arguments; extras are ignored
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
        $out[] = $one;
    }
    return ['cottages' => array_slice($out, 0, NIGHT_TOOL_ROWS_MAX)];
}
