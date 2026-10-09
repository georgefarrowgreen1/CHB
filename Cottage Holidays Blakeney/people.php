<?php
// ============================================================
//  people.php — Permissions (Manage → Your account → Permissions).
//  Super Users only. Each person signs in with their own password or passkey;
//  nobody here ever sets or sees a password — adding someone emails them a link
//  to choose their own, and a reset sends a new link.
//  POST {action}: list, invite, reinvite, cancel_invite, remove, restore,
//                 set_full (the role), set_perm, reset_perms, reset_link,
//                 passkeys, passkey_remove, set_mail
//  Two rules hold everywhere: you never act on yourself here (your own details
//  live on your account page) — except set_mail, the emails, which you choose
//  for yourself too — and there is always a Super User.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php'; // the extra addresses (people_mail_extras)

$in = body();
require_full_access();
$me = admin_me();
$myId = (int) $me['id'];
$myFirst = people_first_name($me);

// The person the action is about: never yourself, and they must exist.
function people_target(array $in, $myId)
{
    $id = (int) ($in['id'] ?? 0);
    if ($id === $myId) {
        json_out(['error' => 'Your own sign-in is on your account page.'], 400);
    }
    $row = admin_row($id, true);
    if (!$row) {
        json_out(['error' => 'That person isn’t here any more.', 'code' => 'gone'], 404);
    }
    return $row;
}
// How many Super Users can still sign in, other than this one.
function people_other_full($id)
{
    $q = db()->prepare('SELECT COUNT(*) FROM admins WHERE id <> ? AND full_access = 1 AND removed_at IS NULL AND invited_at IS NULL');
    $q->execute([(int) $id]);
    return (int) $q->fetchColumn();
}
function people_list_payload($myId)
{
    $rows = db()->query('SELECT * FROM admins ORDER BY full_access DESC, id')->fetchAll();
    $counts = [];
    foreach (db()->query('SELECT admin_id, COUNT(*) n FROM admin_passkeys GROUP BY admin_id')->fetchAll() as $r) {
        $counts[(int) $r['admin_id']] = (int) $r['n'];
    }
    $out = [];
    foreach ($rows as $r) {
        $p = people_public($r, $myId);
        $p['contact'] = admin_contact_email($r);
        $p['passkeys'] = $counts[(int) $r['id']] ?? 0;
        $p += people_mail_payload($r);
        $out[] = $p;
    }
    // You first, then everyone else in the order they joined.
    usort($out, fn($a, $b) => ($b['you'] <=> $a['you']) ?: ($a['id'] <=> $b['id']));
    return $out;
}
// Every permission, in page order, so the screen never keeps a second copy of the words.
function people_perm_defs()
{
    $out = [];
    foreach (PEOPLE_PERMS as $k => $p) {
        $out[] = ['k' => $k, 't' => $p[0], 'g' => $p[1], 'fixed' => $p[2], 'host' => people_host_perms()[$k]];
    }
    return $out;
}
function people_done(array $extra = [])
{
    json_out(
        [
            'ok' => true,
            'people' => people_list_payload((int) $_SESSION['admin_id']),
            'mailKinds' => people_mail_kinds(),
            'mailExtras' => people_mail_extras(),
            'permDefs' => people_perm_defs(),
            'permGroups' => PEOPLE_PERM_GROUPS,
        ] + $extra,
    );
}
// Store a Host's permissions as how they differ from a plain Host.
function people_perms_save($id, array $perms)
{
    try {
        db()->prepare('UPDATE admins SET perms = ? WHERE id = ?')->execute([json_encode((object) people_perms_diff($perms)), (int) $id]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Permissions need the latest database update — run the migrations first.'], 503);
    }
}

route_actions(
    [
        'list' => fn() => people_done(),

        // Add someone: their name, email and role. A Host starts as a plain Host
        // (bookings, guests, key safes and the money); each permission can be
        // changed afterwards. They choose their own password from the email.
        'invite' => function () use ($in, $myId, $myFirst) {
            rate_limit('people_invite', 10, 60);
            $name = trim((string) ($in['name'] ?? ''));
            $email = strtolower(trim((string) ($in['email'] ?? '')));
            $bad = people_name_problem($name) ?: people_email_problem($email);
            if ($bad !== '') {
                json_out(['error' => $bad], 400);
            }
            $q = db()->prepare('SELECT * FROM admins WHERE email = ? LIMIT 1');
            $q->execute([$email]);
            $dupe = $q->fetch();
            // The first sign-in takes the owner address from config.php until its
            // owner sets their own, so inviting the person who used to share it
            // meets your own row: say so, and where to change it.
            if (!$dupe && admin_contact_email(admin_me() ?: []) === $email) {
                $dupe = admin_me();
            }
            if ($dupe) {
                json_out(
                    [
                        'error' => (int) $dupe['id'] === $myId
                            ? 'That’s the email on your own sign-in. Change yours in Your details first, then invite them.'
                            : (!empty($dupe['removed_at'])
                                ? 'That email was ' . people_display_name($dupe) . '’s. Give the access back from ' . people_first_name($dupe) . '’s page instead.'
                                : 'That email already has a sign-in.'),
                    ],
                    409,
                );
            }
            $super = ($in['role'] ?? 'host') === 'super';
            $taken = array_map('strval', db()->query('SELECT username FROM admins')->fetchAll(PDO::FETCH_COLUMN));
            $username = people_username_from($name, $taken);
            try {
                db()
                    ->prepare(
                        "INSERT INTO admins (username, password_hash, name, email, full_access, caps, perms, twofa, invited_at, created_at)
                         VALUES (?, '', ?, ?, ?, '', '{}', 1, NOW(), NOW())",
                    )
                    ->execute([$username, $name, $email, $super ? 1 : 0]);
            } catch (\Throwable $e) {
                json_out(['error' => 'Permissions need the latest database update — run the migrations first.'], 503);
            }
            $row = admin_row((int) db()->lastInsertId(), true);
            $sent = $row ? admin_send_link($row, 'invite', $myFirst) : false;
            log_activity('account', 'people.invite', $myFirst . ' invited ' . $name . ' to the back office as a ' . ($super ? 'Super User' : 'Host'), ['severity' => $super ? 'warn' : 'info', 'entity' => 'admin', 'entity_id' => (string) ($row['id'] ?? '')]);
            people_done(['sent' => $sent, 'id' => (int) ($row['id'] ?? 0)]);
        },

        'reinvite' => function () use ($in, $myId, $myFirst) {
            rate_limit('people_invite', 10, 60);
            $row = people_target($in, $myId);
            if (empty($row['invited_at'])) {
                json_out(['error' => people_first_name($row) . ' has already chosen a password.'], 409);
            }
            $sent = admin_send_link($row, 'invite', $myFirst);
            log_activity('account', 'people.reinvite', $myFirst . ' sent ' . people_display_name($row) . '’s invite again', ['entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done(['sent' => $sent]);
        },

        // An invite nobody has used yet is withdrawn outright: there is no
        // history to keep, and the link stops working.
        'cancel_invite' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            if (empty($row['invited_at']) || !empty($row['removed_at'])) {
                json_out(['error' => 'That invite has already been used.'], 409);
            }
            db()->prepare('DELETE FROM admin_passkeys WHERE admin_id = ?')->execute([(int) $row['id']]);
            db()->prepare('DELETE FROM admins WHERE id = ? AND invited_at IS NOT NULL')->execute([(int) $row['id']]);
            log_activity('account', 'people.invite_cancel', $myFirst . ' cancelled ' . people_display_name($row) . '’s invite', ['entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done();
        },

        // Remove someone's access: signed out everywhere at once, the password and
        // passkeys switched off, devices forgotten. The row stays, so the activity
        // log still names them.
        'remove' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            if (!empty($row['removed_at'])) {
                people_done();
            }
            if (people_is_full($row) && people_other_full((int) $row['id']) === 0) {
                json_out(['error' => 'There must always be a Super User.'], 409);
            }
            db()
                ->prepare(
                    'UPDATE admins SET removed_at = NOW(), auth_epoch = auth_epoch + 1, invite_hash = NULL, invite_expires = NULL,
                        reset_hash = NULL, reset_expires = NULL WHERE id = ?',
                )
                ->execute([(int) $row['id']]);
            try {
                db()->prepare('DELETE FROM admin_devices WHERE admin_id = ?')->execute([(int) $row['id']]);
                db()->prepare("DELETE FROM push_subscriptions WHERE admin_id = ? AND role = 'admin'")->execute([(int) $row['id']]);
            } catch (\Throwable $e) {
            }
            log_activity('account', 'people.remove', $myFirst . ' removed ' . people_display_name($row) . '’s access', ['severity' => 'warn', 'entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done();
        },

        // Give access back: a fresh start — a new invite to choose a new password;
        // the old passkeys are gone (they add new ones).
        'restore' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            if (empty($row['removed_at'])) {
                json_out(['error' => people_first_name($row) . ' already has access.'], 409);
            }
            db()->prepare('DELETE FROM admin_passkeys WHERE admin_id = ?')->execute([(int) $row['id']]);
            db()
                ->prepare("UPDATE admins SET removed_at = NULL, invited_at = NOW(), password_hash = '', auth_epoch = auth_epoch + 1 WHERE id = ?")
                ->execute([(int) $row['id']]);
            $row = admin_row((int) $row['id'], true);
            $sent = $row ? admin_send_link($row, 'invite', $myFirst) : false;
            log_activity('account', 'people.restore', $myFirst . ' gave ' . people_display_name($row ?: []) . ' access again (a new invite)', ['entity' => 'admin', 'entity_id' => (string) ($row['id'] ?? '')]);
            people_done(['sent' => $sent]);
        },

        // The role: a Super User can do everything; a Host has what their
        // permissions say. Becoming a Host starts as a plain Host.
        'set_full' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            $on = !empty($in['on']);
            if ($on === people_is_full($row)) {
                people_done();
            }
            if (!$on && people_other_full((int) $row['id']) === 0) {
                json_out(['error' => 'There must always be a Super User.'], 409);
            }
            db()->prepare('UPDATE admins SET full_access = ? WHERE id = ?')->execute([$on ? 1 : 0, (int) $row['id']]);
            if (!$on) {
                people_perms_save((int) $row['id'], people_host_perms());
            }
            log_activity('account', 'people.role', $myFirst . ' made ' . people_display_name($row) . ($on ? ' a Super User' : ' a Host'), ['severity' => $on ? 'warn' : 'info', 'entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done();
        },

        // One permission, on or off, for a Host.
        'set_perm' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            $k = (string) ($in['perm'] ?? '');
            if (!isset(PEOPLE_PERMS[$k])) {
                json_out(['error' => 'Unknown permission'], 400);
            }
            if (people_is_full($row)) {
                json_out(['error' => people_first_name($row) . ' is a Super User, so can do everything already.'], 409);
            }
            if (PEOPLE_PERMS[$k][2] === 'always') {
                json_out(['error' => 'Everyone can ' . lcfirst(PEOPLE_PERMS[$k][0]) . '.'], 409);
            }
            if (PEOPLE_PERMS[$k][2] === 'super') {
                json_out(['error' => PEOPLE_PERMS[$k][0] . ' is for a Super User only.'], 409);
            }
            $perms = people_perms($row);
            $perms[$k] = !empty($in['on']);
            people_perms_save((int) $row['id'], $perms);
            log_activity('account', 'people.perm', $myFirst . ' turned ' . PEOPLE_PERMS[$k][0] . ($perms[$k] ? ' on' : ' off') . ' for ' . people_display_name($row), ['entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done();
        },

        // Back to a plain Host: every permission as the role has it.
        'reset_perms' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            if (people_is_full($row)) {
                json_out(['error' => people_first_name($row) . ' is a Super User.'], 409);
            }
            people_perms_save((int) $row['id'], people_host_perms());
            log_activity('account', 'people.perm_reset', $myFirst . ' put ' . people_display_name($row) . ' back to a plain Host', ['entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done();
        },

        // A link to their own inbox to choose a new password. You never see it.
        'reset_link' => function () use ($in, $myId, $myFirst) {
            rate_limit('people_reset', 6, 60);
            $row = people_target($in, $myId);
            if (!empty($row['removed_at']) || !empty($row['invited_at'])) {
                json_out(['error' => people_first_name($row) . ' doesn’t have a password to reset.'], 409);
            }
            $sent = admin_send_link($row, 'reset', $myFirst);
            log_activity('account', 'people.reset', $myFirst . ' sent ' . people_display_name($row) . ' a password reset link', ['entity' => 'admin', 'entity_id' => (string) $row['id']]);
            people_done(['sent' => $sent]);
        },

        // Who gets which emails: one person, one kind, on or off. You may choose
        // your own here too. An email whose permission is off for them can't be
        // switched on (the permission takes its emails with it), and the last
        // person on an email that must reach someone can't be switched off.
        'set_mail' => function () use ($in, $myFirst) {
            $id = (int) ($in['id'] ?? 0);
            $row = admin_row($id, true);
            if (!$row || !empty($row['removed_at'])) {
                json_out(['error' => 'That person isn’t here any more.', 'code' => 'gone'], 404);
            }
            $kind = (string) ($in['kind'] ?? '');
            if (!isset(PEOPLE_MAILS[$kind])) {
                json_out(['error' => 'Unknown email'], 400);
            }
            $on = !empty($in['on']);
            if ($on && ($lock = people_mail_lock($row, $kind)) !== '') {
                json_out(['error' => $lock, 'code' => 'locked'], 409);
            }
            if (!$on) {
                $all = db()->query('SELECT * FROM admins WHERE removed_at IS NULL')->fetchAll();
                $bad = people_mail_must_problem($all, $id, $kind);
                if ($bad !== '') {
                    json_out(['error' => $bad, 'code' => 'must'], 409);
                }
            }
            $mail = people_mail_norm($row);
            $mail[$kind] = $on;
            try {
                db()->prepare('UPDATE admins SET mail_prefs = ? WHERE id = ?')->execute([json_encode($mail), $id]);
            } catch (\Throwable $e) {
                json_out(['error' => 'This needs the latest database update — run the migrations first.'], 503);
            }
            log_activity('account', 'people.mail', $myFirst . ($on ? ' sent ' : ' stopped ') . PEOPLE_MAILS[$kind]['name'] . ($on ? ' to ' : ' for ') . ((int) $row['id'] === (int) $_SESSION['admin_id'] ? 'themselves' : people_display_name($row)), ['entity' => 'admin', 'entity_id' => (string) $id]);
            people_done();
        },

        // Someone else's passkeys: you can see them and remove a lost phone's,
        // never add or use one.
        'passkeys' => function () use ($in, $myId) {
            $row = people_target($in, $myId);
            $s = db()->prepare('SELECT id, label, created_at, last_used_at FROM admin_passkeys WHERE admin_id = ? ORDER BY created_at DESC');
            $s->execute([(int) $row['id']]);
            json_out(['ok' => true, 'passkeys' => $s->fetchAll()]);
        },
        'passkey_remove' => function () use ($in, $myId, $myFirst) {
            $row = people_target($in, $myId);
            $key = (int) ($in['key'] ?? 0);
            $q = db()->prepare('SELECT label FROM admin_passkeys WHERE id = ? AND admin_id = ?');
            $q->execute([$key, (int) $row['id']]);
            $label = $q->fetchColumn();
            if ($label === false) {
                json_out(['error' => 'That passkey has already gone.', 'code' => 'gone'], 404);
            }
            db()->prepare('DELETE FROM admin_passkeys WHERE id = ? AND admin_id = ?')->execute([$key, (int) $row['id']]);
            log_activity('account', 'people.passkey_remove', $myFirst . ' removed ' . people_display_name($row) . '’s passkey (' . mb_substr((string) $label, 0, 40) . ')', ['entity' => 'admin', 'entity_id' => (string) $row['id']]);
            $s = db()->prepare('SELECT id, label, created_at, last_used_at FROM admin_passkeys WHERE admin_id = ? ORDER BY created_at DESC');
            $s->execute([(int) $row['id']]);
            json_out(['ok' => true, 'passkeys' => $s->fetchAll(), 'people' => people_list_payload((int) $_SESSION['admin_id'])]);
        },
    ],
    $in,
);
