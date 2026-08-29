<?php
// ============================================================
//  passkeys.php — WebAuthn / FIDO2 passkey support for guest accounts.
//  Uses the lbuchs/WebAuthn library (you upload it to lib/WebAuthn/ — see
//  SETUP-PASSKEYS.md). Passkeys are ADDED ALONGSIDE password login, never
//  replacing it, so guests always have a fallback.
//
//  Actions (POST JSON):
//   register_begin   (guest must be logged in)  -> creation options
//   register_finish  (guest)                    -> store the new credential
//   list             (guest)                    -> their registered passkeys
//   delete           (guest)                    -> remove one passkey
// ============================================================
require_once __DIR__ . '/db.php';

// --- Load the WebAuthn library (uploaded separately) ---
$libBase = __DIR__ . '/lib/WebAuthn/WebAuthn.php';
if (!is_file($libBase)) {
    json_out(['error' => 'Passkey library not installed. Upload lib/WebAuthn/ (see SETUP-PASSKEYS.md).'], 500);
}
require_once $libBase;

use lbuchs\WebAuthn\WebAuthn;

// --- Work out the Relying Party (your domain) ---
// rpId must be the registrable domain (no scheme, no port, no path).
$host = $_SERVER['HTTP_HOST'] ?? '';
$rpId = preg_replace('/:\d+$/', '', $host); // strip any port
$rpName = 'Cottage Holidays Blakeney';

function new_webauthn($rpName, $rpId)
{
    // Allow common formats; 'none' attestation keeps it simple (no enterprise need).
    return new WebAuthn($rpName, $rpId, null);
}

// base64url helpers (WebAuthn uses base64url, NOT standard base64) ---
function b64url_encode($bin)
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}
function b64url_decode($txt)
{
    $txt = strtr($txt, '-_', '+/');
    $pad = strlen($txt) % 4;
    if ($pad) {
        $txt .= str_repeat('=', 4 - $pad);
    }
    return base64_decode($txt);
}

// Normalise the library's argument object so every binary field is a plain
// base64url STRING before it goes to the browser. The lbuchs library returns
// binary values as ByteBuffer objects (which JSON-encode as {"$base64":...});
// we convert them to predictable strings the client can decode reliably.
function normalize_args($node)
{
    if (is_object($node)) {
        // A lbuchs ByteBuffer holds binary data. Different versions expose it
        // differently, so try several routes to get clean base64url out.
        if (method_exists($node, 'getBinaryString')) {
            return b64url_encode($node->getBinaryString());
        }
        if ($node instanceof \JsonSerializable) {
            $j = $node->jsonSerialize();
            // Typically {"$base64":"..."} (standard base64) — re-encode to base64url.
            if (is_array($j) && isset($j['$base64'])) {
                return b64url_encode(base64_decode($j['$base64']));
            }
            if (is_string($j)) {
                return $j;
            }
            return normalize_args($j);
        }
        $out = new stdClass();
        foreach (get_object_vars($node) as $k => $v) {
            $out->$k = normalize_args($v);
        }
        return $out;
    }
    if (is_array($node)) {
        // Array might itself be a {"$base64":...} structure after json round-trip.
        if (isset($node['$base64'])) {
            return b64url_encode(base64_decode($node['$base64']));
        }
        return array_map('normalize_args', $node);
    }
    return $node;
}

$in = body();
$action = $in['action'] ?? '';

// Brute-force / spam guard on the UNAUTHENTICATED WebAuthn steps. The crypto
// itself resists guessing, but unlimited login_finish attempts and unlimited
// challenge minting are free load + probing surface. Authenticated actions
// (register/list/delete) are already gated by their sessions.
if (in_array($action, ['admin_login_begin', 'admin_login_finish'], true)) {
    rate_limit('passkey-login', 20, 10);
}
$wa = new_webauthn($rpName, $rpId);

// ---------------- REGISTER (logged-in guest adds a passkey) ----------------
if ($action === 'register_begin') {
    require_guest();
    $gid = current_guest_id();
    $g = db()->prepare('SELECT id, name, email FROM guests WHERE id = ?');
    $g->execute([$gid]);
    $guest = $g->fetch();
    if (!$guest) {
        json_out(['error' => 'Guest not found'], 404);
    }

    // userId must be binary & stable; use the numeric guest id.
    $userId = (string) $guest['id'];
    $args = $wa->getCreateArgs($userId, $guest['email'], $guest['name'], 30, false, 'none');
    // Remember the challenge for the finish step (binary -> base64url in session).
    $_SESSION['pk_challenge'] = b64url_encode($wa->getChallenge()->getBinaryString());
    json_out(['options' => normalize_args($args)]);
}

if ($action === 'register_finish') {
    require_guest();
    $gid = current_guest_id();
    if (empty($_SESSION['pk_challenge'])) {
        json_out(['error' => 'No registration in progress'], 400);
    }
    $challenge = b64url_decode($_SESSION['pk_challenge']);

    try {
        $clientDataJSON = b64url_decode($in['clientDataJSON'] ?? '');
        $attestationObject = b64url_decode($in['attestationObject'] ?? '');
        $data = $wa->processCreate($clientDataJSON, $attestationObject, $challenge, false, true, false);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not register passkey: ' . $e->getMessage()], 400);
    }

    $credId = b64url_encode($data->credentialId);
    $pubKey = $data->credentialPublicKey; // PEM string
    $label = trim($in['label'] ?? '') ?: 'Passkey';
    db()
        ->prepare(
            'INSERT INTO guest_passkeys (guest_id, credential_id, public_key, label, sign_count)
                   VALUES (?,?,?,?,?)',
        )
        ->execute([$gid, $credId, $pubKey, $label, (int) ($data->signCount ?? 0)]);
    unset($_SESSION['pk_challenge']);
    log_activity('account', 'passkey.register', 'Passkey added — ' . mb_substr($label, 0, 60), ['actor' => 'guest', 'entity' => 'passkey']);
    json_out(['ok' => true]);
}

// The usernameless login_begin/login_finish pair is REMOVED — superseded by
// any_login_begin/any_login_finish (the mode-choosing pair the client has used
// since it shipped), it had no caller and was pure unauthenticated
// session-minting surface. An unknown action falls through to the 400 below.

// ---------------- MANAGE ----------------
if ($action === 'list') {
    require_guest();
    $s = db()->prepare(
        'SELECT id, label, created_at, last_used_at FROM guest_passkeys WHERE guest_id = ? ORDER BY created_at DESC',
    );
    $s->execute([current_guest_id()]);
    json_out(['passkeys' => $s->fetchAll()]);
}

if ($action === 'delete') {
    require_guest();
    $pid = (int) ($in['id'] ?? 0);
    db()
        ->prepare('DELETE FROM guest_passkeys WHERE id = ? AND guest_id = ?')
        ->execute([$pid, current_guest_id()]);
    json_out(['ok' => true]);
}

// ==================== ADMIN PASSKEYS (back office) ====================
// Mirror of the guest flow, but for the admin account. The admin PASSWORD
// always remains a working fallback — these are an additional way in.

if ($action === 'admin_register_begin') {
    require_admin();
    $aid = (int) $_SESSION['admin_id'];
    $a = db()->prepare('SELECT id, username FROM admins WHERE id = ?');
    $a->execute([$aid]);
    $admin = $a->fetch();
    if (!$admin) {
        json_out(['error' => 'Admin not found'], 404);
    }
    $args = $wa->getCreateArgs((string) $admin['id'], $admin['username'], $admin['username'], 30, false, 'none');
    $_SESSION['pk_admin_challenge'] = b64url_encode($wa->getChallenge()->getBinaryString());
    json_out(['options' => normalize_args($args)]);
}

if ($action === 'admin_register_finish') {
    require_admin();
    $aid = (int) $_SESSION['admin_id'];
    if (empty($_SESSION['pk_admin_challenge'])) {
        json_out(['error' => 'No registration in progress'], 400);
    }
    $challenge = b64url_decode($_SESSION['pk_admin_challenge']);
    try {
        $clientDataJSON = b64url_decode($in['clientDataJSON'] ?? '');
        $attestationObject = b64url_decode($in['attestationObject'] ?? '');
        $data = $wa->processCreate($clientDataJSON, $attestationObject, $challenge, false, true, false);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not register passkey: ' . $e->getMessage()], 400);
    }
    $credId = b64url_encode($data->credentialId);
    $label = trim($in['label'] ?? '') ?: 'Passkey';
    db()
        ->prepare(
            'INSERT INTO admin_passkeys (admin_id, credential_id, public_key, label, sign_count) VALUES (?,?,?,?,?)',
        )
        ->execute([$aid, $credId, $data->credentialPublicKey, $label, (int) ($data->signCount ?? 0)]);
    unset($_SESSION['pk_admin_challenge']);
    log_activity('account', 'passkey.admin_register', 'Admin passkey added — ' . mb_substr($label, 0, 60), ['entity' => 'passkey']);
    json_out(['ok' => true]);
}

if ($action === 'admin_login_begin') {
    $args = $wa->getGetArgs([], 30, true, true, true, true, false);
    $_SESSION['pk_admin_login_challenge'] = b64url_encode($wa->getChallenge()->getBinaryString());
    json_out(['options' => normalize_args($args)]);
}

if ($action === 'admin_login_finish') {
    if (empty($_SESSION['pk_admin_login_challenge'])) {
        json_out(['error' => 'No login in progress'], 400);
    }
    $challenge = b64url_decode($_SESSION['pk_admin_login_challenge']);
    $credId = $in['id'] ?? '';
    $row = db()->prepare('SELECT * FROM admin_passkeys WHERE credential_id = ?');
    $row->execute([$credId]);
    $cred = $row->fetch();
    if (!$cred) {
        json_out(['error' => 'Passkey not recognised'], 401);
    }
    try {
        $clientDataJSON = b64url_decode($in['clientDataJSON'] ?? '');
        $authenticatorData = b64url_decode($in['authenticatorData'] ?? '');
        $signature = b64url_decode($in['signature'] ?? '');
        // null = skip the signature-counter check (needed for synced passkeys).
        $data = $wa->processGet($clientDataJSON, $authenticatorData, $signature, $cred['public_key'], $challenge, null);
    } catch (\Throwable $e) {
        json_out(['error' => 'Passkey verification failed: ' . $e->getMessage()], 401);
    }
    $newCount = is_object($data) && isset($data->signCount) ? (int) $data->signCount : (int) $cred['sign_count'];
    db()
        ->prepare('UPDATE admin_passkeys SET sign_count = ?, last_used_at = NOW() WHERE id = ?')
        ->execute([$newCount, $cred['id']]);
    session_regenerate_id(true); // new session id on login — prevents session fixation
    $_SESSION['admin_id'] = (int) $cred['admin_id'];
    unset($_SESSION['guest_id']); // one role at a time: signing in as admin ends any guest session
    unset($_SESSION['pk_admin_login_challenge']);
    json_out(['ok' => true]);
}

// STEP-UP by passkey: the same assertion the owner signs in with, asked for
// again before a refund. Two differences from admin_login_finish, and both
// matter: the credential must belong to the admin ALREADY signed in (a
// borrowed session must not be re-confirmed by someone else's passkey), and
// it stamps the re-auth window rather than creating a session.
if ($action === 'admin_reauth_begin') {
    require_admin();
    $args = $wa->getGetArgs([], 30, true, true, true, true, false);
    $_SESSION['pk_admin_reauth_challenge'] = b64url_encode($wa->getChallenge()->getBinaryString());
    json_out(['options' => normalize_args($args)]);
}

if ($action === 'admin_reauth_finish') {
    require_admin();
    if (empty($_SESSION['pk_admin_reauth_challenge'])) {
        json_out(['error' => 'No confirmation in progress'], 400);
    }
    $challenge = b64url_decode($_SESSION['pk_admin_reauth_challenge']);
    unset($_SESSION['pk_admin_reauth_challenge']); // one shot: a challenge is never reusable
    $row = db()->prepare('SELECT * FROM admin_passkeys WHERE credential_id = ?');
    $row->execute([$in['id'] ?? '']);
    $cred = $row->fetch();
    // THE BINDING: this passkey must be the signed-in owner's own.
    if (!$cred || (int) $cred['admin_id'] !== (int) $_SESSION['admin_id']) {
        json_out(['error' => 'That passkey is not registered to this account.'], 401);
    }
    try {
        $wa->processGet(
            b64url_decode($in['clientDataJSON'] ?? ''),
            b64url_decode($in['authenticatorData'] ?? ''),
            b64url_decode($in['signature'] ?? ''),
            $cred['public_key'],
            $challenge,
            null, // synced passkeys have no reliable counter
        );
    } catch (\Throwable $e) {
        log_activity('account', 'admin.reauth_fail', 'Passkey confirmation failed before a refund', ['level' => 'warn']);
        json_out(['error' => 'That passkey could not be verified.'], 401);
    }
    db()->prepare('UPDATE admin_passkeys SET last_used_at = NOW() WHERE id = ?')->execute([$cred['id']]);
    reauth_stamp();
    json_out(['ok' => true]);
}

if ($action === 'admin_list') {
    require_admin();
    $s = db()->prepare(
        'SELECT id, label, created_at, last_used_at FROM admin_passkeys WHERE admin_id = ? ORDER BY created_at DESC',
    );
    $s->execute([(int) $_SESSION['admin_id']]);
    json_out(['passkeys' => $s->fetchAll()]);
}

if ($action === 'admin_delete') {
    require_admin();
    $pid = (int) ($in['id'] ?? 0);
    db()
        ->prepare('DELETE FROM admin_passkeys WHERE id = ? AND admin_id = ?')
        ->execute([$pid, (int) $_SESSION['admin_id']]);
    json_out(['ok' => true]);
}

// ---------------- UNIFIED LOGIN (one prompt, detects admin OR guest) ----------------
// Both admin and guest passkeys are usernameless/discoverable, so a single
// WebAuthn ceremony can return either. We look the returned credential up in the
// admin table first, then the guest table, and start the matching session.
if ($action === 'any_login_begin') {
    $args = $wa->getGetArgs([], 30, true, true, true, true, false);
    $_SESSION['pk_any_login_challenge'] = b64url_encode($wa->getChallenge()->getBinaryString());
    json_out(['options' => normalize_args($args)]);
}

if ($action === 'any_login_finish') {
    if (empty($_SESSION['pk_any_login_challenge'])) {
        json_out(['error' => 'No login in progress'], 400);
    }
    $challenge = b64url_decode($_SESSION['pk_any_login_challenge']);
    $credId = $in['id'] ?? '';
    $clientDataJSON = b64url_decode($in['clientDataJSON'] ?? '');
    $authenticatorData = b64url_decode($in['authenticatorData'] ?? '');
    $signature = b64url_decode($in['signature'] ?? '');

    // 1) Is this an ADMIN passkey?
    $row = db()->prepare('SELECT * FROM admin_passkeys WHERE credential_id = ?');
    $row->execute([$credId]);
    $cred = $row->fetch();
    if ($cred) {
        try {
            $data = $wa->processGet(
                $clientDataJSON,
                $authenticatorData,
                $signature,
                $cred['public_key'],
                $challenge,
                null,
            );
        } catch (\Throwable $e) {
            json_out(['error' => 'Passkey verification failed: ' . $e->getMessage()], 401);
        }
        $newCount = is_object($data) && isset($data->signCount) ? (int) $data->signCount : (int) $cred['sign_count'];
        db()
            ->prepare('UPDATE admin_passkeys SET sign_count = ?, last_used_at = NOW() WHERE id = ?')
            ->execute([$newCount, $cred['id']]);
        session_regenerate_id(true); // new session id on login — prevents session fixation
        $_SESSION['admin_id'] = (int) $cred['admin_id'];
        unset($_SESSION['guest_id']); // one role at a time
        unset($_SESSION['pk_any_login_challenge']);
        json_out(['ok' => true, 'role' => 'admin']);
    }

    // 2) Otherwise treat it as a GUEST passkey.
    $row = db()->prepare('SELECT p.*, g.name, g.email, g.phone FROM guest_passkeys p
                          JOIN guests g ON g.id = p.guest_id WHERE p.credential_id = ?');
    $row->execute([$credId]);
    $cred = $row->fetch();
    if (!$cred) {
        json_out(['error' => 'Passkey not recognised'], 401);
    }
    try {
        $data = $wa->processGet($clientDataJSON, $authenticatorData, $signature, $cred['public_key'], $challenge, null);
    } catch (\Throwable $e) {
        json_out(['error' => 'Passkey verification failed: ' . $e->getMessage()], 401);
    }
    $newCount = is_object($data) && isset($data->signCount) ? (int) $data->signCount : (int) $cred['sign_count'];
    db()
        ->prepare('UPDATE guest_passkeys SET sign_count = ?, last_used_at = NOW() WHERE id = ?')
        ->execute([$newCount, $cred['id']]);
    session_regenerate_id(true); // new session id on login — prevents session fixation
    $_SESSION['guest_id'] = (int) $cred['guest_id'];
    unset($_SESSION['admin_id']); // one role at a time
    unset($_SESSION['pk_any_login_challenge']);
    json_out([
        'ok' => true,
        'role' => 'guest',
        'guest' => ['name' => $cred['name'], 'email' => $cred['email'], 'phone' => $cred['phone']],
    ]);
}

json_out(['error' => 'Unknown action'], 400);
