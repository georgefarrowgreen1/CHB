<?php
// ============================================================
//  search.php — federated "deep index" search for the ⌘K palette.
//
//  Admin-only. Runs a bounded LIKE query across EVERY content source the
//  owner might look for — bookings (and their invoices), enquiries, guest
//  accounts, chat messages, reviews, sent emails, payments and the activity
//  log — and returns one flat, typed result list. The client maps each type
//  to a destination; we never send code back.
//
//  Every source is wrapped so a missing table/column can never break the whole
//  search (older installs may not have every migration). Each source is capped;
//  the whole response is capped again. Read-only.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

$q = trim((string) ($_GET['q'] ?? (body()['q'] ?? '')));
if (mb_strlen($q) < 2) {
    json_out(['ok' => true, 'results' => []]);
}
// Escape LIKE wildcards so a stray % / _ in the query is treated literally.
$like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
$PER = 6; // per-source cap
$results = [];
$snip = function ($s, $n = 90) {
    $s = trim(preg_replace('/\s+/', ' ', (string) $s));
    return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s;
};
$src = function (callable $fn) {
    try {
        $fn();
    } catch (\Throwable $e) {
        /* a missing table/column must never break the rest of the search */
    }
};

// 1) Bookings — each stay is also its invoice. Name, email, phone, address, notes, ref.
$src(function () use (&$results, $like, $PER, $q) {
    $st = db()->prepare(
        "SELECT id, prop_key, name, email, phone, check_in
         FROM bookings
         WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR address LIKE ? OR postcode LIKE ? OR notes LIKE ?
            OR CONCAT('chb-', LPAD(id, 6, '0')) LIKE ?
         ORDER BY (check_in >= CURDATE()) DESC, check_in ASC
         LIMIT $PER",
    );
    $ref = '%' . strtolower(preg_replace('/[^0-9a-z]/i', '', $q)) . '%';
    $st->execute([$like, $like, $like, $like, $like, $like, $ref]);
    foreach ($st->fetchAll() as $b) {
        $results[] = [
            'type' => 'booking',
            'id' => (int) $b['id'],
            'title' => $b['name'] ?: '(no name)',
            'sub' => 'CHB-' . str_pad((string) $b['id'], 6, '0', STR_PAD_LEFT) . ' · ' . prop_display($b['prop_key'])['name'] . ($b['check_in'] ? ' · ' . uk_date($b['check_in']) : ''),
        ];
    }
});

// 2) Enquiries — name, email, their message.
$src(function () use (&$results, $like, $PER) {
    $st = db()->prepare('SELECT id, prop_key, name, email, message FROM enquiries WHERE name LIKE ? OR email LIKE ? OR message LIKE ? ORDER BY id DESC LIMIT ' . $PER);
    $st->execute([$like, $like, $like]);
    foreach ($st->fetchAll() as $e) {
        $results[] = ['type' => 'enquiry', 'id' => (int) $e['id'], 'title' => $e['name'] ?: '(no name)', 'sub' => 'Enquiry · ' . prop_display($e['prop_key'])['name']];
    }
});

// 3) Guest accounts — name, email, phone.
$src(function () use (&$results, $like, $PER) {
    $st = db()->prepare('SELECT id, name, email, phone FROM guests WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT ' . $PER);
    $st->execute([$like, $like, $like]);
    foreach ($st->fetchAll() as $g) {
        $results[] = ['type' => 'guest', 'id' => (int) $g['id'], 'email' => $g['email'], 'title' => $g['name'] ?: $g['email'], 'sub' => 'Guest account · ' . $g['email']];
    }
});

// 4) Chat messages — the message text; jump to its thread.
$src(function () use (&$results, $like, $PER, $snip) {
    $st = db()->prepare(
        'SELECT m.thread_id, m.body, m.sender_role, COALESCE(t.name, g.name) AS who
         FROM messages m
         LEFT JOIN chat_threads t ON t.id = m.thread_id
         LEFT JOIN guests g ON g.id = m.guest_id
         WHERE m.body LIKE ? AND m.thread_id IS NOT NULL
         ORDER BY m.id DESC LIMIT ' . $PER,
    );
    $st->execute([$like]);
    foreach ($st->fetchAll() as $m) {
        $results[] = [
            'type' => 'message',
            'thread_id' => (int) $m['thread_id'],
            'title' => $snip($m['body']),
            'sub' => 'Chat · ' . ($m['who'] ?: 'Visitor') . ($m['sender_role'] === 'admin' ? ' (you)' : ''),
        ];
    }
});

// 5) Reviews — the review text.
$src(function () use (&$results, $like, $PER, $snip) {
    $st = db()->prepare('SELECT id, prop_key, review_text FROM guest_reviews WHERE review_text LIKE ? ORDER BY id DESC LIMIT ' . $PER);
    $st->execute([$like]);
    foreach ($st->fetchAll() as $r) {
        $results[] = ['type' => 'review', 'id' => (int) $r['id'], 'title' => $snip($r['review_text']), 'sub' => 'Review · ' . prop_display($r['prop_key'])['name']];
    }
});

// 6) Sent emails — subject, recipient, body (the mail_sent trail).
$src(function () use (&$results, $like, $PER) {
    $st = db()->prepare('SELECT id, to_email, subject FROM mail_sent WHERE subject LIKE ? OR to_email LIKE ? OR body LIKE ? ORDER BY id DESC LIMIT ' . $PER);
    $st->execute([$like, $like, $like]);
    foreach ($st->fetchAll() as $m) {
        $results[] = ['type' => 'email', 'id' => (int) $m['id'], 'title' => $m['subject'] ?: '(no subject)', 'sub' => 'Email · to ' . $m['to_email']];
    }
});

// 7) Payments — by amount or Square reference; jump to the booking.
$src(function () use (&$results, $like, $PER) {
    $st = db()->prepare(
        'SELECT p.id, p.booking_id, p.amount, p.kind, b.name
         FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
         WHERE p.square_payment_id LIKE ? OR CAST(p.amount AS CHAR) LIKE ?
         ORDER BY p.id DESC LIMIT ' . $PER,
    );
    $st->execute([$like, $like]);
    foreach ($st->fetchAll() as $p) {
        $results[] = [
            'type' => 'payment',
            'booking_id' => (int) $p['booking_id'],
            'title' => '£' . number_format((float) $p['amount'], 2) . ' ' . $p['kind'],
            'sub' => 'Payment · ' . ($p['name'] ?: 'booking #' . $p['booking_id']),
        ];
    }
});

// 8) Activity log — anything that happened.
$src(function () use (&$results, $like, $PER, $snip) {
    $st = db()->prepare('SELECT id, summary, category, created_at FROM activity_log WHERE summary LIKE ? ORDER BY id DESC LIMIT ' . $PER);
    $st->execute([$like]);
    foreach ($st->fetchAll() as $a) {
        $results[] = ['type' => 'activity', 'id' => (int) $a['id'], 'title' => $snip($a['summary']), 'sub' => 'Activity · ' . uk_date(substr((string) $a['created_at'], 0, 10))];
    }
});

json_out(['ok' => true, 'results' => array_slice($results, 0, 40)]);
