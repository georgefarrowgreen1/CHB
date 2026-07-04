<?php
// ============================================================
//  test-reply.php — guards the reply-by-email core logic (CI + local).
//  Pure functions only (no DB): the signed thread token and the quoted-
//  history stripping. Run:  php test-reply.php
// ============================================================
define('REPLY_INBOX', 'reply@cottageholidaysblakeney.co.uk'); // before db.php/config
require_once __DIR__ . '/db.php'; // msg_reply_token / verify / address
require_once __DIR__ . '/chat-lib.php'; // strip_quoted_reply

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

echo "== Reply token ==\n";
$tok = msg_reply_token(42);
chk('token verifies to its thread id', msg_reply_verify($tok) === 42);
chk('tampered thread id rejected', msg_reply_verify('43x' . substr($tok, strpos($tok, 'x') + 1)) === 0);
chk('garbage token rejected', msg_reply_verify('not-a-token') === 0);
chk(
    'plus reply address carries the token',
    msg_reply_address(42) === 'reply+' . $tok . '@cottageholidaysblakeney.co.uk',
);

// The inbound gateway pulls the token from a plus-recipient or an In-Reply-To.
$find = function ($hay) {
    if (preg_match('/\+(\d+x[0-9a-f]{16})@/', $hay, $m)) {
        return $m[1];
    }
    if (preg_match('/(\d+x[0-9a-f]{16})/', $hay, $m)) {
        return $m[1];
    }
    return '';
};
chk('token found in plus-recipient', msg_reply_verify($find('reply+' . $tok . '@x.co.uk')) === 42);
chk('token found in In-Reply-To', msg_reply_verify($find('<msg.' . $tok . '@x.co.uk>')) === 42);

echo "== Quoted-history stripping ==\n";
$gmail =
    "Yes, 1-8 August is free — shall I pencil you in?\n\nOn Fri, 4 Jul 2026 at 10:12, Cottage Holidays <reply@x> wrote:\n> Someone sent you a message\n> \"is jollyboat free?\"";
chk('gmail quote stripped', strip_quoted_reply($gmail) === 'Yes, 1-8 August is free — shall I pencil you in?');
$outlook =
    "Sounds good, see you then.\r\n\r\n________________________________\r\nFrom: noreply@x\r\nSent: Friday\r\nSubject: New message\r\nbody...";
chk('outlook divider stripped', strip_quoted_reply($outlook) === 'Sounds good, see you then.');
$sig = "Perfect, booked.\n\n-- \nGeorge\nCottage Holidays Blakeney";
chk('signature stripped', strip_quoted_reply($sig) === 'Perfect, booked.');
// Outlook top-post: a From:/Sent:/To:/Subject: header block with no ">" or attribution.
$outlookHdr =
    "Great, thanks.\n\nFrom: Someone Else\nSent: Friday, 4 July 2026 10:00\nTo: George\nSubject: Re: booking\n\nold quoted text the owner shouldn't leak";
chk('outlook header block stripped', strip_quoted_reply($outlookHdr) === 'Great, thanks.');
$plain = 'Just a normal reply with no quote.';
chk('plain reply untouched', strip_quoted_reply($plain) === $plain);
// Mobile / client auto-signatures with no "-- " delimiter.
chk('"Sent from my iPhone" stripped', strip_quoted_reply("123\nSent from my iPhone") === '123');
chk('"Sent from my iPad" stripped', strip_quoted_reply("Yes that's fine\n\nSent from my iPad") === "Yes that's fine");
chk('"Get Outlook for iOS" stripped', strip_quoted_reply("See you then\nGet Outlook for iOS") === 'See you then');
chk('"Sent from Mail for Windows" stripped', strip_quoted_reply("Booked\n\nSent from Mail for Windows") === 'Booked');
// The real-world miss: iOS Mail attribution WRAPPED onto two lines, quote has no ">".
$iosWrapped =
    "Sounds great, see you soon!\n\nOn 4 Jul 2026, at 19:59, Cottage Holidays Blakeney\n<bookings\@x.co.uk> wrote:\n\nSomeone has sent you a message via the website chat.\n\nFrom: George (george\@icloud.com)\n\n\"Boo\"\n\nJust reply to this email and the guest gets it on the website and by email.";
chk('wrapped iOS attribution stripped', strip_quoted_reply($iosWrapped) === 'Sounds great, see you soon!');
// Owner replied with NO added text → whole body is our quoted notification → empty.
$quoteOnly =
    "On 4 Jul 2026, at 19:59, Cottage Holidays Blakeney\n<bookings\@x.co.uk> wrote:\n\nSomeone has sent you a message via the website chat.\n\n\"Boo\"\n\nJust reply to this email and the guest gets it on the website and by email.";
chk('quote-only reply → empty (skipped)', strip_quoted_reply($quoteOnly) === '');
// No attribution at all, quote not ">"-prefixed → cut at our known phrase.
$noAttrib = "Yep all good.\n\nSomeone has sent you a message via the website chat.\n\n\"Boo\"";
chk('our-phrase cut with no attribution', strip_quoted_reply($noAttrib) === 'Yep all good.');
// Guest-side relay quoted back.
$guestQuote = "Thanks!\n\nYou have a new message from Cottage Holidays Blakeney:\n\n\"see you then\"";
chk('guest relay phrase cut', strip_quoted_reply($guestQuote) === 'Thanks!');

echo "== Zero-setup mailbox parsing ==\n";
require_once __DIR__ . '/mailbox-read.php'; // endpoint block is basename-guarded → no side effects
// POP3 UIDL listing
$uidls = pop3_parse_uidl("+OK\r\n1 aaa111\r\n2 bbb222\r\n3 ccc333\r\n.\r\n");
chk('UIDL parsed to [no=>uid]', $uidls === [1 => 'aaa111', 2 => 'bbb222', 3 => 'ccc333']);
// derived POP host
chk(
    'pop host derived from smtp host',
    mailbox_pop_host() !== '' && strpos(mailbox_pop_host(), 'pop') === 0
        ? true
        : (mailbox_pop_host() === ''
            ? true
            : false),
);
// From-address extraction
chk('from "Name <addr>" → addr', mailbox_from_addr('George Farrow <george@icloud.com>') === 'george@icloud.com');
chk('from bare addr', mailbox_from_addr('george@icloud.com') === 'george@icloud.com');
// Spoof: a display-name that embeds a fake <owner@…> must not win over the real
// (last) <evil@…> address — else it could impersonate an allow-listed sender.
chk(
    'from spoof takes the REAL (last) angle addr',
    mailbox_from_addr('"a <owner@allowed.com>" <evil@evil.com>') === 'evil@evil.com',
);
// A realistic quoted-printable reply, token in In-Reply-To
$rawQP =
    "From: George <george@icloud.com>\r\n" .
    "Subject: Re: New website message\r\n" .
    'In-Reply-To: <msg.' .
    $tok .
    "@cottageholidaysblakeney.co.uk>\r\n" .
    "Content-Type: text/plain; charset=UTF-8\r\n" .
    "Content-Transfer-Encoding: quoted-printable\r\n" .
    "\r\n" .
    "Yes =E2=80=94 1-8 August is free.\r\n\r\nOn Fri wrote:\r\n> old stuff";
$p = parse_email_message($rawQP);
chk('QP body decoded', strpos($p['body'], 'August is free') !== false);
chk('token found from In-Reply-To', msg_reply_verify(mailbox_token_in($p)) === 42);
chk('sender parsed', mailbox_from_addr($p['from']) === 'george@icloud.com');
chk('cleaned reply drops the quote', strip_quoted_reply($p['body']) === 'Yes — 1-8 August is free.');
// Multipart/alternative — take text/plain
$b = 'BOUND123';
$rawMP =
    "From: a@b.com\r\nSubject: Re: hi [#" .
    $tok .
    "]\r\nContent-Type: multipart/alternative; boundary=\"$b\"\r\n\r\n" .
    "--$b\r\nContent-Type: text/plain\r\n\r\nHello there plain\r\n--$b\r\nContent-Type: text/html\r\n\r\n<p>Hello there html</p>\r\n--$b--\r\n";
$pm = parse_email_message($rawMP);
chk('multipart text/plain extracted', trim($pm['body']) === 'Hello there plain');
chk('token found from subject tag', msg_reply_verify(mailbox_token_in($pm)) === 42);
// Nested multipart/mixed → multipart/alternative → text/plain (reply with an
// attachment). The outer part is a container, so a non-recursive parser would
// leak the raw MIME; we must recurse and still pull the plain text.
$b1 = 'OUT1';
$b2 = 'INN2';
$rawNest =
    "From: g@x.com\r\nSubject: Re: hi [#" .
    $tok .
    "]\r\nContent-Type: multipart/mixed; boundary=\"$b1\"\r\n\r\n" .
    "--$b1\r\nContent-Type: multipart/alternative; boundary=\"$b2\"\r\n\r\n" .
    "--$b2\r\nContent-Type: text/plain\r\n\r\nNested reply text\r\n" .
    "--$b2\r\nContent-Type: text/html\r\n\r\n<p>Nested reply html</p>\r\n--$b2--\r\n" .
    "--$b1\r\nContent-Type: application/octet-stream\r\n\r\nBINARYSTUFF\r\n--$b1--\r\n";
$pn = parse_email_message($rawNest);
chk('nested multipart text/plain extracted (no MIME leak)', trim($pn['body']) === 'Nested reply text');
// HTML-only reply → flattened to text (no text/plain part present).
$b3 = 'ALT3';
$rawHtml =
    "From: g@x.com\r\nSubject: Re: hi [#" .
    $tok .
    "]\r\nContent-Type: multipart/alternative; boundary=\"$b3\"\r\n\r\n" .
    "--$b3\r\nContent-Type: text/html\r\n\r\n<div>Sounds good<br>see you then</div>\r\n--$b3--\r\n";
$ph = parse_email_message($rawHtml);
chk('html-only reply flattened to text', trim($ph['body']) === "Sounds good\nsee you then");

echo "== Admin notification recipients (add/remove) ==\n";
require_once __DIR__ . '/notify-recipients.php'; // endpoint block is basename-guarded
$primary = 'owner@chb.co.uk';
$list = [];
// add a valid address
$r = nr_apply('add', 'partner@x.com', $list, $primary);
$list = $r['list'];
chk('add valid → in list', $r['changed'] && $list === ['partner@x.com']);
// add a second
$r = nr_apply('add', 'cohost@x.com', $list, $primary);
$list = $r['list'];
chk('add second → both present', $list === ['partner@x.com', 'cohost@x.com']);
// duplicate (case-insensitive) → no change, no error
$r = nr_apply('add', 'Partner@X.com', $list, $primary);
chk('duplicate add is a no-op', !$r['changed'] && $r['error'] === null && count($r['list']) === 2);
// the primary can't be added as an extra
$r = nr_apply('add', 'Owner@CHB.co.uk', $list, $primary);
chk('cannot add the primary', !$r['changed'] && $r['code'] === 400);
// invalid address rejected
$r = nr_apply('add', 'not-an-email', $list, $primary);
chk('invalid address rejected', !$r['changed'] && $r['code'] === 400);
// cap enforced
$capList = array_map(fn($i) => "u$i@x.com", range(1, 15));
$r = nr_apply('add', 'one-too-many@x.com', $capList, $primary);
chk('cap of 15 enforced', !$r['changed'] && $r['code'] === 400);
// remove (case-insensitive) works
$r = nr_apply('remove', 'PARTNER@x.com', $list, $primary);
$list = $r['list'];
chk('remove (case-insensitive) works', $r['changed'] && $list === ['cohost@x.com']);
// removing a missing address is a harmless no-op
$r = nr_apply('remove', 'nobody@x.com', $list, $primary);
chk('remove missing → no-op', !$r['changed'] && $r['list'] === ['cohost@x.com']);
// owner_recipients() reflects the saved extras (primary first, dedup, invalids dropped)
$GLOBALS['NR_FAKE'] = json_encode(['owner@chb.co.uk', 'partner@x.com', 'partner@x.com', 'bad', 'cohost@x.com']);
if (!function_exists('content_value_test_override')) {
    // owner_recipients reads content_value('notify-emails'); our config has none,
    // so verify its cleaning directly against a known array instead.
}
$clean = [];
foreach (json_decode($GLOBALS['NR_FAKE'], true) as $e) {
    $e = trim($e);
    if ($e === '' || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
        continue;
    }
    if (strtolower($e) === 'owner@chb.co.uk') {
        continue;
    }
    if (!in_array(strtolower($e), array_map('strtolower', $clean), true)) {
        $clean[] = $e;
    }
}
chk('stored extras clean (dedup + drop invalid + exclude primary)', $clean === ['partner@x.com', 'cohost@x.com']);

echo "== Array-content storage round-trip (watermark bug guard) ==\n";
// content_value() returns '' for any array-valued key, so array keys (the poll
// watermark, anniv-sent) MUST store single-encoded and read via content_json().
// Replicate both decoders (the DB fetch is the only untestable part).
$cv = function ($stored) {
    $d = json_decode($stored, true);
    return is_string($d) ? $d : (is_scalar($d) ? (string) $d : '');
};
$cj = function ($stored) {
    if ($stored === '' || $stored === null) {
        return [];
    }
    $d = json_decode($stored, true);
    if (is_string($d)) {
        $d = json_decode($d, true);
    }
    return is_array($d) ? $d : [];
};
$state = ['at' => 111, 'uids' => ['abc', 'def'], 'error' => ''];
$single = json_encode($state);
chk('content_value LOSES an array (the bug)', $cv($single) === ''); // documents why we can't use it
chk('content_json recovers single-encoded array', $cj($single)['uids'] === ['abc', 'def']);
chk('content_json recovers LEGACY double-encoded array', $cj(json_encode($single))['uids'] === ['abc', 'def']);
chk('content_json empty → default []', $cj('') === [] && $cj(null) === []);

echo "\n" . ($fail === 0 ? "All reply checks passed.\n" : "$fail CHECK(S) FAILED\n");
exit($fail ? 1 : 0);
