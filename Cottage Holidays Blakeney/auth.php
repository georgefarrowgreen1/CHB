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
function throttle_check($identifier) {
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $s = db()->prepare('SELECT COUNT(*) c FROM login_attempts
                            WHERE ip = ? AND identifier = ? AND success = 0
                              AND attempted_at > (NOW() - INTERVAL 10 MINUTE)');
        $s->execute([$ip, $identifier]);
        if ((int)$s->fetch()['c'] >= 5) {
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
        if ((int)$s2->fetch()['c'] >= 20) {
            json_out(['error' => 'Too many failed attempts on this account. Please wait 10 minutes and try again.'], 429);
        }
    } catch (\Throwable $e) { /* table missing — don't block logins */ }
}
function throttle_record($identifier, $ok) {
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        if ($ok) {
            // Success clears the slate for this ip+account
            db()->prepare('DELETE FROM login_attempts WHERE ip = ? AND identifier = ?')->execute([$ip, $identifier]);
        } else {
            db()->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?,?,0)')->execute([$ip, $identifier]);
        }
        // Occasional housekeeping: prune day-old rows
        if (random_int(1, 20) === 1) {
            db()->prepare('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)')->execute();
        }
    } catch (\Throwable $e) { /* table missing — ignore */ }
}

$in     = body();
$action = $in['action'] ?? '';

switch ($action) {

    // ---------------- ADMIN ----------------
    case 'admin_login': {
        $username = clean($in['username'] ?? '');
        $password = $in['password'] ?? '';
        throttle_check('admin:' . strtolower($username));
        $stmt = db()->prepare('SELECT id, password_hash FROM admins WHERE username = ?');
        $stmt->execute([$username]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($password, $row['password_hash'])) {
            throttle_record('admin:' . strtolower($username), false);
            json_out(['error' => 'Incorrect username or password'], 401);
        }
        throttle_record('admin:' . strtolower($username), true);
        $_SESSION['admin_id'] = (int)$row['id'];
        unset($_SESSION['guest_id']);   // one role at a time: signing in as admin ends any guest session
        json_out(['ok' => true]);
    }

    case 'admin_logout':
        unset($_SESSION['admin_id']);
        json_out(['ok' => true]);

    case 'admin_status':
        json_out(['admin' => !empty($_SESSION['admin_id'])]);

    case 'admin_change_password': {
        require_admin();
        $current = $in['current'] ?? '';
        $next    = $in['next'] ?? '';
        if (strlen($next) < 12) json_out(['error' => 'New password must be at least 12 characters'], 400);
        $stmt = db()->prepare('SELECT password_hash FROM admins WHERE id = ?');
        $stmt->execute([$_SESSION['admin_id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) {
            json_out(['error' => 'Current password is incorrect'], 403);
        }
        $hash = password_hash($next, PASSWORD_DEFAULT);
        db()->prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
            ->execute([$hash, $_SESSION['admin_id']]);
        json_out(['ok' => true]);
    }

    // ---------------- GUEST ----------------
    case 'guest_register': {
        $name     = clean($in['name'] ?? '');
        $email    = strtolower(clean($in['email'] ?? ''));
        $phone    = clean($in['phone'] ?? '');
        $address  = clean($in['address'] ?? '');
        $postcode = clean($in['postcode'] ?? '');
        $pw       = $in['password'] ?? '';
        if ($name === '' || $email === '' || strlen($pw) < 8) {
            json_out(['error' => 'Name, email and an 8+ character password are required'], 400);
        }
        if ($address === '') json_out(['error' => 'Please enter your UK address'], 400);
        if (!uk_postcode_valid($postcode)) json_out(['error' => 'Please enter a valid UK postcode'], 400);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_out(['error' => 'Please enter a valid email address'], 400);
        }
        $stmt = db()->prepare('SELECT id FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        if ($stmt->fetch()) json_out(['error' => 'An account with this email already exists'], 409);

        $hash = password_hash($pw, PASSWORD_DEFAULT);
        db()->prepare('INSERT INTO guests (name, email, phone, address, postcode, password_hash) VALUES (?,?,?,?,?,?)')
            ->execute([$name, $email, $phone, $address, $postcode, $hash]);
        $_SESSION['guest_id'] = (int)db()->lastInsertId();
        unset($_SESSION['admin_id']);   // one role at a time: a guest session ends any admin session
        json_out(['ok' => true, 'guest' => ['name' => $name, 'email' => $email, 'phone' => $phone, 'address' => $address, 'postcode' => $postcode]]);
    }

    case 'guest_login': {
        $email = strtolower(clean($in['email'] ?? ''));
        $pw    = $in['password'] ?? '';
        throttle_check('guest:' . $email);
        $stmt = db()->prepare('SELECT id, name, email, phone, address, postcode, password_hash FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($pw, $row['password_hash'])) {
            throttle_record('guest:' . $email, false);
            json_out(['error' => 'Email or password not recognised'], 401);
        }
        throttle_record('guest:' . $email, true);
        $_SESSION['guest_id'] = (int)$row['id'];
        unset($_SESSION['admin_id']);   // one role at a time: a guest session ends any admin session
        json_out(['ok' => true, 'guest' => ['name' => $row['name'], 'email' => $row['email'], 'phone' => $row['phone'], 'address' => $row['address'], 'postcode' => $row['postcode']]]);
    }

    // Passwordless sign-in: email the guest a one-tap magic link. We ALWAYS
    // reply ok (even if no such account) so the endpoint can't be used to probe
    // which emails are registered. The link carries id + issue-time + HMAC.
    case 'guest_magic_request': {
        $email = strtolower(clean($in['email'] ?? ''));
        throttle_check('magic:' . $email);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $stmt = db()->prepare('SELECT id, name, email FROM guests WHERE email = ?');
            $stmt->execute([$email]);
            $g = $stmt->fetch();
            if ($g) {
                $ts  = time();
                $url = site_base_url() . 'index.html?mlogin=' . (int)$g['id'] . '&t=' . $ts . '&k=' . login_token($g['id'], $ts);
                require_once __DIR__ . '/mailer.php';
                send_magic_link_email($g, $url);
            }
        }
        throttle_record('magic:' . $email, true);   // never reveal failure
        json_out(['ok' => true]);
    }

    // Consume a magic link: verify the HMAC and that it's fresh (30 min), then
    // sign the guest in exactly like guest_login.
    case 'guest_magic_consume': {
        $gid = (int)($in['guest_id'] ?? 0);
        $ts  = (int)($in['ts'] ?? 0);
        $tok = (string)($in['token'] ?? '');
        if ($gid <= 0 || $ts <= 0 || $tok === '' || !hash_equals(login_token($gid, $ts), $tok)) {
            json_out(['error' => 'This sign-in link is invalid.'], 401);
        }
        if (abs(time() - $ts) > 1800) json_out(['error' => 'This sign-in link has expired — please request a new one.'], 401);
        $stmt = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$gid]);
        $row = $stmt->fetch();
        if (!$row) json_out(['error' => 'This sign-in link is invalid.'], 401);
        $_SESSION['guest_id'] = (int)$row['id'];
        unset($_SESSION['admin_id']);   // one role at a time
        json_out(['ok' => true, 'guest' => ['name' => $row['name'], 'email' => $row['email'], 'phone' => $row['phone'], 'address' => $row['address'], 'postcode' => $row['postcode']]]);
    }

    case 'guest_logout':
        unset($_SESSION['guest_id']);
        json_out(['ok' => true]);

    case 'guest_status': {
        if (empty($_SESSION['guest_id'])) json_out(['guest' => null]);
        $stmt = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        json_out(['guest' => $stmt->fetch() ?: null]);
    }

    // Logged-in guest updates their own contact details (NOT their email).
    case 'guest_update_profile': {
        if (empty($_SESSION['guest_id'])) json_out(['error' => 'Please log in first'], 401);
        $phone    = clean($in['phone'] ?? '');
        $address  = clean($in['address'] ?? '');
        $postcode = clean($in['postcode'] ?? '');
        if ($address === '') json_out(['error' => 'Please enter your UK address'], 400);
        if (!uk_postcode_valid($postcode)) json_out(['error' => 'Please enter a valid UK postcode'], 400);
        db()->prepare('UPDATE guests SET phone = ?, address = ?, postcode = ? WHERE id = ?')
            ->execute([$phone, $address, $postcode, (int)$_SESSION['guest_id']]);
        $stmt = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        json_out(['ok' => true, 'guest' => $stmt->fetch() ?: null]);
    }

    // Logged-in guest changes their own password (must give the current one).
    case 'guest_change_password': {
        if (empty($_SESSION['guest_id'])) json_out(['error' => 'Please log in first'], 401);
        $current = $in['current'] ?? '';
        $next    = $in['next'] ?? '';
        if (strlen($next) < 8) json_out(['error' => 'New password must be at least 8 characters'], 400);
        $stmt = db()->prepare('SELECT password_hash FROM guests WHERE id = ?');
        $stmt->execute([$_SESSION['guest_id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) {
            json_out(['error' => 'Your current password is incorrect'], 403);
        }
        db()->prepare('UPDATE guests SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($next, PASSWORD_DEFAULT), (int)$_SESSION['guest_id']]);
        json_out(['ok' => true]);
    }

    // GDPR: a logged-in guest downloads everything we hold about them (JSON).
    case 'guest_export_data': {
        if (empty($_SESSION['guest_id'])) json_out(['error' => 'Please log in first'], 401);
        $gid = (int)$_SESSION['guest_id'];
        $acc = db()->prepare('SELECT id, name, email, phone, address, postcode, created_at FROM guests WHERE id = ?');
        $acc->execute([$gid]);
        $account = $acc->fetch() ?: [];
        $email = (string)($account['email'] ?? '');
        $grab = function ($sql, $params) { try { $s = db()->prepare($sql); $s->execute($params); return $s->fetchAll(); } catch (\Throwable $e) { return []; } };
        $bookings = $email !== '' ? $grab('SELECT * FROM bookings WHERE email = ? ORDER BY check_in', [$email]) : [];
        $payments = [];
        $ids = array_values(array_filter(array_map(fn($b) => (int)$b['id'], $bookings)));
        if ($ids) { $ph = implode(',', array_fill(0, count($ids), '?')); $payments = $grab("SELECT booking_id, kind, amount, status, created_at FROM payments WHERE booking_id IN ($ph)", $ids); }
        $data = [
            'exported_at'  => date('c'),
            'account'      => $account,
            'bookings'     => $bookings,
            'payments'     => $payments,
            'enquiries'    => $email !== '' ? $grab('SELECT * FROM enquiries WHERE email = ?', [$email]) : [],
            'chat_threads' => $grab('SELECT * FROM chat_threads WHERE guest_id = ?', [$gid]),
            'messages'     => $grab('SELECT * FROM messages WHERE guest_id = ?', [$gid]),
            'reviews'      => $grab('SELECT * FROM guest_reviews WHERE guest_id = ?', [$gid]),
            'photos'       => $grab('SELECT * FROM guest_photos WHERE guest_id = ?', [$gid]),
            'newsletter'   => $email !== '' ? $grab('SELECT email, name, created_at FROM newsletter_subscribers WHERE email = ?', [$email]) : [],
            'waitlist'     => $email !== '' ? $grab('SELECT * FROM waitlist WHERE email = ?', [$email]) : [],
        ];
        json_out(['ok' => true, 'data' => $data]);
    }

    // GDPR erasure: a logged-in guest deletes their account. Financial records
    // (bookings + payments) are RETAINED for tax/accounting but stripped of personal
    // data; everything else (enquiries, messages, reviews, mailing-list, passkeys,
    // push, etc.) is purged. Public photos are kept but de-identified.
    case 'guest_delete_account': {
        if (empty($_SESSION['guest_id'])) json_out(['error' => 'Please log in first'], 401);
        $gid = (int)$_SESSION['guest_id'];
        $r = db()->prepare('SELECT email FROM guests WHERE id = ?'); $r->execute([$gid]);
        $email = (string)($r->fetchColumn() ?: '');
        $try = function ($sql, $params) { try { db()->prepare($sql)->execute($params); } catch (\Throwable $e) { /* table may not exist */ } };
        if ($email !== '') {
            // Anonymise the financial trail (kept for accounting), then purge non-financial PII.
            $try('UPDATE payments p JOIN bookings b ON b.id = p.booking_id SET p.guest_name = ? WHERE b.email = ?', ['Former guest', $email]);
            $try('UPDATE bookings SET name = ?, email = NULL, phone = NULL, address = NULL, postcode = NULL WHERE email = ?', ['Former guest', $email]);
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
        db()->prepare('DELETE FROM guests WHERE id = ?')->execute([$gid]);
        unset($_SESSION['guest_id']);
        json_out(['ok' => true]);
    }

    // Staging sandbox ONLY: frictionless guest testing. Establishes a test-guest
    // session without the sign-in wall, so the owner can try all the guest-only
    // features. Refuses on any non-staging host. Reuses the owner-email guest (so
    // Test-centre test bookings appear in My Stays), creating it if needed.
    case 'staging_guest_session': {
        if (!preg_match('/(^|\.)staging\./i', $_SERVER['HTTP_HOST'] ?? '')) json_out(['error' => 'Not available'], 403);
        if (!empty($_SESSION['guest_id'])) {
            $s = db()->prepare('SELECT name, email, phone, address, postcode FROM guests WHERE id = ?');
            $s->execute([$_SESSION['guest_id']]);
            json_out(['ok' => true, 'guest' => $s->fetch() ?: null]);
        }
        $email = (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) ? OWNER_NOTIFY_EMAIL : 'staging-guest@example.invalid';
        $s = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE email = ?');
        $s->execute([$email]); $g = $s->fetch();
        if (!$g) {
            db()->prepare('INSERT INTO guests (name, email, password_hash) VALUES (?,?,?)')
                ->execute(['Staging Test Guest', $email, password_hash(bin2hex(random_bytes(9)), PASSWORD_DEFAULT)]);
            $gid = (int)db()->lastInsertId();
            $s = db()->prepare('SELECT id, name, email, phone, address, postcode FROM guests WHERE id = ?');
            $s->execute([$gid]); $g = $s->fetch();
        }
        $_SESSION['guest_id'] = (int)$g['id'];
        unset($_SESSION['admin_id']);   // one role at a time
        json_out(['ok' => true, 'guest' => ['name' => $g['name'], 'email' => $g['email'], 'phone' => $g['phone'], 'address' => $g['address'], 'postcode' => $g['postcode']]]);
    }

    // ----------- ADMIN: manage guest accounts -----------
    case 'guest_list': {
        require_admin();
        $rows = db()->query('SELECT id, name, email, phone, created_at FROM guests ORDER BY name ASC')->fetchAll();
        json_out(['guests' => $rows]);
    }

    case 'guest_reset_password': {
        require_admin();
        $email = strtolower(clean($in['email'] ?? ''));
        $next  = $in['next'] ?? '';
        if ($email === '') json_out(['error' => 'Guest email is required'], 400);
        if (strlen($next) < 8) json_out(['error' => 'New password must be at least 8 characters'], 400);
        $stmt = db()->prepare('SELECT id FROM guests WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        if (!$row) json_out(['error' => 'No guest account found with that email'], 404);
        $hash = password_hash($next, PASSWORD_DEFAULT);
        db()->prepare('UPDATE guests SET password_hash = ? WHERE id = ?')->execute([$hash, $row['id']]);
        json_out(['ok' => true]);
    }

    default:
        json_out(['error' => 'Unknown action'], 400);
}
