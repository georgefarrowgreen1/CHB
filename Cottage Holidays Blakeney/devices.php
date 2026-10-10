<?php
// ============================================================
//  devices.php — Devices: where each person is signed in to the back office,
//  and signing any of those devices out. Manage → Your account → Sign-in &
//  security (your own), and a person's page in Permissions (a Super User's).
//  POST {action}: list {id?}, sign_out {sid, id?}, sign_out_all {id?, push_endpoint?}
//
//  Your own devices are yours. Anyone else's are a Super User's to see and sign
//  out, and that person is emailed saying who did it. Signing out asks for no
//  password: it only takes access away, and the moment it is needed is often on
//  a borrowed phone. The device you are using is never signed out from here —
//  that is Log out, on your account page.
// ============================================================
define('CHB_KEEPS_SESSION', true); // signing out your other devices re-stamps this session
require_once __DIR__ . '/db.php';

$in = body();
require_admin();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(['error' => 'This action needs a POST.'], 405);
}
if (!devices_ready()) {
    json_out(['error' => 'Devices need the latest database update. Run the migrations first.', 'code' => 'not_migrated'], 503);
}
$me = admin_me();
$myId = (int) $me['id'];
$mySid = (int) ($_SESSION['admin_sess'] ?? 0);

// Whose devices: your own, or (a Super User only) someone else's.
function devices_whose(array $in, int $myId): array
{
    $id = (int) ($in['id'] ?? 0);
    if ($id <= 0 || $id === $myId) {
        return admin_me() ?: [];
    }
    if (!admin_is_full()) {
        json_out(['error' => people_refusal(admin_owner_first()), 'code' => 'not_allowed', 'area' => 'owner'], 403);
    }
    $row = admin_row($id, true);
    if (!$row) {
        json_out(['error' => 'That person isn’t here any more.', 'code' => 'gone'], 404);
    }
    return $row;
}
// The list as the page draws it, with what it needs to word it honestly.
function devices_answer(array $row, int $myId, int $mySid, array $extra = []): void
{
    $self = (int) $row['id'] === $myId;
    $began = devices_began();
    json_out(
        [
            'ok' => true,
            'id' => (int) $row['id'],
            'devices' => devices_list((int) $row['id'], $self ? $mySid : 0),
            'twofa' => admin_twofa_on($row),
            'began' => $began ? substr($began, 0, 10) : '',
            'partial' => devices_partial($began, time(), CHB_SESSION_TTL),
        ] + $extra,
    );
}

route_actions(
    [
        'list' => function () use ($in, $myId, $mySid) {
            devices_answer(devices_whose($in, $myId), $myId, $mySid);
        },

        // One device: signed out the next time it is used, forgotten for two-step,
        // and its alerts stop.
        'sign_out' => function () use ($in, $me, $myId, $mySid) {
            $row = devices_whose($in, $myId);
            $self = (int) $row['id'] === $myId;
            $sid = (int) ($in['sid'] ?? 0);
            if ($self && $sid === $mySid) {
                json_out(['error' => 'That’s the device you’re using. Log out from your account page instead.', 'code' => 'this_device'], 400);
            }
            $s = devices_row($sid);
            if (!$s || (int) $s['admin_id'] !== (int) $row['id']) {
                json_out(['error' => 'That device isn’t signed in any more.', 'code' => 'gone'], 404);
            }
            // Already signed out (a second tap, or from another device): the list
            // as it stands is the answer, with nothing done twice.
            if (!devices_end($sid, 'device', $myId, true)) {
                devices_answer($row, $myId, $mySid, ['already' => true]);
            }
            $label = (string) $s['label'];
            log_activity(
                'account',
                'admin.device_signout',
                $self ? people_display_name($me) . ' signed out ' . $label : people_display_name($me) . ' signed ' . people_display_name($row) . ' out of ' . $label,
                ['entity' => 'admin', 'entity_id' => (string) $row['id']],
            );
            if (!$self) {
                devices_tell_signed_out($row, people_first_name($me), $label);
            }
            devices_answer($row, $myId, $mySid, ['label' => $label]);
        },

        // Every other device of yours, or every device of someone else's. The
        // epoch moves too, so a session from before the list began — which has
        // no row to end — is signed out as well. Yours carries on: re-stamped.
        'sign_out_all' => function () use ($in, $me, $myId, $mySid) {
            $row = devices_whose($in, $myId);
            $pid = (int) $row['id'];
            $self = $pid === $myId;
            $keep = $self ? $mySid : 0;
            db()->prepare('UPDATE admins SET auth_epoch = auth_epoch + 1 WHERE id = ?')->execute([$pid]);
            if ($self) {
                $_SESSION['admin_epoch'] = (int) ((admin_row($myId, true) ?: [])['auth_epoch'] ?? 0);
            }
            $n = devices_end_others($pid, $keep, 'all', $myId, true);
            devices_forget_all($pid, $self ? devices_trust_hash() : '', $self && is_string($in['push_endpoint'] ?? null) ? (string) $in['push_endpoint'] : '', $keep);
            log_activity(
                'account',
                'admin.device_signout_all',
                $self
                    ? people_display_name($me) . ' signed out of every other device (' . $n . ')'
                    : people_display_name($me) . ' signed ' . people_display_name($row) . ' out everywhere',
                ['entity' => 'admin', 'entity_id' => (string) $pid],
            );
            if (!$self) {
                devices_tell_signed_out($row, people_first_name($me), '');
            }
            devices_answer($row, $myId, $mySid, ['count' => $n]);
        },
    ],
    $in,
);
