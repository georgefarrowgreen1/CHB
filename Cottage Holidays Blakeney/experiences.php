<?php
// ============================================================
//  experiences.php — local "things to do" cards near Blakeney.
//  Admin-curated, plus guest SUGGESTIONS (moderated).
//  GET  /  POST {action:'list'}   -> published experiences (for the guest tab)
//  POST {action:'suggest'}        -> signed-in guest suggests one (-> PENDING)
//  POST {action:'list_admin'}     -> all rows incl. pending (admin)
//  POST {action:'save'}           -> add/update a published card (admin)
//  POST {action:'approve'}        -> publish a suggestion (admin)
//  POST {action:'reject'}         -> reject a suggestion (admin)
//  POST {action:'delete'}         -> remove a card (admin)
//  POST {action:'reorder'}        -> set display order (admin)
// ============================================================
require_once __DIR__ . '/db.php';

function exp_public_row($r) {
    return [
        'id'        => (int)$r['id'],
        'title'     => $r['title'],
        'body'      => $r['body'],
        'image'     => $r['image_url'],
        'linkLabel' => $r['link_label'],
        'linkUrl'   => $r['link_url'],
        'phone'     => $r['phone'],
        'category'  => $r['category'],
    ];
}
function exp_published() {
    try {
        $rows = db()->query(
            "SELECT * FROM experiences WHERE status = 'published'
             ORDER BY sort_order ASC, created_at ASC"
        )->fetchAll();
    } catch (\Throwable $e) { return []; }   // table not migrated yet — empty
    return array_map('exp_public_row', $rows);
}
function exp_norm_url($u) {
    $u = trim((string)$u);
    if ($u !== '' && !preg_match('~^https?://~i', $u)) $u = 'https://' . $u;
    return $u;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_out(['experiences' => exp_published()]);
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'list') {
    json_out(['experiences' => exp_published()]);
}

// ---- Guest: suggest a new experience (goes to PENDING for the owner) ----
if ($action === 'suggest') {
    require_guest();
    $title = trim((string)($in['title'] ?? ''));
    $bodyTxt = trim((string)($in['body'] ?? ''));
    $linkUrl = exp_norm_url($in['link_url'] ?? '');
    $phone = trim((string)($in['phone'] ?? ''));
    $category = clean($in['category'] ?? '');
    if (mb_strlen($title) < 3) json_out(['error' => 'Please add a name for the experience'], 400);
    if (mb_strlen($bodyTxt) < 10) json_out(['error' => 'Please add a short description'], 400);
    if (mb_strlen($title) > 160) json_out(['error' => 'That name is a bit long'], 400);
    if (mb_strlen($bodyTxt) > 1500) json_out(['error' => 'Please keep the description shorter'], 400);

    $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?');
    $g->execute([$_SESSION['guest_id']]);
    $guest = $g->fetch();
    if (!$guest) json_out(['error' => 'Account not found'], 404);

    try {
        db()->prepare(
            "INSERT INTO experiences (title, body, link_url, phone, category, status, source, suggested_by_name, suggested_by_email)
             VALUES (?,?,?,?,?, 'pending', 'guest', ?, ?)"
        )->execute([$title, $bodyTxt, $linkUrl, $phone, $category, $guest['name'], $guest['email']]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Experiences not ready — has migrate.php been run? (migration-experiences.sql)'], 500);
    }

    // Best-effort heads-up to the owner: push to their devices + email.
    try { require_once __DIR__ . '/webpush.php'; alert_owner('New experience suggestion', ($guest['name'] ?: 'A guest') . ': ' . mb_substr($title, 0, 80)); } catch (\Throwable $e) {}
    if (defined('MAIL_ENABLED') && MAIL_ENABLED && defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL !== '') {
        try {
            require_once __DIR__ . '/mailer.php';
            smtp_send(OWNER_NOTIFY_EMAIL, 'Owner', 'New experience suggestion to review',
                "{$guest['name']} suggested an experience:\n\n{$title}\n\n{$bodyTxt}\n\n"
                . ($linkUrl ? "Link: {$linkUrl}\n" : '') . ($phone ? "Phone: {$phone}\n" : '')
                . "\nReview it in Settings -> Experiences.");
        } catch (\Throwable $e) {}
    }
    json_out(['ok' => true, 'status' => 'pending']);
}

// ---- Everything below is owner-only ----
require_admin();

if ($action === 'list_admin') {
    try {
        $rows = db()->query(
            "SELECT * FROM experiences
             ORDER BY (status = 'pending') DESC, sort_order ASC, created_at DESC"
        )->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Experiences not ready — run migrate.php (migration-experiences.sql).'], 500);
    }
    json_out(['experiences' => $rows]);
}

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $title = trim((string)($in['title'] ?? ''));
    $bodyTxt = trim((string)($in['body'] ?? ''));
    $image = trim((string)($in['image_url'] ?? ''));
    $linkLabel = clean($in['link_label'] ?? '');
    $linkUrl = exp_norm_url($in['link_url'] ?? '');
    $phone = trim((string)($in['phone'] ?? ''));
    $category = clean($in['category'] ?? '');
    if (mb_strlen($title) < 1) json_out(['error' => 'A title is required'], 400);
    try {
        if ($id) {
            db()->prepare(
                "UPDATE experiences SET title=?, body=?, image_url=?, link_label=?, link_url=?, phone=?, category=?, status='published' WHERE id=?"
            )->execute([$title, $bodyTxt, $image, $linkLabel, $linkUrl, $phone, $category, $id]);
        } else {
            $max = (int)(db()->query("SELECT COALESCE(MAX(sort_order),0) m FROM experiences")->fetch()['m'] ?? 0);
            db()->prepare(
                "INSERT INTO experiences (title, body, image_url, link_label, link_url, phone, category, status, source, sort_order)
                 VALUES (?,?,?,?,?,?,?, 'published','admin', ?)"
            )->execute([$title, $bodyTxt, $image, $linkLabel, $linkUrl, $phone, $category, $max + 1]);
            $id = (int)db()->lastInsertId();
        }
    } catch (\Throwable $e) {
        json_out(['error' => 'Experiences not ready — run migrate.php (migration-experiences.sql).'], 500);
    }
    json_out(['ok' => true, 'id' => $id]);
}

if ($action === 'approve') {
    $id = (int)($in['id'] ?? 0);
    if (!$id) json_out(['error' => 'Invalid request'], 400);
    $max = (int)(db()->query("SELECT COALESCE(MAX(sort_order),0) m FROM experiences")->fetch()['m'] ?? 0);
    db()->prepare("UPDATE experiences SET status='published', sort_order=? WHERE id=?")->execute([$max + 1, $id]);
    json_out(['ok' => true]);
}

if ($action === 'reject') {
    $id = (int)($in['id'] ?? 0);
    db()->prepare("UPDATE experiences SET status='rejected' WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    db()->prepare('DELETE FROM experiences WHERE id=?')->execute([$id]);
    json_out(['ok' => true]);
}

if ($action === 'reorder') {
    $ids = $in['ids'] ?? [];
    if (is_array($ids)) {
        $stmt = db()->prepare('UPDATE experiences SET sort_order=? WHERE id=?');
        foreach ($ids as $i => $id) { $stmt->execute([$i + 1, (int)$id]); }
    }
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
