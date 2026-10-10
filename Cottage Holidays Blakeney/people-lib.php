<?php
// ============================================================
//  people-lib.php — the rules about the people who sign in to the back office.
//  PURE: no database, no session, no clock beyond what is passed in, so
//  test-people.php drives every rule directly. db.php requires it.
//
//  Two roles. A Super User (full_access = 1) can do everything, Permissions
//  included. A Host starts with bookings, guests, key safes and the money, and
//  each of the 23 permissions below can be switched on or off for them one by
//  one. Each request is checked against those permissions on the server
//  (people_cap_for → people_can), so an old link or a stray tap gets a sentence
//  instead of the screen.
// ============================================================

// Every permission, in plain words, grouped the way the app's menu is.
// [label, group, fixed]: 'always' is on for everyone, 'super' is a Super User's only.
const PEOPLE_PERMS = [
    'bk.see' => ['See bookings and the calendar', 'bk', 'always'],
    'bk.edit' => ['Add and change bookings', 'bk', ''],
    'bk.cancel' => ['Cancel bookings', 'bk', ''],
    'bk.block' => ['Block dates', 'bk', ''],
    'gu.reply' => ['Reply to enquiries and messages', 'gu', ''],
    'gu.approve' => ['Approve or decline enquiries', 'gu', ''],
    'gu.reviews' => ['Approve reviews and photos', 'gu', ''],
    'ks.see' => ['See door codes', 'ks', ''],
    'ks.change' => ['Change door codes', 'ks', ''],
    'mo.ask' => ['Ask guests to pay', 'mo', ''],
    'mo.record' => ['Record payments', 'mo', ''],
    'mo.refund' => ['Give refunds', 'mo', ''],
    'mo.deposit' => ['Return or keep deposits', 'mo', ''],
    'mo.view' => ['See the Payments page and the books', 'mo', ''],
    'mo.exp' => ['Add expenses', 'mo', ''],
    'co.prices' => ['Change prices and seasons', 'co', ''],
    'co.pages' => ['Edit cottage pages', 'co', ''],
    'co.sync' => ['Calendar sync', 'co', ''],
    'we.content' => ['Home page and things to do', 'we', ''],
    'we.news' => ['Send the newsletter', 'we', ''],
    'we.stats' => ['See analytics', 'we', ''],
    'su.perm' => ['Permissions', 'su', 'super'],
    'su.sys' => ['Backups, status and integrations', 'su', 'super'],
];
const PEOPLE_PERM_GROUPS = ['bk' => 'Bookings', 'gu' => 'Guests & messages', 'ks' => 'Key safes', 'mo' => 'Money', 'co' => 'Cottages & prices', 'we' => 'Website', 'su' => 'Set-up'];
// What a plain Host has: bookings, guests, key safes and the money.
const PEOPLE_HOST_GROUPS = ['bk', 'gu', 'ks', 'mo'];
// The old five areas, said as permissions: an area is "any of" its permissions.
// Older callers (search, alerts) still ask by area; new code asks by permission.
const PEOPLE_AREA_PERMS = [
    'payments' => ['mo.ask', 'mo.record'],
    'refunds' => ['mo.refund', 'mo.deposit'],
    'money' => ['mo.view'],
    'prices' => ['co.prices', 'co.pages', 'co.sync'],
    'website' => ['we.content', 'we.news', 'we.stats'],
];

// The five switches people had before permissions. Read only to carry a person's
// old choices over (people_perms_from_caps); nothing writes them now.
const PEOPLE_CAPS = [
    'payments' => ['Take payments', 'Send payment requests and record cash or bank payments'],
    'refunds' => ['Refunds and deposits', 'Give money back: refunds, and returning or keeping deposits'],
    'money' => ['Money overview', 'The Payments screens: what’s owed, income and tax'],
    'prices' => ['Prices and cottages', 'Rates, seasons, pricing ideas, cottage pages and calendar sync'],
    'website' => ['Website and marketing', 'Home page, things to do, newsletter and analytics'],
];
const PEOPLE_CAPS_DEFAULT = ['payments' => true, 'refunds' => false, 'money' => false, 'prices' => false, 'website' => false];

// The old switches as stored (JSON) or given, as exactly the five booleans.
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

// A Super User: everything, Permissions included. A row from before people
// existed has no column and is the owner.
function people_is_full($row)
{
    return is_array($row) && (!array_key_exists('full_access', $row) || (int) $row['full_access'] === 1);
}

// A plain Host's permissions.
function people_host_perms()
{
    $out = [];
    foreach (PEOPLE_PERMS as $k => $p) {
        $out[$k] = $p[2] === 'always' || ($p[2] === '' && in_array($p[1], PEOPLE_HOST_GROUPS, true));
    }
    return $out;
}
// Someone set up before permissions: the everyday work (bookings, guests, key
// safes) was always theirs, and each old switch becomes the permissions it covered.
function people_perms_from_caps($caps)
{
    $c = people_caps_norm($caps);
    $out = [];
    foreach (PEOPLE_PERMS as $k => $p) {
        $out[$k] = $p[2] === 'always' || in_array($p[1], ['bk', 'gu', 'ks'], true);
    }
    $out['mo.ask'] = $out['mo.record'] = $c['payments'];
    $out['mo.refund'] = $out['mo.deposit'] = $c['refunds'];
    $out['mo.view'] = $out['mo.exp'] = $c['money'];
    $out['co.prices'] = $out['co.pages'] = $out['co.sync'] = $c['prices'];
    $out['we.content'] = $out['we.news'] = $out['we.stats'] = $c['website'];
    return $out;
}
// Everything this person may do, as exactly the 23 booleans. A Super User has
// all of them. A Host's `perms` column holds only how they differ from a plain
// Host ({} = a plain Host); NULL means they predate permissions, so their old
// switches decide. 'always' is on and 'super' off for every Host, whatever is stored.
function people_perms($row)
{
    $out = [];
    if (people_is_full($row)) {
        foreach (PEOPLE_PERMS as $k => $_) {
            $out[$k] = true;
        }
        return $out;
    }
    $raw = is_array($row) && array_key_exists('perms', $row) ? $row['perms'] : null;
    $own = $raw === null || $raw === '' ? null : json_decode((string) $raw, true);
    $base = is_array($own) ? people_host_perms() : people_perms_from_caps($row['caps'] ?? '');
    $own = is_array($own) ? $own : [];
    foreach (PEOPLE_PERMS as $k => $p) {
        $v = array_key_exists($k, $own) && is_bool($own[$k]) ? $own[$k] : $base[$k];
        $out[$k] = $p[2] === 'always' ? true : ($p[2] === 'super' ? false : $v);
    }
    return $out;
}
// How a Host differs from a plain Host, as stored: only the permissions that differ.
function people_perms_diff(array $perms)
{
    $host = people_host_perms();
    $out = [];
    foreach (PEOPLE_PERMS as $k => $p) {
        if ($p[2] === '' && isset($perms[$k]) && (bool) $perms[$k] !== $host[$k]) {
            $out[$k] = (bool) $perms[$k];
        }
    }
    return $out;
}
// How many permissions differ from a plain Host (a Super User: 0, nothing to compare).
function people_perm_changes($row)
{
    return people_is_full($row) ? 0 : count(people_perms_diff(people_perms($row)));
}

// May this person do this? 'all' is anyone signed in, 'owner' a Super User only,
// a permission key ('mo.refund') is that switch, two joined by '+' need both, and
// an old area name ('payments') is any of its permissions.
function people_can($row, $cap)
{
    if (!is_array($row) || !empty($row['removed_at'])) {
        return false;
    }
    $cap = (string) $cap;
    if (people_is_full($row) || $cap === 'all') {
        return true;
    }
    // 'gu.reply+mo.ask': every one of them.
    if (strpos($cap, '+') !== false) {
        foreach (explode('+', $cap) as $one) {
            if (!people_can($row, $one)) {
                return false;
            }
        }
        return true;
    }
    if ($cap === 'owner') {
        return false;
    }
    $perms = people_perms($row);
    if (isset($perms[$cap])) {
        return $perms[$cap];
    }
    foreach (PEOPLE_AREA_PERMS[$cap] ?? [] as $k) {
        if ($perms[$k]) {
            return true;
        }
    }
    return false;
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

// The refusal a Host reads.
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
        'role' => people_is_full($row) ? 'super' : 'host',
        'perms' => people_perms($row),
        'changes' => people_perm_changes($row),
        // The old areas, said from the permissions, for anything still asking by area.
        'caps' => array_combine(array_keys(PEOPLE_AREA_PERMS), array_map(fn($a) => people_can(['removed_at' => null] + $row, $a), array_keys(PEOPLE_AREA_PERMS))),
        'photo' => preg_match('/^[a-f0-9]{32}\.jpg$/', (string) ($row['photo'] ?? '')) ? substr((string) $row['photo'], 0, 10) : '',
        'state' => $state,
        'you' => (int) ($row['id'] ?? 0) === (int) $viewerId,
        'seen' => (string) ($row['last_seen_at'] ?? ''),
        'invited' => (string) ($row['invited_at'] ?? ''),
        'removed' => (string) ($row['removed_at'] ?? ''),
    ];
}

// ---- The policy: which permission each request needs ----
// Every back-office request is 'all' (anyone signed in), a permission key, or
// 'owner' (a Super User only). A file or action NOT listed is 'owner': a new
// endpoint is closed to a Host until someone decides otherwise, which is the safe
// way round. '' is a request with no action (most endpoints' GET list); '*'
// covers every action of a file not listed by name.
const PEOPLE_POLICY = [
    // Anyone signed in: reading the day's work, and your own account.
    'admin-bootstrap.php' => ['*' => 'all'],
    'avatar.php' => ['*' => 'all'],
    'chat-upload.php' => ['*' => 'gu.reply'],
    'customers.php' => ['directory' => 'all', 'audit' => 'all'],
    'my-bookings.php' => ['*' => 'all'], // the read-only preview of a guest's account
    'search.php' => ['*' => 'all'],
    'watchers.php' => ['list' => 'all', 'set' => 'all', 'stop' => 'all'],
    // Approving a direct review PUBLISHES it on the cottage page (reviews.php
    // serves approved direct_leads), so it takes the same permission as
    // approving any other review; the private guest rating stays everyday.
    'leads.php' => ['list' => 'all', 'set_status' => 'gu.reviews', 'rate_guest' => 'all', 'delete' => 'gu.reviews'],
    // Key safes.
    'keysafe.php' => ['state' => 'ks.see', 'confirm' => 'ks.change', 'set_enabled' => 'ks.change'],
    // Guests & messages: reading is anyone's; writing to a guest is a permission.
    'mailbox.php' => [
        'new' => 'all', 'list' => 'all', 'read' => 'all', 'attachment' => 'all', 'mark_unread' => 'all', 'sent' => 'all',
        'send' => 'gu.reply', 'delete' => 'gu.reply', 'delete_sent' => 'gu.reply',
    ],
    'messages.php' => [
        '' => 'all', 'threads' => 'all', 'thread' => 'all', 'unread' => 'all', 'mark_all_read' => 'all', 'archive' => 'all', 'unarchive' => 'all',
        'typing' => 'gu.reply', 'send' => 'gu.reply', 'delete' => 'gu.reply', 'send_arrival' => 'gu.reply',
        'send_balance' => 'mo.ask',
        // Who answers the guest chat: anyone may look; your own name and line are
        // yours to change, anyone else's a Super User's (messages.php decides).
        'team' => 'all', 'set_member' => 'all',
    ],
    'waitlist.php' => ['' => 'all', 'list' => 'all', 'notify' => 'gu.reply', 'delete' => 'gu.reply'],
    'photos.php' => ['list_admin' => 'all', 'approve' => 'gu.reviews', 'reject' => 'gu.reviews', 'delete' => 'gu.reviews'],
    'reviews.php' => ['list_admin' => 'all', 'set_status' => 'gu.reviews', 'delete' => 'gu.reviews'],
    'enquiries.php' => [
        '' => 'all', 'submit' => 'all', 'declined' => 'all', 'seen' => 'all',
        'decline' => 'gu.approve', 'restore' => 'gu.approve', 'undecline' => 'gu.approve', 'delete' => 'gu.approve',
        'approve_preview' => 'gu.approve', 'approve' => 'gu.approve',
        'email_preview' => 'gu.reply', 'email_guest' => 'gu.reply',
        'set_terms' => 'mo.ask',
    ],
    // Bookings.
    'ical-import.php' => ['sync' => 'all', 'blocks' => 'all', 'list' => 'all', 'overview' => 'all', 'add_block' => 'bk.block', 'delete_block' => 'bk.block', 'save_feeds' => 'co.sync', 'unlink_feed' => 'co.sync'],
    'bookings.php' => [
        '' => 'all', 'email_logs' => 'all', 'hub_bundle' => 'all', 'history' => 'all', 'email_render' => 'all', 'deposit_card' => 'all',
        'deposit_returns' => 'all', 'payments' => 'all', 'rate_guest' => 'all',
        'add' => 'bk.edit', 'update' => 'bk.edit', 'set_notes' => 'bk.edit',
        'cancel' => 'bk.cancel', 'delete' => 'bk.cancel',
        'send_arrival' => 'gu.reply', 'arrival_preview' => 'gu.reply', 'send_confirmation' => 'gu.reply', 'email_preview' => 'gu.reply', 'email_guest' => 'gu.reply',
        // Money coming in: asking for it, and recording it.
        'request_payment' => 'mo.ask', 'set_payment_plan' => 'mo.ask', 'pay_link' => 'mo.ask',
        'set_payment' => 'mo.record', 'hold_capture' => 'mo.record', 'record_square_payment' => 'mo.record',
        // Money going back out.
        'refund' => 'mo.refund', 'hold_release' => 'mo.refund',
        'return_deposit' => 'mo.deposit', 'keep_deposit' => 'mo.deposit', 'confirm_return_settled' => 'mo.deposit',
        // The Payments screens.
        'recent_payments' => 'mo.view',
    ],
    'auth.php' => [
        // Your own sign-in and details.
        'admin_status' => 'all', 'admin_logout' => 'all', 'admin_reauth_password' => 'all', 'admin_change_password' => 'all',
        'admin_me_set' => 'all', 'admin_email_begin' => 'all', 'admin_email_finish' => 'all', 'admin_twofa_set' => 'all',
        'admin_avatar_set' => 'all', 'admin_avatar_remove' => 'all', 'admin_notify_set' => 'all',
        // Guests.
        'guest_list' => 'all', 'guest_send_reset' => 'all', 'guest_crm' => 'all', 'guest_reinvite' => 'gu.reply',
    ],
    'passkeys.php' => [
        'admin_register_begin' => 'all', 'admin_register_finish' => 'all', 'admin_reauth_begin' => 'all', 'admin_reauth_finish' => 'all',
        'admin_list' => 'all', 'admin_delete' => 'all',
    ],
    'push.php' => ['subscribe_admin' => 'all', 'unsubscribe_admin' => 'all', 'test_admin' => 'all'],
    // The Payments page and the books.
    'accounts.php' => ['*' => 'mo.view'],
    'money.php' => ['*' => 'mo.view'],
    // Seeing the bank and adding statements is the books (mo.view); SORTING a
    // payment says whose money it was and feeds what each host is owed, so it
    // takes Record payments; switching statements off is a Super User's.
    'statements.php' => ['status' => 'mo.view', 'preview' => 'mo.view', 'import' => 'mo.view', 'mark' => 'mo.record', 'unmark' => 'mo.record', 'settings' => 'mo.record'],
    'expenses.php' => ['' => 'mo.view', 'add' => 'mo.exp', 'update' => 'mo.exp', 'delete' => 'mo.exp', '*' => 'mo.view'],
    // The Monzo live link: checking and syncing are the Payments page's; adding
    // the developer client, connecting and disconnecting are a Super User's.
    'monzo.php' => ['status' => 'mo.view', 'check' => 'mo.view', 'sync' => 'mo.view'],
    // Whose money is whose: the figures are the Payments page's; who hosts what,
    // and whose account it lands in, are a Super User's.
    'split.php' => ['status' => 'mo.view'],
    'square-setup.php' => ['payouts_refresh' => 'mo.view'],
    // Cottages & prices.
    'rates.php' => ['create' => 'co.pages', 'set_unlisted' => 'co.pages', 'archive' => 'co.pages', 'unarchive' => 'co.pages', '*' => 'co.prices'],
    'pricing-suggest.php' => ['*' => 'co.prices'],
    // Website.
    'experiences.php' => ['*' => 'we.content'],
    'optimize-hero.php' => ['*' => 'we.content'],
    'newsletter.php' => ['*' => 'we.news'],
    'track.php' => ['*' => 'we.stats'],
];

// The permission one request needs. $in is the request's parameters, for the
// few actions whose money parts decide it (the endpoint re-checks those it can
// only judge against the stored row, e.g. a booking edit or a cancellation's refund).
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
    // An enquiry approved WITH an agreed price or plan is a money decision too.
    if ($file === 'enquiries.php' && $action === 'approve') {
        foreach (['price_override', 'deposit_pct', 'deposit_amount', 'balance_due_date'] as $k) {
            if (isset($in[$k]) && $in[$k] !== '' && $in[$k] !== null && $in[$k] !== false) {
                return 'gu.approve+mo.ask';
            }
        }
        return 'gu.approve';
    }
    // A pay button in an email is asking for money.
    if (($file === 'bookings.php' || $file === 'enquiries.php') && $action === 'email_guest') {
        $btn = $in['buttons'] ?? ($in['button'] ?? []);
        $btn = is_array($btn) ? $btn : [$btn];
        return in_array('pay', array_map('strval', $btn), true) ? 'gu.reply+mo.ask' : 'gu.reply';
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
    // Website: the home page, its cards and the menu.
    if (in_array($k, ['site-logo', 'hero-bg', 'terms-title'], true) || preg_match('/^(hero|nav|mnav)-/', $k) || preg_match('/^card(\d+-|-title-|-meta-|-img-)/', $k)) {
        return 'we.content';
    }
    // Anyone: the host card, saved replies, guest chat, reviews, and what the
    // back office itself remembers as you work (dismissed duties, search).
    $everyday = [
        'host-name', 'host-badge', 'host-years', 'host-school', 'host-work', 'host-bio', 'host-photo', 'contact-phone',
        'email-templates', 'reviews', 'google-review-url',
        'duty-dismissed', 'inbox-state', 'search-pins', 'nlu-learned', 'nlu-suppressed', 'search-misses', 'search-canon', 'guest-faq-misses',
    ];
    if (in_array($k, $everyday, true) || preg_match('/^chat-(away|ans)-/', $k) || $k === 'chat-chips' || $k === 'chat-reply-time') {
        return 'all';
    }
    // The search undo list holds price changes, and replaying one posts a price
    // change as whoever taps Undo. Only someone who could make that change
    // themselves may write it, so nobody can plant one for a Super User to run.
    if ($k === 'search-undo') {
        return 'co.prices';
    }
    if ($k === 'plan-presets') {
        return 'mo.ask';
    }
    if ($k === 'sweep-moved' || $k === 'sweep-landed' || $k === 'sweep-balance') {
        return 'mo.view';
    }
    // Prices and seasons: rates, the rules that price and limit a stay, the
    // cancellation policy.
    if (preg_match('/^(rules|occupancy|ota-price)-/', $k)
        || preg_match('/^pricing-(limits|smart-off|changeover|hidden)$/', $k)
        || preg_match('/-cancellation-policy$/', $k)) {
        return 'co.prices';
    }
    // Which Square location every money read uses: a Payments setting, so a Super
    // User's. Named BEFORE the cottage pattern below, which takes any
    // "<word>-location" as a cottage's own location line and so handed this to
    // anyone who edits cottage pages.
    if ($k === 'square-location') {
        return 'owner';
    }
    // The cottage pages and their private notes.
    if (preg_match('/^(images|amenities|houserules|safety|geo|access|faqs|welcome|arrival|ops)-/', $k)
        || preg_match('/^[a-z0-9_]+-(title|subtitle|tagline|desc|location)$/', $k)
        || $k === 'darkskies') {
        return 'co.pages';
    }
    return 'owner';
}
// Private and internal keys a Host may READ although only a Super User changes
// them: switches the everyday screens consult. Never a secret.
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
        return 'co.pages'; // a cottage's photos
    }
    if (strpos($s, 'content-') === 0 || $s === 'experience') {
        return 'we.content';
    }
    return 'owner';
}

// ---- Who gets which emails ----
// Every email the back office sends its people, in the order the page shows
// them. cap: who MAY get it ('all' anyone, a permission, or 'owner' a Super
// User only) — a permission switched off takes its emails with it. must: the reason one
// always has to reach someone, so the last person on it can't be switched off.
// Sign-in codes and reset links aren't here: they only ever go to the person
// signing in, so there is nothing to choose.
const PEOPLE_MAILS = [
    'enquiry' => ['cap' => 'gu.reply', 'must' => 'a guest is waiting for a reply', 'name' => 'new enquiries'],
    'booking' => ['cap' => 'all', 'must' => '', 'name' => 'new bookings'],
    'paid' => ['cap' => 'mo.record', 'must' => '', 'name' => 'payments received'],
    'messages' => ['cap' => 'gu.reply', 'must' => 'guests are waiting for an answer', 'name' => 'guest messages'],
    'reviews' => ['cap' => 'gu.reviews', 'must' => '', 'name' => 'reviews to approve'],
    'ideas' => ['cap' => 'we.content', 'must' => '', 'name' => 'things-to-do suggestions'],
    'digest' => ['cap' => 'all', 'must' => '', 'name' => 'the weekly digest'],
    'analytics' => ['cap' => 'we.stats', 'must' => '', 'name' => 'the weekly analytics'],
    'backup' => ['cap' => 'owner', 'must' => 'it’s the copy that lives off the host', 'name' => 'the backup'],
];
// A Host starts with the guest-facing emails; a Super User gets everything,
// which is how it worked before people existed.
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
// so switching a permission back on brings their old choice back.)
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
        return 'Only a Super User gets the backup. It’s everything on the site.';
    }
    return $n . ' can’t get this yet. Switch on ' . (PEOPLE_PERMS[$cap][0] ?? $cap) . ' in What ' . $n . ' can do first.';
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
