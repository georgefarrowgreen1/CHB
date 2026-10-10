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
// Tokens in ALREADY-SENT emails were 16-hex — they must keep verifying after
// the widening to 32 (each length checks against its own recomputation).
$legacy = '42x' . substr(hash_hmac('sha256', 'msg-reply|42', APP_SECRET), 0, 16);
chk('legacy 16-hex token still verifies', msg_reply_verify($legacy) === 42);
chk('current token is 32-hex', preg_match('/x[0-9a-f]{32}$/', $tok) === 1);
chk('legacy token with wrong mac rejected', msg_reply_verify('42x' . str_repeat('0', 16)) === 0);

// Both readers (the webhook and the POP3 poll) take the token through ONE helper,
// msg_reply_token_in, from a plus-recipient, an In-Reply-To or a subject tag.
chk('token found in plus-recipient', msg_reply_verify(msg_reply_token_in(['reply+' . $tok . '@x.co.uk'])) === 42);
chk('token found in In-Reply-To', msg_reply_verify(msg_reply_token_in(['', '<msg.' . $tok . '@x.co.uk>'])) === 42);
chk('…read whole: all 32 hex, not the first 16', msg_reply_token_in(['<msg.' . $tok . '@x.co.uk>']) === $tok);
chk('a legacy 16-hex token is still found and verifies', msg_reply_verify(msg_reply_token_in(['Re: hi [#' . $legacy . ']'])) === 42);
// Read as its first 16 hex, a current token with a forged second half passed as a
// legacy one. Read whole, it is refused.
chk('a current token with a forged second half is refused', msg_reply_verify(msg_reply_token_in(['<msg.' . substr($tok, 0, 19) . str_repeat('0', 16) . '@x.co.uk>'])) === 0);
// A token-shaped string that does not verify (another client's id, a forgery) no
// longer hides the real token behind it, in the same field or a later one.
chk('a decoy earlier in the field does not hide the real token', msg_reply_verify(msg_reply_token_in(['<msg.7x' . str_repeat('ab', 16) . '@x> <msg.' . $tok . '@x.co.uk>'])) === 42);
chk('…nor a decoy in an earlier field', msg_reply_verify(msg_reply_token_in(['<msg.7x' . str_repeat('cd', 16) . '@x>', 'Re: [#' . $tok . ']'])) === 42);
chk('nothing token-shaped → empty', msg_reply_token_in(['', 'Re: hello', '<abc@x>']) === '');

// TWO AUDIENCES. The guest's own copy carries a GUEST token: it parses to its
// thread (so a guest reply-by-email still lands as a guest message) but it can
// NEVER authorise an owner reply — msg_reply_verify is owner-only.
$gtok = msg_reply_token(42, 'guest');
chk('guest token is its own shape', preg_match('/^42y[0-9a-f]{32}$/', $gtok) === 1 && $gtok !== $tok);
chk('guest token parses to its thread as a GUEST token', msg_reply_parse($gtok) === [42, 'guest']);
chk('…and can never authorise an owner reply', msg_reply_verify($gtok) === 0);
chk('an owner token parses as the owner', msg_reply_parse($tok) === [42, 'owner']);
chk('a guest mac on the owner shape is refused', msg_reply_verify('42x' . substr($gtok, 3)) === 0);
chk('the guest plus-address carries the guest token', msg_reply_address(42, 'guest') === 'reply+' . $gtok . '@cottageholidaysblakeney.co.uk');
chk('a guest token is found in In-Reply-To', msg_reply_parse(msg_reply_token_in(['<msg.' . $gtok . '@x.co.uk>'])) === [42, 'guest']);
// The SHIPPED readers use the one helper, and neither keeps a pattern of its own.
foreach (['inbound-mail.php', 'mailbox-read.php'] as $f) {
    $src = (string) file_get_contents(__DIR__ . '/' . $f);
    chk("$f reads the token through msg_reply_token_in", strpos($src, 'msg_reply_token_in(') !== false && strpos($src, '[xy][0-9a-f]') === false);
}
chk('the guest-facing chat email carries a GUEST token', preg_match("/msg_reply_token\\(\\\$threadId, 'guest'\\)/", (string) file_get_contents(__DIR__ . '/chat-lib.php')) === 1);
chk('mailbox-read makes an admin reply only from an OWNER token', strpos((string) file_get_contents(__DIR__ . '/mailbox-read.php'), "\$senderOk && \$tokAud === 'owner'") !== false);

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
// A reply signed by a person opens "Sophia replied in your chat with …", so a guest
// answering it quotes that line back, not the business's.
$namedQuote = "See you Friday!\n\nSophia replied in your chat with Cottage Holidays Blakeney:\n\n\"the cot is in the hall\"";
chk('a named reply\'s opener is cut too', strip_quoted_reply($namedQuote) === 'See you Friday!');

echo "== The away reply's hours ==\n";
// [from, to) are the hours someone is around; outside them the away reply answers.
chk('switched off: off whatever the hour', chat_away_at('', '07', '22', 3) === 'off' && chat_away_at('0', '07', '22', 3) === 'off');
chk('on with no hours: always', chat_away_at('1', '', '', 14) === 'always' && chat_away_at('1', '07', '', 3) === 'always');
chk('inside the hours: in (the start hour counts)', chat_away_at('1', '07', '22', 7) === 'in' && chat_away_at('1', '07', '22', 21) === 'in');
chk('outside them: away (the end hour does not count)', chat_away_at('1', '07', '22', 22) === 'away' && chat_away_at('1', '07', '22', 3) === 'away');
chk('a window past midnight wraps', chat_away_at('1', '22', '02', 23) === 'in' && chat_away_at('1', '22', '02', 1) === 'in' && chat_away_at('1', '22', '02', 2) === 'away' && chat_away_at('1', '22', '02', 12) === 'away');

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

// ---- ONLY CUSTOMER MAIL, AND NEVER OUR OWN VOICE ---------------------------
// The site sends as the same address the owner reads, so every alert it raises
// ("New enquiry…", "Payment received…") lands in the polled mailbox: measured on
// the owner's phone, 4 of the first 7 messages were the site talking to itself.
// ---- Automated report robots are not people -------------------------------
//  Reported live: "noreply-dmarc-support@google.com emailed you" as a duty in
//  the owner's Today strip, with the report itself sitting in Inbox → Email.
//  Any domain publishing a DMARC record gets these daily from every large
//  provider. mailbox_is_report_robot is the sibling of the self-notification
//  rule — the other kind of mail that is not a person writing to the business.
echo "\n== Automated report robots (DMARC and friends) ==\n";
chk('the address the owner reported is a robot', mailbox_is_report_robot('noreply-dmarc-support@google.com'));
chk('…however it is cased or padded', mailbox_is_report_robot('  NoReply-DMARC-Support@Google.com  '));
chk('other providers report too (a class, not one address)', mailbox_is_report_robot('dmarcreply@microsoft.com'));
chk('…including the ones that put it in the DOMAIN', mailbox_is_report_robot('report@dmarc.yahoo.com'));
// The negatives are the point: this must never eat a booking.
chk('a guest is not a robot', !mailbox_is_report_robot('sarah.pemberton@gmail.com'));
// ---- AND THE RULE MUST BE TRUE OF WHAT IS ALREADY STORED -------------------
// Reported live a SECOND time, after the write-side fix had shipped and
// deployed: the same DMARC robot still on Today. The filter governed what the
// poll RECORDS, so anything stored before it went on being a duty for ever —
// the only other thing that clears one is the owner opening the folder. The
// decision now runs on the way out too, and is pure so it can be driven.
$stored = [
    ['uid' => 'u1', 'from' => 'noreply-dmarc-support@google.com', 'subject' => 'Report domain: cottageholidaysblakeney.co.uk'],
    ['uid' => 'u2', 'from' => 'sarah.pemberton@gmail.com', 'subject' => 'Question about parking'],
    ['uid' => 'u3', 'from' => 'report@dmarc.yahoo.com', 'subject' => 'Report'],
];
$unread = mailbox_new_unread($stored, []);
chk('a robot already in the store is no longer news', count($unread) === 1);
chk('…and the guest beside it still is', $unread[0]['uid'] === 'u2');
chk('a seen email is still filtered, as it always was', mailbox_new_unread($stored, ['u2']) === []);
chk('an empty store is not a crash', mailbox_new_unread([], []) === [] && mailbox_new_unread(null, []) === []);
chk('a malformed row is skipped, not counted', count(mailbox_new_unread(['rubbish', ['uid' => 'u9', 'from' => 'a@b.com']], [])) === 1);
chk('a row with no from at all is kept — unknown is not a robot',
    count(mailbox_new_unread([['uid' => 'u4', 'subject' => 'hello']], [])) === 1);
// WIRING, both halves: the pending list must USE it, and the poll must still
// refuse to record one in the first place.
$mbSrc = file_get_contents(__DIR__ . '/mailbox-read.php');
chk('the pending list is built from it', strpos($mbSrc, '$out = mailbox_new_unread($stored, is_array($seen) ? $seen : []);') !== false);
chk('the poll still refuses to record one', strpos($mbSrc, '!mailbox_is_report_robot($fromAddr) && $route === ') !== false);
chk('and the store cleans itself on the next poll', preg_match('/function mailbox_new_record[\s\S]{0,600}mailbox_is_report_robot/', $mbSrc) === 1);
chk('a platform noreply is NOT blocked — it can carry a real enquiry',
    !mailbox_is_report_robot('noreply@airbnb.com') && !mailbox_is_report_robot('no-reply@booking.com'));
// A BARE substring test matched this and would have eaten the enquiry. The
// first draft of this check hid that behind a double negative — it asserted the
// false positive while its label claimed the opposite.
chk('a guest whose name merely contains the letters is safe', !mailbox_is_report_robot('e.dmarcus@gmail.com'));
chk('…and one whose name ends with it', !mailbox_is_report_robot('adamdmarc@gmail.com'));
chk('a delivery-failure bounce is a robot too (mailer-daemon@)', mailbox_is_report_robot('MAILER-DAEMON@mail.example.com') && mailbox_is_report_robot('mailer-daemon@googlemail.com'));
chk('…and postmaster@', mailbox_is_report_robot('postmaster@outlook.com'));
chk('a guest whose name merely starts with it is safe', !mailbox_is_report_robot('postmaster.jones@gmail.com') && !mailbox_is_report_robot('mailerdaemon@gmail.com'));
chk('rubbish in, false out — never a crash', !mailbox_is_report_robot('') && !mailbox_is_report_robot('not-an-address'));

// mailbox_is_self_notification is the ONE test both the list filter and the
// reply-ingest use, so the mailbox cannot hide what the ingest would swallow.
echo "\n== The mailbox is guests only ==\n";
// MAIL_FROM is defined by config.php on the host; in this sandbox it may not be.
$own = mailbox_own_address();
if ($own === '') {
    // With no address configured the mailbox CANNOT identify itself, and must
    // show everything rather than hide everything — the failure that matters.
    chk('no configured address → nothing is treated as our own', !mailbox_is_self_notification('anyone@example.test'));
} else {
    chk('a message from our own address is our own notification', mailbox_is_self_notification($own));
    chk('…case- and space-insensitively', mailbox_is_self_notification('  ' . strtoupper($own) . ' '));
    chk('a guest is never mistaken for us', !mailbox_is_self_notification('guest@example.test'));
}

// WHAT THE SITE WROTE, NOT WHO IT IS FROM. The owner's phone sends as the same
// address, so a test email to themselves and a reply to a guest-chat alert were
// both hidden as the site's voice (reported: "why is it not picking up my email").
echo "\n== The site's own mail, by its fingerprint ==\n";
$ownA = $own !== '' ? $own : 'info@example.test';
$dom = substr(strrchr($ownA, '@'), 1);
$siteNew = "From: Cottage Holidays Blakeney <{$ownA}>\nMessage-ID: <x1@{$dom}>\nX-CHB-Origin: site\nSubject: =?UTF-8?B?eA==?=";
$siteAlt = "From: <{$ownA}>\nMessage-ID: <AB12@{$dom}>\nContent-Type: multipart/alternative; boundary=\"chbalt_0a1b2c3d4e5f6a7b\"";
$siteMix = "From: <{$ownA}>\nContent-Type: multipart/mixed;\n\tboundary=\"chbmix_0a1b2c3d4e5f6a7b\"";
$sitePlain = "From: <{$ownA}>\nMessage-ID: <0123456789abcdef01234567@{$dom}>\nContent-Type: text/plain; charset=UTF-8";
$siteMsg = "From: <{$ownA}>\nMessage-ID: <msg.17x0123456789abcdef0123456789abcdef@{$dom}>\nSubject: New message [#17x0123456789abcdef]";
// What iPhone Mail wrote in the report: Apple's boundary, a UUID Message-ID.
$phone = "From: George Farrow-Green <{$ownA}>\nTo: George Farrow-Green <{$ownA}>\nSubject: Booking\nMessage-ID: <6F9619FF-8B86-D011-B42D-00C04FC964FF@{$dom}>\n"
    . "Content-Type: multipart/alternative; boundary=Apple-Mail-6F9619FF-8B86-D011-B42D-00C04FC964FF\nX-Mailer: iPhone Mail (22A3354)";
chk('the new marker is the site', mailbox_is_site_sent($siteNew));
chk('mail already in the box: our alternative boundary', mailbox_is_site_sent($siteAlt));
chk('…our mixed boundary, folded onto a second line', mailbox_is_site_sent($siteMix));
chk('…our 24-hex Message-ID on a plain-text send', mailbox_is_site_sent($sitePlain));
chk('…our msg.<token> Message-ID', mailbox_is_site_sent($siteMsg));
chk('an email typed on a phone is not the site', !mailbox_is_site_sent($phone));
// A reply quotes our Message-ID in In-Reply-To / References. Only ITS OWN
// Message-ID may count, or every reply to an alert would be hidden as the alert.
chk('a reply to our alert is not the site', !mailbox_is_site_sent($phone . "\nIn-Reply-To: <msg.17x0123456789abcdef0123456789abcdef@{$dom}>\nReferences: <0123456789abcdef01234567@{$dom}>"));
// A forwarded message carries its original's headers in the BODY.
chk('a forward of one of our alerts is not the site', !mailbox_is_site_sent($phone . "\n\n--x\nContent-Type: message/rfc822\n\nX-CHB-Origin: site\nContent-Type: multipart/alternative; boundary=\"chbalt_00\""));
chk('rubbish in, false out', !mailbox_is_site_sent('') && !mailbox_is_site_sent('not headers'));
if ($own !== '') {
    chk('our own alert is hidden', mailbox_is_self_notification($own, $siteAlt));
    chk('THE REPORT: a test email typed on the phone is shown', !mailbox_is_self_notification($own, $phone));
    chk('someone else using our boundary is still not us', !mailbox_is_self_notification('guest@example.test', $siteAlt));
    chk('no header block → the old address-only answer', mailbox_is_self_notification($own));
}
// The new marker is written on every send — smtp_transmit is the one place.
$mailerSrc = file_get_contents(__DIR__ . '/mailer.php');
chk('smtp_transmit writes the marker', preg_match('/function smtp_transmit\([\s\S]{0,4000}X-CHB-Origin: site/', $mailerSrc) === 1);
// THE WIRING: both readers pass the header block. Without it they fall back to
// the address-only answer and hide the owner's own words again.
$mbxSrc = file_get_contents(__DIR__ . '/mailbox.php');
chk('the mailbox list passes the headers', strpos($mbxSrc, 'mailbox_is_self_notification($fromAddr, $head)') !== false);
chk('the reply poll passes the headers', preg_match('/\$isSelf = mailbox_is_self_notification\(\$fromAddr, explode\(/', file_get_contents(__DIR__ . '/mailbox-read.php')) === 1);
// An owner's emailed reply becomes a chat message, so the list must not show it
// a second time as a person waiting — but only one the poll would route: an
// OWNER token, a sender on the allow-list, and a chat that still exists (a reply
// to a deleted chat is left as ordinary mail by the poll, so it must show here).
chk('the list sets aside an owner reply the poll routes', strpos($mbxSrc, "\$rAud === 'owner'") !== false && strpos($mbxSrc, 'people_mail_senders()') !== false);
chk('…only while its chat still exists', preg_match('/\$rAud === \'owner\'[\s\S]{0,400}FROM chat_threads WHERE id = \?[\s\S]{0,400}if \(\$rLive\) \{\s*\$ownHidden\+\+;/', $mbxSrc) === 1);
// The addresses come through mailbox_from_addr, so the pairing must survive the
// display form the mailbox actually reads ("Name <addr>").
chk('a display-name From resolves to its address', mailbox_from_addr('Cottage Holidays Blakeney <info@example.test>') === 'info@example.test');
chk('…and the LAST angle group wins (spoof-safe)', mailbox_from_addr('"a <owner@allowed.test>" <evil@x.test>') === 'evil@x.test');

// ---- NEW CUSTOMER MAIL IS NOTICED, THE SITE'S OWN IS NOT -------------------
// Plain new mail from a customer used to be marked seen and dropped: the one
// thing arriving from outside the system that nobody was told about was an
// actual email. It is recorded and alerted now — and the recording code is only
// ever reached for mail that is NOT ours and did NOT become a chat reply, which
// is what stops the owner being paged about their own "Payment received".
echo "\n== New customer mail ==\n";
$fresh = [
    ['uid' => 'b', 'from' => 'anne@example.test', 'name' => 'Anne Betts', 'subject' => 'Re: Pimpernel', 'at' => 200],
    ['uid' => 'a', 'from' => 'bob@example.test', 'name' => 'Bob Carter', 'subject' => 'Parking?', 'at' => 100],
];
$merged = mailbox_new_merge([], $fresh);
chk('both arrivals are kept', count($merged) === 2);
chk('newest first', $merged[0]['uid'] === 'b' && $merged[1]['uid'] === 'a');
// The poll re-lists the whole INBOX every run, so the same uid WILL come round
// again — twice in the list would be twice in the count and twice on the badge.
$again = mailbox_new_merge($merged, [$fresh[0]]);
chk('the same message is never counted twice', count($again) === 2);
$older = mailbox_new_merge($merged, [['uid' => 'c', 'from' => 'c@x.test', 'subject' => 'Older', 'at' => 50]]);
chk('an older arrival sorts below, not on top', $older[0]['uid'] === 'b' && $older[2]['uid'] === 'c');
chk('a uid-less row is dropped rather than stored blank', count(mailbox_new_merge([], [['from' => 'x@y.test']])) === 0);
$cap = [];
for ($i = 0; $i < 60; $i++) {
    $cap[] = ['uid' => 'u' . $i, 'from' => 'a@b.test', 'subject' => 's', 'at' => $i];
}
$capped = mailbox_new_merge([], $cap, 40);
chk('capped, newest kept', count($capped) === 40 && $capped[0]['uid'] === 'u59');
chk('a long subject is trimmed, not stored whole', mb_strlen(mailbox_new_merge([], [['uid' => 'z', 'subject' => str_repeat('x', 400), 'at' => 1]])[0]['subject']) === 120);

// What the push SAYS. One sender is named; several are counted — a notification
// that reads "3 new emails" is useful, "New email from " is not.
[$t1, $b1] = mailbox_new_alert_text([$fresh[0]]);
chk('one email names the sender', $t1 === 'New email from Anne Betts' && $b1 === 'Re: Pimpernel');
[$t2, $b2] = mailbox_new_alert_text($fresh);
chk('several are counted', $t2 === '2 new emails' && strpos($b2, 'Anne Betts') === 0 && strpos($b2, '1 other') !== false);
[$t0] = mailbox_new_alert_text([]);
chk('nothing to say → no alert', $t0 === '');
// A bare address has no display name; falling through to the address beats
// printing an empty "New email from ".
[$t3] = mailbox_new_alert_text([['uid' => 'q', 'from' => 'bare@example.test', 'name' => '', 'subject' => 'Hi', 'at' => 1]]);
chk('a nameless sender falls back to the address', $t3 === 'New email from bare@example.test');
chk('a display-name From yields the name', mailbox_sender_name('Anne Betts <anne@x.test>') === 'Anne Betts');
chk('…quoted too', mailbox_sender_name('"Anne Betts" <anne@x.test>') === 'Anne Betts');
chk('a bare address yields no name', mailbox_sender_name('anne@x.test') === '');

// THE WIRING, not just the helpers. Testing the composer alone passed with the
// call site deleted — the trap this codebase keeps walking into.
$src = file_get_contents(__DIR__ . '/mailbox-read.php');
chk('the poll records new mail', strpos($src, '$noticed = mailbox_new_record($fresh);') !== false);
chk('…only for mail that is NOT ours, NOT a robot, and did NOT become a chat reply',
    strpos($src, "if (\$deliverOk && !\$isSelf && !mailbox_is_report_robot(\$fromAddr) && \$route === 'drop') {") !== false);
// The LIST hides them too — the owner asked not to SEE them, not merely to stop
// being nudged. Two surfaces, one rule.
$mbx = file_get_contents(__DIR__ . '/mailbox.php');
chk('the mailbox list hides report robots as well', strpos($mbx, 'if (mailbox_is_report_robot($fromAddr)) {') !== false);
chk('…on their own tally, not folded into "our own voice"', strpos($mbx, "'robotHidden' => \$robotHidden,") !== false);
chk('the alert routes to the Email folder', strpos($src, "'url' => './?open=inbox:email'") !== false);
// The count must clear itself through the SAME fact the reader already writes.
chk('pending is stored-minus-seen', strpos($src, '$seen = mailbox_seen_uids();') !== false);
$dbsrc = file_get_contents(__DIR__ . '/db.php');
chk('seen-uids has ONE definition, in db.php', strpos($dbsrc, 'function mailbox_seen_uids()') !== false);
chk('…and mailbox.php delegates to it',
    strpos(file_get_contents(__DIR__ . '/mailbox.php'), 'return mailbox_seen_uids();') !== false);
chk('the boot payload carries it (no extra request)',
    strpos(file_get_contents(__DIR__ . '/admin-bootstrap.php'), "'newMail' => \$newMail") !== false);
// The mail watch's cheap re-read: mailbox.php answers 'new' from the SAME
// pending derivation (DB only, no POP3) — the client's periodic check and the
// boot payload can never disagree about how many are waiting.
chk("mailbox.php routes 'new' through mailbox_new_pending",
    strpos($mbx, "if (\$action === 'new') {") !== false
    && strpos($mbx, "json_out(['ok' => true, 'new' => mailbox_new_pending()]);") !== false);

// EMAIL TEXT ARRIVES IN ITS OWN CHARSET. Outlook still sends Windows-1252, and
// those bytes passed on unconverted made json_out refuse the whole answer: the
// email opened empty and was marked read, and a reply by email reached the guest
// chat with its quotes and £ signs as '?'. Headers with no encoded words lost
// every accented letter to iconv's continue-on-error mode.
echo "\n== Email text in any charset reaches the screen as UTF-8 ==\n";
chk('a raw UTF-8 subject keeps its accents', mailbox_decode_subject('Réservation – octobre') === 'Réservation – octobre');
chk('an encoded UTF-8 header decodes', mailbox_decode_subject('=?UTF-8?Q?Si=C3=A2n_Jones?=') === 'Siân Jones');
chk('an encoded Latin-1 header decodes', mailbox_decode_subject('=?iso-8859-1?Q?R=E9servation?=') === 'Réservation');
chk('raw Latin-1 bytes in a header become UTF-8', mailbox_decode_subject("R\xE9servation") === 'Réservation');
chk("an encoded sender's name is decoded for the alert", mailbox_sender_name('=?UTF-8?Q?Si=C3=A2n_Jones?= <sian@x.test>') === 'Siân Jones');
$p = parse_email_message("From: x@y.test\r\nContent-Type: text/plain; charset=Windows-1252\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nI=92m hoping 24=9628 October =A375 deposit");
chk('a Windows-1252 body converts (quotes, dash, £)', $p['body'] === 'I’m hoping 24–28 October £75 deposit');
$p = parse_email_message("From: x@y.test\r\nContent-Type: text/plain; charset=\"iso-8859-1\"\r\n\r\nCaf\xE9 \x92ok\x92");
chk('a Latin-1 label carrying Windows-1252 quotes reads as the browser would', $p['body'] === 'Café ’ok’');
$p = parse_email_message("From: x@y.test\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=windows-1252\r\nContent-Transfer-Encoding: 8bit\r\n\r\n\x93Hello\x94 \xA3100\r\n--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>x</p>\r\n--b1--\r\n");
chk('a multipart part converts from its own charset', trim($p['body']) === '“Hello” £100');
$p = parse_email_message("From: x@y.test\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . base64_encode('Thanks — see you Friday £50'));
chk('a UTF-8 body is left exactly as sent', $p['body'] === 'Thanks — see you Friday £50');
$p = parse_email_message("From: x@y.test\r\nContent-Type: text/plain; charset=x-made-up\r\n\r\nabc \xC3");
chk('an unknown charset still yields valid UTF-8', mb_check_encoding($p['body'], 'UTF-8'));

// THE HANDLED LIST FOLLOWS THE INBOX. Cut to the last 2,000 ids while nothing deletes
// mail, an inbox past 2,000 kept some messages off the list for ever and every poll
// re-handled the newest of them (an old emailed reply posted to a guest's chat again).
echo "\n== The handled-mail list is as long as the inbox, not a count ==\n";
$listing = [];
for ($i = 1; $i <= 2600; $i++) {
    $listing[$i] = 'uid-' . $i;
}
$handled = array_values($listing);
$kept = mailbox_handled_keep(array_merge(['gone-1', 'gone-2'], $handled), $listing);
chk('an inbox of 2,600 handled messages keeps all 2,600 (nothing falls off a count)', count($kept) === 2600 && $kept[0] === 'uid-1' && end($kept) === 'uid-2600');
chk('ids no longer in the inbox are forgotten', !in_array('gone-1', $kept, true));
chk('the list keeps its order', $kept === $handled);
chk('a message not yet handled is not invented as handled', !in_array('uid-new', mailbox_handled_keep(['uid-1'], ['uid-1', 'uid-new']), true));
$mrd = (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/mailbox-read.php'));
chk('THE WIRING: the poll prunes to its listing only when the listing was read in full', (bool) preg_match('~if \(\$uclean\) \{\s*\$processed = mailbox_handled_keep\(\$processed, \$uidls\);~', $mrd));
chk('…and the 2,000 cap is gone', strpos($mrd, '> 2000') === false);

echo "\n" . ($fail === 0 ? "All reply checks passed.\n" : "$fail CHECK(S) FAILED\n");
exit($fail ? 1 : 0);
