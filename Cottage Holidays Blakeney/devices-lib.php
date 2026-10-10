<?php
// ============================================================
//  devices-lib.php — Devices: every device a person is signed in to the back
//  office on is a row in admin_sessions (migration-143), so one device can be
//  signed out without signing out the rest.
//
//  The session carries its row's id ($_SESSION['admin_sess']). Every request
//  asks the row whether it is still open (admin_session_check, db.php), so
//  ending the row signs that device out the next time it is used. A session
//  from before the list began is recorded on its next request ('earlier').
//
//  Three rules:
//   - UNKNOWN IS NOT SIGNED OUT. A database that can't be read, or a table not
//     migrated yet, leaves the session alone; only a row that says it ended, or
//     a row that is gone, signs the device out.
//   - A NEW DEVICE IS TOLD ABOUT, AN OLD ONE NEVER. A browser keeps its own key
//     (the chb_dk cookie); signing in again where you have signed in before, or
//     where two-step already trusts the device, is not news.
//   - SIGNING A DEVICE OUT FORGETS IT: its two-step trust and its alerts go
//     with it. Logging out yourself keeps the trust, as it always has.
//
//  Required by db.php for every request; the pure helpers at the top are what
//  test-devices.php drives.
// ============================================================

const DEVICES_KEY_COOKIE = 'chb_dk'; // this browser's own key (random, HttpOnly)
const DEVICES_HINT_COOKIE = 'chb_dh'; // what the page knows that the browser doesn't say: app, ipad, web
const DEVICES_SEEN_EVERY = 300; // a device's "last active" is written at most every five minutes
const DEVICES_KEEP_ENDED_DAYS = 90; // a signed-out row is kept this long, then deleted
const DEVICES_KEY_DAYS = 400; // the longest a browser will keep a cookie

// ---- Pure ------------------------------------------------------------------

/**
 * The flags in the page's hint cookie, in a closed vocabulary: 'app' (an
 * installed app's own window), 'ipad' (an iPad whose browser calls itself a
 * Mac) and 'web' (a browser tab). Anything else is ignored. PURE.
 */
function devices_hint_flags(string $raw): array
{
    $out = [];
    foreach (explode('.', strtolower(substr($raw, 0, 40))) as $f) {
        if (in_array($f, ['app', 'ipad', 'web'], true) && !in_array($f, $out, true)) {
            $out[] = $f;
        }
    }
    return $out;
}

/**
 * What a device is called in the list: "iPhone · App", "Mac · Chrome". The kind
 * picks the icon (phone, tablet, laptop, desktop). PURE.
 *
 * An iPad's Safari says it is a Mac, and an installed app's window says nothing
 * about being one — the page tells us both through the hint cookie. Without a
 * hint, an iPhone or iPad browser with no Safari token is an installed app.
 */
function devices_label(string $ua, string $hint = ''): array
{
    $flags = devices_hint_flags($hint);
    $ios = false;
    if (preg_match('/iPhone|iPod/', $ua)) {
        [$dev, $kind, $ios] = ['iPhone', 'phone', true];
    } elseif (preg_match('/iPad/', $ua) || (in_array('ipad', $flags, true) && preg_match('/Macintosh/', $ua))) {
        [$dev, $kind, $ios] = ['iPad', 'tablet', true];
    } elseif (preg_match('/Android/', $ua)) {
        $phone = (bool) preg_match('/Mobile/', $ua);
        [$dev, $kind] = [$phone ? 'Android phone' : 'Android tablet', $phone ? 'phone' : 'tablet'];
    } elseif (preg_match('/CrOS/', $ua)) {
        [$dev, $kind] = ['Chromebook', 'laptop'];
    } elseif (preg_match('/Macintosh|Mac OS X/', $ua)) {
        [$dev, $kind] = ['Mac', 'laptop'];
    } elseif (preg_match('/Windows/', $ua)) {
        [$dev, $kind] = ['Windows PC', 'desktop'];
    } elseif (preg_match('/Linux/', $ua)) {
        [$dev, $kind] = ['Linux PC', 'desktop'];
    } else {
        [$dev, $kind] = ['Unknown device', 'desktop'];
    }
    if (in_array('app', $flags, true) || ($ios && !$flags && !preg_match('/Safari\//', $ua))) {
        $br = 'App';
    } elseif (preg_match('/Edg(e|A|iOS)?\//', $ua)) {
        $br = 'Edge';
    } elseif (preg_match('/SamsungBrowser\//', $ua)) {
        $br = 'Samsung Internet';
    } elseif (preg_match('/OPR\/|OPiOS\//', $ua)) {
        $br = 'Opera';
    } elseif (preg_match('/Firefox\/|FxiOS\//', $ua)) {
        $br = 'Firefox';
    } elseif (preg_match('/Chrome\/|CriOS\//', $ua)) {
        $br = 'Chrome';
    } elseif (preg_match('/Safari\//', $ua)) {
        $br = 'Safari';
    } else {
        $br = 'Browser';
    }
    return ['label' => $dev . ' · ' . $br, 'kind' => $kind];
}

/** How a device signed in, in the words the list and the email use. PURE. */
function devices_how_words(string $how): string
{
    return [
        'passkey' => 'Passkey',
        'password' => 'Password',
        'password_code' => 'Password and emailed code',
        'code' => 'Emailed code',
        'invite' => 'Invite link',
        'reset' => 'Password reset link',
        'staging' => 'Staging sign-in',
    ][$how] ?? 'Not recorded'; // 'earlier': signed in before the list began
}

/**
 * Is this sign-in worth telling the person about? Only a device they have not
 * signed in on before, that two-step doesn't already trust, when they have
 * signed in somewhere else before (their first ever sign-in is not news), and
 * never for a session recorded late or the staging seat. PURE.
 */
function devices_is_new(bool $knownDevice, bool $trusted, int $rowsBefore, string $how, bool $staging): bool
{
    return !$knownDevice && !$trusted && $rowsBefore > 0 && $how !== 'earlier' && !$staging;
}

/**
 * The list began when migration-143 ran. Until a whole session lifetime has
 * passed since then, a device signed in before it and not used since can still
 * be out there without a row — the list says so rather than claim it is
 * complete. PURE.
 */
function devices_partial(?string $began, int $now, int $ttl): bool
{
    if ($began === null || $began === '') {
        return false;
    }
    $t = strtotime($began);
    return $t !== false && $t > $now - $ttl;
}

// ---- This browser ------------------------------------------------------------

function devices_cookie_set(string $name, string $value, int $days): void
{
    if (headers_sent()) {
        return;
    }
    setcookie($name, $value, [
        'expires' => time() + 86400 * $days,
        'path' => '/',
        'secure' => request_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}
// This browser's own key, made the first time a sign-in is recorded here.
function devices_key(): string
{
    $raw = preg_replace('/[^a-f0-9]/', '', strtolower((string) ($_COOKIE[DEVICES_KEY_COOKIE] ?? '')));
    if (strlen($raw) !== 40) {
        $raw = bin2hex(random_bytes(20));
        $_COOKIE[DEVICES_KEY_COOKIE] = $raw;
    }
    // Set again at every sign-in, so a browser in use never lets it lapse.
    devices_cookie_set(DEVICES_KEY_COOKIE, $raw, DEVICES_KEY_DAYS);
    return $raw;
}
function devices_hint(): string
{
    return (string) ($_COOKIE[DEVICES_HINT_COOKIE] ?? '');
}
// The two-step trust this browser carries (admin_devices.token_hash), or ''.
function devices_trust_hash(): string
{
    $tok = preg_replace('/[^a-f0-9]/i', '', (string) ($_COOKIE['chb_admin_device'] ?? ''));
    return strlen($tok) >= 32 ? hash('sha256', $tok) : '';
}
// The staging copy, where the seat signs people in all day: the same two proofs
// the staging endpoints ask for (the constant and the staging host).
function devices_staging(): bool
{
    return defined('STAGING_SANDBOX') && STAGING_SANDBOX && preg_match('/(^|\.)staging\./i', (string) ($_SERVER['HTTP_HOST'] ?? '')) === 1;
}

// ---- Rows ------------------------------------------------------------------

// Does this two-step trust belong to this person? Trust from before people
// existed has no admin_id and was the first owner's.
function devices_trust_is(int $adminId, string $trustHash): bool
{
    if ($trustHash === '') {
        return false;
    }
    try {
        $q = db()->prepare('SELECT admin_id FROM admin_devices WHERE token_hash = ? LIMIT 1');
        $q->execute([$trustHash]);
        $r = $q->fetch();
        if (!$r) {
            return false;
        }
        $owner = $r['admin_id'] === null ? admin_original_owner_id() : (int) $r['admin_id'];
        return $owner === $adminId;
    } catch (\Throwable $e) {
        return false;
    }
}

/**
 * Record a sign-in on this browser. Called by admin_session_begin (a sign-in)
 * and by devices_session_check for a session from before the list began.
 * Returns the row's id, whether it is a NEW device worth telling them about
 * (null when nothing could be recorded) and its label.
 */
function devices_record(int $adminId, string $how): array
{
    $out = ['sid' => 0, 'new' => null, 'label' => ''];
    if ($adminId <= 0) {
        return $out;
    }
    // Signing in again on top of a sign-in in this browser: the old row ends now
    // rather than lingering in the list for its lifetime.
    $prev = (int) ($_SESSION['admin_sess'] ?? 0);
    unset($_SESSION['admin_sess']);
    if ($prev > 0) {
        devices_end($prev, 'replaced');
    }
    try {
        $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
        $lab = devices_label($ua, devices_hint());
        $dk = hash('sha256', devices_key());
        $trust = devices_trust_hash();
        $q = db()->prepare('SELECT COUNT(*) AS n, COALESCE(SUM(device_hash = ?), 0) AS same FROM admin_sessions WHERE admin_id = ?');
        $q->execute([$dk, $adminId]);
        $c = $q->fetch() ?: ['n' => 0, 'same' => 0];
        db()
            ->prepare('INSERT INTO admin_sessions (admin_id, device_hash, trust_hash, label, kind, how, user_agent, created_at, last_seen) VALUES (?,?,?,?,?,?,?,NOW(),NOW())')
            ->execute([$adminId, $dk, $trust, $lab['label'], $lab['kind'], substr($how, 0, 16), mb_substr($ua, 0, 255)]);
        $sid = (int) db()->lastInsertId();
        $_SESSION['admin_sess'] = $sid;
        $new = devices_is_new((int) $c['same'] > 0, devices_trust_is($adminId, $trust), (int) $c['n'], $how, devices_staging());
        $out = ['sid' => $sid, 'new' => $new, 'label' => $lab['label']];
    } catch (\Throwable $e) {
        // Not migrated yet, or the database is unwell: the sign-in stands, unrecorded.
    }
    return $out;
}

/**
 * Is this device still signed in? False only when its row says it was signed
 * out, belongs to someone else, or is gone. Records a session from before the
 * list began, and keeps "last active" (and the label) fresh.
 */
function devices_session_check(array $row): bool
{
    $id = (int) ($row['id'] ?? 0);
    $sid = (int) ($_SESSION['admin_sess'] ?? 0);
    if ($sid <= 0) {
        devices_record($id, 'earlier');
        return true;
    }
    try {
        $q = db()->prepare('SELECT admin_id, ended_at, last_seen, label, kind FROM admin_sessions WHERE id = ?');
        $q->execute([$sid]);
        $s = $q->fetch();
    } catch (\Throwable $e) {
        return true; // unknown is not signed out
    }
    if (!$s || (int) $s['admin_id'] !== $id || $s['ended_at'] !== null) {
        return false;
    }
    $seen = $s['last_seen'] !== null ? strtotime((string) $s['last_seen']) : false;
    if ($seen === false || $seen < time() - DEVICES_SEEN_EVERY) {
        $lab = devices_label((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), devices_hint());
        try {
            db()->prepare('UPDATE admin_sessions SET last_seen = NOW(), label = ?, kind = ? WHERE id = ? AND ended_at IS NULL')->execute([$lab['label'], $lab['kind'], $sid]);
        } catch (\Throwable $e) {
        }
    }
    return true;
}

/**
 * End one device's row. $forget also drops its two-step trust and its alerts —
 * for a device signed OUT (from the list, or everywhere), never for logging out
 * yourself. Returns the row as it was, or null when it was already ended.
 */
function devices_end(int $sid, string $why, int $by = 0, bool $forget = false): ?array
{
    if ($sid <= 0) {
        return null;
    }
    try {
        $q = db()->prepare('SELECT * FROM admin_sessions WHERE id = ?');
        $q->execute([$sid]);
        $s = $q->fetch();
        if (!$s || $s['ended_at'] !== null) {
            return null;
        }
        $u = db()->prepare('UPDATE admin_sessions SET ended_at = NOW(), ended_why = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL');
        $u->execute([substr($why, 0, 12), $by > 0 ? $by : null, $sid]);
        if ($u->rowCount() < 1) {
            return null; // another request ended it first
        }
        if ($forget) {
            devices_forget($s);
        }
        return $s;
    } catch (\Throwable $e) {
        return null;
    }
}
// What a signed-out device leaves behind: its alerts, and its two-step trust.
function devices_forget(array $s): void
{
    $aid = (int) $s['admin_id'];
    try {
        db()->prepare("DELETE FROM push_subscriptions WHERE role = 'admin' AND admin_session_id = ?")->execute([(int) $s['id']]);
    } catch (\Throwable $e) {
    }
    $trust = (string) ($s['trust_hash'] ?? '');
    if ($trust !== '' && devices_trust_is($aid, $trust)) {
        try {
            db()->prepare('DELETE FROM admin_devices WHERE token_hash = ?')->execute([$trust]);
        } catch (\Throwable $e) {
        }
    }
}

/**
 * End every open row of one person except $keepSid. Returns how many of those
 * were still in use (the number the list showed).
 */
function devices_end_others(int $adminId, int $keepSid, string $why, int $by = 0, bool $forget = false): int
{
    try {
        $q = db()->prepare('SELECT id, (COALESCE(last_seen, created_at) > (NOW() - INTERVAL ? SECOND)) AS live FROM admin_sessions WHERE admin_id = ? AND ended_at IS NULL AND id <> ?');
        $q->execute([CHB_SESSION_TTL, $adminId, $keepSid]);
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        return 0;
    }
    $n = 0;
    foreach ($rows as $r) {
        if (devices_end((int) $r['id'], $why, $by, $forget) && (int) $r['live'] === 1) {
            $n++;
        }
    }
    return $n;
}

// Signed out everywhere else: every two-step trust and every alert of theirs goes,
// apart from this browser's own (signing yourself out of your other devices).
// Sessions from before the list began have no row to forget them by.
function devices_forget_all(int $adminId, string $keepTrust = '', string $keepEndpoint = '', int $keepSid = 0): void
{
    $legacy = $adminId === (int) admin_original_owner_id();
    try {
        db()->prepare('DELETE FROM admin_devices WHERE (admin_id = ?' . ($legacy ? ' OR admin_id IS NULL' : '') . ') AND token_hash <> ?')->execute([$adminId, $keepTrust]);
    } catch (\Throwable $e) {
    }
    try {
        db()
            ->prepare("DELETE FROM push_subscriptions WHERE role = 'admin' AND (admin_id = ?" . ($legacy ? ' OR admin_id IS NULL' : '') . ') AND (admin_session_id IS NULL OR admin_session_id <> ?) AND endpoint <> ?')
            ->execute([$adminId, $keepSid, $keepEndpoint]);
    } catch (\Throwable $e) {
    }
}

// One row, or null.
function devices_row(int $sid): ?array
{
    if ($sid <= 0) {
        return null;
    }
    try {
        $q = db()->prepare('SELECT * FROM admin_sessions WHERE id = ?');
        $q->execute([$sid]);
        return $q->fetch() ?: null;
    } catch (\Throwable $e) {
        return null;
    }
}

/**
 * Where a person is signed in now: open rows used within the session's
 * lifetime, this device first, then the most recently used. $hereSid is the
 * asker's own session (0 when it is someone else's list).
 */
function devices_list(int $adminId, int $hereSid): array
{
    $q = db()->prepare(
        "SELECT s.id, s.label, s.kind, s.how, s.created_at, s.last_seen, s.trust_hash,
                EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.role = 'admin' AND p.admin_session_id = s.id) AS alerts
           FROM admin_sessions s
          WHERE s.admin_id = ? AND s.ended_at IS NULL AND COALESCE(s.last_seen, s.created_at) > (NOW() - INTERVAL ? SECOND)
          ORDER BY (s.id = ?) DESC, COALESCE(s.last_seen, s.created_at) DESC
          LIMIT 50",
    );
    $q->execute([$adminId, CHB_SESSION_TTL, $hereSid]);
    $out = [];
    foreach ($q->fetchAll() as $r) {
        $here = $hereSid > 0 && (int) $r['id'] === $hereSid;
        $out[] = [
            'id' => (int) $r['id'],
            'label' => (string) $r['label'],
            'kind' => (string) $r['kind'],
            'here' => $here,
            'seen' => $here ? date('Y-m-d H:i:s') : (string) ($r['last_seen'] ?? $r['created_at']),
            'since' => (string) $r['created_at'],
            'earlier' => $r['how'] === 'earlier',
            'how' => devices_how_words((string) $r['how']),
            'trusted' => devices_trust_is($adminId, (string) $r['trust_hash']),
            'alerts' => (int) $r['alerts'] === 1,
        ];
    }
    return $out;
}

// When the list began (migration-143 ran), or null.
function devices_began(): ?string
{
    try {
        $q = db()->prepare('SELECT applied_at FROM schema_migrations WHERE filename = ?');
        $q->execute(['migration-143-devices.sql']);
        $v = $q->fetchColumn();
        return $v ? (string) $v : null;
    } catch (\Throwable $e) {
        return null;
    }
}

// Is the table there? The page says so in words rather than showing an empty list.
function devices_ready(): bool
{
    try {
        db()->query('SELECT 1 FROM admin_sessions LIMIT 1');
        return true;
    } catch (\Throwable $e) {
        return false;
    }
}

/**
 * Daily (self-repair): a row unused for longer than a session lives is over —
 * the browser's cookie has lapsed — and a signed-out row is deleted after
 * DEVICES_KEEP_ENDED_DAYS. Returns how many rows changed.
 */
function devices_prune(): int
{
    $n = 0;
    try {
        $u = db()->prepare("UPDATE admin_sessions SET ended_at = NOW(), ended_why = 'expired' WHERE ended_at IS NULL AND COALESCE(last_seen, created_at) < (NOW() - INTERVAL ? SECOND)");
        $u->execute([CHB_SESSION_TTL + 86400]);
        $n += $u->rowCount();
        $d = db()->prepare('DELETE FROM admin_sessions WHERE ended_at IS NOT NULL AND ended_at < (NOW() - INTERVAL ? DAY)');
        $d->execute([DEVICES_KEEP_ENDED_DAYS]);
        $n += $d->rowCount();
    } catch (\Throwable $e) {
    }
    return $n;
}

// ---- Telling the person -------------------------------------------------------

/**
 * A device they haven't used before signed in to their account: a push to their
 * phones (urgent, so it ignores mutes and quiet hours — it is about their own
 * account) that opens the device ready to sign out, and an email. After the
 * response, so the sign-in never waits on either.
 */
function devices_alert_new(array $row, int $sid, string $label, string $how): void
{
    $id = (int) ($row['id'] ?? 0);
    if ($id <= 0 || $sid <= 0) {
        return;
    }
    $to = admin_contact_email($row);
    $first = people_first_name($row);
    $name = people_display_name($row);
    $at = date('Y-m-d H:i');
    require_once __DIR__ . '/mailer.php';
    mail_after_response(function () use ($id, $sid, $label, $how, $to, $first, $name, $at) {
        require_once __DIR__ . '/webpush.php';
        alert_owner('New sign-in on ' . $label, 'Your account, just now. Not you? Tap to sign it out.', [
            'only' => $id,
            'category' => 'urgent',
            'url' => './?open=device-' . $sid,
            'tag' => 'device-' . $sid,
        ]);
        if ($to !== '') {
            $m = admin_new_device_body($first, $label, $at, devices_how_words($how), site_base_url() . '?open=device-' . $sid);
            smtp_send($to, $name, $m['subject'], $m['text'], $m['html']);
        }
    });
}

/**
 * A Super User signed this person out of one device ($label) or everywhere
 * ($label ''): they are emailed, so a sign-out they didn't expect is noticed and
 * nobody is left wondering why the app asked them to sign in.
 */
function devices_tell_signed_out(array $row, string $byFirst, string $label): void
{
    $to = admin_contact_email($row);
    if ($to === '' || !empty($row['removed_at'])) {
        return;
    }
    $first = people_first_name($row);
    $name = people_display_name($row);
    require_once __DIR__ . '/mailer.php';
    mail_after_response(function () use ($to, $first, $name, $byFirst, $label) {
        $m = admin_signed_out_body($first, $byFirst, $label);
        smtp_send($to, $name, $m['subject'], $m['text'], $m['html']);
    });
}
