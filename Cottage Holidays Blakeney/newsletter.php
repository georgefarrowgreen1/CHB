<?php
// ============================================================
//  newsletter.php — a simple opt-in mailing list the owner controls.
//   POST {action:'subscribe', email, name?}   -> public: join the list
//   POST {action:'unsubscribe', token}        -> public: opt out (one-click)
//   GET                                        -> admin: count + recent subscribers
//   POST {action:'broadcast', subject, body}   -> admin: email all active subscribers
//
//  Sending uses smtp_send(); each message carries a one-click unsubscribe link.
// ============================================================
require_once __DIR__ . '/db.php';

// ---- Admin: list subscribers --------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    try {
        $active = (int) db()
            ->query('SELECT COUNT(*) FROM newsletter_subscribers WHERE unsubscribed_at IS NULL')
            ->fetchColumn();
        $total = (int) db()->query('SELECT COUNT(*) FROM newsletter_subscribers')->fetchColumn();
        $recent = db()
            ->query(
                'SELECT email, name, created_at, unsubscribed_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT 50',
            )
            ->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read subscribers — has migrate.php been run?'], 500);
    }
    json_out(['ok' => true, 'active' => $active, 'total' => $total, 'recent' => $recent]);
}

$in = body();
$action = $in['action'] ?? '';

// ---- Public: subscribe ---------------------------------------------------
if ($action === 'subscribe') {
    rate_limit('newsletter', 12); // curb unauthenticated signup flooding
    $email = strtolower(clean($in['email'] ?? ''));
    $name = clean($in['name'] ?? '');
    if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $email)) {
        json_out(['error' => 'Please enter a valid email address.'], 400);
    }
    $source = clean($in['source'] ?? 'site');
    $token = bin2hex(random_bytes(16));
    try {
        // Re-subscribing an existing (perhaps previously unsubscribed) email just
        // reactivates it; we never expose whether the email was already on the list.
        db()
            ->prepare(
                'INSERT INTO newsletter_subscribers (email, name, token, source)
                       VALUES (?,?,?,?)
                       ON DUPLICATE KEY UPDATE name = VALUES(name), unsubscribed_at = NULL',
            )
            ->execute([$email, $name, $token, $source]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not subscribe right now.'], 500);
    }
    json_out(['ok' => true]);
}

// ---- Public: unsubscribe (one-click) ------------------------------------
if ($action === 'unsubscribe') {
    $token = clean($in['token'] ?? '');
    if ($token === '') {
        json_out(['error' => 'Missing token'], 400);
    }
    try {
        db()
            ->prepare(
                'UPDATE newsletter_subscribers SET unsubscribed_at = NOW() WHERE token = ? AND unsubscribed_at IS NULL',
            )
            ->execute([$token]);
    } catch (\Throwable $e) {
    }
    json_out(['ok' => true]); // always succeed (don't leak whether the token existed)
}

// ---- Admin: broadcast ----------------------------------------------------
require_admin();

if ($action === 'broadcast') {
    require_once __DIR__ . '/mailer.php';
    $subject = clean($in['subject'] ?? '');
    $bodyText = (string) ($in['body'] ?? '');
    if ($subject === '' || trim($bodyText) === '') {
        json_out(['error' => 'A subject and a message are both required.'], 400);
    }

    try {
        $subs = db()
            ->query('SELECT email, name, token FROM newsletter_subscribers WHERE unsubscribed_at IS NULL')
            ->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read subscribers.'], 500);
    }
    if (!$subs) {
        json_out(['ok' => true, 'sent' => 0, 'note' => 'No active subscribers yet.']);
    }

    // Build the unsubscribe link base from this request.
    $scheme = request_is_https() ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    $base = $scheme . '://' . $host . $dir . '/';

    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $bodyHtml = nl2br($esc($bodyText));

    // Build every personalised message first, then send them all over ONE SMTP
    // connection (smtp_send_batch) — this used to open a fresh connect+TLS+AUTH
    // handshake per subscriber. RFC 8058 one-click List-Unsubscribe headers are
    // included so mail clients surface their own "Unsubscribe" affordance.
    $msgs = [];
    foreach ($subs as $s) {
        $name = $s['name'] ?: 'there';
        $unsub = $base . 'index.html?unsub=' . rawurlencode($s['token']);
        $text =
            $bodyText .
            "\n\n—\nYou're receiving this because you signed up at Cottage Holidays Blakeney.\nUnsubscribe: " .
            $unsub;
        $inner = function_exists('email_p')
            ? email_p($bodyHtml)
            : '<p style="font-size:15px;color:#d7dae3;line-height:1.7;margin:0;">' . $bodyHtml . '</p>';
        $html = function_exists('email_shell')
            ? email_shell($subject, $inner, '#D6A785', [
                'unsubscribe' => $unsub,
                'footer' => "You're receiving this because you signed up at Cottage Holidays Blakeney.",
            ])
            : '<!DOCTYPE html><html><body style="margin:0;padding:0;">' .
                $inner .
                '<p style="font-size:11px;color:#999;">Unsubscribe: <a href="' .
                $esc($unsub) .
                '">' .
                $esc($unsub) .
                '</a></p></body></html>';
        $msgs[] = [
            'to' => $s['email'],
            'name' => $name,
            'subject' => $subject,
            'text' => $text,
            'html' => $html,
            'headers' => [
                'List-Unsubscribe' => '<' . $unsub . '>',
                'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
            ],
        ];
    }
    $results = smtp_send_batch($msgs);
    $sent = 0;
    $failed = 0;
    foreach ($results as $res) {
        if (!empty($res['ok'])) {
            $sent++;
        } else {
            $failed++;
        }
    }
    log_activity('settings', 'newsletter.broadcast', 'Newsletter sent — “' . mb_substr($subject, 0, 80) . '” (' . $sent . ' recipients)', ['entity' => 'newsletter']);
    json_out(['ok' => true, 'sent' => $sent, 'failed' => $failed, 'subscribers' => count($subs)]);
}

json_out(['error' => 'Unknown action'], 400);
