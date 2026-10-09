<?php
// ============================================================
//  people-lib.php — the rules about the people who sign in to the back office.
//  PURE: no database, no session, no clock beyond what is passed in, so
//  test-people.php drives every rule directly. db.php requires it.
//
//  Someone with full access can do everything, including People & access. Anyone
//  else always has the everyday work (bookings and the calendar, enquiries,
//  messages and email, key safes, guests and reviews) plus the areas the owner
//  switches on for them. Each request is checked against those switches on the
//  server (people_cap_for → people_can), so an old link or a stray tap gets a
//  sentence instead of the screen.
// ============================================================

// The five switches, in the order the person page shows them.
const PEOPLE_CAPS = [
    'payments' => ['Take payments', 'Send payment requests and record cash or bank payments'],
    'refunds' => ['Refunds and deposits', 'Give money back: refunds, and returning or keeping deposits'],
    'money' => ['Money overview', 'The Payments screens: what’s owed, income and tax, moving money out'],
    'prices' => ['Prices and cottages', 'Rates, seasons, pricing ideas, cottage pages and calendar sync'],
    'website' => ['Website and marketing', 'Home page, things to do, newsletter and analytics'],
];
// A new person starts with the everyday work and taking payments.
const PEOPLE_CAPS_DEFAULT = ['payments' => true, 'refunds' => false, 'money' => false, 'prices' => false, 'website' => false];

// The switches as stored (JSON) or given, as exactly the five booleans.
function people_caps_norm($v)
{
    if (is_string($v)) {
        $v = $v === '' ? [] : json_decode($v, true);
    }
    $out = [];
    foreach (PEOPLE_CAPS as $k => $_) {
        $out[$k] = is_array($v) && isset($v[$k]) ? (bool) $v[$k] : false;
    }
    return $out;
}

// Full access: everything, including adding and removing people. A row from
// before people existed has no column and is the owner.
function people_is_full($row)
{
    return is_array($row) && (!array_key_exists('full_access', $row) || (int) $row['full_access'] === 1);
}

// May this person use this area? 'all' is the everyday work, 'owner' is full
// access only, anything else is one of the five switches.
function people_can($row, $cap)
{
    if (!is_array($row) || !empty($row['removed_at'])) {
        return false;
    }
    if (people_is_full($row) || $cap === 'all') {
        return true;
    }
    if ($cap === 'owner' || !isset(PEOPLE_CAPS[$cap])) {
        return false;
    }
    return people_caps_norm($row['caps'] ?? '')[$cap];
}

// Is a session minted under $epoch still good for this row?
function people_session_ok($row, $epoch)
{
    if (!is_array($row)) {
        return false;
    }
    if (!empty($row['removed_at']) || !empty($row['invited_at'])) {
        return false;
    }
    return !array_key_exists('auth_epoch', $row) || (int) $row['auth_epoch'] === (int) $epoch;
}

// The person's name as the back office shows it. A first owner who has not set
// a name yet is shown by their username rather than a guess.
function people_display_name($row)
{
    $n = trim((string) ($row['name'] ?? ''));
    if ($n !== '') {
        return $n;
    }
    $u = trim((string) ($row['username'] ?? ''));
    return $u !== '' ? ucfirst($u) : 'Someone';
}
function people_first_name($row)
{
    $parts = preg_split('/\s+/', people_display_name($row));
    return $parts && $parts[0] !== '' ? $parts[0] : 'Someone';
}

// The refusal a limited person reads.
function people_refusal($ownerFirst)
{
    $o = trim((string) $ownerFirst);
    return 'That’s for ' . ($o !== '' ? $o : 'the owner') . ' to change.';
}

// ---- Validation, said in words ----
function people_name_problem($name)
{
    $n = trim((string) $name);
    if ($n === '') {
        return 'Enter their name.';
    }
    if (mb_strlen($n) > 60) {
        return 'That name is too long.';
    }
    return '';
}
function people_email_problem($email)
{
    $e = trim((string) $email);
    if ($e === '' || !filter_var($e, FILTER_VALIDATE_EMAIL) || mb_strlen($e) > 190) {
        return 'That doesn’t look like an email address.';
    }
    return '';
}
// A username is what you type to sign in: letters, digits, dots, dashes and
// underscores, 3 to 40 of them, and never an @ (an @ means an email).
function people_username_problem($u)
{
    $u = (string) $u;
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,39}$/', $u)) {
        return 'Use 3 to 40 lower-case letters or numbers (dots, dashes and underscores are fine).';
    }
    return '';
}
// A username from a name, made unique against those already taken.
function people_username_from($name, array $taken)
{
    $base = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', (string) $name) ?: ''));
    if (strlen($base) < 3) {
        $base = 'host' . $base;
    }
    $base = substr($base, 0, 36);
    $taken = array_map('strtolower', $taken);
    $u = $base;
    for ($i = 2; in_array($u, $taken, true); $i++) {
        $u = $base . $i;
    }
    return $u;
}
// A password a person chooses: long is the only rule (a short phrase they will
// remember beats "Passw0rd!").
function people_password_problem($pw, $again = null)
{
    if (strlen((string) $pw) < 12) {
        return 'Use at least 12 characters. A short phrase you’ll remember works well.';
    }
    if ($again !== null && (string) $again !== (string) $pw) {
        return 'Those two don’t match. Type it again.';
    }
    return '';
}

// ---- Links: an invite (7 days) and a password reset (30 minutes) ----
// The link carries "<id>.<token>"; only sha256(token) is stored.
function people_link_parse($s)
{
    if (!is_string($s) || !preg_match('/^(\d{1,9})\.([a-f0-9]{48})$/', $s, $m)) {
        return null;
    }
    return ['id' => (int) $m[1], 'token' => $m[2]];
}
function people_link_ok($row, $token, $kind, $now)
{
    if (!is_array($row) || !is_string($token) || $token === '') {
        return false;
    }
    $hash = (string) ($row[$kind . '_hash'] ?? '');
    $exp = strtotime((string) ($row[$kind . '_expires'] ?? '')) ?: 0;
    if ($hash === '' || $exp <= $now || !hash_equals($hash, hash('sha256', $token))) {
        return false;
    }
    if (!empty($row['removed_at'])) {
        return false;
    }
    // An invite is only for someone still waiting to choose a password; a reset
    // only for someone who has one.
    return $kind === 'invite' ? !empty($row['invited_at']) : empty($row['invited_at']);
}

// What one person looks like to the back office (never a hash or a token).
function people_public($row, $viewerId = 0)
{
    $state = !empty($row['removed_at']) ? 'removed' : (!empty($row['invited_at']) ? 'invited' : 'active');
    return [
        'id' => (int) ($row['id'] ?? 0),
        'name' => people_display_name($row),
        'first' => people_first_name($row),
        'named' => trim((string) ($row['name'] ?? '')) !== '',
        'email' => (string) ($row['email'] ?? ''),
        'username' => (string) ($row['username'] ?? ''),
        'full' => people_is_full($row),
        'caps' => people_caps_norm($row['caps'] ?? ''),
        'photo' => preg_match('/^[a-f0-9]{32}\.jpg$/', (string) ($row['photo'] ?? '')) ? substr((string) $row['photo'], 0, 10) : '',
        'state' => $state,
        'you' => (int) ($row['id'] ?? 0) === (int) $viewerId,
        'seen' => (string) ($row['last_seen_at'] ?? ''),
        'invited' => (string) ($row['invited_at'] ?? ''),
        'removed' => (string) ($row['removed_at'] ?? ''),
    ];
}

// ---- The policy: which area each request needs ----
// Every back-office request is 'all' (the everyday work), one of the five
// switches, or 'owner' (full access only). A file or action NOT listed is
// 'owner': a new endpoint is closed to a limited person until someone decides
// otherwise, which is the safe way round. '' is a request with no action (most
// endpoints' GET list); '*' covers every action of a file.
const PEOPLE_POLICY = [
    // The day-to-day work.
    'admin-bootstrap.php' => ['*' => 'all'],
    'avatar.php' => ['*' => 'all'],
    'chat-upload.php' => ['*' => 'all'],
    'customers.php' => ['directory' => 'all', 'audit' => 'all'],
    'keysafe.php' => ['state' => 'all', 'confirm' => 'all', 'set_enabled' => 'all'],
    'mailbox.php' => ['new' => 'all', 'list' => 'all', 'read' => 'all', 'attachment' => 'all', 'mark_unread' => 'all', 'sent' => 'all', 'send' => 'all', 'delete' => 'all', 'delete_sent' => 'all'],
    'my-bookings.php' => ['*' => 'all'], // the read-only preview of a guest's account
    'search.php' => ['*' => 'all'],
    'watchers.php' => ['list' => 'all', 'set' => 'all', 'stop' => 'all'],
    'waitlist.php' => ['' => 'all', 'list' => 'all', 'notify' => 'all', 'delete' => 'all'],
    'photos.php' => ['list_admin' => 'all', 'approve' => 'all', 'reject' => 'all', 'delete' => 'all'],
    'reviews.php' => ['list_admin' => 'all', 'set_status' => 'all', 'delete' => 'all'],
    'leads.php' => ['list' => 'all', 'set_status' => 'all', 'rate_guest' => 'all', 'delete' => 'all'],
    'messages.php' => [
        '' => 'all', 'threads' => 'all', 'thread' => 'all', 'typing' => 'all', 'send' => 'all', 'unread' => 'all',
        'mark_all_read' => 'all', 'archive' => 'all', 'unarchive' => 'all', 'delete' => 'all', 'send_arrival' => 'all',
        'send_balance' => 'payments',
    ],
    'ical-import.php' => ['sync' => 'all', 'blocks' => 'all', 'add_block' => 'all', 'delete_block' => 'all', 'list' => 'all', 'overview' => 'all', 'save_feeds' => 'prices'],
    'enquiries.php' => [
        '' => 'all', 'submit' => 'all', 'declined' => 'all', 'seen' => 'all', 'decline' => 'all', 'restore' => 'all', 'undecline' => 'all', 'delete' => 'all',
        'approve_preview' => 'all', 'approve' => 'all', 'email_preview' => 'all', 'email_guest' => 'all',
        'set_terms' => 'payments',
    ],
    'bookings.php' => [
        '' => 'all', 'delete' => 'all', 'add' => 'all', 'update' => 'all', 'set_notes' => 'all', 'send_arrival' => 'all',
        'arrival_preview' => 'all', 'send_confirmation' => 'all', 'email_preview' => 'all', 'email_guest' => 'all',
        'rate_guest' => 'all', 'cancel' => 'all', 'email_logs' => 'all', 'hub_bundle' => 'all', 'history' => 'all',
        'email_render' => 'all', 'deposit_card' => 'all', 'deposit_returns' => 'all', 'payments' => 'all',
        // Taking payments: asking for money and recording money that came in.
        'set_payment' => 'payments', 'request_payment' => 'payments', 'set_payment_plan' => 'payments', 'pay_link' => 'payments',
        'hold_capture' => 'payments', 'record_square_payment' => 'payments',
        // Money going back out.
        'refund' => 'refunds', 'return_deposit' => 'refunds', 'keep_deposit' => 'refunds', 'confirm_return_settled' => 'refunds',
        'hold_release' => 'refunds',
        // The Payments screens.
        'recent_payments' => 'money',
    ],
    'auth.php' => [
        // Your own sign-in and details.
        'admin_status' => 'all', 'admin_logout' => 'all', 'admin_reauth_password' => 'all', 'admin_change_password' => 'all',
        'admin_me_set' => 'all', 'admin_email_begin' => 'all', 'admin_email_finish' => 'all', 'admin_twofa_set' => 'all',
        'admin_avatar_set' => 'all', 'admin_avatar_remove' => 'all', 'admin_notify_set' => 'all',
        // Guests.
        'guest_list' => 'all', 'guest_send_reset' => 'all', 'guest_crm' => 'all', 'guest_reinvite' => 'all',
    ],
    'passkeys.php' => [
        'admin_register_begin' => 'all', 'admin_register_finish' => 'all', 'admin_reauth_begin' => 'all', 'admin_reauth_finish' => 'all',
        'admin_list' => 'all', 'admin_delete' => 'all',
    ],
    'push.php' => ['subscribe_admin' => 'all', 'unsubscribe_admin' => 'all', 'test_admin' => 'all'],
    // The Payments screens.
    'accounts.php' => ['*' => 'money'],
    'money.php' => ['*' => 'money'],
    'expenses.php' => ['*' => 'money'],
    'square-setup.php' => ['payouts_refresh' => 'money'],
    // Prices and cottages.
    'rates.php' => ['*' => 'prices'],
    'pricing-suggest.php' => ['*' => 'prices'],
    // Website and marketing.
    'experiences.php' => ['*' => 'website'],
    'newsletter.php' => ['*' => 'website'],
    'optimize-hero.php' => ['*' => 'website'],
    'track.php' => ['*' => 'website'],
];

// The area one request needs. $in is the request's parameters, for the few
// actions whose money parts decide it (the endpoint re-checks those it can only
// judge against the stored row, e.g. a booking edit or a cancellation's refund).
function people_cap_for($file, $action, array $in = [])
{
    $file = (string) $file;
    $action = (string) $action;
    if ($file === 'content.php') {
        // get_all is filtered to what the person may read (content.php); a write is
        // decided by its key.
        if ($action === 'get_all' || $action === '') {
            return 'all';
        }
        return people_content_cap((string) ($in['key'] ?? ''));
    }
    if ($file === 'upload.php') {
        return people_upload_cap((string) ($in['slot'] ?? ''));
    }
    // Pulling guests' emailed replies into their threads is the everyday Inbox;
    // the mailbox's read-only diagnosis is the System check.
    if ($file === 'mailbox-read.php') {
        return !empty($in['debug']) ? 'owner' : 'all';
    }
    // An enquiry approved WITH an agreed price or plan is a money decision.
    if ($file === 'enquiries.php' && $action === 'approve') {
        foreach (['price_override', 'deposit_pct', 'deposit_amount', 'balance_due_date'] as $k) {
            if (isset($in[$k]) && $in[$k] !== '' && $in[$k] !== null && $in[$k] !== false) {
                return 'payments';
            }
        }
        return 'all';
    }
    // A pay button in an email is asking for money.
    if (($file === 'bookings.php' || $file === 'enquiries.php') && $action === 'email_guest') {
        $btn = $in['buttons'] ?? ($in['button'] ?? []);
        $btn = is_array($btn) ? $btn : [$btn];
        return in_array('pay', array_map('strval', $btn), true) ? 'payments' : 'all';
    }
    $map = PEOPLE_POLICY[$file] ?? null;
    if ($map === null) {
        return 'owner';
    }
    if (isset($map[$action])) {
        return $map[$action];
    }
    return $map['*'] ?? 'owner';
}

// ---- Content keys: who may change (and read the private or internal ones) ----
function people_content_cap($key)
{
    $k = (string) $key;
    // Website and marketing: the home page, its cards and the menu.
    if (in_array($k, ['site-logo', 'hero-bg', 'terms-title'], true) || preg_match('/^(hero|nav|mnav)-/', $k) || preg_match('/^card(\d+-|-title-|-meta-|-img-)/', $k)) {
        return 'website';
    }
    // The everyday: the host card, saved replies, guest chat, reviews, and what
    // the back office itself remembers as you work (dismissed duties, search).
    $everyday = [
        'host-name', 'host-badge', 'host-years', 'host-school', 'host-work', 'host-bio', 'host-photo', 'contact-phone',
        'email-templates', 'reviews', 'google-review-url',
        'duty-dismissed', 'inbox-state', 'search-pins', 'search-undo', 'nlu-learned', 'nlu-suppressed', 'search-misses', 'search-canon', 'guest-faq-misses',
    ];
    if (in_array($k, $everyday, true) || preg_match('/^chat-(away|ans)-/', $k)) {
        return 'all';
    }
    if ($k === 'plan-presets') {
        return 'payments';
    }
    if ($k === 'sweep-moved' || $k === 'sweep-landed' || $k === 'sweep-balance') {
        return 'money';
    }
    // Prices and cottages: rates, rules, the cottage pages and their private notes.
    if (preg_match('/^(rules|occupancy|ota-price|images|amenities|houserules|safety|geo|access|faqs|welcome|arrival|ops)-/', $k)
        || preg_match('/^pricing-(limits|smart-off|changeover|hidden)$/', $k)
        || preg_match('/-cancellation-policy$/', $k)
        || preg_match('/^[a-z0-9_]+-(title|subtitle|tagline|desc|location)$/', $k)
        || $k === 'darkskies') {
        return 'prices';
    }
    return 'owner';
}
// Private and internal keys a limited person may READ although only full access
// changes them: switches the everyday screens consult. Never a secret.
const PEOPLE_READ_ALSO = ['arrival-review', 'thankyou-email', 'enquiry-nudge-off', 'anniversary-nudge-off', 'mailbox-new', 'mailbox-seen', 'mail-sent-days', 'weather-cache'];
function people_content_readable($row, $key)
{
    if (people_is_full($row)) {
        return true;
    }
    return in_array((string) $key, PEOPLE_READ_ALSO, true) || people_can($row, people_content_cap($key));
}
// An image upload is decided by where it goes.
function people_upload_cap($slot)
{
    $s = (string) $slot;
    if ($s === 'host-photo') {
        return 'all';
    }
    if (strpos($s, 'gallery-') === 0) {
        return 'prices'; // a cottage's photos
    }
    if (strpos($s, 'content-') === 0 || $s === 'experience') {
        return 'website';
    }
    return 'owner';
}

// ---- Who gets which emails ----
// Every email the back office sends its people, in the order the page shows
// them. cap: who MAY get it ('all' anyone, a switch, or 'owner' full access
// only) — an area switched off takes its emails with it. must: the reason one
// always has to reach someone, so the last person on it can't be switched off.
// Sign-in codes and reset links aren't here: they only ever go to the person
// signing in, so there is nothing to choose.
const PEOPLE_MAILS = [
    'enquiry' => ['cap' => 'all', 'must' => 'a guest is waiting for a reply', 'name' => 'new enquiries'],
    'booking' => ['cap' => 'all', 'must' => '', 'name' => 'new bookings'],
    'paid' => ['cap' => 'payments', 'must' => '', 'name' => 'payments received'],
    'messages' => ['cap' => 'all', 'must' => 'guests are waiting for an answer', 'name' => 'guest messages'],
    'reviews' => ['cap' => 'all', 'must' => '', 'name' => 'reviews to approve'],
    'ideas' => ['cap' => 'website', 'must' => '', 'name' => 'things-to-do suggestions'],
    'digest' => ['cap' => 'all', 'must' => '', 'name' => 'the weekly digest'],
    'analytics' => ['cap' => 'website', 'must' => '', 'name' => 'the weekly analytics'],
    'backup' => ['cap' => 'owner', 'must' => 'it’s the copy that lives off the host', 'name' => 'the backup'],
];
// Someone added later starts with the guest-facing emails; someone with full
// access gets everything, which is how it worked before people existed.
const PEOPLE_MAIL_LIMITED = ['enquiry' => true, 'booking' => true, 'paid' => true, 'messages' => true, 'reviews' => true, 'ideas' => false, 'digest' => true, 'analytics' => false, 'backup' => false];

// A person's choices, as exactly the nine booleans (their own over the defaults).
function people_mail_norm($row)
{
    $base = people_is_full($row) ? array_fill_keys(array_keys(PEOPLE_MAILS), true) : PEOPLE_MAIL_LIMITED;
    $own = is_array($row) && isset($row['mail_prefs']) && $row['mail_prefs'] !== '' ? json_decode((string) $row['mail_prefs'], true) : null;
    $out = [];
    foreach (PEOPLE_MAILS as $k => $_) {
        $out[$k] = is_array($own) && array_key_exists($k, $own) ? (bool) $own[$k] : (bool) $base[$k];
    }
    return $out;
}
// May this person get this email at all? (Their choice is a separate question,
// so switching an area back on brings their old choice back.)
function people_mail_can($row, $kind)
{
    return isset(PEOPLE_MAILS[$kind]) && people_can($row, PEOPLE_MAILS[$kind]['cap']);
}
// Does it reach them today? An invite nobody has accepted yet reaches no one.
function people_mail_gets($row, $kind)
{
    return people_mail_can($row, $kind) && empty($row['invited_at']) && people_mail_norm($row)[$kind];
}
// Why it can't be switched on for them, in words ('' = it can).
function people_mail_lock($row, $kind)
{
    if (people_mail_can($row, $kind)) {
        return '';
    }
    $n = people_first_name($row);
    if (!empty($row['removed_at'])) {
        return $n . ' no longer has access.';
    }
    $cap = PEOPLE_MAILS[$kind]['cap'] ?? 'owner';
    if ($cap === 'owner') {
        return 'Only someone with full access gets the backup. It’s everything on the site.';
    }
    return $n . ' can’t get this yet. Switch on ' . (PEOPLE_CAPS[$cap][0] ?? $cap) . ' on ' . $n . '’s page first.';
}
// Switching $kind off for person $id: refused when it is an email that must
// reach someone and nobody else would get it ('' = fine). $rows is everyone.
function people_mail_must_problem(array $rows, $id, $kind)
{
    $must = PEOPLE_MAILS[$kind]['must'] ?? '';
    if ($must === '') {
        return '';
    }
    foreach ($rows as $r) {
        if ((int) ($r['id'] ?? 0) !== (int) $id && empty($r['removed_at']) && people_mail_gets($r, $kind)) {
            return '';
        }
    }
    return 'Someone has to get ' . PEOPLE_MAILS[$kind]['name'] . ' — ' . $must . '.';
}
// What the back office is told about one person's emails: their choices, which
// they may have at all, and which actually reach them today.
function people_mail_payload($row)
{
    $out = ['mail' => people_mail_norm($row), 'mailCan' => [], 'mailGets' => []];
    foreach (PEOPLE_MAILS as $k => $_) {
        $out['mailCan'][$k] = people_mail_can($row, $k);
        if (people_mail_gets($row, $k)) {
            $out['mailGets'][] = $k;
        }
    }
    return $out;
}
// The kinds in page order, with who may get each and whether it must reach someone.
function people_mail_kinds()
{
    $out = [];
    foreach (PEOPLE_MAILS as $k => $m) {
        $out[] = ['k' => $k, 'cap' => $m['cap'], 'must' => $m['must'] !== ''];
    }
    return $out;
}
