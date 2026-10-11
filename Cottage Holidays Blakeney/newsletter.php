<?php
// ============================================================
//  newsletter.php — a simple opt-in mailing list the owner controls.
//   POST {action:'subscribe', email, name?}   -> public: ask to join (a link is emailed)
//   POST {action:'confirm', token, t, k}       -> public: the emailed link, opened
//   POST {action:'unsubscribe', token}        -> public: opt out (one-click)
//   GET                                        -> admin: counts + recent subscribers
//   POST {action:'broadcast', subject, body}   -> admin: email every confirmed subscriber
//
//  A sign-up joins the list only when the link emailed to the address is opened
//  (newsletter-lib.php, migration-146). Each newsletter carries a one-click
//  unsubscribe link.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/newsletter-lib.php';

// Confirmation emails to one address in a day, whoever asks (counted in the same
// ledger as the rate limits, by a hash of the address).
function newsletter_confirm_allowed(string $email): bool
{
    $key = 'nlmail:' . substr(sha1(strtolower($email)), 0, 40);
    try {
        $s = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND attempted_at > (NOW() - INTERVAL 1 DAY)');
        $s->execute([$key]);
        if ((int) $s->fetchColumn() >= NEWSLETTER_CONFIRM_MAILS_PER_DAY) {
            return false;
        }
        db()->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?,?,0)')->execute([client_ip_key(), $key]);
    } catch (\Throwable $e) {
    }
    return true;
}

// ---- Admin: list subscribers --------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    try {
        // Active = confirmed and not unsubscribed; waiting = signed up, link not yet opened.
        $c = db()
            ->query(
                'SELECT SUM(unsubscribed_at IS NULL AND confirmed_at IS NOT NULL) AS active,
                        SUM(unsubscribed_at IS NULL AND confirmed_at IS NULL) AS waiting,
                        SUM(unsubscribed_at IS NOT NULL) AS unsubscribed, COUNT(*) AS total
                   FROM newsletter_subscribers',
            )
            ->fetch();
        $recent = db()
            ->query(
                'SELECT email, name, created_at, confirmed_at, unsubscribed_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT 50',
            )
            ->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read subscribers — has migrate.php been run?'], 500);
    }
    json_out([
        'ok' => true,
        'active' => (int) ($c['active'] ?? 0),
        'waiting' => (int) ($c['waiting'] ?? 0),
        'unsubscribed' => (int) ($c['unsubscribed'] ?? 0),
        'total' => (int) ($c['total'] ?? 0),
        'recent' => $recent,
    ]);
}

$in = body();
$action = $in['action'] ?? '';

// ---- Public: subscribe ---------------------------------------------------
// NOBODY JOINS UNTIL THE INBOX SAYS SO. This added any address it was given and
// switched an unsubscribed one straight back on. Now it emails a link, and only
// opening it puts the address on the list (or back on it). The answer is the same
// for every address, so the form never says who is on the list.
if ($action === 'subscribe') {
    rate_limit('newsletter', 12); // curb unauthenticated signup flooding
    $email = strtolower(clean($in['email'] ?? ''));
    $name = clean($in['name'] ?? '');
    // The same check every other form uses: the loose pattern let <, > and ; through,
    // and the mail server refuses those at send time.
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
        json_out(['error' => 'Please enter a valid email address.'], 400);
    }
    require_fits($in, ['name' => [160, 'Your name']]);
    $source = mb_substr(clean($in['source'] ?? 'site'), 0, 40);
    try {
        $q = db()->prepare('SELECT id, name, token, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE email = ?');
        $q->execute([$email]);
        $row = $q->fetch() ?: null;
        $plan = newsletter_signup_plan($row);
        if ($plan === 'add') {
            // A racing second sign-up for the same address simply finds the row.
            db()
                ->prepare('INSERT INTO newsletter_subscribers (email, name, token, source) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id = id')
                ->execute([$email, $name, bin2hex(random_bytes(16)), $source]);
            $q->execute([$email]);
            $row = $q->fetch() ?: null;
        }
        if ($plan !== 'none' && $row && newsletter_confirm_allowed($email)) {
            require_once __DIR__ . '/mailer.php';
            $link = newsletter_confirm_link(site_base_url(), (string) $row['token'], time());
            $res = send_newsletter_confirm($email, (string) ($row['name'] ?: $name), $link);
            if (!empty($res['ok'])) {
                db()->prepare('UPDATE newsletter_subscribers SET confirm_sent_at = NOW() WHERE id = ?')->execute([(int) $row['id']]);
            } elseif (($res['error'] ?? '') !== 'Mail disabled') {
                // The same answer still goes back (the form never says who is on the
                // list); the owner hears that the link did not go.
                log_activity('settings', 'newsletter.confirm_fail', 'A newsletter confirmation email could not be sent', ['actor' => 'system', 'severity' => 'warn', 'entity' => 'newsletter', 'meta' => ['detail' => (string) ($res['error'] ?? '')]]);
            }
        }
    } catch (\Throwable $e) {
        if (db_schema_missing($e)) {
            json_out(['error' => 'Sign-ups are being updated. Please try again in a minute.'], 503);
        }
        json_out(['error' => 'Could not sign you up right now.'], 500);
    }
    json_out(['ok' => true]);
}

// ---- Public: the emailed link, opened -------------------------------------
// The page posts it (index.html?nlconfirm=…), so a mail scanner that fetches the
// link confirms nothing. Confirming an unsubscribed address puts it back on.
if ($action === 'confirm') {
    rate_limit('nlconfirm', 30);
    $token = clean($in['token'] ?? '');
    $v = newsletter_confirm_check($token, clean($in['t'] ?? ''), clean($in['k'] ?? ''));
    if ($v === 'expired') {
        json_out(['error' => 'That link has expired. Sign up again and we’ll send you a fresh one.', 'code' => 'expired'], 410);
    }
    if ($v !== 'ok') {
        json_out(['error' => 'That link isn’t right. Sign up again and we’ll send you a fresh one.', 'code' => 'invalid'], 400);
    }
    try {
        $q = db()->prepare('SELECT id FROM newsletter_subscribers WHERE token = ?');
        $q->execute([$token]);
        $id = (int) ($q->fetchColumn() ?: 0);
        if ($id <= 0) {
            json_out(['error' => 'That sign-up is no longer on our list. Sign up again and we’ll send you a fresh link.', 'code' => 'gone'], 404);
        }
        // confirmed_at is set BEFORE unsubscribed_at is cleared: MySQL assigns left to
        // right, so a returning subscriber's consent is dated now, not when they first joined.
        db()
            ->prepare('UPDATE newsletter_subscribers SET confirmed_at = IF(unsubscribed_at IS NOT NULL OR confirmed_at IS NULL, NOW(), confirmed_at), unsubscribed_at = NULL WHERE id = ?')
            ->execute([$id]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not confirm right now. Please try the link again in a minute.'], 500);
    }
    log_activity('settings', 'newsletter.confirm', 'Newsletter sign-up confirmed', ['actor' => 'guest', 'entity' => 'newsletter']);
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
        // Confirmed subscribers only: a sign-up still waiting on its link never agreed.
        $subs = db()
            ->query('SELECT email, name, token FROM newsletter_subscribers WHERE unsubscribed_at IS NULL AND confirmed_at IS NOT NULL')
            ->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read subscribers.'], 500);
    }
    if (!$subs) {
        json_out(['ok' => true, 'sent' => 0, 'note' => 'No active subscribers yet.']);
    }

    // The unsubscribe link base — site_base_url() (trusted-host + proxy-aware),
    // never a hand-rolled copy: a broken unsubscribe link is a compliance
    // problem, not just a dead link.
    $base = site_base_url();

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
        // Composed by newsletter_body() in mailer.php — previewable, gated, and the
        // unsubscribe link stays PER RECIPIENT (their own token).
        $m = newsletter_body($subject, $bodyText, $bodyHtml, $unsub);
        $text = $m['text'];
        $html = $m['html'];
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
    $queued = 0;
    foreach ($results as $i => $res) {
        if (!empty($res['ok'])) {
            $sent++;
            continue;
        }
        $failed++;
        // A failed recipient used to be a NUMBER in the report and nothing
        // else — their copy was gone, and the only remedy re-sent to everyone.
        // The outbox retries just theirs (per-recipient message, their own
        // unsubscribe token intact).
        if (email_queueable($res) && isset($msgs[$i])) {
            if (email_outbox_add('newsletter', $msgs[$i]['to'], $msgs[$i]['name'], $msgs[$i]['subject'], $msgs[$i]['text'], $msgs[$i]['html'], [], null, null, $msgs[$i]['headers'] ?? [], $res['error'] ?? '', 'newsletter:' . $msgs[$i]['to'])) {
                $queued++;
            }
        }
    }
    log_activity('settings', 'newsletter.broadcast', 'Newsletter sent — “' . mb_substr($subject, 0, 80) . '” (' . $sent . ' recipients)', ['entity' => 'newsletter']);
    json_out(['ok' => true, 'sent' => $sent, 'failed' => $failed, 'queued' => $queued, 'subscribers' => count($subs)]);
}

json_out(['error' => 'Unknown action'], 400);
