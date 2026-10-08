<?php
// ============================================================
//  test-people.php — the rules about who may do what (dev/CI only).
//
//      php test-people.php
//
//  people-lib.php is PURE, so every rule is driven here with no database: the
//  five switches, full access, the session rule, the links, validation, and the
//  POLICY (which area each request needs). The policy fails CLOSED — anything
//  not listed is full access only — and §9 holds that, along with the money
//  hidden inside everyday actions. The real endpoints are gated by
//  test-integration §51.
// ============================================================
error_reporting(E_ALL);
require_once __DIR__ . '/people-lib.php';

$fail = 0;
$pass = 0;
function ppl($name, $cond)
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name\n";
    }
}

$host = ['id' => 2, 'username' => 'sophia', 'name' => 'Sophia Hart', 'full_access' => 0, 'caps' => json_encode(['payments' => true]), 'auth_epoch' => 3, 'removed_at' => null, 'invited_at' => null];
$owner = ['id' => 1, 'username' => 'george', 'name' => 'George', 'full_access' => 1, 'caps' => '', 'auth_epoch' => 0, 'removed_at' => null, 'invited_at' => null];
$legacy = ['id' => 1, 'username' => 'admin', 'password_hash' => 'x']; // a row from before the migration

echo "\n== §1 the five switches ==\n";
ppl('a stored JSON becomes exactly the five booleans', people_caps_norm('{"payments":true,"refunds":1,"junk":true}') === ['payments' => true, 'refunds' => true, 'money' => false, 'prices' => false, 'website' => false]);
ppl('garbage is all off', people_caps_norm('not json') === array_fill_keys(array_keys(PEOPLE_CAPS), false));
ppl('an empty column is all off', !in_array(true, people_caps_norm(''), true));
ppl('a new person starts with Take payments and nothing else', PEOPLE_CAPS_DEFAULT === ['payments' => true, 'refunds' => false, 'money' => false, 'prices' => false, 'website' => false]);

echo "\n== §2 full access ==\n";
ppl('full_access 1 is full', people_is_full($owner));
ppl('full_access 0 is not', !people_is_full($host));
ppl('a row from before people existed is the owner', people_is_full($legacy));

echo "\n== §3 who may use what ==\n";
ppl('full access may use everything', people_can($owner, 'owner') && people_can($owner, 'refunds') && people_can($owner, 'all'));
ppl('a limited person has the everyday work', people_can($host, 'all'));
ppl('…and the areas switched on (payments)', people_can($host, 'payments'));
ppl('…and not those switched off (refunds, money)', !people_can($host, 'refunds') && !people_can($host, 'money'));
ppl('…and never full-access things', !people_can($host, 'owner'));
ppl('an unknown area is refused, never guessed', !people_can($host, 'banana'));
ppl('a removed person may use nothing, not even the everyday', !people_can(['removed_at' => '2026-10-01 10:00:00'] + $host, 'all'));
ppl('a removed OWNER may use nothing either', !people_can(['removed_at' => '2026-10-01 10:00:00'] + $owner, 'all'));

echo "\n== §4 a session is good until the row says otherwise ==\n";
ppl('the same epoch is good', people_session_ok($host, 3));
ppl('a bumped epoch signs the session out (removed, or a reset)', !people_session_ok($host, 2));
ppl('a removed person is signed out', !people_session_ok(['removed_at' => '2026-10-01'] + $host, 3));
ppl('someone still invited has no session', !people_session_ok(['invited_at' => '2026-10-01'] + $host, 3));
ppl('a row from before the migration keeps its session (no epoch to compare)', people_session_ok($legacy, 0));

echo "\n== §5 names ==\n";
ppl('the name as given', people_display_name($host) === 'Sophia Hart' && people_first_name($host) === 'Sophia');
ppl('no name yet: the username, never the host on the cottage pages', people_display_name($legacy) === 'Admin');
ppl('the refusal names who to ask', people_refusal('George') === 'That’s for George to change.');
ppl('…and someone, when nobody can be named', people_refusal('') === 'That’s for the owner to change.');

echo "\n== §6 validation, in words ==\n";
ppl('a name is needed', people_name_problem('  ') === 'Enter their name.' && people_name_problem('Sophia') === '');
ppl('an email has to look like one', people_email_problem('sophia@') !== '' && people_email_problem('sophia@example.com') === '');
ppl('a username is lower-case letters and digits (no @)', people_username_problem('sophia') === '' && people_username_problem('So@phia') !== '' && people_username_problem('ab') !== '');
ppl('a password is long, and the two match', people_password_problem('short') !== '' && people_password_problem('a long passphrase', 'different one!!') === 'Those two don’t match. Type it again.' && people_password_problem('a long passphrase', 'a long passphrase') === '');

echo "\n== §7 usernames from names ==\n";
ppl('from a name', people_username_from('Sophia Hart', []) === 'sophiahart');
ppl('made unique against those taken', people_username_from('Sophia Hart', ['sophiahart', 'SophiaHart2']) === 'sophiahart3');
ppl('accents are kept as letters', people_username_from('Zoë Brontë', []) === 'zoebronte');
ppl('a very short name still makes a valid one', people_username_problem(people_username_from('Al', [])) === '');

echo "\n== §8 invite and reset links ==\n";
$tok = str_repeat('ab', 24);
ppl('a link parses to id + token', people_link_parse('7.' . $tok) === ['id' => 7, 'token' => $tok]);
ppl('anything else is refused', people_link_parse('7.' . substr($tok, 1)) === null && people_link_parse('x.' . $tok) === null && people_link_parse(['7']) === null);
$inv = ['invite_hash' => hash('sha256', $tok), 'invite_expires' => '2026-10-10 10:00:00', 'invited_at' => '2026-10-03 10:00:00'] + $host;
$now = strtotime('2026-10-05 10:00:00');
ppl('a live invite works', people_link_ok($inv, $tok, 'invite', $now));
ppl('…not with the wrong token', !people_link_ok($inv, str_repeat('cd', 24), 'invite', $now));
ppl('…not once it has expired', !people_link_ok($inv, $tok, 'invite', strtotime('2026-10-11 10:00:00')));
ppl('…not once they have chosen a password', !people_link_ok(['invited_at' => null] + $inv, $tok, 'invite', $now));
ppl('…not for someone removed', !people_link_ok(['removed_at' => '2026-10-04'] + $inv, $tok, 'invite', $now));
$rst = ['reset_hash' => hash('sha256', $tok), 'reset_expires' => '2026-10-05 10:20:00'] + $host;
ppl('a reset link works for someone with a password', people_link_ok($rst, $tok, 'reset', $now));
ppl('…and never as an invite (each link is its own kind)', !people_link_ok($rst, $tok, 'invite', $now));

echo "\n== §9 the policy: which area each request needs ==\n";
$c = fn($f, $a, $in = []) => people_cap_for($f, $a, $in);
ppl('an endpoint nobody listed is full access only (fails CLOSED)', $c('brand-new.php', 'anything') === 'owner');
ppl('an action nobody listed is full access only', $c('bookings.php', 'something_new') === 'owner');
ppl('People & access is full access only', $c('people.php', 'list') === 'owner' && $c('people.php', 'invite') === 'owner');
ppl('set-up and system are full access only', $c('diagnostics.php', 'run') === 'owner' && $c('backup.php', 'run') === 'owner' && $c('migrate.php', '') === 'owner' && $c('square-setup.php', 'setup') === 'owner' && $c('nightshift.php', 'chat_send') === 'owner' && $c('activity-log.php', 'list') === 'owner');
ppl('the everyday: bookings, enquiries, messages, email, key safes, guests', $c('bookings.php', '') === 'all' && $c('bookings.php', 'update') === 'all' && $c('enquiries.php', 'decline') === 'all' && $c('messages.php', 'send') === 'all' && $c('mailbox.php', 'send') === 'all' && $c('keysafe.php', 'confirm') === 'all' && $c('auth.php', 'guest_crm') === 'all');
ppl('your own sign-in is always yours', $c('auth.php', 'admin_change_password') === 'all' && $c('passkeys.php', 'admin_register_begin') === 'all' && $c('auth.php', 'admin_notify_set') === 'all');
ppl('asking for money is Take payments', $c('bookings.php', 'request_payment') === 'payments' && $c('bookings.php', 'set_payment') === 'payments' && $c('bookings.php', 'set_payment_plan') === 'payments' && $c('messages.php', 'send_balance') === 'payments');
ppl('money going back is Refunds and deposits', $c('bookings.php', 'refund') === 'refunds' && $c('bookings.php', 'return_deposit') === 'refunds' && $c('bookings.php', 'keep_deposit') === 'refunds' && $c('bookings.php', 'confirm_return_settled') === 'refunds');
ppl('the Payments screens are Money overview', $c('accounts.php', '') === 'money' && $c('expenses.php', 'add') === 'money' && $c('bookings.php', 'recent_payments') === 'money');
ppl('prices and cottages', $c('rates.php', 'save') === 'prices' && $c('rates.php', 'create') === 'prices' && $c('ical-import.php', 'save_feeds') === 'prices' && $c('pricing-suggest.php', '') === 'prices');
ppl('website and marketing', $c('experiences.php', 'save') === 'website' && $c('newsletter.php', 'broadcast') === 'website' && $c('optimize-hero.php', 'optimize') === 'website');
ppl('blocking dates on the calendar is everyday; changing the feeds is not', $c('ical-import.php', 'add_block') === 'all' && $c('ical-import.php', 'save_feeds') === 'prices');
// The money hidden inside everyday actions.
ppl('approving an enquiry is everyday…', $c('enquiries.php', 'approve', []) === 'all');
ppl('…but approving it with an agreed price or plan is Take payments', $c('enquiries.php', 'approve', ['price_override' => '540']) === 'payments' && $c('enquiries.php', 'approve', ['deposit_pct' => 30]) === 'payments');
ppl('agreeing an enquiry\'s terms is Take payments', $c('enquiries.php', 'set_terms') === 'payments');
ppl('an email with a pay button is asking for money', $c('bookings.php', 'email_guest', ['buttons' => ['pay']]) === 'payments' && $c('bookings.php', 'email_guest', ['buttons' => ['invoice']]) === 'all');

echo "\n== §10 content keys ==\n";
$k = fn($key) => people_content_cap($key);
ppl('the host card, saved replies and guest chat are everyday', $k('host-name') === 'all' && $k('host-photo') === 'all' && $k('contact-phone') === 'all' && $k('email-templates') === 'all' && $k('chat-away-msg') === 'all' && $k('chat-ans-wifi') === 'all');
ppl('what the back office remembers as you work is everyday', $k('duty-dismissed') === 'all' && $k('search-pins') === 'all' && $k('nlu-learned') === 'all');
ppl('the home page and its menu are the website', $k('hero-title') === 'website' && $k('nav-home') === 'website' && $k('card1-title') === 'website' && $k('card-img-annex') === 'website' && $k('site-logo') === 'website');
ppl('terms-title is the website, not a cottage text', $k('terms-title') === 'website');
ppl('cottage pages, rules and rates are prices and cottages', $k('rules-21a') === 'prices' && $k('jollyboat-desc') === 'prices' && $k('images-pimpernel') === 'prices' && $k('21a-cancellation-policy') === 'prices' && $k('pricing-limits') === 'prices' && $k('ops-21a') === 'prices');
ppl('payment plans are Take payments; moving money out is Money overview', $k('plan-presets') === 'payments' && $k('sweep-moved') === 'money');
ppl('secrets and set-up are full access only', $k('bacs-details') === 'owner' && $k('apikey-tides') === 'owner' && $k('backup-passphrase') === 'owner' && $k('square-deposit-pct') === 'owner' && $k('night-shift') === 'owner' && $k('notify-emails') === 'owner');
ppl('a key nobody listed is full access only', $k('something-new') === 'owner');
ppl('a write to content.php is decided by its key', people_cap_for('content.php', 'set', ['key' => 'bacs-details']) === 'owner' && people_cap_for('content.php', 'set', ['key' => 'host-bio']) === 'all');
ppl('reading: a limited person sees the switches the everyday screens need…', people_content_readable($host, 'arrival-review') && people_content_readable($host, 'mailbox-new'));
ppl('…and never a secret', !people_content_readable($host, 'bacs-details') && !people_content_readable($host, 'backup-passphrase') && !people_content_readable($host, 'apikey-twilio-sid') && !people_content_readable($host, 'sweep-balance'));
ppl('full access reads everything', people_content_readable($owner, 'bacs-details'));
ppl('uploads go by where they land', people_upload_cap('host-photo') === 'all' && people_upload_cap('gallery-21a') === 'prices' && people_upload_cap('content-hero-bg') === 'website' && people_upload_cap('') === 'owner');

echo "\n== §11 the table stays true to the files ==\n";
$stale = [];
$typos = [];
foreach (PEOPLE_POLICY as $file => $map) {
    $src = @file_get_contents(__DIR__ . '/' . $file);
    if ($src === false) {
        $stale[] = $file;
        continue;
    }
    foreach ($map as $action => $_) {
        if ($action === '' || $action === '*') {
            continue;
        }
        if (strpos($src, "'" . $action . "'") === false) {
            $typos[] = "$file:$action";
        }
    }
}
ppl('every file in the policy exists' . ($stale ? ' — missing: ' . implode(', ', $stale) : ''), !$stale);
ppl('every action in the policy is an action its file names' . ($typos ? ' — not found: ' . implode(', ', $typos) : ''), !$typos);
ppl('the policy covers at least 25 endpoints (vacuity guard)', count(PEOPLE_POLICY) >= 25);
// The WIRING: the rules only matter if the gate every endpoint passes asks them.
$db = (string) file_get_contents(__DIR__ . '/db.php');
$ra = substr($db, (int) strpos($db, 'function require_admin()'), 1200);
ppl('require_admin() ends by asking people_enforce()', strpos($ra, 'people_enforce();') !== false);
$pe = substr($db, (int) strpos($db, 'function people_enforce()'), 1600);
ppl('people_enforce() checks EVERY place an action can come from (body, query, form)', strpos($pe, "\$in['action']") !== false && strpos($pe, "\$_GET['action']") !== false && strpos($pe, "\$_POST['action']") !== false);
ppl('…and leaves full access alone', strpos($pe, 'people_is_full($me)') !== false);
$bk = (string) file_get_contents(__DIR__ . '/bookings.php');
ppl('a booking edit drops the money for someone without Take payments', substr_count($bk, 'people_strip_money($in);') === 2);
$cancel = substr($bk, (int) strpos($bk, "if (\$action === 'cancel') {"), 3200);
ppl('a cancellation that refunds asks for Refunds and deposits', strpos($cancel, "require_cap('refunds');") !== false);

echo "\n== §12 who gets which emails ==\n";
// Each person chooses which kinds reach them; an area switched off takes its
// emails with it; an invite reaches no one; and an email that must reach someone
// can't lose its last person.
$allMail = array_fill_keys(array_keys(PEOPLE_MAILS), true);
ppl('someone with full access gets everything by default (how it worked before people)', people_mail_norm($owner) === $allMail);
ppl('…and so does a row from before the migration', people_mail_norm($legacy) === $allMail);
ppl('a new limited person starts with the guest-facing emails', people_mail_norm($host) === PEOPLE_MAIL_LIMITED);
ppl('a stored choice wins over the default', people_mail_norm(['mail_prefs' => json_encode(['booking' => false])] + $owner)['booking'] === false && people_mail_norm(['mail_prefs' => json_encode(['booking' => false])] + $owner)['enquiry'] === true);
ppl('garbage in the column is the defaults', people_mail_norm(['mail_prefs' => 'not json'] + $host) === PEOPLE_MAIL_LIMITED);
ppl('payment emails follow Take payments', people_mail_can($host, 'paid') === true && people_mail_can(['caps' => json_encode(['payments' => false])] + $host, 'paid') === false);
ppl('website emails need Website and marketing', people_mail_can($host, 'ideas') === false && people_mail_can($host, 'analytics') === false && people_mail_can(['caps' => json_encode(['website' => true])] + $host, 'analytics') === true);
ppl('the backup is full access only', people_mail_can($host, 'backup') === false && people_mail_can($owner, 'backup') === true);
ppl('an unknown kind is nobody\'s', people_mail_can($owner, 'nonsense') === false);
$hostAll = ['mail_prefs' => json_encode($allMail)] + $host;
ppl('a choice for an area switched off does not reach them (and comes back when it is switched on)', people_mail_gets($hostAll, 'ideas') === false && people_mail_gets(['caps' => json_encode(['website' => true])] + $hostAll, 'ideas') === true);
ppl('an invite reaches no one yet', people_mail_gets(['invited_at' => '2026-10-01 09:00:00'] + $owner, 'enquiry') === false);
ppl('a removed person gets nothing', people_mail_gets(['removed_at' => '2026-10-01 09:00:00'] + $owner, 'enquiry') === false);
ppl('the lock says which switch, on whose page', people_mail_lock($host, 'ideas') === 'Sophia can’t get this yet. Switch on Website and marketing on Sophia’s page first.');
ppl('…and why the backup is locked', people_mail_lock($host, 'backup') === 'Only someone with full access gets the backup. It’s everything on the site.');
ppl('…and nothing is locked that can be had', people_mail_lock($host, 'enquiry') === '');
// The must rule.
$ownerOff = ['mail_prefs' => json_encode(['enquiry' => false] + $allMail)] + $owner;
ppl('the last person on new enquiries can\'t be switched off', people_mail_must_problem([$owner, ['mail_prefs' => json_encode(['enquiry' => false])] + $host], 1, 'enquiry') === 'Someone has to get new enquiries — a guest is waiting for a reply.');
ppl('…but can once someone else gets them', people_mail_must_problem([$owner, $host], 1, 'enquiry') === '');
ppl('…and an invite does not count as someone', people_mail_must_problem([$owner, ['invited_at' => '2026-10-01 09:00:00'] + $host], 1, 'enquiry') !== '');
ppl('guest messages and the backup must reach someone too', people_mail_must_problem([$owner], 1, 'messages') !== '' && people_mail_must_problem([$owner, $host], 1, 'backup') === 'Someone has to get the backup — it’s the copy that lives off the host.');
ppl('an email that need not reach anyone can lose its last person', people_mail_must_problem([$owner], 1, 'analytics') === '' && people_mail_must_problem([$ownerOff], 1, 'booking') === '');
$pay = people_mail_payload($host);
ppl('the payload: choices, what may be had, what reaches them', $pay['mail'] === PEOPLE_MAIL_LIMITED && $pay['mailCan']['backup'] === false && $pay['mailCan']['enquiry'] === true && in_array('enquiry', $pay['mailGets'], true) && !in_array('ideas', $pay['mailGets'], true));
ppl('the kinds travel in page order with their areas', array_column(people_mail_kinds(), 'k') === array_keys(PEOPLE_MAILS) && people_mail_kinds()[0] === ['k' => 'enquiry', 'cap' => 'all', 'must' => true]);
// The WIRING: every sender names its kind (a sender left on send_owner reaches
// only the people with full access).
$mailer = (string) file_get_contents(__DIR__ . '/mailer.php');
$wired = [
    ['mailer.php', "send_people('enquiry',"], ['mailer.php', "send_people('booking',"], ['mailer.php', "send_people('paid',"],
    ['chat-lib.php', "send_people('messages',"], ['messages.php', "send_people('messages',"], ['reviews.php', "send_people('reviews',"],
    ['leads.php', "send_people('reviews',"], ['experiences.php', "send_people('ideas',"], ['owner-digest.php', "send_people('digest',"],
    ['weekly-analytics.php', "send_people('analytics',"], ['backup.php', "send_people('backup',"],
];
$unwired = [];
foreach ($wired as [$f, $needle]) {
    if (strpos((string) file_get_contents(__DIR__ . '/' . $f), $needle) === false) {
        $unwired[] = "$f ($needle)";
    }
}
ppl('every back-office email names its kind' . ($unwired ? ' — missing: ' . implode(', ', $unwired) : ''), !$unwired);
$replyWired = [];
foreach (['inbound-mail.php', 'mailbox-read.php'] as $f) {
    $src = (string) file_get_contents(__DIR__ . '/' . $f);
    if (strpos($src, 'people_mail_senders()') === false || strpos($src, "chat_admin_reply(") === false || strpos($src, "people_mail_sender_row(\$fromAddr)") === false || strpos($src, "'admin:' . (int) \$who['id']") === false) {
        $replyWired[] = $f;
    }
}
ppl('a reply by email may come from anyone with a sign-in, and is credited to them' . ($replyWired ? ' — not in: ' . implode(', ', $replyWired) : ''), !$replyWired);
$od = (string) file_get_contents(__DIR__ . '/owner-digest.php');
ppl('the digest is composed without the money for someone without Money overview', strpos($od, "people_can(\$row, 'money')") !== false && strpos($od, "'noMoney' => true") !== false);
ppl('a digest asked for from the back office goes only to whoever asked, and does not stop Monday\'s', strpos($od, 'people_mail_only(admin_contact_email(admin_me()))') !== false && strpos($od, "people_mail_only() === ''") !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PEOPLE CHECK(S) FAILED ❌\n";
    exit(1);
}
echo "  ALL $pass PEOPLE CHECKS PASSED ✅\n";
