<?php
// ============================================================
//  auth.php — admin & guest authentication.
//  POST {action: ...}
//  Admin:  admin_login, admin_logout, admin_change_password, admin_status
//  Guest:  guest_register, guest_login, guest_logout, guest_status
// ============================================================
require_once __DIR__ . '/db.php';

// ---- Login rate-limiting (5 failures per 10 min, per IP + account) ----
// Resilient: if the login_attempts table doesn't exist (migration not run),
// these helpers silently do nothing, so logins are never blocked by a missing table.
function throttle_check($identifier)
{
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $s = db()->prepare('SELECT COUNT(*) c FROM login_attempts
                            WHERE ip = ? AND identifier = ? AND success = 0
                              AND attempted_at > (NOW() - INTERVAL 10 MINUTE)');
        $s->execute([$ip, $identifier]);
        if ((int) $s->fetch()['c'] >= 5) {
            json_out(['error' => 'Too many failed attempts. Please wait 10 minutes and try again.'], 429);
        }
        // Per-account cap regardless of IP — stops a distributed / IP-rotating
        // brute force against a single account (especially the lone admin) that
        // the per-IP limit above can't catch. Threshold is higher so legitimate
        // users behind shared/CGNAT IPs aren't tripped by others' failures.
        $s2 = db()->prepare('SELECT COUNT(*) c FROM login_attempts
                             WHERE identifier = ? AND success = 0
                               AND attempted_at > (NOW() - INTERVAL 10 MINUTE)');
        $s2->execute([$identifier]);
        if ((int) $s2->fetch()['c'] >= 20) {
            json_out(
                ['error' => 'Too many failed attempts on this account. Please wait 10 minutes and try again.'],
                429,
            );
        }
    } catch (\Throwable $e) {
        /* table missing — don't block logins */
    }
}
function throttle_record($identifier, $ok)
{
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        if ($ok) {
            // Success clears the slate for this ip+account
            db()
                ->prepare('DELETE FROM login_attempts WHERE ip = ? AND identifier = ?')
                ->execute([$ip, $identifier]);
        } else {
            db()
                ->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?,?,0)')
                ->execute([$ip, $identifier]);
        }
        // Occasional housekeeping: prune day-old rows
        if (random_int(1, 20) === 1) {
            db()->prepare('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)')->execute();
        }
    } catch (\Throwable $e) {
        /* table missing — ignore */
    }
}

$in = body();
$action = $in['action'] ?? '';

// When a login is attempted for an account that doesn't exist, verify against this
// dummy hash anyway — so the response takes the same time either way and timing
// can't be used to probe which usernames/emails are registered.
const AUTH_DUMMY_HASH = '$2y$12$gemBw4PxmOQPgTk4uUpBPuJz/NsKCsE1dO8f8csjOOGJAwJSbCn3W';

// ---- Admin 2FA: an emailed one-time code on a NOT-yet-trusted device. Opt-in
// (Settings toggle) AND only active when an owner email + SMTP are configured, so
// it can never lock the owner out. Trusted devices are remembered ~60 days. ----
function admin_2fa_active()
{
    if (content_value('admin-2fa-enabled') !== '1') {
        return false;
    }
    // Must actually be able to send the code, or we'd lock the owner out.
    return defined('OWNER_NOTIFY_EMAIL') &&
        OWNER_NOTIFY_EMAIL &&
        defined('MAIL_ENABLED') &&
        MAIL_ENABLED &&
        defined('SMTP_USER') &&
        SMTP_USER &&
        defined('SMTP_PASS') &&
        SMTP_PASS &&
        SMTP_PASS !== 'CHANGE_ME';
}
function admin_device_trusted()
{
    $tok = preg_replace('/[^a-f0-9]/i', '', (string) ($_COOKIE['chb_admin_device'] ?? ''));
    if (strlen($tok) < 32) {
        return false;
    }
    try {
        $s = db()->prepare('SELECT id FROM admin_devices WHERE token_hash = ? LIMIT 1');
        $s->execute([hash('sha256', $tok)]);
        $id = (int) ($s->fetchColumn() ?: 0);
        if ($id > 0) {
            db()->prepare('UPDATE admin_devices SET last_seen = NOW() WHERE id = ?')->execute([$id]);
            return true;
        }
    } catch (\Throwable $e) {
        // table not migrated yet → treat as untrusted
    }
    return false;
}
function admin_trust_this_device()
{
    try {
        $tok = bin2hex(random_bytes(20));
        db()
            ->prepare('INSERT INTO admin_devices (token_hash, user_agent, last_seen) VALUES (?,?,NOW())')
            ->execute([hash('sha256', $tok), mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255)]);
        setcookie('chb_admin_device', $tok, [
            'expires' => time() + 60 * 60 * 24 * 60,
            'path' => '/',
            'secure' => request_is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    } catch (\Throwable $e) {
    }
}
// Finish an admin sign-in (shared by the direct path and the post-2FA path).
function admin_complete_login($uid)
{
    session_regenerate_id(true); // new session id on login — prevents session fixation
    $_SESSION['admin_id'] = (int) $uid;
    unset($_SESSION['guest_id']); // one role at a time
    unset($_SESSION['pending_admin_2fa']);
    csrf_issue_cookie();
    // New device/location? Coarse fingerprint (IP + browser) vs the last sign-in.
    $fp = ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);
    $prevFp = content_value('admin-last-login-fp');
    $isNew = $prevFp !== '' && $prevFp !== $fp;
    try {
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('admin-last-login-fp', ?)
                 ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode($fp)]);
    } catch (\Throwable $e) {
    }
    if ($isNew) {
        log_activity('account', 'admin.login_new', 'Signed in from a NEW device or location', ['severity' => 'warn', 'meta' => ['detail' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 120)]]);
    } else {
        log_activity('account', 'admin.login', 'Owner signed in');
    }
    json_out(['ok' => true]);
}

switch ($action) {
    // ---------------- ADMIN ----------------
    case 'admin_login':
        $username = clean($in['username'] ?? '');
        $password = $in['password'] ?? '';
        throttle_check('admin:' . strtolower($username));
        $stmt = db()->prepare('SELECT id, password_hash FROM admins WHERE username = ?');
        $stmt->execute([$username]);
        $row = $stmt->fetch();
        if (!password_verify($password, $row['password_hash'] ?? AUTH_DUMMY_HASH) || !$row) {
            throttle_record('admin:' . strtolower($username), false);
            // Diagnose WHY for the owner's log — the HTTP reply below stays generic
            // so an attacker learns nothing. The one sign-in form tries owner first
            // and falls back to guest, so a REGISTERED GUEST's email landing here is
            // routine, not an attack: skip the owner-side warning entirely and let
            // the guest attempt that follows log its own real outcome.
            $reason = $row ? 'wrong password for the owner account' : 'not the owner username';
            if (!$row && strpos($username, '@') !== false) {
                try {
                    $gq = db()->prepare('SELECT COUNT(*) FROM guests WHERE email = ?');
                    $gq->execute([strtolower($username)]);
                    if ((int) $gq->fetchColumn() > 0) {
                        json_out(['error' => 'Incorrect username or password'], 401);
                    }
                } catch (\Throwable $e) {
                }
            }
            // Collapse a burst: log the first failure, then only at thresholds — so a
            // brute-force attempt is one or two "Needs attention" rows, not fifty.
            $fails = 1;
            try {
                $fq = db()->prepare(
                    "SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND success = 0 AND attempted_at > (NOW() - INTERVAL 15 MINUTE)",
                );
                $fq->execute(['admin:' . strtolower($username)]);
                $fails = (int) $fq->fetchColumn();
            } catch (\Throwable $e) {
            }
            if ($fails === 1) {
                log_activity('account', 'admin.login_fail', 'Failed owner sign-in — ' . $reason, ['actor' => 'system', 'severity' => 'warn', 'meta' => ['detail' => 'username: ' . mb_substr($username, 0, 60)]]);
            } elseif (in_array($fails, [5, 15, 30], true)) {
                log_activity('account', 'admin.login_burst', $fails . ' failed owner sign-in attempts in 15 min — ' . $reason, ['actor' => 'system', 'severity' => 'action', 'meta' => ['detail' => 'username: ' . mb_substr($username, 0, 60)]]);
            }
            json_out(['error' => 'Incorrect username or password'], 401);
        }
        throttle_record('admin:' . strtolower($username), true);
        // Password is right. If 2FA is on and this device isn't trusted, hold the
        // login and email a one-time code instead of signing in yet.
        if (admin_2fa_active() && !admin_device_trusted()) {
            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $_SESSION['pending_admin_2fa'] = [
                'uid' => (int) $row['id'],
                'hash' => hash('sha256', $code),
                'exp' => time() + 600, // 10 minutes
                'tries' => 0,
            ];
            try {
                require_once __DIR__ . '/mailer.php';
                if (function_exists('smtp_send')) {
                    // Same coastal shell as every other email the site sends,
                    // with the code big enough to read off a phone screen.
                    $codeHtml = email_shell(
                        'Your one-time sign-in code',
                        email_h('Your sign-in code') .
                            email_p('Use this code to finish signing in to your back office on a new device. It expires in 10 minutes.') .
                            '<div style="text-align:center;padding:20px 0 8px;"><span style="font-family:' .
                            email_sans() .
                            ';font-size:34px;letter-spacing:9px;font-weight:700;color:#2A2622;">' .
                            email_esc($code) .
                            '</span></div>' .
                            email_p('If you didn&rsquo;t just try to sign in, ignore this email and consider changing your password.', true),
                    );
                    smtp_send(
                        OWNER_NOTIFY_EMAIL,
                        'Owner',
                        'Your sign-in code — Cottage Holidays Blakeney',
                        "Your one-time sign-in code is: {$code}\n\nIt expires in 10 minutes. If you didn't just try to sign in to your back office, ignore this email and consider changing your password.",
                        $codeHtml,
                    );
                }
            } catch (\Throwable $e) {
            }
            log_activity('account', 'admin.2fa_sent', 'Sign-in code emailed for a new device', ['actor' => 'system', 'severity' => 'warn']);
            json_out(['ok' => true, 'twofa' => true]);
        }
        admin_complete_login($row['id']);

    case 'admin_2fa':
        // Verify the emailed one-time code and finish the held login.
        rate_limit('admin2fa', 8, 15);
        $p = $_SESSION['pending_admin_2fa'] ?? null;
        if (!is_array($p) || (int) ($p['exp'] ?? 0) < time()) {
            unset($_SESSION['pending_admin_2fa']);
            if (is_array($p)) {
                log_activity('account', 'admin.2fa_fail', 'Owner sign-in code expired before it was used (10-minute window)', ['actor' => 'system', 'severity' => 'warn']);
            }
            json_out(['error' => 'That code has expired — please sign in again.'], 401);
        }
        if ((int) ($p['tries'] ?? 0) >= 5) {
            unset($_SESSION['pending_admin_2fa']);
            log_activity('account', 'admin.2fa_fail', 'Owner sign-in cancelled — 5 wrong one-time codes in a row', ['actor' => 'system', 'severity' => 'action']);
            json_out(['error' => 'Too many attempts — please sign in again.'], 429);
        }
        $_SESSION['pending_admin_2fa']['tries'] = (int) ($p['tries'] ?? 0) + 1;
        $code = preg_replace('/\D/', '', (string) ($in['code'] ?? ''));
        if ($code === '' || !hash_equals((string) ($p['hash'] ?? ''), hash('sha256', $code))) {
            // First typo only (retries are normal) — the cancel above covers persistence.
            if ((int) ($p['tries'] ?? 0) === 0) {
                log_activity('account', 'admin.2fa_fail', 'Wrong one-time sign-in code entered (owner 2FA)', ['actor' => 'system', 'severity' => 'warn']);
            }
            json_out(['error' => 'Incorrect code — check the email and try again.'], 401);
        }
        if (!empty($in['remember'])) {
            admin_trust_this_device();
        }
        admin_complete_login((int) $p['uid']);

    case 'admin_logout':
        log_activity('account', 'admin.logout', 'Owner signed out');
        unset($_SESSION['admin_id']);
        json_out(['ok' => true]);

    case 'admin_status':
        json_out(['admin' => !empty($_SESSION['admin_id'])]);

    case 'admin_change_password':
        require_admin();
        $current = $in['current'] ?? '';
        $next = $in['next'] ?? '';
        if (strlen($next) < 12) {
            json_out(['error' => 'New password must be at least 12 characters'], 400);
        }
        $stmt = db()->prepare('SELECT password_hash FROM admins WHERE id = ?');
        $stmt->execute([$_SESSION['admin_id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) {
            json_out(['error' => 'Current password is incorrect'], 403);
        }
        $hash = password_hash($next, PASSWORD_DEFAULT);
        db()
            ->prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
            ->execute([$hash, $_SESSION['admin_id']]);
        log_activity('account', 'admin.password_change', 'Owner password changed');
        json_out(['ok' => true]);

    // ---------------- GUEST ----------------
    case 'guest_register':
        rate_limit('register', 10); // curb row-flooding + email-enumeration probing (409 reveals existence)
        $name = clean($in['name'] ?? '');
        $email = strtolower(clean($in['email'] ?? ''));
        $phone = clean($in['phone'] ?? '');
        $address = clean($in['address'] ?? '');
        $postcode = clean($in['postcode'] ?? '');
        $pw = $in['password'] ?? '';
        if ($name === '' || $email === '' || strlen($pw) < 8) {
            json_out(['error' => 'Name, email and an 8+ character password are required'], 400);
        }
        if ($address === '') {
            json_out(['error' => 'Please enter your UK address'], 400);
        }
        if (!uk_postcode_valid($postcode)) {
            json_out(['error' => 'Please enter a valid UK postcode'], 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_out(['error' => 'Please enter a valid email address'], 400);
        }
        $stmt = db()->prepare('SELECT id FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            json_out(['error' => 'An account with this email already exists'], 409);
        }

        $hash = password_hash($pw, PASSWORD_DEFAULT);
        db()
            ->prepare('INSERT INTO guests (name, email, phone, address, postcode, password_hash) VALUES (?,?,?,?,?,?)')
            ->execute([$name, $email, $phone, $address, $postcode, $hash]);
        session_regenerate_id(true); // new session id on login — prevents session fixation
        $_SESSION['guest_id'] = (int) db()->lastInsertId();
        unset($_SESSION['admin_id']); // one role at a time: a guest session ends any admin session
        log_activity('account', 'guest.register', 'New guest account — ' . $name, ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) $_SESSION['guest_id']]);
        json_out([
            'ok' => true,
            'guest' => [
                'name' => $name,
                'email' => $email,
                'phone' => $phone,
                'address' => $address,
                'postcode' => $postcode,
            ],
        ]);

    case 'guest_login':
        $email = strtolower(clean($in['email'] ?? ''));
        $pw = $in['password'] ?? '';
        throttle_check('guest:' . $email);
        $stmt = db()->prepare(
            'SELECT id, name, email, phone, address, postcode, password_hash FROM guests WHERE email = ?',
        );
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        if (!password_verify($pw, $row['password_hash'] ?? AUTH_DUMMY_HASH) || !$row) {
            throttle_record('guest:' . $email, false);
            // Diagnose WHY for the owner's log (the reply stays generic): the usual
            // culprits are an email we've never seen, an account that only ever
            // used magic links (no password to check), or a plain wrong password.
            $reason = !$row
                ? 'no guest account with this email'
                : ((string) ($row['password_hash'] ?? '') === ''
                    ? 'account has no password — they need "Email me a sign-in link" or account setup'
                    : 'wrong password');
            // Burst-collapsed like the owner path: first failure, then thresholds.
            $fails = 1;
            try {
                $fq = db()->prepare(
                    "SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND success = 0 AND attempted_at > (NOW() - INTERVAL 15 MINUTE)",
                );
                $fq->execute(['guest:' . $email]);
                $fails = (int) $fq->fetchColumn();
            } catch (\Throwable $e) {
            }
            if ($fails === 1) {
                $opts = ['actor' => 'system', 'severity' => 'warn', 'meta' => ['detail' => 'email: ' . mb_substr($email, 0, 80)]];
                if ($row) {
                    $opts['entity'] = 'guest';
                    $opts['entity_id'] = (string) $row['id'];
                }
                log_activity('account', 'guest.login_fail', 'Failed guest sign-in — ' . $reason, $opts);
            } elseif (in_array($fails, [5, 15, 30], true)) {
                log_activity('account', 'guest.login_burst', $fails . ' failed guest sign-in attempts in 15 min — ' . $reason, ['actor' => 'system', 'severity' => 'action', 'meta' => ['detail' => 'email: ' . mb_substr($email, 0, 80)]]);
            }
            json_out(['error' => 'Email or password not recognised'], 401);
        }
        throttle_record('guest:' . $email, true);
        session_regenerate_id(true); // new session id on login — prevents session fixation
        $_SESSION['guest_id'] = (int) $row['id'];
        unset($_SESSION['admin_id']); // one role at a time: a guest session ends any admin session
        json_out([
            'ok' => true,
            'guest' => [
                'name' => $row['name'],
                'email' => $row['email'],
                'phone' => $row['phone'],
                'address' => $row['address'],
                'postcode' => $row['postcode'],
            ],
        ]);

    // Passwordless sign-in: email the guest a one-tap magic link. We ALWAYS
    // reply ok (even if no such account) so the endpoint can't be used to probe
    // which emails are registered. The link carries id + issue-time + HMAC.
    case 'guest_magic_request':
        $email = strtolower(clean($in['email'] ?? ''));
        throttle_check('magic:' . $email);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $stmt = db()->prepare('SELECT id, name, email FROM guests WHERE email = ?');
            $stmt->execute([$email]);
            $g = $stmt->fetch();
            if ($g) {
                $ts = time();
                $url =
                    site_base_url() .
                    'index.html?mlogin=' .
                    (int) $g['id'] .
                    '&t=' .
                    $ts .
                    '&k=' .
                    login_token($g['id'], $ts);
                require_once __DIR__ . '/mailer.php';
                send_magic_link_email($g, $url);
                log_activity('account', 'guest.magic_link', 'Magic sign-in link emailed to a guest', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) $g['id']]);
            } else {
                // The HTTP reply stays a uniform ok (no account probing), but the
                // owner's log gets the truth — it explains "my sign-in link never
                // arrived" (usually a typo'd or different email than the booking's).
                log_activity('account', 'guest.magic_unknown', 'Sign-in link requested for an email with no guest account — nothing sent', ['actor' => 'system', 'meta' => ['detail' => 'email: ' . mb_substr($email, 0, 80)]]);
            }
        }
        // Count EVERY request (pass false so it records an attempt rather than
        // clearing the slate) — this rate-limits magic-link emails (anti-bombing /
        // anti-enumeration) without ever revealing whether the account exists.
        throttle_record('magic:' . $email, false);
        json_out(['ok' => true]);

    // Consume a magic link: verify the HMAC and that it's fresh (30 min), then
    // sign the guest in exactly like guest_login.
    case 'guest_magic_consume':
        $gid = (int) ($in['guest_id'] ?? 0);
        $ts = (int) ($in['ts'] ?? 0);
        $tok = (string) ($in['token'] ?? '');
        if ($gid <= 0 || $ts <= 0 || $tok === '' || !hash_equals(login_token($gid, $ts), $tok)) {
            json_out(['error' => 'This sign-in link is invalid.'], 401);
        }
        if (abs(time() - $ts) > 1800) {
            json_out(['error' => 'This sign-in link has expired — please request a new one.'], 401);
        }
        // Single-use: atomically CLAIM this link's timestamp. The row updates only if
        // this ts is strictly newer than the last one consumed for the guest, so a
        // replay of the same (or an older) captured link within its 30-min window
        // affects 0 rows and is refused. Race-safe (the DB, not a read-then-write).
        $claim = db()->prepare('UPDATE guests SET magic_used_ts = ? WHERE id = ? AND magic_used_ts < ?');
        $claim->execute([$ts, $gid, $ts]);
        if ($claim->rowCount() < 1) {
            json_out(['error' => 'This sign-in link has already been used — please request a new one.'], 401);
        }
        $stmt = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$gid]);
        $row = $stmt->fetch();
        if (!$row) {
            json_out(['error' => 'This sign-in link is invalid.'], 401);
        }
        session_regenerate_id(true); // new session id on login — prevents session fixation
        $_SESSION['guest_id'] = (int) $row['id'];
        unset($_SESSION['admin_id']); // one role at a time
        json_out([
            'ok' => true,
            'guest' => [
                'name' => $row['name'],
                'email' => $row['email'],
                'phone' => $row['phone'],
                'address' => $row['address'],
                'postcode' => $row['postcode'],
            ],
        ]);

    case 'guest_logout':
        unset($_SESSION['guest_id']);
        json_out(['ok' => true]);

    case 'guest_status':
        if (empty($_SESSION['guest_id'])) {
            json_out(['guest' => null]);
        }
        $stmt = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        json_out(['guest' => $stmt->fetch() ?: null]);

    // Logged-in guest updates their own contact details (NOT their email).
    case 'guest_update_profile':
        if (empty($_SESSION['guest_id'])) {
            json_out(['error' => 'Please log in first'], 401);
        }
        $phone = clean($in['phone'] ?? '');
        $address = clean($in['address'] ?? '');
        $postcode = clean($in['postcode'] ?? '');
        if ($address === '') {
            json_out(['error' => 'Please enter your UK address'], 400);
        }
        if (!uk_postcode_valid($postcode)) {
            json_out(['error' => 'Please enter a valid UK postcode'], 400);
        }
        db()
            ->prepare('UPDATE guests SET phone = ?, address = ?, postcode = ? WHERE id = ?')
            ->execute([$phone, $address, $postcode, (int) $_SESSION['guest_id']]);
        $stmt = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        json_out(['ok' => true, 'guest' => $stmt->fetch() ?: null]);

    // Logged-in guest changes their own password (must give the current one).
    case 'guest_change_password':
        if (empty($_SESSION['guest_id'])) {
            json_out(['error' => 'Please log in first'], 401);
        }
        $current = $in['current'] ?? '';
        $next = $in['next'] ?? '';
        if (strlen($next) < 8) {
            json_out(['error' => 'New password must be at least 8 characters'], 400);
        }
        $stmt = db()->prepare('SELECT password_hash FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) {
            json_out(['error' => 'Your current password is incorrect'], 403);
        }
        db()
            ->prepare('UPDATE guests SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($next, PASSWORD_DEFAULT), (int) $_SESSION['guest_id']]);
        json_out(['ok' => true]);

    // GDPR: a logged-in guest downloads everything we hold about them (JSON).
    case 'guest_export_data':
        if (empty($_SESSION['guest_id'])) {
            json_out(['error' => 'Please log in first'], 401);
        }
        $gid = (int) $_SESSION['guest_id'];
        $acc = db()->prepare('SELECT id, name, email, phone, address, postcode, created_at FROM guests WHERE id = ?');
        $acc->execute([$gid]);
        $account = $acc->fetch() ?: [];
        $email = (string) ($account['email'] ?? '');
        $grab = function ($sql, $params) {
            try {
                $s = db()->prepare($sql);
                $s->execute($params);
                return $s->fetchAll();
            } catch (\Throwable $e) {
                return [];
            }
        };
        $bookings = $email !== '' ? $grab('SELECT * FROM bookings WHERE email = ? ORDER BY check_in', [$email]) : [];
        $payments = [];
        $ids = array_values(array_filter(array_map(fn($b) => (int) $b['id'], $bookings)));
        if ($ids) {
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $payments = $grab(
                "SELECT booking_id, kind, amount, status, created_at FROM payments WHERE booking_id IN ($ph)",
                $ids,
            );
        }
        $data = [
            'exported_at' => date('c'),
            'account' => $account,
            'bookings' => $bookings,
            'payments' => $payments,
            'enquiries' => $email !== '' ? $grab('SELECT * FROM enquiries WHERE email = ?', [$email]) : [],
            'chat_threads' => $grab('SELECT * FROM chat_threads WHERE guest_id = ?', [$gid]),
            'messages' => $grab('SELECT * FROM messages WHERE guest_id = ?', [$gid]),
            'reviews' => $grab('SELECT * FROM guest_reviews WHERE guest_id = ?', [$gid]),
            'photos' => $grab('SELECT * FROM guest_photos WHERE guest_id = ?', [$gid]),
            'newsletter' =>
                $email !== ''
                    ? $grab('SELECT email, name, created_at FROM newsletter_subscribers WHERE email = ?', [$email])
                    : [],
            'waitlist' => $email !== '' ? $grab('SELECT * FROM waitlist WHERE email = ?', [$email]) : [],
        ];
        json_out(['ok' => true, 'data' => $data]);

    // GDPR erasure: a logged-in guest deletes their account. Financial records
    // (bookings + payments) are RETAINED for tax/accounting but stripped of personal
    // data; everything else (enquiries, messages, reviews, mailing-list, passkeys,
    // push, etc.) is purged. Public photos are kept but de-identified.
    case 'guest_delete_account':
        if (empty($_SESSION['guest_id'])) {
            json_out(['error' => 'Please log in first'], 401);
        }
        $gid = (int) $_SESSION['guest_id'];
        $r = db()->prepare('SELECT email FROM guests WHERE id = ?');
        $r->execute([$gid]);
        $email = (string) ($r->fetchColumn() ?: '');
        $try = function ($sql, $params) {
            try {
                db()->prepare($sql)->execute($params);
            } catch (\Throwable $e) {
                /* table may not exist */
            }
        };
        if ($email !== '') {
            // Anonymise the financial trail (kept for accounting), then purge non-financial PII.
            $try('UPDATE payments p JOIN bookings b ON b.id = p.booking_id SET p.guest_name = ? WHERE b.email = ?', [
                'Former guest',
                $email,
            ]);
            $try(
                'UPDATE bookings SET name = ?, email = NULL, phone = NULL, address = NULL, postcode = NULL WHERE email = ?',
                ['Former guest', $email],
            );
            $try('DELETE FROM enquiries WHERE email = ?', [$email]);
            $try('DELETE FROM newsletter_subscribers WHERE email = ?', [$email]);
            $try('DELETE FROM waitlist WHERE email = ?', [$email]);
        }
        $try('DELETE FROM messages WHERE guest_id = ?', [$gid]);
        $try('DELETE FROM chat_threads WHERE guest_id = ?', [$gid]);
        $try('DELETE FROM guest_reviews WHERE guest_id = ?', [$gid]);
        $try('UPDATE guest_photos SET guest_id = NULL, guest_name = ? WHERE guest_id = ?', ['Former guest', $gid]);
        $try('DELETE FROM push_subscriptions WHERE guest_id = ?', [$gid]);
        $try('DELETE FROM guest_passkeys WHERE guest_id = ?', [$gid]);
        db()
            ->prepare('DELETE FROM guests WHERE id = ?')
            ->execute([$gid]);
        unset($_SESSION['guest_id']);
        json_out(['ok' => true]);

    // Staging sandbox ONLY: frictionless guest testing. Establishes a test-guest
    // session without the sign-in wall, so the owner can try all the guest-only
    // features. Refuses on any non-staging host. Reuses the owner-email guest (so
    // Test-centre test bookings appear in My Stays), creating it if needed.
    case 'staging_guest_session':
        // Gate on a SERVER-SIDE constant (defined only in the staging config.php),
        // NOT the client-controlled Host header: otherwise a spoofed
        // `Host: staging.…` sent to production could mint a credential-less guest
        // session bound to the owner-email guest. Host check kept as belt-and-braces.
        if (
            !(defined('STAGING_SANDBOX') && STAGING_SANDBOX) ||
            !preg_match('/(^|\.)staging\./i', $_SERVER['HTTP_HOST'] ?? '')
        ) {
            json_out(['error' => 'Not available'], 403);
        }
        if (!empty($_SESSION['guest_id'])) {
            $s = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
            $s->execute([$_SESSION['guest_id']]);
            json_out(['ok' => true, 'guest' => $s->fetch() ?: null]);
        }
        $email =
            defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL ? OWNER_NOTIFY_EMAIL : 'staging-guest@example.invalid';
        $s = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE email = ?');
        $s->execute([$email]);
        $g = $s->fetch();
        if (!$g) {
            db()
                ->prepare('INSERT INTO guests (name, email, password_hash) VALUES (?,?,?)')
                ->execute(['Staging Test Guest', $email, password_hash(bin2hex(random_bytes(9)), PASSWORD_DEFAULT)]);
            $gid = (int) db()->lastInsertId();
            $s = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE id = ?');
            $s->execute([$gid]);
            $g = $s->fetch();
        }
        $_SESSION['guest_id'] = (int) $g['id'];
        unset($_SESSION['admin_id']); // one role at a time
        json_out([
            'ok' => true,
            'guest' => [
                'name' => $g['name'],
                'email' => $g['email'],
                'phone' => $g['phone'],
                'address' => $g['address'],
                'postcode' => $g['postcode'],
            ],
        ]);

    // ----------- ADMIN: manage guest accounts -----------
    case 'guest_list':
        require_admin();
        $rows = db()->query('SELECT id, name, email, phone, created_at FROM guests ORDER BY name ASC')->fetchAll();
        json_out(['guests' => $rows]);

    case 'guest_reset_password':
        require_admin();
        $email = strtolower(clean($in['email'] ?? ''));
        $next = $in['next'] ?? '';
        if ($email === '') {
            json_out(['error' => 'Guest email is required'], 400);
        }
        if (strlen($next) < 8) {
            json_out(['error' => 'New password must be at least 8 characters'], 400);
        }
        $stmt = db()->prepare('SELECT id FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        if (!$row) {
            json_out(['error' => 'No guest account found with that email'], 404);
        }
        $hash = password_hash($next, PASSWORD_DEFAULT);
        db()
            ->prepare('UPDATE guests SET password_hash = ? WHERE id = ?')
            ->execute([$hash, $row['id']]);
        json_out(['ok' => true]);

    // Guest CRM: aggregate BOOKINGS (everyone who actually stayed, account or not)
    // by email into a lifetime-value view — stays, total spend, first/last stay,
    // favourite cottage, repeat flag — ranked best-first so the owner can see and
    // target their most valuable, most loyal guests.
    case 'guest_crm':
        require_admin();
        $rows = db()
            ->query(
                "SELECT LOWER(email) email, name, prop_key, check_in,
                        COALESCE(price_override, agreed_total, 0) val
                 FROM bookings WHERE email IS NOT NULL AND email <> ''",
            )
            ->fetchAll();
        $acct = [];
        foreach (db()->query('SELECT LOWER(email) email FROM guests')->fetchAll() as $a) {
            $acct[$a['email']] = true;
        }
        $g = [];
        foreach ($rows as $r) {
            $e = $r['email'];
            if (!isset($g[$e])) {
                $g[$e] = ['email' => $e, 'name' => '', 'stays' => 0, 'ltv' => 0.0, 'last' => '', 'first' => '', 'props' => []];
            }
            $g[$e]['stays']++;
            $g[$e]['ltv'] += (float) $r['val'];
            if ($r['check_in'] > $g[$e]['last']) {
                $g[$e]['last'] = $r['check_in'];
            }
            if ($g[$e]['first'] === '' || $r['check_in'] < $g[$e]['first']) {
                $g[$e]['first'] = $r['check_in'];
            }
            if ($r['name']) {
                $g[$e]['name'] = $r['name'];
            }
            $p = $r['prop_key'];
            $g[$e]['props'][$p] = ($g[$e]['props'][$p] ?? 0) + 1;
        }
        $out = [];
        foreach ($g as $e => $d) {
            arsort($d['props']);
            $out[] = [
                'email' => $e,
                'name' => $d['name'],
                'stays' => $d['stays'],
                'ltv' => round($d['ltv'], 2),
                'last_stay' => $d['last'],
                'first_stay' => $d['first'],
                'fav_prop' => array_key_first($d['props']),
                'repeat' => $d['stays'] > 1,
                'has_account' => isset($acct[$e]),
            ];
        }
        // Best guests first: lifetime value, then stay count.
        usort($out, fn($a, $b) => $b['ltv'] <=> $a['ltv'] ?: $b['stays'] <=> $a['stays']);
        json_out(['guests' => $out]);

    // One-tap "invite back": send the returning-guest re-invite to a past guest,
    // referencing their most recent stay.
    case 'guest_reinvite':
        require_admin();
        $email = strtolower(clean($in['email'] ?? ''));
        if ($email === '') {
            json_out(['error' => 'Guest email is required'], 400);
        }
        $s = db()->prepare(
            'SELECT name, prop_key, check_in FROM bookings WHERE LOWER(email) = ? ORDER BY check_in DESC LIMIT 1',
        );
        $s->execute([$email]);
        $b = $s->fetch();
        if (!$b) {
            json_out(['error' => 'No past booking found for that guest'], 404);
        }
        require_once __DIR__ . '/mailer.php';
        $d = function_exists('prop_display') ? prop_display($b['prop_key']) : ['name' => $b['prop_key']];
        $r = send_anniversary_email([
            'email' => $email,
            'name' => $b['name'],
            'prop_key' => $b['prop_key'],
            'prop_name' => $d['name'] ?: $b['prop_key'],
            'check_in' => $b['check_in'],
        ]);
        if (empty($r['ok'])) {
            json_out(['error' => $r['error'] ?? 'Could not send the email'], 400);
        }
        log_activity('guest', 'guest.reinvite', 'Re-invited past guest', ['entity' => 'guest', 'meta' => ['email' => $email]]);
        json_out(['ok' => true]);

    default:
        json_out(['error' => 'Unknown action'], 400);
}
