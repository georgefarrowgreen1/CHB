<?php
// ============================================================
//  photos.php — guest photo wall (UGC).
//   POST multipart {action:'submit', prop_key, caption, image}  -> guest: upload (pending)
//   GET  ?prop=<key>                                            -> public: approved photos
//   POST {action:'list_admin'}                                  -> admin: pending + approved
//   POST {action:'approve'|'reject'|'delete', id}               -> admin: moderate
//
//  Uploaded photos are validated + stored by image-save.php (same as upload.php),
//  but a guest submission lands as 'pending' and only shows once the owner approves.
// ============================================================
require_once __DIR__ . '/db.php';

// ---- Public: approved photos for a cottage ------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $prop = clean($_GET['prop'] ?? '');
    try {
        if ($prop !== '') {
            $s = db()->prepare("SELECT id, prop_key, guest_name, url, caption FROM guest_photos
                                WHERE status = 'approved' AND prop_key = ? ORDER BY created_at DESC LIMIT 60");
            $s->execute([$prop]);
        } else {
            $s = db()->query("SELECT id, prop_key, guest_name, url, caption FROM guest_photos
                              WHERE status = 'approved' ORDER BY created_at DESC LIMIT 60");
        }
        json_out(['ok' => true, 'photos' => $s->fetchAll()]);
    } catch (\Throwable $e) {
        // Table not migrated yet — behave as "no photos" so the page still works.
        json_out(['ok' => true, 'photos' => []]);
    }
}

$action = $_POST['action'] ?? '';
if ($action === '') { $in = body(); $action = $in['action'] ?? ''; } else { $in = $_POST; }

// ---- Guest: submit a photo (multipart/form-data) ------------------------
if ($action === 'submit') {
    require_guest();
    require_once __DIR__ . '/image-save.php';
    $guestId = (int)$_SESSION['guest_id'];

    $prop = clean($_POST['prop_key'] ?? '');
    if (!get_rate($prop)) json_out(['error' => 'Unknown property'], 400);

    // Only guests who actually have a booking for this cottage can post about it.
    $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?');
    $g->execute([$guestId]);
    $guest = $g->fetch();
    if (!$guest) json_out(['error' => 'Please log in first'], 401);
    $own = db()->prepare("SELECT COUNT(*) FROM bookings WHERE prop_key = ? AND email IS NOT NULL AND LOWER(email) = LOWER(?)");
    $own->execute([$prop, $guest['email']]);
    if ((int)$own->fetchColumn() < 1) json_out(['error' => "You can share photos for a cottage you've booked."], 403);

    // Rate-limit: at most 12 photos per guest.
    try {
        $cnt = db()->prepare('SELECT COUNT(*) FROM guest_photos WHERE guest_id = ?');
        $cnt->execute([$guestId]);
        if ((int)$cnt->fetchColumn() >= 12) json_out(['error' => "Thanks! You've reached the photo limit."], 429);
    } catch (\Throwable $e) {}

    if (empty($_FILES['image'])) json_out(['error' => 'No image received'], 400);
    $res = save_uploaded_image($_FILES['image'], 'guest');
    if (!empty($res['error'])) json_out(['error' => $res['error']], $res['code'] ?? 400);

    $caption = clean($_POST['caption'] ?? '');
    if (mb_strlen($caption) > 280) $caption = mb_substr($caption, 0, 280);

    try {
        db()->prepare('INSERT INTO guest_photos (prop_key, guest_id, guest_name, url, caption, status)
                       VALUES (?,?,?,?,?,\'pending\')')
            ->execute([$prop, $guestId, $guest['name'] ?? '', $res['url'], $caption]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not save your photo — has migrate.php been run?'], 500);
    }
    json_out(['ok' => true]);
}

// ---- Admin: moderation ---------------------------------------------------
require_admin();

if ($action === 'list_admin') {
    try {
        $rows = db()->query("SELECT id, prop_key, guest_name, url, caption, status, created_at
                             FROM guest_photos WHERE status <> 'rejected' ORDER BY (status='pending') DESC, created_at DESC LIMIT 200")->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read photos — run migrate.php (migration-guest-photos.sql).'], 500);
    }
    json_out(['ok' => true, 'photos' => $rows]);
}

if ($action === 'approve' || $action === 'reject') {
    $id = (int)($in['id'] ?? 0);
    $status = $action === 'approve' ? 'approved' : 'rejected';
    db()->prepare('UPDATE guest_photos SET status = ? WHERE id = ?')->execute([$status, $id]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    try {
        $s = db()->prepare('SELECT url FROM guest_photos WHERE id = ?');
        $s->execute([$id]);
        $url = $s->fetchColumn();
        db()->prepare('DELETE FROM guest_photos WHERE id = ?')->execute([$id]);
        // Best-effort: remove the file + its webp companion (only inside uploads/).
        if (is_string($url) && strpos($url, 'uploads/') === 0 && strpos($url, '..') === false) {
            $p = __DIR__ . '/' . $url;
            if (is_file($p)) @unlink($p);
            if (is_file($p . '.webp')) @unlink($p . '.webp');
        }
    } catch (\Throwable $e) {}
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
