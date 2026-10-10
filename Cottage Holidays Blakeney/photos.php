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
if ($action === '') {
    $in = body();
    $action = $in['action'] ?? '';
} else {
    $in = $_POST;
}

// ---- Guest: submit a photo (multipart/form-data) ------------------------
if ($action === 'submit') {
    require_guest_proven(); // ownership is matched by email — confirmed accounts only
    require_once __DIR__ . '/image-save.php';
    // get_rate() lives in pricing.php: without it EVERY guest upload died on the
    // call below, and the guest read "Something went wrong on our side".
    require_once __DIR__ . '/pricing.php';
    $guestId = (int) $_SESSION['guest_id'];

    $prop = clean($_POST['prop_key'] ?? '');
    if (!get_rate($prop)) {
        json_out(['error' => 'Unknown property'], 400);
    }

    // Only guests who actually have a booking for this cottage can post about it.
    $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?');
    $g->execute([$guestId]);
    $guest = $g->fetch();
    if (!$guest) {
        json_out(['error' => 'Please log in first'], 401);
    }
    // The stay must have at least STARTED — a future-only (or later-moved)
    // booking shouldn't unlock the public photo wall yet. In-stay sharing is
    // deliberately allowed (reviews, by contrast, need a COMPLETED stay).
    $own = db()->prepare(
        'SELECT COUNT(*) FROM bookings WHERE prop_key = ? AND email IS NOT NULL AND email = ? AND check_in <= CURDATE()',
    );
    $own->execute([$prop, $guest['email']]);
    if ((int) $own->fetchColumn() < 1) {
        json_out(['error' => 'You can share photos once your stay has begun.'], 403);
    }

    // Rate-limit: at most 12 photos per guest.
    try {
        $cnt = db()->prepare('SELECT COUNT(*) FROM guest_photos WHERE guest_id = ?');
        $cnt->execute([$guestId]);
        if ((int) $cnt->fetchColumn() >= 12) {
            json_out(['error' => "Thanks! You've reached the photo limit."], 429);
        }
    } catch (\Throwable $e) {
    }

    if (empty($_FILES['image'])) {
        json_out(['error' => 'No image received'], 400);
    }
    $res = save_uploaded_image($_FILES['image'], 'guest', null, true);
    if (!empty($res['error'])) {
        json_out(['error' => $res['error']], $res['code'] ?? 400);
    }

    $caption = clean($_POST['caption'] ?? '');
    if (mb_strlen($caption) > 280) {
        $caption = mb_substr($caption, 0, 280);
    }

    try {
        db()
            ->prepare(
                'INSERT INTO guest_photos (prop_key, guest_id, guest_name, url, caption, status)
                       VALUES (?,?,?,?,?,\'pending\')',
            )
            ->execute([$prop, $guestId, $guest['name'] ?? '', $res['url'], $caption]);
    } catch (\Throwable $e) {
        guest_save_failed('photo', $e);
    }
    json_out(['ok' => true]);
}

// ---- Admin: moderation ---------------------------------------------------
require_admin();

if ($action === 'list_admin') {
    // The badge's count, without the rows (reviews.php's rule).
    if (($in['count'] ?? '') === 'pending') {
        try {
            json_out(['pending' => (int) db()->query("SELECT COUNT(*) FROM guest_photos WHERE status = 'pending'")->fetchColumn()]);
        } catch (\Throwable $e) {
            json_out(['error' => 'Could not count the photos waiting.'], 500);
        }
    }
    try {
        $rows = db()
            ->query(
                "SELECT id, prop_key, guest_name, url, caption, status, created_at
                             FROM guest_photos WHERE status <> 'rejected' ORDER BY (status='pending') DESC, created_at DESC LIMIT 200",
            )
            ->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read photos — run migrate.php (migration-guest-photos.sql).'], 500);
    }
    json_out(['ok' => true, 'photos' => $rows]);
}

if ($action === 'approve' || $action === 'reject') {
    $id = (int) ($in['id'] ?? 0);
    $status = $action === 'approve' ? 'approved' : 'rejected';
    $uq = db()->prepare('SELECT url FROM guest_photos WHERE id = ?');
    $uq->execute([$id]);
    $url = (string) ($uq->fetchColumn() ?: '');
    // A photo turned down is never shown, so its file goes now: rejected rows are
    // hidden from the list, and the owner had no other way to remove it. Approving
    // one whose file has gone would put a broken image on the wall.
    if ($action === 'approve' && ($url === '' || !is_file(__DIR__ . '/' . $url))) {
        json_out(['error' => 'That photo is no longer on the server.'], 409);
    }
    db()
        ->prepare('UPDATE guest_photos SET status = ? WHERE id = ?')
        ->execute([$status, $id]);
    if ($action === 'reject') {
        upload_delete($url);
    }
    log_activity('moderation', 'photo.' . $action, 'Guest photo ' . ($action === 'approve' ? 'approved' : 'rejected'), ['entity' => 'photo', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $id = (int) ($in['id'] ?? 0);
    try {
        $s = db()->prepare('SELECT url FROM guest_photos WHERE id = ?');
        $s->execute([$id]);
        $url = $s->fetchColumn();
        db()
            ->prepare('DELETE FROM guest_photos WHERE id = ?')
            ->execute([$id]);
        // The file, its WebP companion and its resized copies (upload_delete rebuilds
        // the path from a basename, so traversal is impossible by construction).
        upload_delete((string) $url);
    } catch (\Throwable $e) {
    }
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
