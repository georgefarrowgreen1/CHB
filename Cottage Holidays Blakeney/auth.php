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
        if (strlen($next) < 4) json_out(['error' => 'New password must be at least 4 characters'], 400);
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
        if ($name === '' || $email === '' || strlen($pw) < 4) {
            json_out(['error' => 'Name, email and a 4+ character password are required'], 400);
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
        if (strlen($next) < 4) json_out(['error' => 'New password must be at least 4 characters'], 400);
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

    // Logged-in guest deletes their own account (login + passkeys). Their past
    // bookings remain as business/tax records.
    case 'guest_delete_account': {
        if (empty($_SESSION['guest_id'])) json_out(['error' => 'Please log in first'], 401);
        $gid = (int)$_SESSION['guest_id'];
        try { db()->prepare('DELETE FROM guest_passkeys WHERE guest_id = ?')->execute([$gid]); } catch (\Throwable $e) { /* table may not exist */ }
        db()->prepare('DELETE FROM guests WHERE id = ?')->execute([$gid]);
        unset($_SESSION['guest_id']);
        json_out(['ok' => true]);
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
        if (strlen($next) < 4) json_out(['error' => 'New password must be at least 4 characters'], 400);
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
