<?php
// ============================================================
//  auth.php — admin & guest authentication.
//  POST {action: ...}
//  Admin:  admin_login (username or email), admin_2fa (+ _resend), admin_logout,
//          admin_status, admin_change_password, admin_reauth_password,
//          admin_reset_request / admin_link_check / admin_reset_save /
//          admin_invite_accept (the links people.php and the sign-in page send),
//          admin_me_set, admin_email_begin / _finish, admin_twofa_set,
//          admin_avatar_set / _remove (your own details)
//  Guest:  guest_register, guest_login, guest_logout, guest_status
// ============================================================
// Sign-in writes the session, so this endpoint keeps its lock (session-lib.php).
define('CHB_KEEPS_SESSION', true);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/webpush.php'; // each person's alert settings (notify_prefs_for)
guest_session_check(); // a revoked guest session (migration-127) is signed out before any action reads it

// ---- Login rate-limiting (5 failures per 10 min, per IP + account) ----
// Resilient: if the login_attempts table doesn't exist (migration not run),
// these helpers silently do nothing, so logins are never blocked by a missing table.
// PROVING AN ADDRESS (the magic link or an emailed code): stamps email_verified_at,
// and ENDS ANY CLAIM THAT CAME BEFORE IT. An unproven account's password was chosen
// by whoever registered, which may not be the person reading this inbox — so
// proving the address from any OTHER browser clears that password, forgets its
// passkeys and signs out every earlier session. Returns whether it did.
function guest_prove_address(int $gid): bool
{
    $reset = false;
    try {
        $vq = db()->prepare('SELECT email_verified_at FROM guests WHERE id = ?');
        $vq->execute([$gid]);
        $wasProven = $vq->fetchColumn() !== null;
        if (!$wasProven && (int) ($_SESSION['reg_gid'] ?? 0) !== $gid) {
            db()->prepare("UPDATE guests SET password_hash = '', auth_epoch = auth_epoch + 1 WHERE id = ?")->execute([$gid]);
            try {
                db()->prepare('DELETE FROM guest_passkeys WHERE guest_id = ?')->execute([$gid]);
            } catch (\Throwable $e) {
            }
            // Everything else the earlier claim set up goes with it: its phones would
            // go on receiving this guest's booking and payment alerts, its photo would
            // sit beside their bookings, and its chat would read as theirs.
            foreach (['DELETE FROM push_subscriptions WHERE guest_id = ?', 'UPDATE chat_threads SET guest_id = NULL WHERE guest_id = ?'] as $sql) {
                try {
                    db()->prepare($sql)->execute([$gid]);
                } catch (\Throwable $e) {
                }
            }
            try {
                $was = guest_avatar_name($gid);
                db()->prepare('UPDATE guests SET avatar = NULL WHERE id = ?')->execute([$gid]);
                avatar_delete($was);
            } catch (\Throwable $e) {
            }
            $reset = true;
            log_activity('account', 'guest.claim_reset', 'Email confirmed from a new browser — the unconfirmed password was cleared and other sessions signed out', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) $gid]);
        }
        db()->prepare('UPDATE guests SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?')->execute([$gid]);
    } catch (\Throwable $e) {
        // migration-111/127 not applied — nothing to stamp.
    }
    unset($_SESSION['reg_gid']);
    return $reset;
}
function guest_code_hash(string $email, string $code): string
{
    return hash_hmac('sha256', 'code:' . strtolower($email) . ':' . $code, APP_SECRET);
}
// AN EMAILED CODE IS A WHOLE SIGN-IN (a guest's, and the back office's), so wrong
// guesses are counted over a DAY across every IP, not only the ten minutes
// throttle_check() watches. Six digits is a million codes: at that check's
// ceiling (20 wrong per 10 minutes, any number of IPs) a patient guesser had about
// a 0.3% chance a day. Ten a day makes it about 0.001%. Past it, codes for that
// address pause until the day is out; a passkey or a password still works. Every
// address is treated the same, so the pause says nothing about who has a sign-in.
const CODE_DAILY_FAILS = 10;
const CODE_PAUSED = 'Too many wrong codes have been tried for this email today, so codes for it are paused until tomorrow. A passkey or a password still works, if you have one.';
// Asking for a code while paused: a guest's account still gets a one-tap LINK, which
// cannot be guessed, so somebody else's ten wrong guesses no longer lock a guest out
// of their stay (and its door code) for the day. The same words for every address.
const CODE_PAUSED_LINK = 'Too many wrong codes have been tried for this email today, so codes are paused until tomorrow. If it has a guest account, we have emailed it a link that signs you in instead. A passkey or a password still works too.';
function code_paused(string $email): bool
{
    try {
        $s = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND success = 0 AND attempted_at > (NOW() - INTERVAL 1 DAY)');
        $s->execute(['codev:' . strtolower($email)]);
        return (int) $s->fetchColumn() >= CODE_DAILY_FAILS;
    } catch (\Throwable $e) {
        return false; // no login_attempts table: a missing table never blocks a sign-in
    }
}

function throttle_check($identifier)
{
    try {
        $ip = client_ip_key();
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
// ONE DAILY ALLOWANCE OF SIGN-IN EMAILS PER ADDRESS, across every kind (a code,
// a magic link, a re-sent confirmation, a reset link) and every sender. Each kind
// had its own short-window throttle, which still let a stranger send thousands a
// day to one inbox, and one path (the right password on an unconfirmed account)
// re-sent a link on every try with no limit at all. Over the allowance the
// request is answered exactly as before and nothing is sent.
const SIGNIN_MAILS_PER_DAY = 10;
function signin_mail_allowed($email)
{
    $email = strtolower(trim((string) $email));
    if ($email === '') {
        return false;
    }
    $key = 'mailto:' . substr(sha1($email), 0, 40);
    try {
        $s = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND attempted_at > (NOW() - INTERVAL 1 DAY)');
        $s->execute([$key]);
        if ((int) $s->fetchColumn() >= SIGNIN_MAILS_PER_DAY) {
            return false;
        }
        db()->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?,?,0)')->execute([client_ip_key(), $key]);
    } catch (\Throwable $e) {
    }
    return true;
}
function throttle_record($identifier, $ok)
{
    try {
        $ip = client_ip_key();
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


// ---- A NEW DEVICE ASKS FOR A CODE, sent to the person signing in ----
// (admin_twofa_on and its two helpers live in db.php: the Devices list reads them too.)
// A trusted device belongs to the person who trusted it. Rows from before
// people existed have no admin_id and were the first owner's.
function admin_device_trusted($uid)
{
    $tok = preg_replace('/[^a-f0-9]/i', '', (string) ($_COOKIE['chb_admin_device'] ?? ''));
    if (strlen($tok) < 32) {
        return false;
    }
    $uid = (int) $uid;
    try {
        try {
            $s = db()->prepare('SELECT id, admin_id FROM admin_devices WHERE token_hash = ? LIMIT 1');
            $s->execute([hash('sha256', $tok)]);
            $r = $s->fetch();
            $owner = $r ? ($r['admin_id'] === null ? admin_original_owner_id() : (int) $r['admin_id']) : 0;
        } catch (\Throwable $e) {
            // admin_id not migrated yet: every device was the one owner's
            $s = db()->prepare('SELECT id FROM admin_devices WHERE token_hash = ? LIMIT 1');
            $s->execute([hash('sha256', $tok)]);
            $r = $s->fetch();
            $owner = $r ? $uid : 0;
        }
        if ($r && $owner === $uid) {
            db()->prepare('UPDATE admin_devices SET last_seen = NOW() WHERE id = ?')->execute([(int) $r['id']]);
            return true;
        }
    } catch (\Throwable $e) {
        // table not migrated yet → treat as untrusted
    }
    return false;
}
function admin_trust_this_device($uid)
{
    try {
        $tok = bin2hex(random_bytes(20));
        $ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
        try {
            db()
                ->prepare('INSERT INTO admin_devices (token_hash, user_agent, last_seen, admin_id) VALUES (?,?,NOW(),?)')
                ->execute([hash('sha256', $tok), $ua, (int) $uid]);
        } catch (\Throwable $e) {
            db()
                ->prepare('INSERT INTO admin_devices (token_hash, user_agent, last_seen) VALUES (?,?,NOW())')
                ->execute([hash('sha256', $tok), $ua]);
        }
        setcookie('chb_admin_device', $tok, [
            'expires' => time() + 60 * 60 * 24 * 60,
            'path' => '/',
            'secure' => request_is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        // The sign-in this precedes is recorded with the trust it now has, so
        // signing that device out later forgets it for two-step too.
        $_COOKIE['chb_admin_device'] = $tok;
    } catch (\Throwable $e) {
    }
}
// A person by what they typed: a username, or an email (with an @). Removed and
// invited people are found too — the callers decide what each may do.
// THE ADDRESS THAT GETS YOUR CODES IS AN ADDRESS YOU CAN SIGN IN WITH. The first
// owner's codes and reset links go to the owner address in config.php while their
// own email is still blank (admin_contact_email), so that address finds them too,
// and is written onto their row there and then. Looking up the column alone sent
// that owner down the GUEST path with the very address their codes arrive at.
function admin_find($ident)
{
    $ident = strtolower(trim((string) $ident));
    if ($ident === '') {
        return null;
    }
    try {
        if (strpos($ident, '@') !== false) {
            $q = db()->prepare('SELECT * FROM admins WHERE email = ? ORDER BY (removed_at IS NULL) DESC, id LIMIT 1');
            $q->execute([$ident]);
            $row = $q->fetch() ?: null;
            if (!$row) {
                $first = admin_row(admin_original_owner_id(), true);
                if ($first && (string) ($first['email'] ?? '') === '' && admin_contact_email($first) === $ident) {
                    $row = admin_backfill_owner($first);
                }
            }
            return $row;
        }
        $q = db()->prepare('SELECT * FROM admins WHERE username = ? LIMIT 1');
        $q->execute([$ident]);
        return $q->fetch() ?: null;
    } catch (\Throwable $e) {
        return null; // no email column yet: only usernames can be looked up
    }
}
function admin_switched_off()
{
    $o = admin_owner_first();
    return 'This sign-in has been switched off. Ask ' . ($o !== '' ? $o : 'the owner') . ' if you need it back.';
}
// What the browser is told about the person signed in.
function admin_me_payload($row)
{
    $me = people_public($row, (int) $row['id']);
    $me['contact'] = admin_contact_email($row);
    $me['twofa'] = admin_twofa_wanted($row);
    $me['twofaLive'] = admin_twofa_on($row);
    $me['original'] = (int) $row['id'] === admin_original_owner_id();
    $me['notify'] = notify_prefs_for($row);
    $me += people_mail_payload($row);
    return $me;
}
// The first owner's row predates the email column: fill it once from the owner
// address the server already knows, unless someone else is using it.
function admin_backfill_owner($row)
{
    if (!is_array($row) || !array_key_exists('email', $row) || (string) $row['email'] !== '') {
        return $row;
    }
    if ((int) $row['id'] !== admin_original_owner_id() || !defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) {
        return $row;
    }
    $e = strtolower((string) OWNER_NOTIFY_EMAIL);
    try {
        $q = db()->prepare('SELECT COUNT(*) FROM admins WHERE email = ? AND id <> ?');
        $q->execute([$e, (int) $row['id']]);
        if ((int) $q->fetchColumn() === 0) {
            db()->prepare("UPDATE admins SET email = ? WHERE id = ? AND email = ''")->execute([$e, (int) $row['id']]);
            $row['email'] = $e;
        }
    } catch (\Throwable $e2) {
    }
    return $row;
}
// Finish a sign-in (a password, an emailed code, a new-device code, an invite or
// reset, and the staging seat): a new session id, the person's own session, and a
// note in the log saying how, a warning when the device or place is new to THIS person.
// $proven: the person has JUST proved themselves beyond signing in (an invite or
// reset link from their own inbox, and a password chosen a moment ago), so the
// step-up window starts now and the passkey offer that follows needs no prompt.
// $via: how, for the Devices list (devices_how_words).
function admin_complete_login($uid, array $extra = [], string $how = '', bool $proven = false, string $via = '')
{
    session_regenerate_id(true); // new session id on login — prevents session fixation
    $dev = admin_session_begin((int) $uid, $via);
    if ($proven) {
        reauth_stamp();
    }
    unset($_SESSION['pending_admin_2fa'], $_SESSION['admin_email_proof']);
    csrf_issue_cookie();
    $row = admin_backfill_owner(admin_row((int) $uid, true));
    $who = $row ? people_display_name($row) : 'Owner';
    $fp = ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);
    $prevFp = is_array($row) && array_key_exists('last_login_fp', $row) ? (string) $row['last_login_fp'] : null;
    if ($prevFp === null || ($prevFp === '' && (int) $uid === admin_original_owner_id())) {
        $prevFp = content_value('admin-last-login-fp'); // where it lived before people
    }
    // A NEW DEVICE is one this browser's own key has never signed in from (the
    // Devices list knows). The address-and-browser fingerprint is only the answer
    // before that list exists: a phone's address changes all day, so it called
    // the same phone "new" over and over.
    $isNew = $dev['new'] ?? null;
    if ($isNew === null) {
        $isNew = $prevFp !== '' && $prevFp !== $fp;
    }
    try {
        db()->prepare('UPDATE admins SET last_login_fp = ? WHERE id = ?')->execute([$fp, (int) $uid]);
    } catch (\Throwable $e) {
        try {
            db()
                ->prepare(
                    "INSERT INTO content (item_key, item_value) VALUES ('admin-last-login-fp', ?)
                     ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
                )
                ->execute([json_encode($fp)]);
        } catch (\Throwable $e2) {
        }
    }
    $how = $how !== '' ? ' ' . $how : '';
    if ($isNew) {
        $on = ($dev['label'] ?? '') !== '' ? ' on a new device: ' . $dev['label'] : ' from a new device or location';
        log_activity('account', 'admin.login_new', $who . ' signed in' . $how . $on, ['severity' => 'warn', 'meta' => ['detail' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 120)]]);
        // They are told, on their phones and by email, with a way to sign it out.
        if ($row && !empty($dev['sid'])) {
            devices_alert_new($row, (int) $dev['sid'], (string) $dev['label'], $via);
        }
    } else {
        log_activity('account', 'admin.login', $who . ' signed in' . $how);
    }
    json_out(['ok' => true, 'me' => $row ? admin_me_payload($row) : null, 'ownerFirst' => admin_owner_first()] + $extra);
}
// Send a 6-digit code for a new device to the person's own email, and hold the
// sign-in until it comes back (admin_2fa).
function admin_send_device_code($row)
{
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $to = admin_contact_email($row);
    $_SESSION['pending_admin_2fa'] = [
        'uid' => (int) $row['id'],
        'hash' => hash('sha256', $code),
        'exp' => time() + 600, // 10 minutes
        'tries' => 0,
    ];
    try {
        require_once __DIR__ . '/mailer.php';
        if (function_exists('smtp_send')) {
            // Composed by admin_code_body() in mailer.php, so it can be previewed
            // and the render gate can prove it builds.
            $m = admin_code_body($code, 'device', people_first_name($row));
            smtp_send($to, people_display_name($row), $m['subject'], $m['text'], $m['html']);
        }
    } catch (\Throwable $e) {
    }
    log_activity('account', 'admin.2fa_sent', 'Sign-in code emailed to ' . people_display_name($row) . ' for a new device', ['actor' => 'system', 'severity' => 'warn']);
    json_out(['ok' => true, 'twofa' => true, 'to' => admin_mask_email($to)]);
}
// Which person a link is for, if it is still good; null otherwise.
function admin_link_row($link, $kind)
{
    $p = people_link_parse((string) $link);
    if (!$p) {
        return null;
    }
    $row = admin_row($p['id'], true);
    return people_link_ok($row, $p['token'], $kind, time()) ? $row : null;
}
function admin_link_dead($kind)
{
    $o = admin_owner_first();
    return $kind === 'invite'
        ? 'This invite link has been used or has expired. Ask ' . ($o !== '' ? $o : 'the owner') . ' to send a new one.'
        : 'This link has been used or has expired. Ask for a new one from the sign-in page.';
}

// Did this request pass staging-gate.php? Two proofs, matching the gate's own
// two ways in: the signed cookie its form login sets (HMAC of the gate username
// with APP_SECRET — recomputed here, so the two files cannot disagree), or the
// Basic-Auth header a native-dialog sign-in carries. Fails CLOSED when the gate
// credentials are unset — an unconfigured gate must not mean an open one.
function staging_gate_passed()
{
    $user = defined('STAGING_GATE_USER') ? (string) STAGING_GATE_USER : '';
    $pass = defined('STAGING_GATE_PASS') ? (string) STAGING_GATE_PASS : '';
    $secret = defined('APP_SECRET') ? (string) APP_SECRET : '';
    if ($user === '' || $secret === '') {
        return false;
    }
    $want = hash_hmac('sha256', 'staging-gate|' . $user . '|' . hash('sha256', $pass), $secret); // the PASSWORD rides the cookie: changing it revokes every cookie
    if (isset($_COOKIE['chb_staging_gate']) && hash_equals($want, (string) $_COOKIE['chb_staging_gate'])) {
        return true;
    }
    $bu = $_SERVER['PHP_AUTH_USER'] ?? null;
    $bp = $_SERVER['PHP_AUTH_PW'] ?? null;
    if ($bu === null) {
        $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if (preg_match('/Basic\s+(.+)/i', $hdr, $m)) {
            $dec = base64_decode($m[1], true);
            if ($dec !== false && strpos($dec, ':') !== false) {
                [$bu, $bp] = explode(':', $dec, 2);
            }
        }
    }
    return $pass !== '' &&
        is_string($bu) &&
        is_string($bp) &&
        hash_equals($user, $bu) &&
        hash_equals($pass, (string) $bp);
}

switch ($action) {
    // ---------------- ADMIN ----------------
    case 'admin_login':
        // What was typed: a username, or the person's own email. Either way the
        // password decides; a new device then gets a code at the person's inbox.
        $username = strtolower(clean($in['username'] ?? ''));
        $password = field_text($in['password'] ?? '');
        throttle_check('admin:' . $username);
        $row = admin_find($username);
        $hash = auth_hash_for($row);
        if (!password_verify($password, $hash) || !$row || $hash === auth_dummy_hash()) {
            throttle_record('admin:' . $username, false);
            // Diagnose WHY for the owner's log — the HTTP reply below stays generic
            // so an attacker learns nothing. The one sign-in form tries owner first
            // and falls back to guest, so a REGISTERED GUEST's email landing here is
            // routine, not an attack: skip the owner-side warning entirely and let
            // the guest attempt that follows log its own real outcome.
            $reason = $row ? 'wrong password for ' . people_display_name($row) : 'not a back-office username';
            if (!$row && strpos($username, '@') !== false) {
                try {
                    $gq = db()->prepare('SELECT COUNT(*) FROM guests WHERE email = ?');
                    $gq->execute([$username]);
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
                $fq->execute(['admin:' . $username]);
                $fails = (int) $fq->fetchColumn();
            } catch (\Throwable $e) {
            }
            if ($fails === 1) {
                log_activity('account', 'admin.login_fail', 'Failed back-office sign-in — ' . $reason, ['actor' => 'system', 'severity' => 'warn', 'meta' => ['detail' => 'username: ' . mb_substr($username, 0, 60)]]);
            } elseif (in_array($fails, [5, 15, 30], true)) {
                log_activity('account', 'admin.login_burst', $fails . ' failed back-office sign-in attempts in 15 min — ' . $reason, ['actor' => 'system', 'severity' => 'action', 'meta' => ['detail' => 'username: ' . mb_substr($username, 0, 60)]]);
            }
            json_out(['error' => 'Incorrect username or password'], 401);
        }
        throttle_record('admin:' . $username, true);
        // A hash made at an older cost is brought up to this PHP's default on a
        // sign-in that proved the password, so real hashes and the dummy agree.
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            try {
                db()->prepare('UPDATE admins SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), (int) $row['id']]);
            } catch (\Throwable $e) {
            }
        }
        // The right password for someone whose access was removed: say so, since
        // only they could have typed it.
        if (!empty($row['removed_at'])) {
            json_out(['error' => admin_switched_off(), 'code' => 'removed'], 403);
        }
        if (admin_twofa_on($row) && !admin_device_trusted((int) $row['id'])) {
            admin_send_device_code($row);
        }
        admin_complete_login((int) $row['id'], [], 'with a password', false, 'password');

    case 'admin_2fa':
        // Verify the emailed one-time code and finish the held login.
        rate_limit('admin2fa', 8, 15);
        $p = $_SESSION['pending_admin_2fa'] ?? null;
        if (!is_array($p) || (int) ($p['exp'] ?? 0) < time()) {
            unset($_SESSION['pending_admin_2fa']);
            if (is_array($p)) {
                log_activity('account', 'admin.2fa_fail', 'A sign-in code expired before it was used (10-minute window)', ['actor' => 'system', 'severity' => 'warn']);
            }
            json_out(['error' => 'That code has expired — please sign in again.', 'code' => 'expired'], 401);
        }
        if ((int) ($p['tries'] ?? 0) >= 5) {
            unset($_SESSION['pending_admin_2fa']);
            log_activity('account', 'admin.2fa_fail', 'A back-office sign-in was cancelled — 5 wrong one-time codes in a row', ['actor' => 'system', 'severity' => 'action']);
            json_out(['error' => 'Too many attempts — please sign in again.', 'code' => 'too_many'], 429);
        }
        $_SESSION['pending_admin_2fa']['tries'] = (int) ($p['tries'] ?? 0) + 1;
        $code = preg_replace('/\D/', '', (string) ($in['code'] ?? ''));
        if ($code === '' || !hash_equals((string) ($p['hash'] ?? ''), hash('sha256', $code))) {
            // First typo only (retries are normal) — the cancel above covers persistence.
            if ((int) ($p['tries'] ?? 0) === 0) {
                log_activity('account', 'admin.2fa_fail', 'Wrong one-time sign-in code entered (two-step)', ['actor' => 'system', 'severity' => 'warn']);
            }
            json_out(['error' => 'That code isn’t right. Try again, or send a new one.', 'code' => 'wrong'], 401);
        }
        $two = admin_row((int) $p['uid'], true);
        if (!$two || !empty($two['removed_at'])) {
            unset($_SESSION['pending_admin_2fa']);
            json_out(['error' => admin_switched_off(), 'code' => 'removed'], 403);
        }
        if (!empty($in['remember'])) {
            admin_trust_this_device((int) $p['uid']);
        }
        admin_complete_login((int) $p['uid'], [], 'with a password and a code to their email', false, 'password_code');

    // A new code for the device step, to the same person (the held sign-in).
    case 'admin_2fa_resend':
        rate_limit('admin2fa_resend', 4, 15);
        $p = $_SESSION['pending_admin_2fa'] ?? null;
        $two = is_array($p) ? admin_row((int) ($p['uid'] ?? 0), true) : null;
        if (!$two || !empty($two['removed_at'])) {
            json_out(['error' => 'That sign-in has expired — please sign in again.', 'code' => 'expired'], 401);
        }
        admin_send_device_code($two);

    case 'admin_logout':
        $me = admin_me();
        log_activity('account', 'admin.logout', ($me ? people_display_name($me) : 'Owner') . ' signed out');
        // This device stops getting the owner's alerts (push_subs_drop).
        if ($me && is_string($in['push_endpoint'] ?? null) && $in['push_endpoint'] !== '') {
            push_subs_drop('admin', (int) $me['id'], (string) $in['push_endpoint']);
        }
        session_end_signed_in();
        json_out(['ok' => true]);

    case 'admin_status':
        $me = admin_me();
        if (!$me) {
            // This device was signed out from a Devices list: said once, so the page
            // can say so rather than a bare "your sign-in has ended".
            $ended = (string) ($_SESSION['admin_ended'] ?? '');
            unset($_SESSION['admin_ended']);
            json_out(['admin' => false] + ($ended !== '' ? ['ended' => $ended] : []));
        }
        $me = admin_backfill_owner($me);
        json_out(['admin' => true, 'me' => admin_me_payload($me), 'ownerFirst' => admin_owner_first()]);

    // STEP-UP by password: prove it is still you, right now, before a refund.
    // Throttled on the SAME identifier as sign-in, so this cannot become a
    // quieter way to guess a password; a failure is recorded there too. Never
    // mints or extends a session — it only stamps the window.
    case 'admin_reauth_password':
        require_admin();
        $pw = field_text($in['password'] ?? '');
        $stmt = db()->prepare('SELECT username, password_hash FROM admins WHERE id = ?');
        $stmt->execute([$_SESSION['admin_id']]);
        $row = $stmt->fetch();
        $ident = 'admin:' . strtolower((string) ($row['username'] ?? ''));
        throttle_check($ident);
        if (!$row || !password_verify($pw, auth_hash_for($row))) {
            throttle_record($ident, false);
            log_activity('account', 'admin.reauth_fail', 'Confirmation failed before a refund', ['severity' => 'warn']);
            json_out(['error' => 'That password did not match.'], 403);
        }
        throttle_record($ident, true);
        reauth_stamp();
        json_out(['ok' => true]);

    // Change your own password. Your other sessions are signed out (the epoch
    // moves); this one is re-stamped so you stay in where you are.
    case 'admin_change_password':
        require_admin();
        $current = field_text($in['current'] ?? '');
        $next = field_text($in['next'] ?? '');
        if (strlen($next) < 12) {
            json_out(['error' => 'New password must be at least 12 characters'], 400);
        }
        $stmt = db()->prepare('SELECT username, password_hash FROM admins WHERE id = ?');
        $stmt->execute([$_SESSION['admin_id']]);
        $row = $stmt->fetch();
        // Throttled and logged on the SAME identifier as sign-in, like the refund
        // confirmation: otherwise a borrowed session could guess the password here
        // without limit and nothing would say so.
        $ident = 'admin:' . strtolower((string) ($row['username'] ?? ''));
        throttle_check($ident);
        if (!$row || !password_verify($current, auth_hash_for($row))) {
            throttle_record($ident, false);
            log_activity('account', 'admin.password_change_fail', 'A password change was refused: the current password did not match', ['severity' => 'warn']);
            json_out(['error' => 'Current password is incorrect'], 403);
        }
        throttle_record($ident, true);
        $hash = password_hash($next, PASSWORD_DEFAULT);
        try {
            db()->prepare('UPDATE admins SET password_hash = ?, auth_epoch = auth_epoch + 1, reset_hash = NULL, reset_expires = NULL WHERE id = ?')->execute([$hash, $_SESSION['admin_id']]);
            $_SESSION['admin_epoch'] = (int) ((admin_row((int) $_SESSION['admin_id'], true) ?: [])['auth_epoch'] ?? 0);
            // The devices this signs out stop getting alerts too; this one keeps its own.
            push_subs_drop('admin', (int) $_SESSION['admin_id'], '', is_string($in['push_endpoint'] ?? null) ? (string) $in['push_endpoint'] : '');
            // …and leave the Devices list.
            devices_end_others((int) $_SESSION['admin_id'], (int) ($_SESSION['admin_sess'] ?? 0), 'password');
        } catch (\Throwable $e) {
            db()->prepare('UPDATE admins SET password_hash = ? WHERE id = ?')->execute([$hash, $_SESSION['admin_id']]);
        }
        $me = admin_me();
        log_activity('account', 'admin.password_change', ($me ? people_display_name($me) : 'Owner') . ' changed their password');
        json_out(['ok' => true]);

    // ---- Forgotten password: a link to the person's own inbox, never anyone
    // else's. The reply is the same whether or not such a sign-in exists. ----
    case 'admin_reset_request':
        rate_limit('admin_reset', 5, 15);
        $ident = strtolower(clean($in['id'] ?? ''));
        throttle_check('areset:' . $ident);
        $row = admin_find($ident);
        if ($row && empty($row['removed_at']) && empty($row['invited_at']) && (string) ($row['password_hash'] ?? '') !== '' && signin_mail_allowed(admin_contact_email($row))) {
            if (admin_send_link($row, 'reset')) {
                log_activity('account', 'admin.reset_sent', 'Password reset link emailed to ' . people_display_name($row), ['actor' => 'system']);
            }
        }
        throttle_record('areset:' . $ident, false);
        json_out(['ok' => true]);

    // What a link is for, so the page can greet the person before they type.
    case 'admin_link_check':
        rate_limit('admin_link', 20, 15);
        $kind = ($in['kind'] ?? '') === 'invite' ? 'invite' : 'reset';
        $row = admin_link_row($in['link'] ?? '', $kind);
        if (!$row) {
            json_out(['error' => admin_link_dead($kind), 'code' => 'dead'], 410);
        }
        // `email` is the address they sign in with: the page files the password they
        // choose under it, so a phone's password manager offers it at the next sign-in.
        // Their own address, shown to whoever holds their own link.
        json_out(['ok' => true, 'first' => people_first_name($row), 'username' => (string) $row['username'], 'email' => admin_contact_email($row), 'by' => admin_owner_first()]);

    // The invite's last step: the person chooses their own password. The link,
    // or a code this browser has just proved for their email, is the proof.
    case 'admin_invite_accept':
        rate_limit('admin_link', 20, 15);
        $row = admin_link_row($in['link'] ?? '', 'invite');
        if (!$row) {
            $proof = $_SESSION['admin_email_proof'] ?? null;
            $cand = is_array($proof) && time() - (int) ($proof['at'] ?? 0) < 900 ? admin_row((int) ($proof['id'] ?? 0), true) : null;
            $row = $cand && !empty($cand['invited_at']) && empty($cand['removed_at']) ? $cand : null;
        }
        if (!$row) {
            json_out(['error' => admin_link_dead('invite'), 'code' => 'dead'], 410);
        }
        $bad = people_password_problem(field_text($in['password'] ?? ''), isset($in['again']) ? field_text($in['again']) : null);
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }
        db()
            ->prepare('UPDATE admins SET password_hash = ?, invited_at = NULL, invite_hash = NULL, invite_expires = NULL, auth_epoch = auth_epoch + 1 WHERE id = ?')
            ->execute([password_hash(field_text($in['password'] ?? ''), PASSWORD_DEFAULT), (int) $row['id']]);
        log_activity('account', 'admin.invite_accepted', people_display_name($row) . ' chose a password and signed in for the first time', ['actor' => 'admin:' . (int) $row['id']]);
        admin_trust_this_device((int) $row['id']); // the link came to their inbox: that is the proof
        admin_complete_login((int) $row['id'], [], '', true, 'invite');

    // A reset link's last step: a new password, and every other session ends.
    case 'admin_reset_save':
        rate_limit('admin_link', 20, 15);
        $row = admin_link_row($in['link'] ?? '', 'reset');
        if (!$row) {
            json_out(['error' => admin_link_dead('reset'), 'code' => 'dead'], 410);
        }
        $bad = people_password_problem(field_text($in['password'] ?? ''), isset($in['again']) ? field_text($in['again']) : null);
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }
        db()
            ->prepare('UPDATE admins SET password_hash = ?, reset_hash = NULL, reset_expires = NULL, auth_epoch = auth_epoch + 1 WHERE id = ?')
            ->execute([password_hash(field_text($in['password'] ?? ''), PASSWORD_DEFAULT), (int) $row['id']]);
        push_subs_drop('admin', (int) $row['id']); // every device it signed out; this one re-registers at sign-in
        devices_end_others((int) $row['id'], 0, 'reset'); // …and leaves the Devices list
        log_activity('account', 'admin.reset_done', people_display_name($row) . ' chose a new password from a reset link — every other session was signed out', ['actor' => 'admin:' . (int) $row['id']]);
        admin_trust_this_device((int) $row['id']);
        admin_complete_login((int) $row['id'], [], '', true, 'reset');

    // ---- Your own details ----
    case 'admin_me_set':
        require_admin();
        $field = (string) ($in['field'] ?? '');
        $val = trim((string) ($in['value'] ?? ''));
        $me = admin_me();
        if ($field === 'name') {
            $bad = people_name_problem($val);
            if ($bad !== '') {
                json_out(['error' => $bad === 'Enter their name.' ? 'Enter your name.' : $bad], 400);
            }
            db()->prepare('UPDATE admins SET name = ? WHERE id = ?')->execute([$val, (int) $me['id']]);
        } elseif ($field === 'username') {
            $val = strtolower($val);
            $bad = people_username_problem($val);
            if ($bad !== '') {
                json_out(['error' => $bad], 400);
            }
            $q = db()->prepare('SELECT COUNT(*) FROM admins WHERE username = ? AND id <> ?');
            $q->execute([$val, (int) $me['id']]);
            if ((int) $q->fetchColumn() > 0) {
                json_out(['error' => 'Someone already signs in with that username.'], 409);
            }
            db()->prepare('UPDATE admins SET username = ? WHERE id = ?')->execute([$val, (int) $me['id']]);
        } else {
            json_out(['error' => 'Unknown field'], 400);
        }
        json_out(['ok' => true, 'me' => admin_me_payload(admin_row((int) $me['id'], true))]);

    // A new email only changes once a code sent TO it comes back.
    case 'admin_email_begin':
        require_admin();
        // The email is where codes and reset links go: changing it hands over the
        // account, so a borrowed session must prove it is still you first.
        require_reauth('changing the email you sign in with');
        rate_limit('admin_email', 5, 15);
        $email = strtolower(trim((string) ($in['email'] ?? '')));
        $bad = people_email_problem($email);
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }
        $me = admin_me();
        $q = db()->prepare('SELECT COUNT(*) FROM admins WHERE email = ? AND id <> ?');
        $q->execute([$email, (int) $me['id']]);
        if ((int) $q->fetchColumn() > 0) {
            json_out(['error' => 'Someone else signs in with that email.'], 409);
        }
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $_SESSION['admin_email_change'] = ['email' => $email, 'hash' => hash('sha256', $code), 'exp' => time() + 1800, 'tries' => 0];
        require_once __DIR__ . '/mailer.php';
        $m = admin_code_body($code, 'email', people_first_name($me));
        $r = smtp_send($email, people_display_name($me), $m['subject'], $m['text'], $m['html']);
        if (is_array($r) && empty($r['ok'])) {
            json_out(['error' => 'The code couldn’t be sent to that address. Check it and try again.'], 502);
        }
        json_out(['ok' => true, 'to' => admin_mask_email($email)]);

    case 'admin_email_finish':
        require_admin();
        $p = $_SESSION['admin_email_change'] ?? null;
        if (!is_array($p) || (int) ($p['exp'] ?? 0) < time()) {
            unset($_SESSION['admin_email_change']);
            json_out(['error' => 'That code has expired. Start again to send a new one.', 'code' => 'expired'], 401);
        }
        if ((int) ($p['tries'] ?? 0) >= 5) {
            unset($_SESSION['admin_email_change']);
            json_out(['error' => 'Too many tries. Start again to send a new code.', 'code' => 'too_many'], 429);
        }
        $_SESSION['admin_email_change']['tries'] = (int) ($p['tries'] ?? 0) + 1;
        $code = preg_replace('/\D/', '', (string) ($in['code'] ?? ''));
        if ($code === '' || !hash_equals((string) $p['hash'], hash('sha256', $code))) {
            json_out(['error' => 'That code isn’t right. Check the latest email and try again.', 'code' => 'wrong'], 401);
        }
        $me = admin_me();
        db()->prepare('UPDATE admins SET email = ? WHERE id = ?')->execute([(string) $p['email'], (int) $me['id']]);
        unset($_SESSION['admin_email_change']);
        // A warning, so it reaches Needs attention: where sign-in codes go is the
        // one change someone taking over an account would make first.
        log_activity('account', 'admin.email_change', people_display_name($me) . ' changed their sign-in email', ['severity' => 'warn']);
        json_out(['ok' => true, 'me' => admin_me_payload(admin_row((int) $me['id'], true))]);

    // Two-step on your own sign-in.
    case 'admin_twofa_set':
        require_admin();
        $me = admin_me();
        $on = !empty($in['on']) ? 1 : 0;
        if (!$on) {
            require_reauth('turning off two-step sign-in');
        }
        try {
            db()->prepare('UPDATE admins SET twofa = ? WHERE id = ?')->execute([$on, (int) $me['id']]);
        } catch (\Throwable $e) {
            json_out(['error' => 'This needs the latest database update — run the migrations first.'], 503);
        }
        log_activity('account', 'admin.twofa', people_display_name($me) . ' turned two-step sign-in ' . ($on ? 'on' : 'off'));
        json_out(['ok' => true, 'me' => admin_me_payload(admin_row((int) $me['id'], true))]);

    // Your own alert settings: what buzzes and your quiet hours. Nobody else's.
    case 'admin_notify_set':
        require_admin();
        $me = admin_me();
        $p = is_array($in['prefs'] ?? null) ? $in['prefs'] : [];
        $out = [];
        foreach (['money', 'enquiries', 'messages', 'checkout', 'arrivals', 'system'] as $k) {
            if (array_key_exists($k, $p)) {
                $out[$k] = (bool) $p[$k];
            }
        }
        foreach (['quietFrom', 'quietTo'] as $k) {
            $v = (string) ($p[$k] ?? '');
            $out[$k] = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) ? $v : '';
        }
        if (($out['quietFrom'] === '') !== ($out['quietTo'] === '')) {
            json_out(['error' => 'Choose both ends of the quiet hours, or neither.'], 400);
        }
        try {
            db()->prepare('UPDATE admins SET notify_prefs = ? WHERE id = ?')->execute([json_encode(array_merge(notify_prefs_for($me), $out)), (int) $me['id']]);
        } catch (\Throwable $e) {
            json_out(['error' => 'This needs the latest database update — run the migrations first.'], 503);
        }
        json_out(['ok' => true, 'me' => admin_me_payload(admin_row((int) $me['id'], true))]);

    // Your own photo: private to the back office, served by avatar.php.
    case 'admin_avatar_set':
        require_admin();
        rate_limit('admin_avatar', 12, 60);
        $me = admin_me();
        $name = avatar_store($in['data'] ?? '');
        if ($name === '') {
            json_out(['error' => 'That photo couldn’t be saved. Try another, or a smaller one.'], 400);
        }
        try {
            db()->prepare('UPDATE admins SET photo = ? WHERE id = ?')->execute([$name, (int) $me['id']]);
        } catch (\Throwable $e) {
            avatar_delete($name);
            json_out(['error' => 'This needs the latest database update — run the migrations first.'], 503);
        }
        avatar_delete((string) ($me['photo'] ?? ''));
        json_out(['ok' => true, 'me' => admin_me_payload(admin_row((int) $me['id'], true))]);

    case 'admin_avatar_remove':
        require_admin();
        $me = admin_me();
        try {
            db()->prepare("UPDATE admins SET photo = '' WHERE id = ?")->execute([(int) $me['id']]);
        } catch (\Throwable $e) {
        }
        avatar_delete((string) ($me['photo'] ?? ''));
        json_out(['ok' => true, 'me' => admin_me_payload(admin_row((int) $me['id'], true))]);

    // ---------------- GUEST ----------------
    case 'guest_register':
        rate_limit('register', 10); // curb row-flooding + email-enumeration probing (409 reveals existence)
        $name = clean($in['name'] ?? '');
        $email = strtolower(clean($in['email'] ?? ''));
        $phone = clean($in['phone'] ?? '');
        $address = clean($in['address'] ?? '');
        $postcode = clean($in['postcode'] ?? '');
        $pw = field_text($in['password'] ?? '');
        if ($name === '' || $email === '') {
            json_out(['error' => 'Your name and email are required'], 400);
        }
        if (strlen($pw) < 8) {
            json_out(['error' => 'Please choose a password of at least 8 characters.'], 400);
        }
        if (mb_strlen($name) > 160 || strlen($email) > 190 || mb_strlen($phone) > 60) {
            json_out(['error' => 'One of those details is too long — please shorten it.'], 400);
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

        // REGISTERING AN EMAIL IS NOT PROOF YOU OWN IT. my_bookings_payload matches
        // stays on `b.email = ?`, so signing someone in the instant
        // they type an address handed over every booking already made against it —
        // dates, party, money, the arrival details, and the door code once inside
        // its reveal window — to anyone who guessed a guest's email. Nothing else
        // in the flow verifies the address.
        // So: an address that ALREADY HAS RECORDS gets no session here. The account
        // is created (the password they chose is theirs), and we email the existing
        // magic link, which is the app's own proof-of-control. A genuinely new guest
        // — the ordinary case — is unaffected and still signs straight in.
        // BOOKINGS ONLY, deliberately — not enquiries. The enquiry flow registers an
        // account moments after the guest submits an enquiry with that same address,
        // so counting enquiries would send every ordinary new guest to their inbox
        // and the "your account is ready" path would never happen. A booking is also
        // where the exposure actually is: money, arrival details and the door code
        // hang off a booking; an enquiry carries none of them.
        $claimsExisting = false;
        try {
            $c = db()->prepare('SELECT 1 FROM bookings WHERE email = ? LIMIT 1');
            $c->execute([$email]);
            $claimsExisting = (bool) $c->fetchColumn();
        } catch (\Throwable $e) {
            // Can't tell — assume it DOES claim records. Failing closed costs a new
            // guest one email; failing open hands over someone's booking.
            $claimsExisting = true;
        }

        $hash = password_hash($pw, PASSWORD_DEFAULT);
        // NO ACCOUNT IS VERIFIED AT REGISTRATION ANY MORE. An address with nothing
        // behind it TODAY can still gain bookings tomorrow — and an account squatting
        // a guest's email would then inherit them (dates, money, the door code). So
        // every new account starts unproven: it signs in (when there is nothing to
        // claim) and works, but sees no stays until the emailed link is opened.
        try {
            db()
                ->prepare('INSERT INTO guests (name, email, phone, address, postcode, password_hash, email_verified_at) VALUES (?,?,?,?,?,?,?)')
                ->execute([$name, $email, $phone, $address, $postcode, $hash, null]);
        } catch (\Throwable $e) {
            // migration-111 not applied yet — keep the pre-verification write.
            db()
                ->prepare('INSERT INTO guests (name, email, phone, address, postcode, password_hash) VALUES (?,?,?,?,?,?)')
                ->execute([$name, $email, $phone, $address, $postcode, $hash]);
        }
        $newGuestId = (int) db()->lastInsertId();
        // THIS browser registered the account — so the password it chose is the
        // confirmer's own if the link is opened here (see guest_magic_consume).
        $_SESSION['reg_gid'] = $newGuestId;

        if ($claimsExisting) {
            try {
                $ts = time();
                $url = site_base_url() . 'index.html?mlogin=' . $newGuestId . '&t=' . $ts . '&k=' . login_token($newGuestId, $ts);
                require_once __DIR__ . '/mailer.php';
                send_magic_link_email(['id' => $newGuestId, 'name' => $name, 'email' => $email], $url);
            } catch (\Throwable $e) {
            }
            log_activity('account', 'guest.register_verify', 'New account for an email that already has bookings — sign-in link emailed instead of signing in', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) $newGuestId]);
            json_out([
                'ok' => true,
                'verify' => true,
                'message' => "Account created. We've emailed you a sign-in link at " . $email . " — tap it to confirm it's you and see your stay.",
            ]);
        }

        session_regenerate_id(true); // new session id on login — prevents session fixation
        guest_session_begin($newGuestId);
        unset($_SESSION['admin_id']); // one role at a time: a guest session ends any admin session
        // The confirmation link: until it is opened the account sees no stays.
        try {
            $ts = time();
            $url = site_base_url() . 'index.html?mlogin=' . $newGuestId . '&t=' . $ts . '&k=' . login_token($newGuestId, $ts);
            require_once __DIR__ . '/mailer.php';
            send_magic_link_email(['id' => $newGuestId, 'name' => $name, 'email' => $email], $url);
        } catch (\Throwable $e) {
        }
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
        $pw = field_text($in['password'] ?? '');
        throttle_check('guest:' . $email);
        $stmt = db()->prepare(
            'SELECT id, name, email, phone, address, postcode, password_hash FROM guests WHERE email = ?',
        );
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        $gHash = auth_hash_for($row);
        if (!password_verify($pw, $gHash) || !$row || $gHash === auth_dummy_hash()) {
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
        if (password_needs_rehash($gHash, PASSWORD_DEFAULT)) {
            try {
                db()->prepare('UPDATE guests SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), (int) $row['id']]);
            } catch (\Throwable $e) {
            }
        }
        // THE PASSWORD IS NOT THE PROOF. An account created against an address that
        // already had bookings is left unverified (guest_register), and the password
        // was chosen by whoever registered — so accepting it here would walk straight
        // back through the door the registration check just closed. Only the emailed
        // link proves the address; re-send it and say so. Grandfathered accounts and
        // every ordinary new guest are stamped verified, so nobody real meets this.
        try {
            $vq = db()->prepare('SELECT email_verified_at FROM guests WHERE id = ?');
            $vq->execute([(int) $row['id']]);
            $verifiedAt = $vq->fetchColumn();
            $hasStays = false;
            if ($verifiedAt === null) {
                $hq = db()->prepare('SELECT 1 FROM bookings WHERE email = ? LIMIT 1');
                $hq->execute([(string) $row['email']]);
                $hasStays = (bool) $hq->fetchColumn();
            }
            // Unproven AND there are stays behind the address: the password proves
            // nothing about who owns them, so only the emailed link will do. With
            // nothing to claim, an unproven account signs in (it sees no stays).
            if ($verifiedAt === null && $hasStays) {
                if (!signin_mail_allowed((string) $row['email'])) {
                    json_out(['error' => 'Please confirm your email first — use the sign-in link we sent to ' . $email . '.'], 403);
                }
                $ts = time();
                $url = site_base_url() . 'index.html?mlogin=' . (int) $row['id'] . '&t=' . $ts . '&k=' . login_token($row['id'], $ts);
                require_once __DIR__ . '/mailer.php';
                send_magic_link_email($row, $url);
                log_activity('account', 'guest.login_unverified', 'Sign-in refused until the email is confirmed — link re-sent', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) (int) $row['id']]);
                json_out(['error' => "Please confirm your email first — we've just sent you a sign-in link at " . $email . '.'], 403);
            }
        } catch (\PDOException $e) {
            // migration-111 not applied — behave exactly as before.
        }
        session_regenerate_id(true); // new session id on login — prevents session fixation
        guest_session_begin((int) $row['id']);
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
        // Per address above; per sender here, so one connection cannot mail every
        // guest in turn (the code request has carried the same cap all along).
        rate_limit('guestmagic', 12, 15);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $stmt = db()->prepare('SELECT id, name, email FROM guests WHERE email = ?');
            $stmt->execute([$email]);
            $g = $stmt->fetch();
            if ($g) {
                if (!signin_mail_allowed($email)) {
                    throttle_record('magic:' . $email, false);
                    json_out(['ok' => true]);
                }
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

    // ---- THE CODE-FIRST SIGN-IN (approved demo) ----
    // One email field. A six-digit code goes to it (with the magic link too, for a
    // known guest). The reply is ALWAYS ok, whether or not an account exists — the
    // same no-probing rule as the link. A code is HMAC'd at rest, works once, for 30
    // minutes (10 for the back office), and dies after 5 wrong tries; asking again
    // retires older codes. An address with a day's worth of wrong codes gets none.
    case 'guest_code_request':
        $email = strtolower(clean($in['email'] ?? ''));
        throttle_check('code:' . $email);
        rate_limit('guestcode', 12, 15);
        if ($email !== '' && code_paused($email)) {
            if (filter_var($email, FILTER_VALIDATE_EMAIL) && !admin_find($email)) {
                $pq = db()->prepare('SELECT id, name, email FROM guests WHERE email = ?');
                $pq->execute([$email]);
                $pg = $pq->fetch();
                if ($pg && signin_mail_allowed($email)) {
                    $ts = time();
                    require_once __DIR__ . '/mailer.php';
                    send_magic_link_email($pg, site_base_url() . 'index.html?mlogin=' . (int) $pg['id'] . '&t=' . $ts . '&k=' . login_token($pg['id'], $ts), 'signin');
                }
            }
            json_out(['error' => CODE_PAUSED_LINK, 'code' => 'paused'], 429);
        }
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            // A BACK-OFFICE SIGN-IN'S EMAIL gets its own code email, and the code is
            // the whole sign-in, so it lives 10 minutes rather than a guest's 30. The
            // reply below is the same either way: the page never says which emails
            // have one.
            $adm = admin_find($email);
            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            try {
                db()->prepare('UPDATE guest_codes SET used_at = NOW() WHERE email = ? AND used_at IS NULL')->execute([$email]);
                db()->prepare('INSERT INTO guest_codes (email, code_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL ' . ($adm ? 10 : 30) . ' MINUTE)')->execute([$email, guest_code_hash($email, $code)]);
            } catch (\Throwable $e) {
                json_out(['error' => 'Sign-in codes need the latest database update — ask the owner to run the migrations.'], 503);
            }
            $stmt = db()->prepare('SELECT id, name, email FROM guests WHERE email = ?');
            $stmt->execute([$email]);
            $g = $stmt->fetch();
            if (!signin_mail_allowed($email)) {
                throttle_record('code:' . $email, false);
                json_out(['ok' => true]); // the same answer: the page never says why
            }
            require_once __DIR__ . '/mailer.php';
            if ($adm) {
                // With a one-tap link, like a guest's: the code screen says "or tap the
                // link in the same email", and a phone that reloads the app while the
                // code is fetched from Mail has lost the screen it was typed into. The
                // link signs in the device that opens it, exactly as typing the code does.
                $m = admin_code_body($code, 'signin', people_first_name($adm), site_base_url() . 'index.html?signin=' . rawurlencode($email) . '&code=' . $code);
                smtp_send($email, people_display_name($adm), $m['subject'], $m['text'], $m['html']);
                log_activity('account', 'admin.code', 'Sign-in code emailed to ' . people_display_name($adm), ['actor' => 'system']);
                throttle_record('code:' . $email, false);
                json_out(['ok' => true]);
            }
            if ($g) {
                $ts = time();
                $url = site_base_url() . 'index.html?mlogin=' . (int) $g['id'] . '&t=' . $ts . '&k=' . login_token($g['id'], $ts);
                send_magic_link_email($g, $url, 'signin', $code);
            } else {
                send_magic_link_email(['name' => '', 'email' => $email], '', 'join', $code);
            }
            log_activity('account', 'guest.code', 'Sign-in code emailed', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => $g ? (string) $g['id'] : '']);
        }
        throttle_record('code:' . $email, false);
        json_out(['ok' => true]);

    case 'guest_code_verify':
        $email = strtolower(clean($in['email'] ?? ''));
        $code = preg_replace('/\D/', '', (string) ($in['code'] ?? ''));
        throttle_check('codev:' . $email);
        // Paused means paused, the right code included: a guess that happens to land
        // after the tenth wrong one is still a guess.
        if (code_paused($email)) {
            json_out(['error' => CODE_PAUSED, 'code' => 'paused'], 429);
        }
        try {
            $q = db()->prepare('SELECT id, code_hash, tries FROM guest_codes WHERE email = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1');
            $q->execute([$email]);
            $c = $q->fetch();
        } catch (\Throwable $e) {
            $c = false;
        }
        if (!$c) {
            json_out(['error' => 'That code has expired. Send yourself a new one.', 'code' => 'expired'], 401);
        }
        if (strlen($code) !== 6 || !hash_equals((string) $c['code_hash'], guest_code_hash($email, $code))) {
            $tries = (int) $c['tries'] + 1;
            db()->prepare('UPDATE guest_codes SET tries = ?, used_at = IF(? >= 5, NOW(), used_at) WHERE id = ?')->execute([$tries, $tries, (int) $c['id']]);
            throttle_record('codev:' . $email, false);
            if ($tries >= 5) {
                json_out(['error' => 'Too many tries — for your security that code has stopped working. Send yourself a new one.', 'code' => 'too_many'], 429);
            }
            json_out(['error' => "That code isn't right. Check the latest email and try again.", 'code' => 'wrong', 'left' => 5 - $tries], 401);
        }
        // Claimed atomically, so a code cannot be used twice by two racing taps.
        $claim = db()->prepare('UPDATE guest_codes SET used_at = NOW() WHERE id = ? AND used_at IS NULL');
        $claim->execute([(int) $c['id']]);
        if ($claim->rowCount() < 1) {
            json_out(['error' => 'That code has already been used. Send yourself a new one.', 'code' => 'expired'], 401);
        }
        throttle_record('codev:' . $email, true); // this browser's own wrong tries are forgiven
        // A BACK-OFFICE SIGN-IN'S EMAIL: the code proved the inbox, and that is the
        // whole sign-in. An emailed code, a password and a passkey are three equal
        // ways in. The device is remembered, so a password typed on it later needs
        // no second code. Someone invited and not yet started chooses their password
        // instead; the proof waits in the session for admin_invite_accept.
        $adm = admin_find($email);
        if ($adm) {
            if (!empty($adm['removed_at'])) {
                json_out(['error' => admin_switched_off(), 'code' => 'removed'], 403);
            }
            if (!empty($adm['invited_at'])) {
                $_SESSION['admin_email_proof'] = ['id' => (int) $adm['id'], 'at' => time()];
                json_out(['ok' => true, 'admin' => true, 'choose' => true, 'first' => people_first_name($adm), 'username' => (string) $adm['username'], 'by' => admin_owner_first()]);
            }
            admin_trust_this_device((int) $adm['id']);
            admin_complete_login((int) $adm['id'], ['admin' => true], 'with an emailed code', false, 'code');
        }
        $stmt = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        if (!$row) {
            // A new guest: the code proved the address, so the account that follows
            // is created CONFIRMED and needs only a name (guest_code_register).
            session_regenerate_id(true);
            $_SESSION['code_email'] = $email;
            $_SESSION['code_at'] = time();
            json_out(['ok' => true, 'new' => true]);
        }
        $reset = guest_prove_address((int) $row['id']);
        session_regenerate_id(true);
        guest_session_begin((int) $row['id']);
        unset($_SESSION['admin_id']);
        log_activity('account', 'guest.code_login', 'Guest signed in with an emailed code', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) $row['id']]);
        $row['avatar'] = guest_avatar_v((int) $row['id']);
        unset($row['id']);
        json_out(['ok' => true, 'reset' => $reset, 'guest' => $row]);

    case 'guest_code_register':
        $email = (string) ($_SESSION['code_email'] ?? '');
        if ($email === '' || time() - (int) ($_SESSION['code_at'] ?? 0) > 1800) {
            json_out(['error' => 'That took a little long — send yourself a new code to finish.', 'code' => 'expired'], 401);
        }
        $name = clean($in['name'] ?? '');
        if (mb_strlen($name) < 2) {
            json_out(['error' => "Add your name, so we know who we're talking to."], 400);
        }
        require_fits($in, ['name' => [160, 'Your name']]);
        $stmt = db()->prepare('SELECT id FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        $gid = (int) ($stmt->fetchColumn() ?: 0);
        if ($gid <= 0) {
            db()->prepare("INSERT INTO guests (name, email, phone, address, postcode, password_hash, email_verified_at) VALUES (?, ?, '', '', '', '', NOW())")->execute([$name, $email]);
            $gid = (int) db()->lastInsertId();
            log_activity('account', 'guest.registered', 'New guest account (email confirmed by code)', ['actor' => 'guest', 'entity' => 'guest', 'entity_id' => (string) $gid]);
        }
        unset($_SESSION['code_email'], $_SESSION['code_at']);
        guest_session_begin($gid);
        unset($_SESSION['admin_id']);
        $stmt = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$gid]);
        json_out(['ok' => true, 'guest' => $stmt->fetch()]);

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
        // THIS is the proof of address — the link was emailed to it and has just been
        // opened. Stamping it here is what lets an account created against existing
        // bookings finally sign in (guest_register / guest_login).
        // AND IT ENDS ANY CLAIM THAT CAME BEFORE IT. An unproven account's password
        // was chosen by whoever registered, which may not be the person reading this
        // inbox — so proving the address from any OTHER browser clears that password,
        // forgets its passkeys and signs out every earlier session. Opened in the
        // browser that registered, the password is the confirmer's own and stays.
        $reset = guest_prove_address((int) $row['id']);
        unset($_SESSION['reg_gid']);
        // A RESET link (sent by the owner from Manage → Guests) opens a short window
        // in which this session may choose a new password without the old one —
        // the link was emailed to the address, which is the proof. Kept in the
        // SESSION rather than clearing the password, so a link opened by mistake
        // never locks the guest out of the password they still know.
        $pwReset = !empty($in['reset']);
        session_regenerate_id(true); // new session id on login — prevents session fixation
        guest_session_begin((int) $row['id']);
        unset($_SESSION['admin_id']); // one role at a time
        if ($pwReset) {
            $_SESSION['pw_reset_at'] = time();
        }
        json_out([
            'ok' => true,
            'reset' => $reset,
            'choose_password' => $pwReset,
            'guest' => [
                'name' => $row['name'],
                'email' => $row['email'],
                'phone' => $row['phone'],
                'address' => $row['address'],
                'postcode' => $row['postcode'],
            ],
        ]);

    case 'guest_logout':
        if (!empty($_SESSION['guest_id']) && is_string($in['push_endpoint'] ?? null) && $in['push_endpoint'] !== '') {
            push_subs_drop('guest', (int) $_SESSION['guest_id'], (string) $in['push_endpoint']);
        }
        session_end_signed_in();
        json_out(['ok' => true]);

    case 'guest_status':
        if (empty($_SESSION['guest_id'])) {
            json_out(['guest' => null]);
        }
        $stmt = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        $gRow = $stmt->fetch() ?: null;
        if ($gRow) {
            $gRow['avatar'] = guest_avatar_v((int) $_SESSION['guest_id']);
        }
        json_out(['guest' => $gRow]);

    // Logged-in guest updates their own contact details (NOT their email).
    case 'guest_update_profile':
        if (empty($_SESSION['guest_id'])) {
            json_out(['error' => 'Please log in first'], 401);
        }
        $phone = clean($in['phone'] ?? '');
        $address = clean($in['address'] ?? '');
        $postcode = clean($in['postcode'] ?? '');
        require_fits($in, ['phone' => [60, 'Your phone number']]);
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
        $gRow = $stmt->fetch() ?: null;
        if ($gRow) {
            $gRow['avatar'] = guest_avatar_v((int) $_SESSION['guest_id']);
        }
        json_out(['ok' => true, 'guest' => $gRow]);

    // The guest's own profile photo: set (a cropped JPEG from the Account page) or
    // remove. Only ever their OWN — the session decides whose, never the body.
    case 'guest_avatar_set':
        require_guest();
        $gid = (int) $_SESSION['guest_id'];
        rate_limit('avatar:' . $gid, 12, 60); // a dozen changes an hour is plenty for a person
        $name = avatar_store($in['data'] ?? '');
        if ($name === '') {
            json_out(['error' => "That photo couldn't be used — try a different one (a JPEG or a photo from your camera)."], 400);
        }
        $was = guest_avatar_name($gid);
        try {
            db()->prepare('UPDATE guests SET avatar = ? WHERE id = ?')->execute([$name, $gid]);
        } catch (\Throwable $e) {
            avatar_delete($name);
            json_out(['error' => 'Profile photos need the latest database update — please try again later.'], 503);
        }
        if ($was !== '' && $was !== $name) {
            avatar_delete($was);
        }
        json_out(['ok' => true, 'avatar' => substr($name, 0, 10)]);

    case 'guest_avatar_remove':
        require_guest();
        $gid = (int) $_SESSION['guest_id'];
        $was = guest_avatar_name($gid);
        try {
            db()->prepare('UPDATE guests SET avatar = NULL WHERE id = ?')->execute([$gid]);
        } catch (\Throwable $e) {
        }
        avatar_delete($was);
        json_out(['ok' => true, 'avatar' => '']);

    // Logged-in guest changes their own password (must give the current one).
    case 'guest_change_password':
        if (empty($_SESSION['guest_id'])) {
            json_out(['error' => 'Please log in first'], 401);
        }
        $current = field_text($in['current'] ?? '');
        $next = field_text($in['next'] ?? '');
        if (strlen($next) < 8) {
            json_out(['error' => 'New password must be at least 8 characters'], 400);
        }
        $stmt = db()->prepare('SELECT password_hash FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        $row = $stmt->fetch();
        // An account with NO password (cleared when the email was confirmed, or a
        // magic-link-only account) sets one without a current one — the session is
        // the proof, and there is nothing to type.
        $noPw = $row && (string) $row['password_hash'] === '';
        // …and so does a session opened by a reset link in the last 30 minutes.
        if ($row && !empty($_SESSION['pw_reset_at']) && time() - (int) $_SESSION['pw_reset_at'] <= 1800) {
            $noPw = true;
        }
        // Throttled on its own identifier: a borrowed signed-in phone must not be a
        // free oracle for guessing the account's password.
        throttle_check('guestpw:' . (int) $_SESSION['guest_id']);
        if (!$row || (!$noPw && !password_verify($current, $row['password_hash']))) {
            throttle_record('guestpw:' . (int) $_SESSION['guest_id'], false);
            json_out(['error' => 'Your current password is incorrect'], 403);
        }
        throttle_record('guestpw:' . (int) $_SESSION['guest_id'], true);
        db()
            ->prepare('UPDATE guests SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($next, PASSWORD_DEFAULT), (int) $_SESSION['guest_id']]);
        unset($_SESSION['pw_reset_at']); // one reset per link
        // A new password signs out every OTHER session (a phone left signed in is
        // exactly why people change it); this one is re-stamped and stays in.
        try {
            db()->prepare('UPDATE guests SET auth_epoch = auth_epoch + 1 WHERE id = ?')->execute([(int) $_SESSION['guest_id']]);
            guest_session_begin((int) $_SESSION['guest_id']);
        } catch (\Throwable $e) {
        }
        push_subs_drop('guest', (int) $_SESSION['guest_id'], '', is_string($in['push_endpoint'] ?? null) ? (string) $in['push_endpoint'] : '');
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
        // Stays are matched by EMAIL, so they belong to whoever proved the inbox —
        // an unconfirmed account exports its own account data only.
        $proven = guest_email_proven($gid);
        $bookings = ($email !== '' && $proven) ? $grab('SELECT * FROM bookings WHERE email = ? ORDER BY check_in', [$email]) : [];
        // The OWNER'S fields are not the guest's data: the private booking note, and
        // the payment-processor handles that identify a card on file.
        foreach ($bookings as &$bk) {
            foreach (['notes', 'price_reason', 'hold_payment_id', 'autopay_card_id', 'autopay_customer_id', 'autopay_last_error', 'autopay_last_code'] as $k) {
                unset($bk[$k]);
            }
        }
        unset($bk);
        $payments = [];
        $ids = array_values(array_filter(array_map(fn($b) => (int) $b['id'], $bookings)));
        if ($ids) {
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $payments = $grab(
                "SELECT booking_id, kind, amount, status, created_at FROM payments WHERE booking_id IN ($ph)",
                $ids,
            );
        }
        // What deleting the account treats as theirs, the export carries too.
        $mine = $email !== '' && $proven;
        // THE WHOLE CONVERSATION, the owner's replies included (they carry no
        // guest_id), and a chat started before signing in under the proven address.
        // A thread's token opens that chat, so it never goes into a file; nor do the
        // owner's archive flag and the typing stamps.
        $threads = $mine
            ? $grab('SELECT * FROM chat_threads WHERE guest_id = ? OR (guest_id IS NULL AND email = ?) ORDER BY id', [$gid, $email])
            : $grab('SELECT * FROM chat_threads WHERE guest_id = ? ORDER BY id', [$gid]);
        foreach ($threads as &$th) {
            unset($th['token'], $th['archived'], $th['guest_typing_at'], $th['admin_typing_at']);
        }
        unset($th);
        $tids = array_values(array_filter(array_map(fn($t) => (int) $t['id'], $threads)));
        $messages = $tids
            ? $grab('SELECT * FROM messages WHERE guest_id = ? OR thread_id IN (' . implode(',', array_fill(0, count($tids), '?')) . ') ORDER BY id', array_merge([$gid], $tids))
            : $grab('SELECT * FROM messages WHERE guest_id = ? ORDER BY id', [$gid]);
        // The emails the owner wrote them: from the Inbox (the sent log) and from a
        // booking's page (kept with the booking's activity).
        $emailsToYou = $mine ? $grab('SELECT subject, body, sent_at FROM mail_sent WHERE to_email = ? ORDER BY id', [$email]) : [];
        if ($ids) {
            foreach ($grab("SELECT meta, created_at FROM activity_log WHERE action = 'booking.email' AND entity = 'booking' AND entity_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY id', array_map('strval', $ids)) as $lg) {
                $m = json_decode((string) ($lg['meta'] ?? ''), true);
                if (is_array($m) && (($m['subject'] ?? '') !== '' || ($m['body'] ?? '') !== '')) {
                    $emailsToYou[] = ['subject' => (string) ($m['subject'] ?? ''), 'body' => (string) ($m['body'] ?? ''), 'sent_at' => $lg['created_at']];
                }
            }
        }
        // A review left from a review link, without the owner's private rating and note.
        $leads = $mine ? $grab('SELECT * FROM direct_leads WHERE email = ? ORDER BY id', [$email]) : [];
        foreach ($leads as &$ld) {
            unset($ld['admin_rating'], $ld['admin_note']);
        }
        unset($ld);
        $data = [
            'exported_at' => date('c'),
            'account' => $account,
            'bookings' => $bookings,
            'payments' => $payments,
            'enquiries' => $mine ? $grab('SELECT * FROM enquiries WHERE email = ?', [$email]) : [],
            'enquiry_draft' => $mine ? $grab('SELECT prop_key, name, check_in, check_out, adults, children, created_at, updated_at FROM enquiry_drafts WHERE email = ?', [$email]) : [],
            'chat_threads' => $threads,
            'messages' => $messages,
            'emails_to_you' => $emailsToYou,
            'reviews' => $grab('SELECT * FROM guest_reviews WHERE guest_id = ?', [$gid]),
            'reviews_from_a_link' => $leads,
            'photos' => $grab('SELECT * FROM guest_photos WHERE guest_id = ?', [$gid]),
            'passkeys' => $grab('SELECT label, created_at, last_used_at FROM guest_passkeys WHERE guest_id = ?', [$gid]),
            'newsletter' =>
                $email !== ''
                    ? $grab('SELECT email, name, created_at FROM newsletter_subscribers WHERE email = ?', [$email])
                    : [],
            'waitlist' => $mine ? $grab('SELECT * FROM waitlist WHERE email = ?', [$email]) : [],
        ];
        // The profile photo is theirs too — included as the JPEG itself.
        $avN = guest_avatar_name($gid);
        $avP = $avN !== '' ? __DIR__ . '/' . AVATAR_DIR . '/' . $avN : '';
        $data['profile_photo'] = $avP !== '' && is_file($avP) ? 'data:image/jpeg;base64,' . base64_encode((string) file_get_contents($avP)) : null;
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
        // An unconfirmed account deletes ITSELF, never the bookings and enquiries
        // filed under an address it has not proven is its own.
        if (!guest_email_proven($gid)) {
            $email = '';
        }
        $try = function ($sql, $params) {
            try {
                db()->prepare($sql)->execute($params);
            } catch (\Throwable $e) {
                /* table may not exist */
            }
        };
        if ($email !== '') {
            // A STAY STILL TO COME IS A CONTRACT IN PROGRESS. Anonymising it left the
            // owner a "Former guest" with no email or phone two weeks before arrival,
            // no arrival email or balance chase (both need the address), and the guest
            // no way back to their own booking or door code — while a card plan would
            // still have collected, with no notice. The account can go once it has ended.
            $nx = db()->prepare('SELECT MIN(check_in) FROM bookings WHERE email = ? AND check_out >= ?');
            $nx->execute([$email, date('Y-m-d')]);
            $next = (string) ($nx->fetchColumn() ?: '');
            if ($next !== '') {
                json_out(['error' => 'You have a stay booked from ' . uk_date($next) . '. Your account can be deleted once it has ended. To cancel the stay, message us.', 'code' => 'stay_ahead'], 409);
            }
            // The owner's emails written from a booking's page are kept with that
            // booking's activity, in full; the booking stays, the words go.
            $bq = db()->prepare('SELECT id FROM bookings WHERE email = ?');
            $bq->execute([$email]);
            $bids = array_map('strval', $bq->fetchAll(\PDO::FETCH_COLUMN));
            if ($bids) {
                $try("UPDATE activity_log SET meta = NULL WHERE action = 'booking.email' AND entity = 'booking' AND entity_id IN (" . implode(',', array_fill(0, count($bids), '?')) . ')', $bids);
            }
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
            // …and the rest filed under the address: the half-typed enquiry, the
            // "book direct" lead (its marketing email would still have gone), the
            // owner's own emails to them, unsent queued copies and old sign-in codes.
            $try('DELETE FROM enquiry_drafts WHERE email = ?', [$email]);
            $try('DELETE FROM direct_leads WHERE email = ?', [$email]);
            $try('DELETE FROM mail_sent WHERE to_email = ?', [$email]);
            $try('DELETE FROM email_outbox WHERE to_email = ? AND sent_at IS NULL', [$email]);
            $try('DELETE FROM guest_codes WHERE email = ?', [$email]);
        }
        // The activity log keeps the first line of every chat message, theirs and the
        // owner's, and its search reads it: those lines go with the conversation, and
        // a guest's message stops being named. Before the threads go, while they can
        // still be found.
        $tq = db()->prepare('SELECT id FROM chat_threads WHERE guest_id = ?' . ($email !== '' ? ' OR (guest_id IS NULL AND email = ?)' : ''));
        $tq->execute($email !== '' ? [$gid, $email] : [$gid]);
        $tids = array_map('strval', $tq->fetchAll(\PDO::FETCH_COLUMN));
        if ($tids) {
            $try("UPDATE activity_log SET meta = NULL, summary = IF(action = 'message.guest' AND summary LIKE 'New chat message from %', 'New chat message', summary) WHERE entity = 'thread' AND entity_id IN (" . implode(',', array_fill(0, count($tids), '?')) . ')', $tids);
        }
        // …and the photos in those conversations, which stayed on the site at their old
        // address (the owner's emails to them still carry it). Found now, deleted once
        // the messages have gone.
        $chatFiles = [];
        try {
            $fq = db()->prepare("SELECT attachment FROM messages WHERE (guest_id = ?" . ($tids ? ' OR thread_id IN (' . implode(',', array_fill(0, count($tids), '?')) . ')' : '') . ") AND attachment IS NOT NULL AND attachment <> ''");
            $fq->execute(array_merge([$gid], $tids));
            $chatFiles = $fq->fetchAll(\PDO::FETCH_COLUMN);
        } catch (\Throwable $e) {
        }
        if ($email !== '') {
            // A chat started on the website before signing in carries the address,
            // not the account: theirs too, the owner's replies in it included.
            $try('DELETE m FROM messages m JOIN chat_threads t ON t.id = m.thread_id WHERE t.guest_id IS NULL AND t.email = ?', [$email]);
            $try('DELETE FROM chat_threads WHERE guest_id IS NULL AND email = ?', [$email]);
        }
        // THE WHOLE CONVERSATION, not only their own lines: the owner's replies and
        // their emailed replies carry no guest_id, so they outlived the account and
        // stayed searchable. By thread, then the threads.
        $try('DELETE m FROM messages m JOIN chat_threads t ON t.id = m.thread_id WHERE t.guest_id = ?', [$gid]);
        $try('DELETE FROM messages WHERE guest_id = ?', [$gid]);
        $try('DELETE FROM chat_threads WHERE guest_id = ?', [$gid]);
        foreach ($chatFiles as $cf) {
            upload_delete($cf);
        }
        $try('DELETE FROM guest_reviews WHERE guest_id = ?', [$gid]);
        // A photo still waiting for approval, or turned down, was never shown: it goes,
        // file and all. Approved ones stay on the photo wall, without a name.
        try {
            $pq = db()->prepare("SELECT id, url FROM guest_photos WHERE guest_id = ? AND status <> 'approved'");
            $pq->execute([$gid]);
            foreach ($pq->fetchAll() as $ph) {
                upload_delete($ph['url']);
                db()->prepare('DELETE FROM guest_photos WHERE id = ?')->execute([(int) $ph['id']]);
            }
        } catch (\Throwable $e) {
        }
        $try('UPDATE guest_photos SET guest_id = NULL, guest_name = ? WHERE guest_id = ?', ['Former guest', $gid]);
        // A thing to do they suggested: a published card stays, without their name or
        // address; one never published goes, picture and all.
        if ($email !== '') {
            try {
                $eq = db()->prepare('SELECT id, image_url, status FROM experiences WHERE suggested_by_email = ?');
                $eq->execute([$email]);
                foreach ($eq->fetchAll() as $ex) {
                    if (($ex['status'] ?? '') === 'published') {
                        db()->prepare("UPDATE experiences SET suggested_by_name = '', suggested_by_email = '' WHERE id = ?")->execute([(int) $ex['id']]);
                    } else {
                        db()->prepare('DELETE FROM experiences WHERE id = ?')->execute([(int) $ex['id']]);
                        experience_image_drop($ex['image_url'] ?? '', (int) $ex['id']);
                    }
                }
            } catch (\Throwable $e) {
            }
        }
        $try('DELETE FROM push_subscriptions WHERE guest_id = ?', [$gid]);
        // …and the text of their last notification, kept for the phone to fetch.
        $try('DELETE FROM content WHERE item_key = ?', ['guest-ping-' . $gid]);
        $try('DELETE FROM guest_passkeys WHERE guest_id = ?', [$gid]);
        avatar_delete(guest_avatar_name($gid)); // the photo goes with the account
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
        try {
            db()->prepare('UPDATE guests SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?')->execute([(int) $g['id']]);
        } catch (\Throwable $e) {
        }
        session_regenerate_id(true); // a new id at every sign-in, as everywhere else
        guest_session_begin((int) $g['id']);
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

    // Staging sandbox ONLY: the one-tap "Back office" seat. The guest seat above
    // needs no credential because a guest session is low-power; an ADMIN session
    // is the whole back office AND a working mailer, so it demands proof the
    // caller passed staging-gate.php — the STAGING_SANDBOX constant only proves
    // which SITE this is, never who is asking. The gate password IS the admin
    // credential on staging; there is no second secret worth asking for.
    case 'staging_admin_session':
        if (
            !(defined('STAGING_SANDBOX') && STAGING_SANDBOX) ||
            !preg_match('/(^|\.)staging\./i', $_SERVER['HTTP_HOST'] ?? '')
        ) {
            json_out(['error' => 'Not available'], 403);
        }
        if (!staging_gate_passed()) {
            json_out(['error' => 'Sign in at the staging gate first, then try again.'], 403);
        }
        // First admin row; minted if setup.php was never run here — the password
        // is random and never shown, because on staging the gate is the way in.
        $row = db()
            ->query('SELECT id FROM admins ORDER BY id LIMIT 1')
            ->fetch();
        if (!$row) {
            db()
                ->prepare('INSERT INTO admins (username, password_hash) VALUES (?,?)')
                ->execute(['staging-owner', password_hash(bin2hex(random_bytes(18)), PASSWORD_DEFAULT)]);
            $row = ['id' => (int) db()->lastInsertId()];
        }
        admin_complete_login((int) $row['id'], [], '', false, 'staging'); // json_out(['ok' => true]) and exits

    // ----------- ADMIN: manage guest accounts -----------
    case 'guest_list':
        require_admin();
        $rows = db()->query('SELECT id, name, email, phone, created_at FROM guests ORDER BY name ASC')->fetchAll();
        json_out(['guests' => $rows]);

    // The owner never sets a guest's password: this EMAILS the guest a signed,
    // single-use, 30-minute link (the magic-link token) that opens a "choose a new
    // password" step. One per minute per guest, so a few quick taps send one email.
    case 'guest_send_reset':
        // The OWNER may send one to any guest; a signed-in GUEST may send one only to
        // their OWN address (Account → Sign-in & security). The body's email is
        // ignored for a guest — it goes to the inbox that already proves the account.
        $selfReset = empty($_SESSION['admin_id']);
        if ($selfReset) {
            // Only an account whose address is proven: an unproven one was registered
            // by whoever typed the address, and a reset link a minute to it was a way
            // to fill a stranger's inbox.
            require_guest_proven();
            $sq = db()->prepare('SELECT email FROM guests WHERE id = ?');
            $sq->execute([(int) $_SESSION['guest_id']]);
            $email = strtolower((string) $sq->fetchColumn());
        } else {
            require_admin();
            $email = strtolower(clean($in['email'] ?? ''));
        }
        if ($email === '') {
            json_out(['error' => 'Guest email is required'], 400);
        }
        $stmt = db()->prepare('SELECT id, name, email FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        $g = $stmt->fetch();
        if (!$g) {
            json_out(['error' => 'That guest has no account yet, so there is no password to reset.'], 404);
        }
        try {
            $rq = db()->prepare("SELECT created_at FROM activity_log WHERE action = 'guest.reset_link' AND entity = 'guest' AND entity_id = ? AND created_at >= (NOW() - INTERVAL 60 SECOND) LIMIT 1");
            $rq->execute([(string) (int) $g['id']]);
            if ($rq->fetchColumn()) {
                json_out(['error' => 'A reset link has just gone to ' . $g['email'] . ' — give it a minute before sending another.', 'code' => 'already_sent'], 409);
            }
        } catch (\Throwable $e) {
        }
        // A reset link counts against the address's daily allowance of sign-in emails,
        // like every other kind (signin_mail_allowed). Said plainly: whoever asked is
        // the owner or the account's own guest, so there is nothing to hide.
        if (!signin_mail_allowed($email)) {
            json_out(['error' => 'That address has had today\'s sign-in emails, so no more go to it until tomorrow.', 'code' => 'paused'], 429);
        }
        $ts = time();
        $url = site_base_url() . 'index.html?mlogin=' . (int) $g['id'] . '&t=' . $ts . '&k=' . login_token($g['id'], $ts) . '&pr=1';
        require_once __DIR__ . '/mailer.php';
        $r = send_magic_link_email($g, $url, 'reset');
        if (empty($r['ok'])) {
            json_out(['error' => $r['error'] ?? 'Could not send the email'], 500);
        }
        log_activity('account', 'guest.reset_link', $selfReset ? 'A guest asked for a password reset link to their own email' : 'Password reset link emailed to a guest', ['actor' => $selfReset ? 'guest' : 'owner', 'entity' => 'guest', 'entity_id' => (string) (int) $g['id']]);
        json_out(['ok' => true, 'until' => date('H:i', $ts + 1800)]);

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
        $invited = [];
        try {
            $iq = db()->query("SELECT meta, created_at FROM activity_log WHERE action = 'guest.reinvite' AND created_at >= (NOW() - INTERVAL 90 DAY)");
            foreach ($iq->fetchAll() as $ir) {
                $m = json_decode((string) $ir['meta'], true);
                $ie = is_array($m) ? strtolower((string) ($m['email'] ?? '')) : '';
                if ($ie !== '' && (string) $ir['created_at'] > ($invited[$ie] ?? '')) {
                    $invited[$ie] = (string) $ir['created_at'];
                }
            }
        } catch (\Throwable $e) {
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
                'invited_at' => $invited[$e] ?? '',
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
            'SELECT name, prop_key, check_in FROM bookings WHERE email = ? ORDER BY check_in DESC LIMIT 1',
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
