<?php
// ============================================================
//  test-waitlist.php — guards WHO gets told "a space has opened", and more
//  importantly WHO DOESN'T. Dev/CI only, deploy-excluded. No DB, no SMTP, no
//  clock: db(), dates_clash() and smtp_send() are stubbed BEFORE the require, so
//  the real waitlist-lib.php functions are driven with nothing external.
//
//  Why this file exists: waitlist_notify_freed() emails guests UNPROMPTED about
//  somebody else's cancellation, and until now nothing exercised it. The failure
//  that costs something is not "nobody was told" — it is telling somebody a
//  falsehood, which burns the invitation for the one time it would have worked.
//  So most of the checks here are silences.
//
//  Run:  php test-waitlist.php
// ============================================================

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

// ---- the world, faked -------------------------------------------------------
// Every SELECT the library runs, in order, with its bound parameters — so a
// check can ask what was actually asked of the database, not just what came back.
$WL_QUERIES = [];
$WL_ROWS = [];       // what the waitlist SELECT returns
$WL_UPDATES = [];    // ids marked notified
$WL_SENT = [];       // recipients smtp_send was called for
$WL_SEND_OK = true;  // does the mail go?
$WL_CLASH = false;   // is the freed range still covered?
$WL_DB_THROWS = false;

class WlStmt
{
    private $sql;
    public function __construct($sql)
    {
        $this->sql = $sql;
    }
    public function execute($args = [])
    {
        global $WL_QUERIES, $WL_UPDATES, $WL_DB_THROWS;
        if ($WL_DB_THROWS) {
            throw new RuntimeException('database is down');
        }
        $WL_QUERIES[] = ['sql' => $this->sql, 'args' => $args];
        if (stripos($this->sql, 'UPDATE waitlist') !== false) {
            $WL_UPDATES[] = $args[0] ?? null;
        }
        return true;
    }
    public function fetchAll()
    {
        global $WL_ROWS;
        return stripos($this->sql, 'FROM waitlist') !== false ? $WL_ROWS : [];
    }
    public function fetchColumn()
    {
        return stripos($this->sql, 'FROM properties') !== false ? 'Jollyboat' : false;
    }
}
class WlDb
{
    public function prepare($sql)
    {
        return new WlStmt($sql);
    }
}
function db()
{
    return new WlDb();
}
function dates_clash($prop, $from, $to)
{
    global $WL_CLASH;
    return $WL_CLASH;
}
function smtp_send($toEmail, $toName, $subject, $text, $html = null)
{
    global $WL_SENT, $WL_SEND_OK;
    $WL_SENT[] = ['to' => $toEmail, 'subject' => $subject, 'text' => $text, 'html' => $html];
    return $WL_SEND_OK ? ['ok' => true] : ['ok' => false, 'error' => 'Mail disabled'];
}
function uk_date($iso)
{
    $t = strtotime((string) $iso);
    return $t ? date('d/m/Y', $t) : (string) $iso;
}
// email_shell / email_h / email_p / email_btn / prop_display / site_base_url are
// deliberately NOT defined: wl_send guards on function_exists for all of them, so
// leaving them out drives the plain-text fallback as well as the branded path.

require_once __DIR__ . '/waitlist-lib.php';

function wl_reset(array $o = [])
{
    global $WL_QUERIES, $WL_ROWS, $WL_UPDATES, $WL_SENT, $WL_SEND_OK, $WL_CLASH, $WL_DB_THROWS;
    $WL_QUERIES = [];
    $WL_UPDATES = [];
    $WL_SENT = [];
    $WL_ROWS = $o['rows'] ?? [];
    $WL_SEND_OK = $o['send'] ?? true;
    $WL_CLASH = $o['clash'] ?? false;
    $WL_DB_THROWS = $o['throws'] ?? false;
}
// Read through a function rather than indexing the global directly: the global
// is initialised `[]` and only ever filled by the stub, which static analysis
// cannot see, so a bare `$WL_SENT[0] ?? …` reads as an impossible offset.
function wl_sent($i = 0)
{
    global $WL_SENT;
    return $WL_SENT[$i] ?? ['to' => '', 'subject' => '', 'text' => '', 'html' => null];
}
$WAITING = [
    ['id' => 1, 'prop_key' => 'jollyboat', 'name' => 'Ada Bell', 'email' => 'ada@example.test', 'check_in' => '2026-08-10', 'check_out' => '2026-08-14'],
    ['id' => 2, 'prop_key' => 'jollyboat', 'name' => 'Ben Cole', 'email' => 'ben@example.test', 'check_in' => null, 'check_out' => null],
];

echo "== test-waitlist.php ==\n";

// ============================================================
//  1. A FREEING WITH NO DATES IS NOT A FREEING.
//
//  The bug this pins: the clash check was wrapped in `if ($from && $to)` while
//  the query beneath it fell back to 1970–9999, which matches EVERY waiting
//  entry for the cottage. So one caller passing an empty date would have emailed
//  the whole waitlist "a space has opened" with the ONE check that could have
//  refused it switched off. No caller did — bookings and ical-import all pass a
//  real range — but the two halves read the same range differently, and that is
//  the shape every "one fact, two definitions" defect in this codebase has had.
// ============================================================
echo "\n-- a freeing needs a cottage AND a range --\n";
wl_reset(['rows' => $WAITING]);
chk('no dates at all → nobody is emailed', waitlist_notify_freed('jollyboat', '', '') === 0 && !$WL_SENT);
wl_reset(['rows' => $WAITING]);
chk('...nor with only a start', waitlist_notify_freed('jollyboat', '2026-08-10', '') === 0 && !$WL_SENT);
wl_reset(['rows' => $WAITING]);
chk('...nor with only an end', waitlist_notify_freed('jollyboat', '', '2026-08-14') === 0 && !$WL_SENT);
wl_reset(['rows' => $WAITING]);
chk('...nor with no cottage', waitlist_notify_freed('', '2026-08-10', '2026-08-14') === 0 && !$WL_SENT);
// The refusal is BEFORE the read, not after it — a query that runs and is then
// discarded is one edit from being acted on.
chk('...and it refuses before it even asks the database', !$WL_QUERIES);
// The fallback that made the trap reachable is gone from the SQL as well as the
// guard, so the two cannot drift apart again.
$libSrc = (string) file_get_contents(__DIR__ . '/waitlist-lib.php');
chk('no 1970/9999 catch-all range is left in the query',
    strpos($libSrc, '9999-12-31') === false && strpos($libSrc, '1970-01-01') === false);

// ============================================================
//  2. A RANGE THAT IS STILL COVERED IS NOT FREE.
//
//  bookings.php calls this from delete/cancel WITHOUT pre-checking, so this is
//  the only thing standing between a cancellation and an email about dates the
//  OTHER booking still holds.
// ============================================================
echo "\n-- still booked → say nothing --\n";
wl_reset(['rows' => $WAITING, 'clash' => true]);
chk('a range another booking still covers emails nobody', waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14') === 0);
chk('...and nothing is marked notified', !$WL_UPDATES);
chk('...and it asks BEFORE reading the waitlist', !$WL_QUERIES);
wl_reset(['rows' => $WAITING]);
chk('a genuinely free range does email', waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14') === 2 && count($WL_SENT) === 2);

// ============================================================
//  3. A SOFT MAIL FAILURE MUST NOT BURN THE RE-INVITE.
//
//  Marking an entry notified is a one-way door: it never matches again. So the
//  mark belongs to the SEND, not to the attempt — otherwise a dropped SMTP
//  connection silently costs the guest the one email this feature exists for.
// ============================================================
echo "\n-- a send that did not go leaves the entry to retry --\n";
wl_reset(['rows' => $WAITING, 'send' => false]);
$n = waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14');
chk('a failed send counts nobody as told', $n === 0);
chk('...and marks nobody, so a later run tries again', !$WL_UPDATES);
chk('...though it really did try', count($WL_SENT) === 2);
// Half and half: one address the mailer refuses outright must not stop the other.
wl_reset(['rows' => [$WAITING[0], ['id' => 3, 'prop_key' => 'jollyboat', 'name' => 'No Address', 'email' => '']]]);
chk('an entry with no email is skipped, not fatal', waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14') === 1);
chk('...and only the one that went is marked', $WL_UPDATES === [1]);

// ============================================================
//  4. WHO MATCHES. An entry with no dates asked to hear about ANYTHING at that
//  cottage — that is about what the guest signed up for, not about whether
//  anything was freed, which is why §1 does not touch it. The dated entries use
//  the house's end-exclusive overlap, same as dates_clash and the guest picker.
// ============================================================
echo "\n-- who the query asks for --\n";
wl_reset(['rows' => $WAITING]);
waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14');
$sel = null;
foreach ($WL_QUERIES as $q) {
    if (stripos($q['sql'], 'FROM waitlist') !== false) {
        $sel = $q;
        break;
    }
}
chk('the waitlist is read for this cottage', $sel && $sel['args'][0] === 'jollyboat');
chk('...with the freed range bound as given', $sel && $sel['args'][1] === '2026-08-14' && $sel['args'][2] === '2026-08-10');
chk('...end-exclusive, like every other overlap here', $sel && strpos($sel['sql'], 'check_in < ? AND check_out > ?') !== false);
chk('...and only entries never told before', $sel && strpos($sel['sql'], 'notified_at IS NULL') !== false);
chk('an open-dated entry still matches', $sel && strpos($sel['sql'], 'check_in IS NULL OR check_out IS NULL') !== false);

// ============================================================
//  5. AN UNREADABLE DATABASE SAYS NOTHING, rather than throwing into a caller
//     that is mid-cancellation. Cancelling a booking must not fail because the
//     waitlist could not be read.
// ============================================================
echo "\n-- a broken read is silent, not fatal --\n";
wl_reset(['rows' => $WAITING, 'throws' => true]);
$threw = false;
try {
    $n = waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14');
} catch (\Throwable $e) {
    $threw = true;
}
chk('a failing query does not escape into the caller', !$threw);
chk('...and reports nobody told', $n === 0);

// ============================================================
//  6. THE EMAIL ITSELF. Dates read DD/MM/YYYY like every other guest email —
//     raw ISO leaked here once — and the cottage is named, not keyed.
// ============================================================
echo "\n-- what the guest actually reads --\n";
wl_reset(['rows' => [$WAITING[0]]]);
waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14');
$mail = wl_sent(0);
chk('the guest is greeted by name', strpos($mail['text'], 'Hi Ada Bell') !== false);
chk('the cottage is named, not keyed', strpos($mail['subject'], 'Jollyboat') !== false && strpos($mail['subject'], 'jollyboat') === false);
chk('dates read DD/MM/YYYY', strpos($mail['text'], '10/08/2026 to 14/08/2026') !== false);
chk('...and never raw ISO', strpos($mail['text'], '2026-08-10') === false);
// An open-dated entry has no range to quote, so it must not print an empty one.
wl_reset(['rows' => [$WAITING[1]]]);
waitlist_notify_freed('jollyboat', '2026-08-10', '2026-08-14');
$open = (string) wl_sent(0)['text'];
chk('an open-dated guest is told about the cottage, without dangling dates',
    strpos($open, 'Jollyboat.') !== false && strpos($open, ' for  ') === false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail WAITLIST CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass WAITLIST CHECKS PASSED \u{2705}\n";
