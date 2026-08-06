<?php

// Centered crown logo for the top of customer emails. The image is embedded
// as a base64 data URI so it travels inside the email — no external URL to
// break and no dependence on the site domain. Works on a light background.
function email_crown_header($bg)
{
    $src =
        'data:image/png;base64,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';
    return '<tr><td align="center" style="padding:30px 40px 0;background:' .
        $bg .
        ';">' .
        '<img src="' .
        $src .
        '" width="72" height="72" alt="Cottage Holidays Blakeney" ' .
        'style="display:block;width:72px;height:72px;border:0;outline:none;">' .
        '</td></tr>';
}

// ============================================================
//  mailer.php — minimal, dependency-free SMTP sender.
//  Speaks SMTP directly (EHLO / STARTTLS / AUTH LOGIN / DATA) so no
//  external library or Composer is needed on shared hosting.
//  Public entry point: send_booking_emails($booking) — sends a guest
//  confirmation and a separate owner notification. Never throws; returns
//  a small status array so the caller can log but not fail on email errors.
// ============================================================

// ---- Email preview (back office) ----
// Turn on capture, call any send_* function, then take() the messages it built.
// smtp_send short-circuits into the capture buffer instead of connecting, so we
// get the EXACT bytes that would have been sent — no duplicated templates, no
// SMTP, no side effects.
// Run $fn AFTER the HTTP response has been flushed to the client — the same
// pattern chat uses (messages.php chat_notify_owner_deferred): the visitor
// isn't kept waiting on SMTP handshakes, and a slow mail server can't gateway-
// timeout a request whose real work (the DB write) is already committed.
// Without fastcgi_finish_request (CLI/cron) it still runs at shutdown, i.e.
// exactly where the code sat before — never earlier, never skipped.
function mail_after_response($fn)
{
    register_shutdown_function(function () use ($fn) {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
        try {
            $fn();
        } catch (\Throwable $e) {
        }
    });
}

function mail_preview_start()
{
    $GLOBALS['__mail_preview'] = [];
}
function mail_preview_take()
{
    $c = isset($GLOBALS['__mail_preview']) && is_array($GLOBALS['__mail_preview']) ? $GLOBALS['__mail_preview'] : [];
    unset($GLOBALS['__mail_preview']);
    return $c;
}

// ============================================================
//  SMTP transport — split into open / transmit / quit so ONE connection can
//  carry several messages (smtp_send_batch): the owner-copies loop and the
//  newsletter used to pay a full connect + STARTTLS + AUTH handshake PER
//  message. smtp_send() keeps its public contract (one message, then done)
//  and adds a single retry on TRANSIENT failures — but never after the
//  message payload has been transmitted, so a retry can't double-send.
// ============================================================

// Read one (possibly multi-line) SMTP reply. '' on read failure/EOF.
function smtp_read($fp)
{
    $data = '';
    while (($line = fgets($fp, 515)) !== false) {
        $data .= $line;
        // Lines like "250-..." continue; "250 ..." (space) ends the reply.
        if (isset($line[3]) && $line[3] === ' ') {
            break;
        }
    }
    return $data;
}
function smtp_cmd($fp, $command)
{
    fwrite($fp, $command . "\r\n");
}
function smtp_code($reply)
{
    return (int) substr(ltrim($reply), 0, 3);
}
// Transient failures (4xx greylist/rate-limit, connection trouble) are worth
// one retry; permanent rejections (5xx: bad auth, relaying denied) are not.
function smtp_transient($reply)
{
    $c = smtp_code($reply);
    return $c === 0 || ($c >= 400 && $c < 500);
}
function smtp_quit($fp)
{
    @fwrite($fp, "QUIT\r\n");
    @fclose($fp);
}
// One warn entry in the activity log per FINAL failure (a blip that a retry
// recovers is no longer logged — it wasn't a problem the owner needs to see).
function smtp_fail_log($toName, $error)
{
    if (function_exists('log_activity')) {
        log_activity('system', 'email.fail', 'Email failed to send — ' . $toName, [
            'severity' => 'warn',
            'entity' => 'email',
            'meta' => ['detail' => mb_substr((string) $error, 0, 200)],
        ]);
    }
}

// Connect + greeting + EHLO + STARTTLS + AUTH. Returns ['ok'=>true,'fp'=>…]
// or ['ok'=>false,'error'=>…,'retryable'=>bool].
function smtp_open()
{
    $host = SMTP_HOST;
    $port = (int) SMTP_PORT;
    $secure = strtolower(SMTP_SECURE);
    $timeout = 15;

    // For SSL (port 465) we connect with an ssl:// wrapper; for TLS (587) we
    // connect plain then upgrade with STARTTLS.
    $transport = $secure === 'ssl' ? "ssl://{$host}" : $host;

    // Some shared hosts (incl. IONOS) present certs that don't perfectly match the
    // hostname; allow the connection rather than failing silently. Mail is still
    // encrypted — we just don't hard-verify the peer name.
    $ctx = stream_context_create([
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true,
        ],
    ]);

    $errno = 0;
    $errstr = '';
    $fp = @stream_socket_client("{$transport}:{$port}", $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return ['ok' => false, 'error' => "Connect failed: {$errstr} ({$errno})", 'retryable' => true];
    }
    stream_set_timeout($fp, $timeout);

    $fail = function ($msg, $reply = '') use ($fp) {
        smtp_quit($fp);
        $detail = trim(preg_replace('/\s+/', ' ', (string) $reply));
        return [
            'ok' => false,
            'error' => mb_substr($detail !== '' ? $msg . ' — ' . $detail : $msg, 0, 200),
            'retryable' => smtp_transient($reply),
        ];
    };

    $greet = smtp_read($fp);
    if (smtp_code($greet) !== 220) {
        return $fail('No 220 greeting', $greet);
    }

    $ehloHost = $_SERVER['SERVER_NAME'] ?? 'localhost';
    smtp_cmd($fp, "EHLO {$ehloHost}");
    $r = smtp_read($fp);
    if (smtp_code($r) !== 250) {
        return $fail('EHLO rejected', $r);
    }

    // Upgrade to TLS on 587
    if ($secure === 'tls') {
        smtp_cmd($fp, 'STARTTLS');
        $r = smtp_read($fp);
        if (smtp_code($r) !== 220) {
            return $fail('STARTTLS rejected', $r);
        }
        if (
            !@stream_socket_enable_crypto(
                $fp,
                true,
                STREAM_CRYPTO_METHOD_TLS_CLIENT |
                    STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT |
                    STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT,
            )
        ) {
            smtp_quit($fp);
            return ['ok' => false, 'error' => 'TLS negotiation failed', 'retryable' => true];
        }
        smtp_cmd($fp, "EHLO {$ehloHost}");
        $r = smtp_read($fp);
        if (smtp_code($r) !== 250) {
            return $fail('EHLO after TLS rejected', $r);
        }
    }

    // AUTH LOGIN
    smtp_cmd($fp, 'AUTH LOGIN');
    $r = smtp_read($fp);
    if (smtp_code($r) !== 334) {
        return $fail('AUTH not accepted', $r);
    }
    smtp_cmd($fp, base64_encode(SMTP_USER));
    $r = smtp_read($fp);
    if (smtp_code($r) !== 334) {
        return $fail('Username rejected', $r);
    }
    smtp_cmd($fp, base64_encode(SMTP_PASS));
    $r = smtp_read($fp);
    if (smtp_code($r) !== 235) {
        return $fail('Login failed (check user/password)', $r);
    }

    return ['ok' => true, 'fp' => $fp];
}

// Send ONE message on an open, authenticated connection. Returns
// ['ok'=>bool,'error'=>…,'retryable'=>bool,'dirty'=>bool]. dirty=true means
// the connection is no longer trustworthy for another message (payload was
// transmitted but refused, or a read broke mid-exchange) — the caller must
// close it. A clean command rejection (MAIL/RCPT/DATA refused before any
// payload) is RSET so the same connection can carry the next message.
function smtp_transmit(
    $fp,
    $toEmail,
    $toName,
    $subject,
    $bodyText,
    $bodyHtml = null,
    $attachments = [],
    $replyTo = null,
    $messageId = null,
    $extraHeaders = [],
) {
    // Defence-in-depth: strip any CR/LF from the recipient so it can never inject
    // extra SMTP commands (RCPT TO) or email headers. Addresses are also validated
    // with FILTER_VALIDATE_EMAIL on input.
    $toEmail = preg_replace('/[\r\n]+/', '', (string) $toEmail);
    // The staging Test centre marks sample emails so they're unmistakable in the inbox.
    if (!empty($GLOBALS['__chb_test_prefix'])) {
        $subject = $GLOBALS['__chb_test_prefix'] . $subject;
    }

    // A pre-payload rejection: RSET so the connection stays usable for the
    // next message in a batch; if even RSET misbehaves, mark it dirty.
    $reject = function ($msg, $reply) use ($fp) {
        $detail = trim(preg_replace('/\s+/', ' ', (string) $reply));
        smtp_cmd($fp, 'RSET');
        $rst = smtp_read($fp);
        return [
            'ok' => false,
            'error' => mb_substr($detail !== '' ? $msg . ' — ' . $detail : $msg, 0, 200),
            'retryable' => smtp_transient($reply),
            'dirty' => smtp_code($rst) !== 250,
        ];
    };

    // Envelope
    $from = MAIL_FROM;
    smtp_cmd($fp, "MAIL FROM:<{$from}>");
    $mfReply = smtp_read($fp);
    if (smtp_code($mfReply) !== 250) {
        return $reject('MAIL FROM rejected', $mfReply);
    }
    smtp_cmd($fp, "RCPT TO:<{$toEmail}>");
    $rcptReply = smtp_read($fp);
    $rc = smtp_code($rcptReply);
    if ($rc !== 250 && $rc !== 251) {
        return $reject('RCPT TO rejected', $rcptReply);
    }

    // Data
    smtp_cmd($fp, 'DATA');
    $dataReply = smtp_read($fp);
    if (smtp_code($dataReply) !== 354) {
        return $reject('DATA not accepted', $dataReply);
    }

    $fromName = defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : $from;
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $fromDomain = substr(strrchr($from, '@') ?: '@localhost', 1);
    $headers = 'From: ' . mb_encode_safe($fromName) . " <{$from}>\r\n";
    $headers .= 'To: ' . mb_encode_safe($toName) . " <{$toEmail}>\r\n";
    // Reply-To: the caller can override (reply-by-email routes replies to an
    // inbound mailbox); CR/LF stripped so it can't inject headers.
    $rt = $replyTo && filter_var($replyTo, FILTER_VALIDATE_EMAIL) ? preg_replace('/[\r\n]+/', '', $replyTo) : $from;
    $headers .= "Reply-To: {$rt}\r\n";
    $headers .= "Subject: {$encSubject}\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= 'Date: ' . date('r') . "\r\n";
    // Message-ID is required by many MTAs (incl. IONOS) — a message without one
    // can be rejected at the end of DATA ("Message not accepted"). A caller may
    // pass a token so a reply's In-Reply-To echoes it back to us.
    $mid =
        $messageId !== null && $messageId !== ''
            ? preg_replace('/[^A-Za-z0-9._+\-]/', '', (string) $messageId)
            : bin2hex(random_bytes(12));
    $headers .= "Message-ID: <{$mid}@{$fromDomain}>\r\n";
    // Caller-supplied extra headers (e.g. List-Unsubscribe on marketing sends).
    // Names/values sanitised so they can never inject additional headers.
    foreach ((array) $extraHeaders as $hn => $hv) {
        $hn = preg_replace('/[^A-Za-z0-9\-]/', '', (string) $hn);
        $hv = trim(preg_replace('/[\r\n]+/', ' ', (string) $hv));
        if ($hn !== '' && $hv !== '') {
            $headers .= "{$hn}: {$hv}\r\n";
        }
    }

    // Base64-encode bodies in 76-char lines. This guarantees no line ever exceeds
    // the SMTP limit (which caused "501 line too long" with raw 8-bit HTML), and
    // safely carries UTF-8. chunk_split adds CRLF every 76 chars.
    $b64 = function ($s) {
        return rtrim(chunk_split(base64_encode($s), 76, "\r\n"), "\r\n");
    };

    // Build the body (multipart/alternative for text+html). If attachments are
    // present, wrap the whole thing in a multipart/mixed envelope.
    $altBoundary = 'chbalt_' . bin2hex(random_bytes(8));
    if ($bodyHtml !== null && $bodyHtml !== '') {
        $body =
            "--{$altBoundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" .
            $b64($bodyText) .
            "\r\n\r\n";
        $body .=
            "--{$altBoundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" .
            $b64($bodyHtml) .
            "\r\n\r\n";
        $body .= "--{$altBoundary}--";
        $bodyType = "multipart/alternative; boundary=\"{$altBoundary}\"";
    } else {
        $body = $b64($bodyText);
        $bodyType = "text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64";
    }

    if (is_array($attachments) && count($attachments)) {
        $mix = 'chbmix_' . bin2hex(random_bytes(8));
        $headers .= "Content-Type: multipart/mixed; boundary=\"{$mix}\"\r\n";
        $msg = "--{$mix}\r\nContent-Type: {$bodyType}\r\n\r\n{$body}\r\n\r\n";
        foreach ($attachments as $att) {
            $fn = preg_replace('/[^A-Za-z0-9._-]/', '_', (string) ($att['filename'] ?? 'attachment'));
            $mime = $att['mime'] ?? 'application/octet-stream';
            $msg .= "--{$mix}\r\nContent-Type: {$mime}; name=\"{$fn}\"\r\n";
            $msg .= "Content-Transfer-Encoding: base64\r\n";
            $msg .= "Content-Disposition: attachment; filename=\"{$fn}\"\r\n\r\n";
            $msg .= $b64((string) ($att['content'] ?? '')) . "\r\n\r\n";
        }
        $msg .= "--{$mix}--";
        $payload = $headers . "\r\n" . $msg . "\r\n.";
    } else {
        $headers .= "Content-Type: {$bodyType}\r\n";
        $payload = $headers . "\r\n" . $body . "\r\n.";
    }

    smtp_cmd($fp, $payload);
    $finalReply = smtp_read($fp);
    if (smtp_code($finalReply) !== 250) {
        // The payload was transmitted: the server MAY have accepted it despite
        // the error, so this is NEVER retryable (a retry could double-send),
        // and the connection state is unknown — callers must close it.
        return [
            'ok' => false,
            'error' => mb_substr('Message not accepted: ' . trim($finalReply), 0, 200),
            'retryable' => false,
            'dirty' => true,
        ];
    }

    return ['ok' => true, 'error' => '', 'retryable' => false, 'dirty' => false];
}

/**
 * Low-level: send one email via SMTP. Returns [ok=>bool, error=>string].
 * Retries ONCE on a transient failure (connect trouble or a 4xx before the
 * payload went out) — never after the payload was transmitted.
 */
function smtp_send(
    $toEmail,
    $toName,
    $subject,
    $bodyText,
    $bodyHtml = null,
    $attachments = [],
    $replyTo = null,
    $messageId = null,
    $extraHeaders = [],
) {
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        return ['ok' => false, 'error' => 'Mail disabled'];
    }
    // Preview mode: capture the fully-built message instead of sending it, so the
    // back office can show the owner exactly what a templated email looks like
    // (booking confirmation, arrival info, payment request) — no send, no SMTP.
    if (isset($GLOBALS['__mail_preview']) && is_array($GLOBALS['__mail_preview'])) {
        $GLOBALS['__mail_preview'][] = [
            'to' => (string) $toEmail,
            'name' => (string) $toName,
            'subject' => (string) $subject,
            'text' => (string) $bodyText,
            'html' => $bodyHtml !== null ? (string) $bodyHtml : '',
        ];
        return ['ok' => true, 'preview' => true];
    }

    $last = ['ok' => false, 'error' => 'send failed'];
    for ($attempt = 1; $attempt <= 2; $attempt++) {
        $open = smtp_open();
        if (!$open['ok']) {
            $last = $open;
            if ($attempt === 1 && !empty($open['retryable'])) {
                usleep(800000); // brief pause — greylists/blips often clear immediately
                continue;
            }
            break;
        }
        $res = smtp_transmit($fp = $open['fp'], $toEmail, $toName, $subject, $bodyText, $bodyHtml, $attachments, $replyTo, $messageId, $extraHeaders);
        smtp_quit($fp);
        if ($res['ok']) {
            return ['ok' => true, 'error' => ''];
        }
        $last = $res;
        if ($attempt === 1 && !empty($res['retryable'])) {
            usleep(800000);
            continue;
        }
        break;
    }
    smtp_fail_log($toName, $last['error'] ?? 'send failed');
    return ['ok' => false, 'error' => $last['error'] ?? 'send failed'];
}

/**
 * Send SEVERAL messages over ONE connection (owner copies, newsletter, cron
 * batches) instead of a full connect+TLS+AUTH handshake per message. Each
 * message: ['to','name','subject','text','html','attachments','reply_to',
 * 'message_id','headers']. Returns one [ok,error] result per message, in
 * order. If the connection turns dirty mid-batch it reconnects once and
 * carries on; per-message failures don't stop the rest.
 */
function smtp_send_batch($messages)
{
    $results = [];
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        foreach ($messages as $i => $m) {
            $results[$i] = ['ok' => false, 'error' => 'Mail disabled'];
        }
        return $results;
    }
    if (isset($GLOBALS['__mail_preview']) && is_array($GLOBALS['__mail_preview'])) {
        foreach ($messages as $i => $m) {
            $GLOBALS['__mail_preview'][] = [
                'to' => (string) ($m['to'] ?? ''),
                'name' => (string) ($m['name'] ?? ''),
                'subject' => (string) ($m['subject'] ?? ''),
                'text' => (string) ($m['text'] ?? ''),
                'html' => isset($m['html']) && $m['html'] !== null ? (string) $m['html'] : '',
            ];
            $results[$i] = ['ok' => true, 'preview' => true];
        }
        return $results;
    }

    $fp = null;
    $reconnects = 1; // allow one mid-batch reconnect (greylist blip, dropped socket)
    foreach ($messages as $i => $m) {
        if ($fp === null) {
            $open = smtp_open();
            if (!$open['ok'] && $reconnects > 0 && !empty($open['retryable'])) {
                $reconnects--;
                usleep(800000);
                $open = smtp_open();
            }
            if (!$open['ok']) {
                // Connection unavailable — fail this and every remaining message.
                for ($j = $i; $j < count($messages); $j++) {
                    if (!isset($results[$j])) {
                        $results[$j] = ['ok' => false, 'error' => $open['error']];
                        smtp_fail_log($messages[$j]['name'] ?? '', $open['error']);
                    }
                }
                return $results;
            }
            $fp = $open['fp'];
        }
        $res = smtp_transmit(
            $fp,
            $m['to'] ?? '',
            $m['name'] ?? '',
            $m['subject'] ?? '',
            $m['text'] ?? '',
            $m['html'] ?? null,
            $m['attachments'] ?? [],
            $m['reply_to'] ?? null,
            $m['message_id'] ?? null,
            $m['headers'] ?? [],
        );
        $results[$i] = ['ok' => $res['ok'], 'error' => $res['error']];
        if (!$res['ok']) {
            smtp_fail_log($m['name'] ?? '', $res['error']);
        }
        if (!empty($res['dirty'])) {
            smtp_quit($fp);
            $fp = null; // next message reopens (bounded by $reconnects)
        }
    }
    if ($fp !== null) {
        smtp_quit($fp);
    }
    return $results;
}

// Everyone who should receive owner/admin activity notifications: the primary
// OWNER_NOTIFY_EMAIL plus any extra addresses added in Settings → Notifications
// (content 'notify-emails' = JSON array). Deduped case-insensitively, validated,
// primary first. This is the single source of truth for "who gets alerted".
function owner_recipients()
{
    $list = [];
    if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL && filter_var(OWNER_NOTIFY_EMAIL, FILTER_VALIDATE_EMAIL)) {
        $list[] = OWNER_NOTIFY_EMAIL;
    }
    // 'notify-emails' is an ARRAY-valued content key, so it MUST be read with
    // content_json() — content_value() returns '' for a JSON array, which would
    // silently drop every extra recipient (and reject co-host reply-by-email).
    if (function_exists('content_json')) {
        foreach (content_json('notify-emails', []) as $e) {
            $e = trim((string) $e);
            if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) {
                $list[] = $e;
            }
        }
    }
    $seen = [];
    $out = [];
    foreach ($list as $e) {
        $k = strtolower($e);
        if (!isset($seen[$k])) {
            $seen[$k] = true;
            $out[] = $e;
        }
    }
    return $out;
}

// Branded HTML for plain-text owner alerts — the SAME coastal shell guests
// get, built automatically so every send_owner(subject, text) caller (new
// payment, new message, new review, owner booking copies…) matches the guest
// emails. Blank lines split paragraphs; bare URLs become links; all escaped.
function owner_alert_text_html($subject, $text)
{
    // The shell already carries the brand — don't repeat it in the heading.
    $heading = preg_replace('/\s*[—–-]\s*Cottage Holidays Blakeney\s*$/u', '', (string) $subject);
    $inner = email_h($heading);
    foreach (preg_split('/\n{2,}/', trim((string) $text)) as $para) {
        $para = trim($para);
        if ($para === '') {
            continue;
        }
        $safe = nl2br(email_esc($para));
        $safe = preg_replace(
            '~(https?://[^\s<]+)~',
            '<a href="$1" style="color:#B07A3F;text-decoration:underline;">$1</a>',
            $safe,
        );
        $inner .= email_p($safe);
    }
    return email_shell($heading, $inner);
}
// Send ONE owner/admin notification to every recipient (owner_recipients()).
// Returns the primary send's result so existing callers keep their {ok,error}
// contract; copies to the extra addresses are best-effort.
function send_owner($subject, $text, $html = null, $atts = [], $replyTo = null, $messageId = null)
{
    $rcpts = owner_recipients();
    if (!$rcpts) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    // Plain-text callers get the branded shell automatically — one look for
    // every email that leaves this site, owner alerts included.
    if ($html === null || $html === '') {
        $html = owner_alert_text_html($subject, $text);
    }
    // One connection for all owner copies (was one full handshake per address).
    $msgs = [];
    foreach ($rcpts as $to) {
        $msgs[] = [
            'to' => $to,
            'name' => 'Owner',
            'subject' => $subject,
            'text' => $text,
            'html' => $html,
            'attachments' => $atts,
            'reply_to' => $replyTo,
            'message_id' => $messageId,
        ];
    }
    $results = smtp_send_batch($msgs);
    return $results[0] ?? ['ok' => false, 'error' => 'No owner email'];
}

/** Encode a display name safely for a header (handles non-ASCII). */
function mb_encode_safe($name)
{
    if (preg_match('/[^\x20-\x7E]/', $name)) {
        return '=?UTF-8?B?' . base64_encode($name) . '?=';
    }
    return $name;
}

/**
 * Send the guest confirmation + a separate owner notification for a booking.
 * $b is an associative array with keys: name, email, prop_name, check_in,
 * check_out, check_in_time, check_out_time, adults, children, total,
 * damages_deposit, ref. Returns [guest=>result, owner=>result].
 */
// Build an iCalendar (.ics) VEVENT for a booking so the guest can add it to
// their phone calendar. All-day-ish: uses the check-in/out dates with times.
function build_booking_ics($b)
{
    if (empty($b['check_in']) || empty($b['check_out'])) {
        return '';
    }
    $ci = $b['check_in'] . ' ' . ($b['check_in_time'] ?? '15:00');
    $co = $b['check_out'] . ' ' . ($b['check_out_time'] ?? '10:00');
    $fmt = function ($s) {
        $t = strtotime($s);
        return $t ? gmdate('Ymd\THis\Z', $t) : '';
    };
    $dtStart = $fmt($ci);
    $dtEnd = $fmt($co);
    if (!$dtStart || !$dtEnd) {
        return '';
    }
    $uid = 'chb-' . ($b['ref'] ?? bin2hex(random_bytes(6))) . '@cottageholidaysblakeney';
    $esc = function ($s) {
        return preg_replace('/([,;\\\\])/', '\\\\$1', str_replace("\n", '\\n', (string) $s));
    };
    $summary = $esc('Stay at ' . ($b['prop_name'] ?? 'your cottage'));
    $loc = $esc($b['address'] ?? '');
    $desc = $esc(
        'Booking ref ' .
            ($b['ref'] ?? '') .
            '. Check-in from ' .
            ($b['check_in_time'] ?? '15:00') .
            ', check-out by ' .
            ($b['check_out_time'] ?? '10:00') .
            '.',
    );
    $lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Cottage Holidays Blakeney//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:' . $uid,
        'DTSTAMP:' . gmdate('Ymd\THis\Z'),
        'DTSTART:' . $dtStart,
        'DTEND:' . $dtEnd,
        'SUMMARY:' . $summary,
        $loc ? 'LOCATION:' . $loc : '',
        'DESCRIPTION:' . $desc,
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return implode("\r\n", array_filter($lines, fn($l) => $l !== ''));
}

// ============================================================
//  "Midnight Glass" email design kit — a dark, liquid-glass look that mirrors
//  the site. Inboxes can't blur, so the glass feel is evoked with a deep
//  gradient backdrop, a lifted card with a hairline top highlight, a rose-gold
//  accent, and Playfair/Montserrat (Georgia/Arial fallbacks). All inline,
//  table-based and Outlook-safe (bgcolor fallbacks + VML buttons).
// ============================================================
function email_sans()
{
    return "'Montserrat','Helvetica Neue',Arial,sans-serif";
}
function email_serif()
{
    return "'Playfair Display',Georgia,'Times New Roman',serif";
}
function email_esc($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

// ============================================================
//  Email design system — LIGHT & COASTAL, to match the website.
//  Warm sand backdrop, crisp white card, Playfair serif headings, soft
//  rose-gold accents, generous air. Table-based + Outlook-safe (bgcolor
//  fallbacks + VML buttons). Palette:
//    sand backdrop  #ECE5D7   card #FFFFFF   hairline/panel #F3EEE4 / border #E7DFCF
//    ink #262320    body #57524A   muted #8E877A    accent (rose-gold) #C79A64
// ============================================================

// Bulletproof rose-gold button (rounded in Outlook too, via VML). Warm tan fill
// with a deep-brown label — matches the site's buttons and keeps AA contrast.
function email_btn($href, $label, $accent = '#C79A64', $textColor = '#3A2E1E')
{
    $h = email_esc($href);
    $l = email_esc($label);
    $sans = email_sans();
    return '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 6px;"><tr><td align="center" bgcolor="' .
        $accent .
        '" style="border-radius:999px;">' .
        '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="' .
        $h .
        '" style="height:50px;v-text-anchor:middle;width:300px;" arcsize="50%" stroke="f" fillcolor="' .
        $accent .
        '"><w:anchorlock/><center style="color:' .
        $textColor .
        ';font-family:' .
        $sans .
        ';font-size:15px;font-weight:bold;letter-spacing:0.4px;"><![endif]-->' .
        '<a href="' .
        $h .
        '" style="display:inline-block;background:' .
        $accent .
        ';color:' .
        $textColor .
        ';text-decoration:none;font-family:' .
        $sans .
        ';font-size:15px;font-weight:700;letter-spacing:0.4px;line-height:50px;padding:0 40px;border-radius:999px;">' .
        $l .
        '</a>' .
        '<!--[if mso]></center></v:roundrect><![endif]--></td></tr></table>';
}

// Centred amount/stat sub-panel (deposit due, refund, etc.). $amount is pre-formatted.
function email_amount($label, $amount, $sub = '', $valueColor = '#2A2622')
{
    $sans = email_sans();
    $serif = email_serif();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr><td bgcolor="#FAF6EC" style="background:#FAF6EC;border:1px solid #ECE4D3;border-radius:16px;padding:20px;text-align:center;">' .
        '<div style="font-family:' .
        $sans .
        ';font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#A0987F;">' .
        email_esc($label) .
        '</div>' .
        '<div style="font-family:' .
        $serif .
        ';font-size:34px;font-weight:700;color:' .
        $valueColor .
        ';padding:7px 0 2px;">' .
        $amount .
        '</div>' .
        ($sub !== '' ? '<div style="font-family:' . $sans . ';font-size:12px;color:#A0987F;">' . $sub . '</div>' : '') .
        '</td></tr></table>';
}

// Label/value detail rows with hairline dividers. $rows = [[label, valueHtml], ...]
function email_rows($rows)
{
    $sans = email_sans();
    $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">';
    $n = count($rows);
    $i = 0;
    foreach ($rows as $r) {
        $i++;
        $bd = $i < $n ? 'border-bottom:1px solid #EDE6D8;' : '';
        $out .=
            '<tr><td style="padding:12px 0;' .
            $bd .
            'font-family:' .
            $sans .
            ';font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9A927F;vertical-align:top;width:40%;">' .
            $r[0] .
            '</td>' .
            '<td align="right" style="padding:12px 0;' .
            $bd .
            'font-family:' .
            $sans .
            ';font-size:14px;font-weight:600;color:#2E2A25;vertical-align:top;">' .
            $r[1] .
            '</td></tr>';
    }
    return $out . '</table>';
}

// Left-accent callout box.
function email_note($html, $accent = '#C79A64')
{
    $sans = email_sans();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>' .
        '<td bgcolor="#FAF6EC" style="background:#FAF6EC;border:1px solid #ECE4D3;border-left:3px solid ' .
        $accent .
        ';border-radius:10px;padding:15px 18px;font-family:' .
        $sans .
        ';font-size:13px;color:#5A554C;line-height:1.75;">' .
        $html .
        '</td></tr></table>';
}

// Serif heading inside the card (optional cottage-accent square).
function email_h($text, $accent = '')
{
    $serif = email_serif();
    $bar =
        $accent !== ''
            ? '<span style="display:inline-block;width:13px;height:13px;border-radius:4px;background:' .
                $accent .
                ';vertical-align:middle;margin-right:11px;"></span>'
            : '';
    return '<h1 style="font-family:' .
        $serif .
        ';font-size:26px;font-weight:700;color:#262320;margin:0 0 6px;line-height:1.3;">' .
        $bar .
        email_esc($text) .
        '</h1>';
}

// Body paragraph (muted=secondary text). Pass pre-escaped HTML.
function email_p($html, $muted = false)
{
    return '<p style="font-family:' .
        email_sans() .
        ';font-size:15px;color:' .
        ($muted ? '#8E877A' : '#57524A') .
        ';line-height:1.75;margin:13px 0 0;">' .
        $html .
        '</p>';
}

// The full document shell. $inner = card body HTML. $accentBar = top hairline colour.
// $opts: ['unsubscribe' => url, 'footer' => html]
function email_shell($preheader, $inner, $accentBar = '#C79A64', $opts = [])
{
    $sans = email_sans();
    $serif = email_serif();
    $unsub = $opts['unsubscribe'] ?? '';
    $footerExtra = $opts['footer'] ?? '';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' .
        '<style>@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Montserrat:wght@400;500;600;700&display=swap");' .
        'body{margin:0;padding:0;background:#ECE5D7;}' .
        '@media (max-width:600px){.ec-wrap{width:100%!important;}.ec-pad{padding-left:24px!important;padding-right:24px!important;}}' .
        '</style></head>' .
        '<body style="margin:0;padding:0;background:#ECE5D7;">' .
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">' .
        email_esc($preheader) .
        '</div>' .
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ECE5D7" style="background:#ECE5D7;background-image:linear-gradient(170deg,#F2ECE0 0%,#E7DFD0 60%);"><tr><td align="center" style="padding:34px 12px 40px;">' .
        '<table role="presentation" width="600" class="ec-wrap" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' .
        email_crown_header('') .
        '<tr><td align="center" style="padding:12px 20px 24px;"><div style="font-family:' .
        $serif .
        ';font-size:22px;color:#2A2622;letter-spacing:0.4px;">Cottage Holidays Blakeney</div>' .
        '<div style="font-family:' .
        $sans .
        ';font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#A79E8A;padding-top:5px;">North Norfolk Coast</div></td></tr>' .
        '<tr><td class="ec-pad" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E7DFCF;border-top:3px solid ' .
        $accentBar .
        ';border-radius:22px;padding:34px 36px;">' .
        $inner .
        '</td></tr>' .
        '<tr><td align="center" style="padding:24px 24px 8px;font-family:' .
        $sans .
        ';font-size:11px;color:#A79E8A;line-height:1.8;">' .
        'Self-catering holiday cottages in Blakeney, North Norfolk &middot; NR25<br>' .
        ($footerExtra !== '' ? $footerExtra . '<br>' : '') .
        ($unsub !== ''
            ? '<a href="' . email_esc($unsub) . '" style="color:#A79E8A;text-decoration:underline;">Unsubscribe</a>'
            : '') .
        '</td></tr>' .
        '</table></td></tr></table></body></html>';
}

// Let the owner know money has landed. $b: name, prop_name, kind, amount, status.
// Pure — split out of send_owner_payment_notice so a gate can drive the REAL
// composer rather than reading its source (which proves the words exist, not
// that they are ever reached).
function owner_payment_notice_body($b)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $what = ($b['kind'] ?? '') === 'balance' ? 'balance' : 'deposit';
    // A SLICE IS NOT ITS STAGE — the same fact the guest's receipt carries. The
    // owner reading "Type: balance" beside £120 of a £290 balance would take the
    // booking as settled and stop chasing it.
    $typeLine = !empty($b['partial']) ? 'part payment towards the ' . $what : $what;
    $statusTxt = ($b['status'] ?? '') === 'paid' ? ' — now paid in full' : '';
    $prop = $b['prop_name'] ?? ($b['prop_key'] ?? 'a cottage');
    return [
        'subject' => 'Payment received: ' . $money($b['amount']) . " — {$prop}",
        'text' =>
            "Good news — a payment has come in.\n\n" .
            'Guest: ' .
            ($b['name'] ?? '—') .
            "\n" .
            "Property: {$prop}\n" .
            "Type: {$typeLine}\n" .
            'Amount: ' .
            $money($b['amount']) .
            $statusTxt .
            "\n\n" .
            "See Money & income for the full picture.\nCottage Holidays Blakeney",
    ];
}
function send_owner_payment_notice($b)
{
    // Guard on what send_owner() can actually deliver to: the co-host list
    // ('notify-emails') counts too — an owner relying on it with a cleared
    // OWNER_NOTIFY_EMAIL silently got NO payment notices from this path.
    if (!owner_recipients()) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $m = owner_payment_notice_body($b);
    return send_owner($m['subject'], $m['text']);
}

// Ask a past guest to leave a review. $b: name, email, prop_key, prop_name, reviewUrl.
function send_review_request_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'there');
    $prop = $b['prop_name'] ?: 'your cottage';
    $url = $b['reviewUrl'] ?? '';
    // Google review funnel: if the owner has set a Google review link, make it the
    // primary call to action (best for search ranking + social proof); the on-site
    // review form stays as a secondary option.
    $googleUrl = $b['googleUrl'] ?? '';

    $subject = "How was {$prop}? Leave a review";
    $text =
        "Hi {$name},\n\n" .
        "Thank you for staying at {$prop}. We'd love to hear how it went — a short review " .
        "really helps other guests (and us).\n\n" .
        ($googleUrl ? "Leave us a Google review: {$googleUrl}\n\n" : '') .
        ($url ? "Or review us on our site: {$url}\n\n" : '') .
        "We hope to welcome you back.\nCottage Holidays Blakeney";

    $inner =
        email_h('How was your stay?') .
        email_p(
            'Hi ' .
                $esc($name) .
                ', thank you for staying at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>. We\'d love to hear how it went — a short review really helps other guests (and us).',
        );
    if ($googleUrl) {
        $inner .= email_btn($googleUrl, '★ Review us on Google');
    }
    if ($url) {
        $inner .= $googleUrl
            ? '<p style="text-align:center;font-family:' .
                email_sans() .
                ';font-size:13px;margin:12px 0 0;"><a href="' .
                $esc($url) .
                '" style="color:#D6A785;text-decoration:none;">…or leave one on our site &rsaquo;</a></p>'
            : email_btn($url, 'Leave a review');
    }
    $inner .= email_p('We hope to welcome you back.<br>Cottage Holidays Blakeney', true);
    $html = email_shell("We'd love your feedback on " . $prop, $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Anniversary re-invite: ~11 months after a stay, invite the guest back for the
// same season next year (sent once per booking by anniversary-nudge.php).
function send_anniversary_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = ($b['name'] ?? '') !== '' ? preg_split('/\s+/', trim($b['name']))[0] : 'there';
    $prop = $b['prop_name'] ?: 'the cottage';
    $month = date('F', strtotime($b['check_in'] ?? 'now'));
    $url = function_exists('site_base_url') ? site_base_url() : '';

    // Real one-click unsubscribe (this is a marketing-ish email): a signed
    // email-optout.php link in the footer + RFC 8058 headers so mail clients
    // show their own Unsubscribe control. anniversary-nudge.php skips anyone
    // on the suppression list before ever calling this.
    $unsub = $url && function_exists('email_optout_token')
        ? $url . 'email-optout.php?e=' . rawurlencode($b['email']) . '&t=' . email_optout_token($b['email'])
        : '';

    $subject = "{$month} at {$prop} — fancy a return visit?";
    $text =
        "Hi {$name},\n\n" .
        "Around this time last year you were getting ready for your stay at {$prop} — " .
        "we hope Blakeney has stayed with you the way it tends to.\n\n" .
        "The same {$month} weeks are starting to book up again, so if you fancy a return " .
        "we wanted you to have first pick of the dates.\n\n" .
        ($url ? "Check availability: {$url}\n\n" : '') .
        "Hope to welcome you back,\nCottage Holidays Blakeney\n\n" .
        ($unsub
            ? "Prefer not to get the occasional note like this? Unsubscribe in one tap: {$unsub}"
            : 'P.S. Prefer not to get the occasional note like this? Just reply and say so.');

    $inner =
        email_h('Fancy a return visit?') .
        email_p(
            'Hi ' .
                $esc($name) .
                ', around this time last year you were getting ready for your stay at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong> — we hope Blakeney has stayed with you the way it tends to.',
        ) .
        email_p(
            'The same <strong style="color:#2A2622;">' .
                $esc($month) .
                '</strong> weeks are starting to book up again, so we wanted you to have first pick of the dates.',
        );
    if ($url) {
        $inner .= email_btn($url, 'Check availability');
    }
    $inner .= email_p('Hope to welcome you back,<br>Cottage Holidays Blakeney', true);
    $inner .= $unsub
        ? email_p('Prefer not to get the occasional note like this? <a href="' . email_esc($unsub) . '" style="color:#A79E8A;text-decoration:underline;">Unsubscribe in one tap</a>.', true)
        : email_p('Prefer not to get the occasional note like this? Just reply and say so.', true);
    $html = email_shell($month . ' at ' . $prop, $inner, $accent);

    $headers = $unsub
        ? ['List-Unsubscribe' => '<' . $unsub . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']
        : [];
    return smtp_send($b['email'], $b['name'] ?? '', $subject, $text, $html, [], null, null, $headers);
}

// Book-direct re-invite for an EXTERNAL guest who left a review via a /review
// link (~a year on). The whole point is to convert an Airbnb/Vrbo guest into a
// direct booking: best price, no platform fees. $lead: name, email, prop_key.
// Sent once per lead by direct-followup.php; low privately-rated guests are
// filtered out before we ever get here.
function send_direct_followup_email($lead)
{
    if (empty($lead['email'])) {
        return ['ok' => false, 'error' => 'No email on file'];
    }
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = ($lead['name'] ?? '') !== '' ? preg_split('/\s+/', trim($lead['name']))[0] : 'there';
    $prop = prop_display($lead['prop_key'] ?? '')['name'] ?: 'our cottage';
    $url = function_exists('site_base_url') ? site_base_url() : '';
    $sans = email_sans();
    $serif = email_serif();

    // The cottage's own first gallery photo, as an absolute URL, becomes the
    // hero — this is what turns a note into an invitation back to the place.
    $img = '';
    $abs = function ($p) use ($url) {
        $p = trim((string) $p);
        if ($p === '') {
            return '';
        }
        if (preg_match('#^https?://#i', $p)) {
            return $p;
        }
        return $url !== '' ? rtrim($url, '/') . '/' . ltrim($p, '/') : '';
    };
    if (function_exists('content_json')) {
        $imgs = content_json('images-' . ($lead['prop_key'] ?? ''), []);
        if (is_array($imgs) && !empty($imgs[0]) && is_string($imgs[0])) {
            $img = $abs($imgs[0]);
        }
    }
    if ($img === '' && function_exists('content_value')) {
        $hb = content_value('hero-bg');
        if ($hb) {
            $img = $abs($hb);
        }
    }

    // Real one-click unsubscribe (this is a marketing email) + RFC 8058 headers.
    $unsub = $url && function_exists('email_optout_token')
        ? $url . 'email-optout.php?e=' . rawurlencode($lead['email']) . '&t=' . email_optout_token($lead['email'])
        : '';

    $subject = "The coast is calling — come back to {$prop}, direct";
    $text =
        "Hi {$name},\n\n" .
        "Thank you again for your lovely review of {$prop} — it genuinely made our week.\n\n" .
        "If North Norfolk is on your mind again — the big skies over the marshes, the walk down to the " .
        "quay, the hush once the day-trippers have gone — we'd love to have you back.\n\n" .
        "And here's the best part: book DIRECT with us and you skip the booking-site fees entirely. Best " .
        "price, no middle-man — just you and the people who look after the cottage.\n\n" .
        ($url ? "See dates & book direct: {$url}\n\n" : '') .
        "We'd love to welcome you back,\nCottage Holidays Blakeney\n\n" .
        ($unsub ? "Prefer not to get the occasional note like this? Unsubscribe in one tap: {$unsub}" : '');

    // Framed hero photo (rounded; degrades to a plain image in Outlook).
    $hero = $img !== ''
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 6px;">' .
            '<img src="' . email_esc($img) . '" alt="' . $esc($prop) . '" width="528" ' .
            'style="display:block;width:100%;max-width:528px;height:auto;border-radius:16px;border:0;outline:none;">' .
            '</td></tr></table>'
        : '';
    $tag =
        '<p style="font-family:' . $sans . ';text-align:center;font-size:11px;font-weight:700;letter-spacing:2.6px;' .
        'text-transform:uppercase;color:#C79A64;margin:16px 0 0;">Book direct &middot; Best price</p>';
    $head =
        '<h1 style="font-family:' . $serif . ';text-align:center;font-size:30px;font-weight:700;color:#262320;' .
        'margin:6px 0 2px;line-height:1.25;">The coast is calling you back</h1>';
    $highlights =
        '<p style="font-family:' . $sans . ';text-align:center;font-size:12px;letter-spacing:1px;color:#8E877A;' .
        'margin:22px 0 2px;">Blakeney Quay &nbsp;&middot;&nbsp; The Coastal Path &nbsp;&middot;&nbsp; Seal trips to the Point</p>';

    $inner =
        $hero .
        $tag .
        $head .
        email_p(
            'Hi ' .
                $esc($name) .
                ', thank you again for your lovely review of <strong style="color:#262320;">' .
                $esc($prop) .
                '</strong> — it genuinely made our week.',
        ) .
        email_p(
            'If North Norfolk is on your mind again — the big skies over the marshes, the walk down to the quay, the hush once the day-trippers have gone — we\'d love to have you back.',
        ) .
        email_p(
            'And here\'s the best part: book <strong style="color:#262320;">direct</strong> with us and you skip the booking-site fees entirely. <strong style="color:#262320;">Best price</strong>, no middle-man — just you and the people who look after the cottage.',
        ) .
        $highlights;
    if ($url) {
        $inner .= email_btn($url, 'See dates & book direct');
    }
    $inner .= email_p('We\'d love to welcome you back,<br>Cottage Holidays Blakeney', true);
    $inner .= $unsub
        ? email_p('Prefer not to get the occasional note like this? <a href="' . email_esc($unsub) . '" style="color:#A79E8A;text-decoration:underline;">Unsubscribe in one tap</a>.', true)
        : email_p('Prefer not to get the occasional note like this? Just reply and say so.', true);
    // Brand rose-gold accent bar (not a per-cottage colour) — one coherent look.
    $html = email_shell('Come back to ' . $prop . ' — book direct and skip the fees', $inner, '#C79A64');

    $headers = $unsub
        ? ['List-Unsubscribe' => '<' . $unsub . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']
        : [];
    return smtp_send($lead['email'], $lead['name'] ?? '', $subject, $text, $html, [], null, null, $headers);
}

// Acknowledge a guest's enquiry by email. $accountExists tailors the closing line:
// returning guests are pointed to sign in; new guests are invited to create an account.
function send_enquiry_ack($enq, $accountExists = false)
{
    $email = trim((string) ($enq['email'] ?? ''));
    if ($email === '') {
        return ['ok' => false, 'error' => 'no email'];
    }
    $name = first_name($enq['name'] ?? '', 'there');
    $first = explode(' ', $name)[0] ?: 'there';
    $prop = function_exists('prop_display') ? prop_display($enq['prop_key'] ?? '')['name'] ?? '' : '';
    $pretty = fn($d) => $d ? uk_date($d) : '';
    $dates = trim($pretty($enq['check_in'] ?? '') . ' to ' . $pretty($enq['check_out'] ?? ''), ' to');
    $url = function_exists('site_base_url') ? site_base_url() : '/';
    $acctLine = $accountExists
        ? 'You already have an account with us — sign in to track this enquiry and manage your bookings.'
        : 'Tip: create an account next time you visit (just set a password) to track this enquiry, message us and book faster.';

    $subject = "We've received your enquiry — Cottage Holidays Blakeney";
    $text =
        "Hi {$first},\n\n" .
        'Thanks for your enquiry' .
        ($prop ? " about {$prop}" : '') .
        ($dates ? " for {$dates}" : '') .
        ".\n" .
        "We'll check availability and email you back to confirm your dates and price.\n\n" .
        $acctLine .
        "\n" .
        $url .
        "\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h('Enquiry received') .
        email_p(
            'Hi ' .
                email_esc($first) .
                ', thanks for your enquiry' .
                ($prop ? ' about <strong style="color:#2A2622;">' . email_esc($prop) . '</strong>' : '') .
                ($dates ? ' for <strong style="color:#2A2622;">' . email_esc($dates) . '</strong>' : '') .
                '.',
        ) .
        email_p("We'll check availability and email you back to confirm your dates and price.", true) .
        email_note(email_esc($acctLine)) .
        email_btn($url, $accountExists ? 'Sign in' : 'Visit the site');
    $html = email_shell("We've received your enquiry", $inner);
    return smtp_send($email, $name, $subject, $text, $html);
}

// Owner's direct reply to an enquirer, sent from the back office Inbox. The
// owner writes the message; the guest's enquiry details ride along underneath
// (cottage, dates, times, party, estimated price) in the house email style.
// Replies come back to the site address (smtp_send's default Reply-To).
// Build the branded reply email (subject + text + HTML) WITHOUT sending it, so the
// same output can be shown as a live preview in the composer and then sent. Single
// source of truth for both the preview endpoint and send_enquiry_reply_email().
function build_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry')
{
    $noun = $ctx === 'booking' ? 'booking' : 'enquiry';
    $prop = function_exists('prop_display')
        ? prop_display($e['prop_key'] ?? '')['name'] ?? ($e['prop_key'] ?? '')
        : $e['prop_key'] ?? '';
    $accent = function_exists('prop_display') ? prop_display($e['prop_key'] ?? '')['accent'] ?? '#C79A64' : '#C79A64';
    $name = first_name($e['name'], 'Guest');
    $party =
        (int) ($e['adults'] ?? 0) .
        ' adult' .
        ((int) ($e['adults'] ?? 0) === 1 ? '' : 's') .
        ((int) ($e['children'] ?? 0)
            ? ' + ' . (int) $e['children'] . ' child' . ((int) $e['children'] === 1 ? '' : 'ren')
            : '');
    $p = is_array($e['price'] ?? null) ? $e['price'] : null;
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $priceLine = $p
        ? $money($p['total']) .
            ' (' . (int) $p['nights'] . ' night' . ((int) $p['nights'] === 1 ? '' : 's') .
            ' × ' . $money($p['perNight'] ?? 0) . ')' .
            (!empty($p['damagesDeposit']) ? ' + ' . $money($p['damagesDeposit']) . ' refundable deposit (charged with your first payment, refunded after your stay)' : '')
        : '';
    $times = 'Arrive ' . (($e['check_in_time'] ?? '') ?: '15:00') . ' · leave ' . (($e['check_out_time'] ?? '') ?: '10:00');

    $subject = trim((string) $subject) ?: 'Your ' . $noun . ' — ' . $prop;

    $text =
        "Hello {$name},\n\n" .
        trim((string) $message) .
        "\n\n---\nYour {$noun} details\n" .
        "Cottage: {$prop}\n" .
        'Dates: ' . uk_date($e['check_in'] ?? '') . ' to ' . uk_date($e['check_out'] ?? '') . "\n" .
        $times . "\n" .
        "Party: {$party}\n" .
        ($priceLine !== '' ? ($noun === 'booking' ? 'Price: ' : 'Estimated price: ') . $priceLine . "\n" : '') .
        "\nJust reply to this email to reach us.\nCottage Holidays Blakeney";

    // Owner-typed message: escape, then preserve their line breaks.
    $msgHtml = nl2br(email_esc(trim((string) $message)));
    $kvRows = '';
    $kv = function ($label, $value) use (&$kvRows) {
        if ($value === '' || $value === null) {
            return;
        }
        $kvRows .=
            '<tr><td style="padding:4px 14px 4px 0;color:#8a8377;font-size:13px;white-space:nowrap;vertical-align:top;">' .
            email_esc($label) .
            '</td><td style="padding:4px 0;color:#2A2622;font-size:14px;">' .
            email_esc($value) .
            '</td></tr>';
    };
    $kv('Cottage', $prop);
    $kv('Dates', uk_date($e['check_in'] ?? '') . ' to ' . uk_date($e['check_out'] ?? ''));
    $kv('Times', $times);
    $kv('Party', $party);
    // A confirmed booking's price is settled — "Price"; an enquiry is still a quote.
    $kv($noun === 'booking' ? 'Price' : 'Est. price', $priceLine);

    $inner =
        email_h('About your ' . $noun, $accent) .
        email_p('Hello ' . email_esc($name) . ',') .
        email_p($msgHtml) .
        email_p('<strong style="color:#2A2622;">Your ' . $noun . ' details</strong>', true) .
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 14px;border-collapse:collapse;">' .
        $kvRows .
        '</table>' .
        email_p('Just reply to this email to reach us.<br>Cottage Holidays Blakeney', true);
    $html = email_shell($subject, $inner, $accent);

    return ['email' => $e['email'] ?? '', 'name' => $name, 'subject' => $subject, 'text' => $text, 'html' => $html];
}
// Send the branded reply email (owner writes the message; the guest's details
// ride along underneath). Builds via build_enquiry_reply_email() so the sent
// email is byte-identical to the composer preview.
function send_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry', $attachments = [])
{
    $noun = $ctx === 'booking' ? 'booking' : 'enquiry';
    if (empty($e['email'])) {
        return ['ok' => false, 'error' => 'No guest email on this ' . $noun];
    }
    $m = build_enquiry_reply_email($e, $subject, $message, $ctx);
    return smtp_send($m['email'], $m['name'], $m['subject'], $m['text'], $m['html'], is_array($attachments) ? $attachments : []);
}

// Validate + normalise attachments from a JSON email_guest payload (admin-only)
// into smtp_send's format: [['filename','mime','content'(RAW bytes)], …]. Caps
// count/size, sanitises filenames, and decodes the base64 content.
function sanitize_email_attachments($raw)
{
    if (!is_array($raw)) {
        return [];
    }
    $allowed = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
        'application/pdf', 'text/plain', 'text/calendar',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    $out = [];
    $total = 0;
    foreach ($raw as $a) {
        if (count($out) >= 4) {
            break;
        }
        $content = base64_decode((string) ($a['content'] ?? ''), true);
        if ($content === false || $content === '') {
            continue;
        }
        $len = strlen($content);
        if ($len > 4 * 1024 * 1024) {
            continue; // 4 MB per file
        }
        $total += $len;
        if ($total > 8 * 1024 * 1024) {
            break; // 8 MB total
        }
        $filename = preg_replace('/[^A-Za-z0-9._ \-]/', '_', (string) ($a['filename'] ?? 'attachment'));
        $filename = mb_substr(trim($filename) !== '' ? trim($filename) : 'attachment', 0, 120);
        $mime = (string) ($a['mime'] ?? '');
        if (!in_array($mime, $allowed, true)) {
            $mime = 'application/octet-stream'; // still attach, but as a generic file
        }
        $out[] = ['filename' => $filename, 'mime' => $mime, 'content' => $content];
    }
    return $out;
}

// New-enquiry alert for the owner, with signed one-tap action links. $e carries
// the enquiry fields + prebuilt approve_url / decline_url (enquiry-action.php).
function send_owner_enquiry_email($e)
{
    // Co-host recipients count too (see send_owner_payment_notice above).
    if (!owner_recipients()) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $prop = function_exists('prop_display')
        ? prop_display($e['prop_key'] ?? '')['name'] ?? ($e['prop_key'] ?? '')
        : $e['prop_key'] ?? '';
    $party =
        (int) ($e['adults'] ?? 0) .
        ' adult' .
        ((int) ($e['adults'] ?? 0) === 1 ? '' : 's') .
        ((int) ($e['children'] ?? 0)
            ? ' + ' . (int) $e['children'] . ' child' . ((int) $e['children'] === 1 ? '' : 'ren')
            : '');
    $subject =
        'New enquiry: ' . ($e['name'] ?: 'Someone') . ' — ' . $prop . ', ' . uk_date($e['check_in']) . ' to ' . uk_date($e['check_out']);

    // Full booking context so the owner can decide (and reply) straight from the
    // inbox without opening the back office: contact, address, times, the price
    // the site quoted, and whether this guest has stayed before.
    $p = is_array($e['price'] ?? null) ? $e['price'] : null;
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $priceLine = $p
        ? $money($p['total']) .
            ' (' . (int) $p['nights'] . ' night' . ((int) $p['nights'] === 1 ? '' : 's') .
            ' × ' . $money($p['perNight'] ?? ($p['nights'] ? $p['nightly'] / max(1, $p['nights']) : 0)) . ')' .
            (!empty($p['damagesDeposit']) ? ' + ' . $money($p['damagesDeposit']) . ' refundable deposit (charged with the first payment, refunded after the stay)' : '')
        : '';
    $times = ($e['check_in_time'] ?? '') !== '' || ($e['check_out_time'] ?? '') !== ''
        ? 'Arrive ' . ($e['check_in_time'] ?: '15:00') . ' · leave ' . ($e['check_out_time'] ?: '10:00')
        : '';
    $addr = trim(implode(', ', array_filter([trim((string) ($e['address'] ?? '')), trim((string) ($e['postcode'] ?? ''))])));
    $prior = (int) ($e['prior_stays'] ?? 0);

    $text =
        "A new enquiry just arrived.\n\n" .
        'Guest: ' . ($e['name'] ?? '—') . ($prior > 0 ? ' — RETURNING GUEST (' . $prior . ' past stay' . ($prior === 1 ? '' : 's') . ')' : '') . "\n" .
        'Email: ' . ($e['email'] ?? '—') . "\n" .
        (!empty($e['phone']) ? 'Phone: ' . $e['phone'] . "\n" : '') .
        ($addr !== '' ? 'Address: ' . $addr . "\n" : '') .
        "Cottage: {$prop}\n" .
        'Dates: ' . uk_date($e['check_in'] ?? '') . ' to ' . uk_date($e['check_out'] ?? '') . "\n" .
        ($times !== '' ? $times . "\n" : '') .
        "Party: {$party}\n" .
        ($priceLine !== '' ? 'Estimated price: ' . $priceLine . "\n" : '') .
        (!empty($e['message']) ? 'Message: ' . $e['message'] . "\n" : '') .
        "\nApprove (creates the booking + confirmation & payment emails):\n" .
        $e['approve_url'] .
        "\n\n" .
        "Decline (deletes the enquiry):\n" .
        $e['decline_url'] .
        "\n\n" .
        'Each link opens a confirmation page first — nothing happens until you press the button there.';

    // Detail rows for the HTML version (label + value per line, muted labels).
    $kvRows = '';
    $kv = function ($label, $value) use (&$kvRows) {
        if ($value === '' || $value === null) {
            return;
        }
        $kvRows .=
            '<tr><td style="padding:4px 14px 4px 0;color:#8a8377;font-size:13px;white-space:nowrap;vertical-align:top;">' .
            email_esc($label) .
            '</td><td style="padding:4px 0;color:#2A2622;font-size:14px;">' .
            $value .
            '</td></tr>';
    };
    $kv('Email', email_esc($e['email'] ?? ''));
    $kv('Phone', email_esc($e['phone'] ?? ''));
    $kv('Address', email_esc($addr));
    $kv('Times', email_esc($times));
    $kv('Party', email_esc($party));
    $kv('Est. price', email_esc($priceLine));

    $inner =
        email_h('New enquiry') .
        email_p(
            '<strong style="color:#2A2622;">' .
                email_esc($e['name'] ?? '') .
                '</strong> would like to stay at <strong style="color:#2A2622;">' .
                email_esc($prop) .
                '</strong>.',
        ) .
        ($prior > 0
            ? email_note('★ Returning guest — ' . $prior . ' completed stay' . ($prior === 1 ? '' : 's') . ' before this.')
            : '') .
        email_p(
            email_esc(uk_date($e['check_in'] ?? '') . ' to ' . uk_date($e['check_out'] ?? '')) . ' &middot; ' . email_esc($party),
            true,
        ) .
        ($kvRows !== ''
            ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;border-collapse:collapse;">' . $kvRows . '</table>'
            : '') .
        (!empty($e['message']) ? email_note(email_esc($e['message'])) : '') .
        email_btn($e['approve_url'], 'Review & approve') .
        email_p(
            '<a href="' . email_esc($e['decline_url']) . '" style="color:#8a8f9c;">Decline this enquiry</a>',
            true,
        ) .
        email_p('Each link opens a confirmation page first — nothing happens until you press the button there.', true);
    $html = email_shell('New enquiry — ' . $prop, $inner);
    return send_owner($subject, $text, $html);
}

// One-line summary of a cottage's cancellation policy (mirrors the JS
// CANCELLATION_POLICIES map + the '<prop>-cancellation-policy' content key) —
// the booking Terms promise this appears in the confirmation email.
function cancellation_policy_line($propKey)
{
    $policies = [
        'flexible' => ['Flexible', 'full refund at least 1 day before check-in; partial refund within 1 day of check-in'],
        'moderate' => ['Moderate', 'full refund at least 5 days before check-in; partial refund within 5 days of check-in'],
        // Kept word-for-word in step with CANCELLATION_POLICIES in app.js — the
        // cottage page, the terms and this email line are the same promise.
        'limited' => ['Limited', 'full refund at least 14 days before check-in; partial refund 7–14 days before check-in; no refund within 7 days of check-in'],
    ];
    $key = function_exists('content_value') ? content_value($propKey . '-cancellation-policy') : '';
    $pol = $policies[$key] ?? $policies['flexible'];
    return 'Cancellation policy — ' . $pol[0] . ': ' . $pol[1] . '. Full details in our booking terms.';
}

function send_booking_emails($b)
{
    $out = [
        'guest' => ['ok' => false, 'error' => 'not attempted'],
        'owner' => ['ok' => false, 'error' => 'not attempted'],
    ];
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        $out['guest']['error'] = $out['owner']['error'] = 'Mail disabled';
        return $out;
    }

    $money = fn($n) => '£' . number_format((float) $n, 2);
    $nightsTxt = $b['nights'] . ' night' . ((int) $b['nights'] === 1 ? '' : 's');
    $party =
        $b['adults'] .
        ' adult' .
        ((int) $b['adults'] === 1 ? '' : 's') .
        ((int) $b['children'] > 0 ? ', ' . $b['children'] . ' child' . ((int) $b['children'] === 1 ? '' : 'ren') : '');

    // Property accent colour (matches the site's calendar/tag colours)
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $paymentLabel = ucfirst($b['payment'] ?? 'unpaid');
    $paymentColor = ($b['payment'] ?? 'unpaid') === 'paid' ? '#2E7D32' : '#C62828';
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

    // ---- Guest confirmation ----
    if (!empty($b['email'])) {
        $subject = "Your booking is confirmed — {$b['prop_name']}";

        // Plain-text fallback (clients that block HTML still get this)
        $body = "Dear " . first_name($b['name'], 'Guest') . ",\n\n";
        $body .= "Good news — your booking at {$b['prop_name']} is confirmed.\n\n";
        $body .= "Booking reference: {$b['ref']}\n";
        $body .= "Check in:  " . uk_date($b['check_in']) . " from {$b['check_in_time']}\n";
        $body .= "Check out: " . uk_date($b['check_out']) . " by {$b['check_out_time']}\n";
        $body .= "Party: {$party}\n";
        $body .= "Payment: {$paymentLabel}\n";
        $body .= "Address: {$b['address']}\n\n";
        // The refundable deposit is charged with the first payment & refunded after
        // the stay, so it's part of the total the guest pays until then.
        $depAmt = round((float) ($b['damages_deposit'] ?? 0), 2);
        $grandTotal = round((float) $b['total'] + $depAmt, 2);
        // A CUSTOM PRICE IS ONE LINE, SAID SO. With a price_override / agreed
        // enquiry price, `total` is the agreed figure while per_night/nightly/
        // tx_fee are still the standard snapshot — printing them alongside it
        // sent "£130.00 × 7 nights: £910.00 … Total £750.00" to a guest, lines
        // that cannot add up to their own total. booking_price_is_custom is the
        // one definition of that test (db.php).
        $customPrice = booking_price_is_custom($b['nightly'], $b['tx_fee'], $b['total']);
        if ($customPrice) {
            $body .= "Agreed price for your stay ({$nightsTxt}): " . $money($b['total']) . "\n";
        } else {
            $body .= $money($b['per_night']) . " x {$nightsTxt}: " . $money($b['nightly']) . "\n";
            $body .= "Transaction fee ({$b['tx_pct']}%): " . $money($b['tx_fee']) . "\n";
        }
        if ($depAmt > 0) {
            $body .= 'Refundable damages deposit: ' . $money($depAmt) . "\n";
        }
        $body .= 'Total: ' . $money($grandTotal) . ($depAmt > 0 ? ' (incl. deposit)' : '') . "\n";
        if ($depAmt > 0) {
            $body .=
                'Includes a refundable security deposit of ' .
                $money($depAmt) .
                ", charged together with your first payment and refunded in full after checkout (provided there's no damage).\n";
        }
        $body .= cancellation_policy_line($b['prop_key'] ?? '') . "\n";
        // Payment state (only once something has been paid) so a re-sent
        // confirmation reflects a recorded deposit/payment.
        $paidNow = round((float) ($b['paid_so_far'] ?? 0), 2);
        $balNow = round((float) ($b['balance_due'] ?? 0), 2);
        // THE SCHEDULE, NOT JUST THE SUM. The guest was told what was outstanding
        // and never by when — so a plan the owner had agreed with them lived only
        // in the back office. The date is the booking's own (custom date, else
        // check-in minus the window), so this can never quote a different day
        // from the chaser that follows it.
        $dueByLine = '';
        if ($balNow > 0.001 && !empty($b['balance_due_date'])) {
            $dueByLine = ' — due by ' . uk_date((string) $b['balance_due_date']);
        }
        if ($paidNow > 0) {
            $body .= "\nPaid so far: " . $money($paidNow) . "\n";
            $body .= ($balNow > 0.001 ? 'Balance remaining: ' . $money($balNow) . $dueByLine : 'Paid in full — thank you!') . "\n";
        } elseif ($balNow > 0.001 && $dueByLine !== '') {
            // Nothing paid yet: still say when the money is wanted, because this
            // is the email that lands before any of it has been asked for.
            $body .= "\nBalance of " . $money($balNow) . $dueByLine . ".\n";
        }
        if (!empty($b['invoice_url'])) {
            $body .= "\nView or download your invoice: " . $b['invoice_url'] . "\n";
        }
        if (!empty($b['guest_reg_url'])) {
            $body .= "\nBefore you arrive, please add your guest details (a UK legal requirement — full name & nationality of everyone 16+): " . $b['guest_reg_url'] . "\n";
        }
        $body .= "\n";
        $body .= "If you have any questions, just reply to this email.\nCottage Holidays Blakeney\n";

        // HTML version — "Midnight Glass" shell + the booking "stay ticket".
        $paymentColor = ($b['payment'] ?? 'unpaid') === 'paid' ? '#7bd687' : '#e0a06a';
        $sans = email_sans();
        $serif = email_serif();
        $statusBadge =
            '<span style="display:inline-block;background:#22321f;color:#7bd687;font-family:' .
            $sans .
            ';font-size:10px;font-weight:700;letter-spacing:1.5px;padding:5px 12px;border-radius:12px;">UPCOMING</span>';
        $pr = fn($l, $v) => '<tr><td style="padding:8px 0;font-family:' .
            $sans .
            ';font-size:14px;color:#57524A;">' .
            $l .
            '</td><td align="right" style="padding:8px 0;font-family:' .
            $sans .
            ';font-size:14px;color:#57524A;">' .
            $v .
            '</td></tr>';
        $priceBox =
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;"><tr><td bgcolor="#FAF6EC" style="background:#FAF6EC;border:1px solid #ECE4D3;border-radius:14px;padding:8px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' .
            // Same branch as the plain-text body above — a custom price is one
            // coherent line, not standard-rate maths beside a total it can't reach.
            ($customPrice
                ? $pr('Agreed price for your stay <span style="color:#A0987F;">(' . $nightsTxt . ')</span>', $money($b['total']))
                : $pr($money($b['per_night']) . ' &times; ' . $nightsTxt, $money($b['nightly'])) .
                  $pr('Transaction fee (' . $esc($b['tx_pct']) . '%)', $money($b['tx_fee']))) .
            ($depAmt > 0 ? $pr('Refundable damages deposit', $money($depAmt)) : '') .
            '<tr><td colspan="2" style="border-top:1px solid #ECE4D3;font-size:0;line-height:0;">&nbsp;</td></tr>' .
            '<tr><td style="padding:12px 0 4px;font-family:' .
            $serif .
            ';font-size:19px;font-weight:700;color:#2A2622;">Total' . ($depAmt > 0 ? ' <span style="font-size:12px;font-weight:400;color:#A0987F;">(incl. deposit)</span>' : '') . '</td><td align="right" style="padding:12px 0 4px;font-family:' .
            $serif .
            ';font-size:21px;font-weight:700;color:#2A2622;">' .
            $money($grandTotal) .
            '</td></tr>' .
            ($depAmt > 0
                ? $pr(
                    '<span style="color:#A0987F;">incl. ' . $money($depAmt) . ' refundable deposit</span>',
                    '<span style="color:#A0987F;">refunded after your stay</span>',
                )
                : '') .
            // Payment state — shown only once a payment is recorded, so a re-sent
            // confirmation reflects the deposit/balance.
            ($paidNow > 0
                ? '<tr><td colspan="2" style="border-top:1px solid #ECE4D3;font-size:0;line-height:0;">&nbsp;</td></tr>' .
                    $pr('Paid so far', '<span style="color:#2E7D32;font-weight:600;">' . $money($paidNow) . '</span>') .
                    ($balNow > 0.001
                        ? $pr('<strong>Balance remaining</strong>', '<strong>' . $money($balNow) . '</strong>')
                        : $pr('<strong style="color:#2E7D32;">Paid in full</strong>', '<strong style="color:#2E7D32;">&#10003;</strong>'))
                : '') .
            '</table></td></tr></table>';
        $inner =
            email_h($b['prop_name'], $accent) .
            '<div style="font-family:' .
            $sans .
            ';font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#A0987F;margin:2px 0 16px;">Booking ref ' .
            $esc($b['ref']) .
            ' &nbsp;&middot;&nbsp; ' .
            $statusBadge .
            '</div>' .
            email_p('Dear ' . $esc(first_name($b['name'], 'Guest')) . ', good news — your stay is confirmed. Here are the details:') .
            email_rows([
                ['Check in', $esc(uk_date($b['check_in'])) . ' &middot; ' . $esc($b['check_in_time'])],
                ['Check out', $esc(uk_date($b['check_out'])) . ' &middot; ' . $esc($b['check_out_time'])],
                ['Party', $esc($party)],
                ['Payment', '<span style="color:' . $paymentColor . ';font-weight:600;">' . $paymentLabel . '</span>'],
                ['Address', $esc($b['address'])],
            ]) .
            $priceBox .
            (!empty($b['invoice_url']) ? email_btn($b['invoice_url'], 'View your invoice', $accent, '#ffffff') : '') .
            (!empty($b['guest_reg_url']) ? email_p('<strong>Before you arrive:</strong> UK law asks us to record the name &amp; nationality of everyone staying who is 16 or over. Please add your guest details — it only takes a minute.', true) . email_btn($b['guest_reg_url'], 'Add your guest details', $accent, '#ffffff') : '') .
            email_p(htmlspecialchars(cancellation_policy_line($b['prop_key'] ?? ''), ENT_QUOTES, 'UTF-8'), true) .
            email_p('Any questions? Just reply to this email — we look forward to welcoming you.', true);
        $html = email_shell('Your booking at ' . $b['prop_name'] . ' is confirmed', $inner, $accent);

        // Attach a calendar invite (.ics) so the guest can add the stay in one tap.
        $ics = build_booking_ics($b);
        $atts = $ics
            ? [['filename' => 'booking-' . ($b['ref'] ?? 'CHB') . '.ics', 'mime' => 'text/calendar', 'content' => $ics]]
            : [];
        $out['guest'] = smtp_send($b['email'], $b['name'], $subject, $body, $html, $atts);
    } else {
        $out['guest']['error'] = 'No guest email on file';
    }

    // ---- Owner notification ----
    // Skipped on a payment re-send (skip_owner) so the owner isn't re-pinged with
    // "new booking" each time a payment is recorded.
    if (empty($b['skip_owner']) && owner_recipients()) {
        $subject = "New confirmed booking — {$b['prop_name']} (" . uk_date($b['check_in']) . ")";
        $body = "A booking has just been confirmed.\n\n";
        $body .= "Reference: {$b['ref']}\n";
        $body .= "Property: {$b['prop_name']}\n";
        $body .= "Guest: {$b['name']}\n";
        $body .= 'Email: ' . ($b['email'] ?: '—') . "\n";
        $body .= 'Phone: ' . ($b['phone'] ?? '—') . "\n";
        $body .= "Check in:  " . uk_date($b['check_in']) . " ({$b['check_in_time']})\n";
        $body .= "Check out: " . uk_date($b['check_out']) . " ({$b['check_out_time']})\n";
        $body .= "Stay: {$nightsTxt}\n";
        $body .= "Guests: {$party}\n";
        $ownerDep = round((float) ($b['damages_deposit'] ?? 0), 2);
        $body .= 'Total: ' . $money(round((float) $b['total'] + $ownerDep, 2)) . ($ownerDep > 0 ? ' (incl. deposit)' : '') . "\n";
        if (!empty($b['defer_owner'])) {
            // The caller only needs the GUEST result (that's what the UI shows);
            // the owner copy can go out after the response has been flushed, so
            // the save isn't kept waiting on a second SMTP handshake.
            mail_after_response(function () use ($subject, $body) {
                send_owner($subject, $body);
            });
            $out['owner'] = ['ok' => true, 'deferred' => true];
        } else {
            $out['owner'] = send_owner($subject, $body);
        }
    }

    return $out;
}

// ------------------------------------------------------------------
//  Pre-arrival "arrival info" email: sent a few days before check-in
//  (via pre-arrival.php cron) or manually from the back office.
//  $b: prop_key, prop_name, guest name/email, check_in, check_out,
//      check_in_time, address, info (owner-written arrival details).
// ------------------------------------------------------------------
function send_arrival_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $inDate = uk_date($b['check_in']);
    $time = $b['check_in_time'] ?: '15:00';
    $addr = trim($b['address'] ?? '');
    // The actual entry/key code is NOT emailed (see send_arrival_for_booking);
    // guests reveal it in-app once they're at the cottage. We just point them there.
    $reveal =
        'When you arrive, log in to your account on our website and open "My Bookings" to reveal your entry details for the cottage.';

    $subject = "Your stay at {$prop} — arrival information";
    $text =
        "Hello {$name},\n\n" .
        "Your stay at {$prop} begins on {$inDate}. Check-in is from {$time}.\n\n" .
        ($addr !== '' ? "Address:\n{$addr}\n\n" : '') .
        $reveal .
        "\n\n" .
        "We look forward to welcoming you.\n\nCottage Holidays Blakeney";

    $addrHtml = $addr !== '' ? nl2br(htmlspecialchars($addr, ENT_QUOTES, 'UTF-8')) : '';
    $inner =
        email_h($prop, $accent) .
        email_p(
            'Hello ' .
                htmlspecialchars($name, ENT_QUOTES, 'UTF-8') .
                ', your stay begins on <strong style="color:#2A2622;">' .
                $inDate .
                '</strong>. Check-in is from <strong style="color:#2A2622;">' .
                htmlspecialchars($time, ENT_QUOTES, 'UTF-8') .
                '</strong>.',
        ) .
        ($addrHtml !== '' ? email_rows([['Address', $addrHtml]]) : '') .
        email_note(
            'When you arrive, log in to your account on our website and open <strong style="color:#2A2622;">My Bookings</strong> to reveal your entry details for the cottage.',
            $accent,
        ) .
        email_p('We look forward to welcoming you.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Arrival information for your stay at ' . $prop, $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Passwordless sign-in link. $g: a guest row (needs name, email). $url: the
// magic link from auth.php (carries id + issue-time + HMAC, expires in 30 min).
function send_magic_link_email($g, $url)
{
    if (empty($g['email'])) {
        return ['ok' => false, 'error' => 'No email'];
    }
    $accent = '#D6A785';
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($g['name'], 'there');

    $subject = 'Your sign-in link — Cottage Holidays Blakeney';
    $text =
        "Hello {$name},\n\n" .
        "Here is your secure sign-in link for Cottage Holidays Blakeney:\n" .
        $url .
        "\n\n" .
        "It expires in 30 minutes. If you didn't request it, you can safely ignore this email.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h('Sign in to your account', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', tap the button below to sign in to your Cottage Holidays Blakeney account — no password needed.',
        ) .
        email_btn($url, 'Sign me in', $accent) .
        email_p('This link expires in 30 minutes. If you didn\'t request it, you can safely ignore this email.', true) .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('Your secure sign-in link', $inner, $accent);

    return smtp_send($g['email'], $name, $subject, $text, $html);
}

// The owner's bank details for guests paying by transfer, as typed in
// Manage → Payments. Empty until they fill it in — payment_cta() handles that
// case rather than printing a blank instruction.
function bacs_details()
{
    return trim((string) content_value('bacs-details'));
}

// THE "HOW TO PAY" HALF OF A MONEY EMAIL, chosen by the guest's rail
// (payment_rail). ONE definition, shared by the request and the reminder, so the
// first chase and every follow-up ask the same guest for money the same way — the
// chbDuties lesson: two composers over the same facts drift, and here the drift
// would be visible to the guest.
//
// $lead is the caller's sentence up to the amount ("Please pay the remaining
// £290.00") so each email keeps its own voice; this appends only the mechanism.
// Returns ['text' => …, 'html' => …]; the html half is pre-escaped.
//
// The BACS branch deliberately drops "Powered by Square" too — it is a line about
// card handling, and leaving it under bank details reads as a contradiction.
function payment_cta($rail, $payUrl, $bacs, $lead)
{
    if ($rail !== 'bacs') {
        return [
            'text' => $lead . " securely by card here:\n" . $payUrl,
            'html' =>
                email_btn($payUrl, 'Pay securely by card') .
                email_p('Powered by Square — we never see or store your card number.', true),
        ];
    }
    $bacs = trim((string) $bacs);
    if ($bacs === '') {
        // No details on file. Say something ACTIONABLE rather than printing an
        // empty bank block or — worse — falling back to a card link the guest has
        // already shown they don't use.
        return [
            'text' => $lead . " by bank transfer. Please reply to this email and we'll send you our bank details.",
            'html' => email_note(
                '<strong>Pay by bank transfer</strong><br>Please reply to this email and we&rsquo;ll send you our bank details.',
            ),
        ];
    }
    return [
        'text' => $lead . " by bank transfer, using the details below:\n\n" . $bacs,
        // Owner FREE TEXT going into guest-facing HTML — escape, then restore the
        // line breaks they typed (a sort code and an account number belong on
        // their own lines).
        'html' => email_note('<strong>Pay by bank transfer</strong><br>' . nl2br(email_esc($bacs))),
    ];
}

// ------------------------------------------------------------------
//  Square payments — request + receipt emails. Both reuse smtp_send and the
//  crown header. $b: name, email, prop_key, prop_name, check_in, check_out,
//  kind ('deposit'|'balance'), amount, total, payment_method. $payUrl: the
//  secure pay link.
//
//  The two chase emails are split into a PURE body builder + a thin sender: the
//  builder takes everything it needs (accent, bank details) as arguments so
//  test-payrail.php can drive the real composer with no DB and no SMTP. Testing
//  payment_rail() alone would have passed with either call site reverted.
// ------------------------------------------------------------------
function payment_request_body($b, $payUrl, $accent, $bacs)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $what = $b['kind'] === 'balance' ? 'remaining balance' : 'deposit';
    $rail = payment_rail($b);

    // When the refundable deposit rides this payment (first payment), state the true
    // amount the card will be charged today so the emailed figure matches checkout.
    $damages = round((float) ($b['damages'] ?? 0), 2);
    $chargedToday = round((float) $b['amount'] + $damages, 2);
    // ONE composer for the stay total + already-paid (payment_money_facts): the
    // local total here was `total + damages`, which reads £700 the moment the
    // deposit has been CHARGED (damages 0) — beside a confirmation, receipt and
    // My Stays all saying £750. The facts fold the charged deposit into BOTH the
    // stay total and the paid figure, so the balance is unmoved and the guest's
    // documents finally agree.
    $f = payment_money_facts($b, $what);
    $stayTotalGrand = $f['stayTotal'];
    $depositLineText = $f['depositTail'] !== '' ? "\n\n" . $f['depositTail'] : '';
    // The CTA quotes the SUM THE GUEST SENDS, not the rental half of it — the
    // deposit sentence beneath explains the split.
    $cta = payment_cta($rail, $payUrl, $bacs, 'To secure your stay, please pay ' . $money($f['chargedNow']));
    // …and WHEN the rest is wanted (payment_plan_line — see its note: the
    // schedule is the booking's, so this is stated on both rails).
    $planLine = payment_plan_line($f['restAfter'], $b['balance_due_date'] ?? '', $money);

    // THE MONTHLY OPTION, previewed as the SCHEDULE the checkout will offer —
    // guests deciding whether they can afford to book learn it exists here,
    // not as a surprise at the pay screen. Card rail only: a guest getting
    // bank details is not meeting this checkout. The rows are the offer's own
    // dates and figures, so the preview and the consent card cannot disagree.
    $offer = is_array($b['instalment_offer'] ?? null) && $rail === 'card' ? $b['instalment_offer'] : null;
    $offerHtml = '';
    $offerText = '';
    if ($offer) {
        $oN = (int) $offer['n'];
        $oPer = round((float) $offer['per'], 2);
        $oLast = round((float) $offer['last'], 2);
        $oRest = round($oPer * ($oN - 1) + $oLast, 2);
        $oRows = [];
        $oLines = [];
        foreach ((array) $offer['dates'] as $i => $d) {
            $fig = $i + 1 === $oN ? $money($oLast) . ' · final' : $money($oPer);
            $oRows[] = ['Payment ' . ($i + 1) . ' — ' . uk_date($d), $fig];
            $oLines[] = '  ' . ($i + 1) . '. ' . uk_date($d) . ' — ' . $fig;
        }
        $offerLead = 'Rather spread the ' . $money($oRest) . " that's left? When you pay, you can choose:";
        $offerFine = 'From the card you pay with — an email before each one, and you can turn it off any time.';
        $offerHtml = email_p('<strong>' . $esc($offerLead) . '</strong>', true) . email_rows($oRows) . email_p($esc($offerFine), true);
        $offerText = "\n\n" . $offerLead . "\n" . implode("\n", $oLines) . "\n" . $offerFine;
    }

    $subject = "Pay your {$what} — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for booking {$prop} (" . uk_date($b['check_in']) . " to " . uk_date($b['check_out']) . ").\n\n" .
        $cta['text'] .
        $depositLineText .
        "\n\n" .
        'The full stay total is ' .
        $money($stayTotalGrand) .
        ($damages > 0 ? ' (including the refundable deposit)' : '') .
        '.' .
        // What they have ALREADY put down — a balance request that never says so
        // leaves the guest to work it out from two other numbers.
        ($f['paidLine'] !== '' ? ' ' . $f['paidLine'] : '') .
        ($planLine !== '' ? ' ' . $planLine : '') .
        $offerText .
        "\n\nYou can reply to this email with any questions.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h($prop, $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for booking <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong> (' .
                $esc(uk_date($b['check_in'])) .
                ' to ' .
                $esc(uk_date($b['check_out'])) .
                ').',
        ) .
        email_amount(
            $f['payLabel'],
            $money($f['chargedNow']),
            ($f['paySub'] !== '' ? $f['paySub'] . '<br>' : '') . $esc($f['contextLine']),
        ) .
        ($damages > 0
            ? email_p(
                'The <strong>' . $money($damages) . '</strong> security deposit is refundable — it comes back to you after checkout.',
                true,
            )
            : '') .
        $cta['html'] .
        ($planLine !== '' ? email_p($esc($planLine), true) : '') .
        $offerHtml .
        email_p('Any questions? Just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Pay your ' . $what . ' for ' . $prop, $inner, $accent);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
// Thin sender: resolve what the builder can't (the cottage accent and the owner's
// bank details both need the DB) and hand off to smtp_send.
function send_payment_request($b, $payUrl)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $m = payment_request_body($b, $payUrl, $accent, bacs_details());
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// High-level: build the secure pay link for a booking row + kind and email the
// guest the request. Returns ['ok'=>bool,'error'=>string,'amount'=>float].
// Requires db.php + pricing.php to be loaded (always true for callers). The
// amount is derived server-side from the booking; nothing is trusted from input.
function request_booking_payment($b, $kind, $reminder = false)
{
    $kind = $kind === 'balance' ? 'balance' : 'deposit';
    if (!square_enabled()) {
        return ['ok' => false, 'error' => 'Square payments are not switched on.'];
    }
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file.'];
    }
    $amt = booking_amount_due($b, $kind);
    if ($amt['due'] <= 0) {
        return ['ok' => false, 'error' => 'Nothing left to pay.', 'amount' => 0];
    }
    // No stage in the link — pay.php derives it from the booking on open, so an
    // email sent weeks ago asks for whatever the plan wants NOW. The composed
    // email still quotes $kind's figures, which are right at the moment of
    // sending; the link simply stops promising they still will be.
    $payUrl = site_base_url() . 'index.html?pay=' . pay_token($b['id']) . '&b=' . (int) $b['id'];
    $rate = get_rate($b['prop_key']);
    // The refundable damage deposit is CHARGED with the guest's first rental payment
    // (only while hold_status is 'none') and returned after checkout. Mirror pay.php's
    // derivation so the email states the full amount the card will be charged, not
    // just the rental portion. Zero once the deposit has already ridden a payment.
    $damages = 0.0;
    if (($b['hold_status'] ?? 'none') === 'none') {
        $damages = round((float) ($b['agreed_booking_fee'] ?? 0), 2);
        // Legacy rows (no snapshot) fall back to a live calc; a modern row with a
        // waived (£0) deposit stays £0 rather than showing the property standard.
        if (($b['agreed_total'] ?? null) === null && $rate) {
            $pp = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $damages = round((float) ($pp['damagesDeposit'] ?? 0), 2);
        }
    }
    // The deposit ALREADY taken (charged with the first payment, or a captured/kept
    // legacy hold) — the other half of the deposit story from $damages above, which
    // is only the deposit still TO ride this payment. Without it a balance chase
    // quoted the rental rail ("£175.00 already paid" of "£700.00 total") at a guest
    // whose card took £225 and whose confirmation, receipt, invoice and My Stays all
    // say £225 of £750 — the one document telling a different story, reported with a
    // screenshot. Mirrors send_booking_confirmation's $chargedDep derivation.
    $depCharged = in_array(($b['hold_status'] ?? 'none'), ['charged', 'captured', 'kept'], true)
        ? round((float) ($b['hold_amount'] ?? ($b['agreed_booking_fee'] ?? 0)), 2)
        : 0.0;
    $payload = [
        'name' => $b['name'],
        'email' => $b['email'],
        'prop_key' => $b['prop_key'],
        'prop_name' => $rate['name'] ?? $b['prop_key'],
        'check_in' => $b['check_in'],
        'check_out' => $b['check_out'],
        'kind' => $kind,
        'amount' => $amt['due'],
        'total' => $amt['total'],
        'damages' => $damages,
        'deposit_charged' => $depCharged,
        // booking_amount_due already works this out and it was being discarded, so
        // neither email could tell a part-paid guest what they had put down.
        'paid' => $amt['alreadyPaid'],
        // Carried so the email can pick the guest's rail (payment_rail): someone
        // who paid their deposit in cash gets bank details, not a card link.
        'payment_method' => $b['payment_method'] ?? '',
        // WHEN the rest is wanted — the booking's own derived date, the same one
        // the confirmation and the hub quote, so the deposit ask states the plan
        // the owner agreed rather than leaving it in the back office. Read by
        // payment_plan_line; rail-agnostic (see its note).
        'balance_due_date' => function_exists('booking_balance_due_date') ? booking_balance_due_date($b) : ($b['balance_due_date'] ?? ''),
        // THE MONTHLY OPTION IS MENTIONED BEFORE CHECKOUT — derived from the
        // same booking_instalment_offer the pay screen shows, so the email can
        // never promise a plan the checkout won't offer, and the owner's floor
        // rides along for free: no offer, no sentence. Deposit asks only (the
        // offer exists only at the deposit stage). The REMINDER deliberately
        // stays without it: a reminder chases money already asked for, and the
        // ask is the one place the option is put forward.
        'instalment_offer' => $kind === 'deposit' && function_exists('booking_instalment_offer') ? booking_instalment_offer($b) : null,
    ];
    $res = $reminder ? send_payment_reminder($payload, $payUrl) : send_payment_request($payload, $payUrl);
    $res['amount'] = $amt['due'];
    return $res;
}

// THE MONEY FACTS OF A PAYMENT ASK, stated once. The request and its own reminder
// chase the SAME money and were composed independently, so they disagreed: the
// request said "£340.00 will be charged to your card today" (rental + the
// refundable deposit, which pay.php really does bundle) while the reminder — the
// one sent repeatedly until the guest pays — said only "£290.00". Both are handed
// the same payload; the reminder simply ignored `damages`.
//
// Returns everything either email needs to be honest about the sum: what is being
// charged now, what the deposit adds, what has already been paid, and the full
// stay total. `paid` is optional (0 when the caller has no figure) so the line is
// only claimed when it is known.
function payment_money_facts($b, $whatLabel = 'balance')
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $rail = payment_rail($b);
    $due = round((float) ($b['amount'] ?? 0), 2);
    $damages = round((float) ($b['damages'] ?? 0), 2);
    // The deposit ALREADY taken — the £50 that rode the first card payment. The
    // guest's "already paid" must include it, because it is money that left their
    // card and every other document (receipt, confirmation, invoice, My Stays)
    // already counts it: the chase said "£175.00 already paid" of "£700.00 total"
    // to a guest whose card took £225 of a £750 stay. `paid` from the payload is
    // the RENTAL rail (booking_paid_so_far) and stays available raw as paidRental.
    $depCharged = round((float) ($b['deposit_charged'] ?? 0), 2);
    $paidRental = round((float) ($b['paid'] ?? 0), 2);
    $paid = round($paidRental + $depCharged, 2);
    $rentalTotal = round((float) ($b['total'] ?? 0), 2);
    return [
        'due' => $due,
        'damages' => $damages,
        'paid' => $paid,
        'paidRental' => $paidRental,
        'chargedNow' => round($due + $damages, 2),
        // The full stay figure in BOTH deposit eras: still to ride ($damages) or
        // already taken ($depCharged) — never both, and the balance is unmoved
        // either way because the deposit adds equally to total and paid.
        'stayTotal' => round($rentalTotal + $damages + $depCharged, 2),
        'money' => $money,
        // THE HEADLINE FIGURE IS WHAT THE GUEST ACTUALLY PAYS. Both emails used
        // to lead with the rental balance while the card takes balance + the
        // refundable deposit — so the one number that mattered was the one the
        // email never showed at its own size, only in a sentence below the fold
        // (owner's screenshot: a £290.00 hero over a £340.00 charge). The
        // headline is the real sum now and the split rides directly under it,
        // so the figure is never a mystery and never a surprise at checkout.
        // (The transaction fee needs no line of its own: it is inside the
        // rental total, so it is already inside every figure here.)
        'payLabel' => $damages > 0 ? 'To pay now' : ucfirst($whatLabel) . ' due',
        'paySub' => $damages > 0
            ? $money($due) . ' ' . $whatLabel . ' + ' . $money($damages) . ' refundable deposit'
            : '',
        // The quiet context under the figure: what the stay costs in total and
        // what has already been settled.
        'contextLine' => 'Of ' . $money(round($rentalTotal + $damages + $depCharged, 2)) . ' total'
            . ($paid > 0.005 ? ', ' . $money($paid) . ' already paid' : '') . '.',
        // The deposit sentence, in the same words both emails use — and on the
        // RAIL the guest is actually on: "charged to your card today" is a card
        // sentence, and the reminder was saying it to bank-transfer guests
        // (the request had its own rail-aware copy; this one did not).
        'depositTail' => $damages > 0
            ? 'This payment also includes a refundable security deposit of ' . $money($damages)
                . ' (returned after checkout), '
                . ($rail === 'bacs'
                    ? 'so please send ' . $money(round($due + $damages, 2)) . ' in total.'
                    : 'so ' . $money(round($due + $damages, 2)) . ' will be charged to your card today.')
            : '',
        // Stated only when there IS something already paid — "£0.00 already paid"
        // on a fresh request is noise, not information. When the refundable deposit
        // is inside the figure, say so, or £225 against a remembered £175 deposit
        // ask reads as a £50 mystery in the other direction.
        'paidLine' => $paid > 0.005
            ? 'Already paid: ' . $money($paid)
                . ($depCharged > 0.005 ? ' (including your ' . $money($depCharged) . ' refundable deposit)' : '')
                . '.'
            : '',
        // What is STILL to come after this payment — the rental remainder, which
        // is what the booking's plan puts a date on. Zero on a balance ask (that
        // payment settles the stay), positive on a deposit ask.
        'restAfter' => round($rentalTotal - $paidRental - $due, 2),
    ];
}

// THE PLAN, SAID IN THE EMAIL THAT ASKS FOR THE DEPOSIT. The ask told the guest
// what to pay now and what the stay costs, and never when the rest was wanted —
// so a plan the owner had agreed lived only in the back office, exactly the gap
// the confirmation's own due-by line closed (mailer 1523). It matters most on
// the BANK rail: a card guest is at least offered the monthly schedule at
// checkout, while the offer is deliberately suppressed for a guest paying by
// transfer, so without this they were the one party to the arrangement never
// told its date. Rail-agnostic by design — the schedule is the booking's, not
// the payment method's; only the HOW-TO-PAY half follows the rail.
// The date is the booking's own (custom date, else check-in minus the window),
// so this can never quote a different day from the chaser that follows it.
function payment_plan_line($restAfter, $dueDate, $money)
{
    $rest = round((float) $restAfter, 2);
    $due = substr((string) $dueDate, 0, 10);
    if ($rest <= 0.005 || $due === '') {
        return '';
    }
    return 'The remaining ' . $money($rest) . ' is due by ' . uk_date($due) . '.';
}

// A gentler nudge for a balance that's been requested but not yet paid, sent in
// the run-up to arrival. Same rail as the request; warmer copy + days-until-arrival.
function payment_reminder_body($b, $payUrl, $accent, $bacs)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $days = max(0, (int) floor((strtotime($b['check_in']) - strtotime(date('Y-m-d'))) / 86400));
    $when = $days <= 1 ? 'tomorrow' : "in {$days} days";
    $rail = payment_rail($b);
    // The SAME facts the request stated, so the chase cannot quote a smaller sum
    // than the one the card will take — including in the CTA, which used to name
    // the rental half while the deposit sentence beneath added the rest.
    $f = payment_money_facts($b, 'balance');
    $cta = payment_cta($rail, $payUrl, $bacs, 'Please pay ' . $money($f['chargedNow']));

    $subject = "Reminder: balance due for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Just a friendly reminder that the balance for your stay at {$prop} is still outstanding, " .
        "and your arrival is {$when} (" . uk_date($b['check_in']) . ").\n\n" .
        $cta['text'] .
        ($f['depositTail'] !== '' ? "\n\n" . $f['depositTail'] : '') .
        ($f['paidLine'] !== '' ? "\n\n" . $f['paidLine'] : '') .
        "\n\n" .
        "If you've already paid, thank you — please ignore this. Any questions, just reply.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h($prop, $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', a friendly reminder that the balance for your stay at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong> is still outstanding, and your arrival is <strong style="color:#2A2622;">' .
                $esc($when) .
                '</strong> (' .
                $esc(uk_date($b['check_in'])) .
                ').',
        ) .
        email_amount(
            $f['payLabel'],
            $money($f['chargedNow']),
            ($f['paySub'] !== '' ? $f['paySub'] . '<br>' : '') . $esc($f['contextLine']),
        ) .
        ($f['paidLine'] !== '' && $f['paySub'] === '' ? email_p($esc($f['paidLine']), true) : '') .
        $cta['html'] .
        email_p('Already paid? Thank you — please ignore this.', true) .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('Balance reminder for ' . $prop, $inner, $accent);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
// Thin sender (see payment_request_body's note on the split).
function send_payment_reminder($b, $payUrl)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $m = payment_reminder_body($b, $payUrl, $accent, bacs_details());
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Ask the guest to place a refundable card HOLD before arrival. $b: name, email,
// prop_key, prop_name, check_in, check_out, amount. $url: the secure hold link.
function send_hold_request($b, $url)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';

    $subject = "Secure your stay — refundable card hold for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Ahead of your stay at {$prop} (" . uk_date($b['check_in']) . " to " . uk_date($b['check_out']) . "), please place the refundable " .
        'security hold of ' .
        $money($b['amount']) .
        " on your card here:\n" .
        $url .
        "\n\n" .
        'This is a HOLD, not a charge — the amount is simply set aside on your card and released after checkout, ' .
        "provided there's no damage. Powered by Square; we never see your card number.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h($prop, $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', ahead of your stay (' .
                $esc(uk_date($b['check_in'])) .
                ' to ' .
                $esc(uk_date($b['check_out'])) .
                ') please place the refundable security hold on your card.',
        ) .
        email_amount('Refundable hold', $money($b['amount']), 'held, not charged') .
        email_btn($url, 'Place the card hold') .
        email_p(
            'This is a <strong style="color:#2A2622;">hold, not a charge</strong> — the amount is set aside on your card and released after checkout, provided there\'s no damage.',
            true,
        ) .
        email_p('Powered by Square — we never see or store your card number.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Place your refundable card hold for ' . $prop, $inner, $accent);
    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Tell the guest their card hold has been released. $b: name, email, prop_key,
// prop_name, amount.
function send_hold_released($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';

    $subject = "Your security hold has been released — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for staying at {$prop}. We've released the refundable security hold of " .
        $money($b['amount']) .
        ' on your card. ' .
        "Any remaining authorisation will clear from your statement within a few working days, depending on your bank.\n\n" .
        "We hope to welcome you back.\nCottage Holidays Blakeney";

    $inner =
        email_h('Security hold released', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for staying at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>. We\'ve released your refundable security hold.',
        ) .
        email_amount('Hold released', $money($b['amount']), '', '#D6A785') .
        email_p('It will clear from your statement within a few working days, depending on your bank.', true) .
        email_p('We hope to welcome you back.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Your security hold has been released — ' . $prop, $inner, $accent);
    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Tell the guest a refund is on its way. $b: name, email, prop_key, prop_name,
// check_in, check_out, amount.
function send_refund_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));

    $subject = "Refund on its way — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "We've issued a refund of " .
        $money($b['amount']) .
        " for your booking at {$prop}" .
        (!empty($b['check_in']) ? " (" . uk_date($b['check_in']) . " to " . uk_date($b['check_out']) . ")" : '') .
        ".\n\n" .
        ($reason !== '' ? "Reason: {$reason}\n\n" : '') .
        "It's been sent back to the card you paid with. Refunds usually take a few working days " .
        "to appear, depending on your bank.\n\n" .
        "Any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Refund on its way', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', we\'ve issued a refund for your booking at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc(uk_date($b['check_in'])) . ' to ' . $esc(uk_date($b['check_out'])) . ')' : '') .
                '.',
        ) .
        email_amount('Refund', $money($b['amount']), '', '#D6A785') .
        ($reason !== ''
            ? email_note('<strong style="color:#2A2622;">Reason:</strong> ' . $esc($reason), $accent)
            : '') .
        email_p(
            'It\'s on its way back to the card you paid with. Refunds usually take a few working days to appear, depending on your bank.',
            true,
        ) .
        email_p('Any questions? Just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Refund on its way — ' . $prop, $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Damage-deposit return after a stay. $b: name, email, prop_key, prop_name,
// check_in, check_out, amount, held, reason (retention note), manual (bool).
function send_deposit_return_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));
    $held = (float) ($b['held'] ?? $b['amount']);
    $retained = round(max(0, $held - (float) $b['amount']), 2);
    $how = !empty($b['manual']) ? 'by the method we agreed' : 'to the card you paid with';

    $subject = "Your damage deposit — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for staying at {$prop}. We're returning your refundable damage deposit.\n\n" .
        'Returned: ' .
        $money($b['amount']) .
        " ({$how}).\n" .
        ($retained > 0.001 ? 'Retained: ' . $money($retained) . ($reason !== '' ? " — {$reason}" : '') . "\n" : '') .
        "\nRefunds usually take a few working days to appear, depending on your bank.\n\n" .
        "We hope to welcome you back.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Your damage deposit', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for staying at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>. We\'re returning your refundable damage deposit.',
        ) .
        email_amount('Deposit returned', $money($b['amount']), '', '#D6A785') .
        ($retained > 0.001
            ? email_note(
                '<strong style="color:#2A2622;">Amount retained:</strong> ' .
                    $money($retained) .
                    ($reason !== '' ? ' — ' . $esc($reason) : ''),
                $accent,
            )
            : '') .
        email_p(
            'It\'s on its way ' .
                $esc($how) .
                '. Refunds usually take a few working days to appear, depending on your bank.',
            true,
        ) .
        email_p('We hope to welcome you back.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Your damage deposit — ' . $prop, $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Booking cancellation notice. $b: name, email, prop_key, prop_name, check_in,
// check_out, refund (amount), card (bool — refunded to card vs manual), reason.
// Pure — split out for the reason payment_request_body / owner_payment_notice_body
// were: a gate that reads mailer.php's source proves the words EXIST, not that
// they are ever reached.
function send_cancellation_email_body($b)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));
    $refund = (float) ($b['refund'] ?? 0);
    $refundLine =
        $refund > 0.001
            ? 'A refund of ' .
                $money($refund) .
                (!empty($b['card']) ? ' is on its way back to the card you paid with' : ' will be arranged with you') .
                '.'
            : '';
    // THE DEPOSIT IS THEIR MONEY TOO. A guest whose refundable deposit went back
    // on its own Square refund was told nothing about it here — the email named
    // the rental refund only — so the amount landing on their statement did not
    // match the one sentence they had in writing. Stated ONLY when it actually
    // went: a deposit whose refund was refused is being returned by hand, and
    // promising a mechanism that has already failed is worse than saying nothing
    // (the owner is told to settle it, and the activity log carries it).
    $depBack = round((float) ($b['deposit_refunded'] ?? 0), 2);
    $depLine = $depBack > 0.001
        ? 'Your refundable damage deposit of ' . $money($depBack) . ' is also on its way back to the card you paid with.'
        : '';

    $subject = "Booking cancelled — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Your booking at {$prop}" .
        (!empty($b['check_in']) ? " (" . uk_date($b['check_in']) . " to " . uk_date($b['check_out']) . ")" : '') .
        " has been cancelled.\n\n" .
        ($reason !== '' ? "Reason: {$reason}\n\n" : '') .
        ($refundLine !== '' ? $refundLine . "\n\n" : '') .
        ($depLine !== '' ? $depLine . "\n\n" : '') .
        "If you have any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Booking cancelled') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', your booking at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc(uk_date($b['check_in'])) . ' to ' . $esc(uk_date($b['check_out'])) . ')' : '') .
                ' has been cancelled.',
        ) .
        ($reason !== '' ? email_p('<strong style="color:#2A2622;">Reason:</strong> ' . $esc($reason), true) : '') .
        ($refundLine !== '' ? email_note($esc($refundLine)) : '') .
        ($depLine !== '' ? email_note($esc($depLine)) : '') .
        email_p('If you have any questions, just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Booking cancelled — ' . $prop, $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html, 'name' => $name];
}
function send_cancellation_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = send_cancellation_email_body($b);
    return smtp_send($b['email'], $m['name'], $m['subject'], $m['text'], $m['html']);
}

// ---- "WE'LL TAKE IT ON FRIDAY" ---------------------------------------------
// The notice that goes out AUTOPAY_NOTICE_DAYS before an automatic collection.
// Not a request — there is nothing for the guest to do — so it must not read
// like one: no pay button, no balance chase, no urgency. Its whole job is that
// the charge is recognised when it lands, and that anyone who has changed their
// mind has an unhurried way to say so before the money moves.
//
// Takes the booking row and the pay token separately for the same reason the
// two body builders do: it is pure, so the gate can drive the real composer.
function send_autopay_notice($b, $payUrl = null)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = autopay_notice_body($b, $payUrl);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// The PURE composer, split out for the reason payment_request_body is: a gate
// that can only read the source proves the words exist, not that they are ever
// reached — measured, a check written that way passed with the branch that
// selects them forced dead.
function autopay_notice_body($b, $payUrl = null)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = !empty($b['prop_name']) ? $b['prop_name'] : (function_exists('prop_display') ? prop_display((string) ($b['prop_key'] ?? ''))['name'] : 'your cottage');
    $amt = round((float) ($b['autopay_amount'] ?? 0), 2);
    if ($payUrl === null) {
        $payUrl = site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'];
    }
    // A MONTHLY plan's notice names WHICH payment this is and what follows —
    // an automatic charge the guest can place in their own schedule is one
    // they expected; an unplaced one is a dispute. The date is the NEXT
    // collection, and the position comes from the same schedule the guest was
    // shown at consent (guarded: mailer loads without pricing on some paths).
    $apN = (int) ($b['autopay_instalments'] ?? 0);
    $monthly = $apN > 1 && function_exists('booking_instalment_schedule');
    $noticeDate = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10) ?: substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    $when = uk_date($noticeDate !== '' ? $noticeDate : (string) ($b['autopay_due'] ?? ''));
    $ofN = '';
    $tail = '';
    if ($monthly) {
        $sched = booking_instalment_schedule(substr((string) $b['autopay_due'], 0, 10), $apN);
        $pos = 1;
        foreach ($sched as $i => $d) {
            if ($d === $noticeDate) {
                $pos = $i + 1;
            }
        }
        $ofN = "payment {$pos} of {$apN}";
        $tail =
            $pos < $apN
                ? ($apN - $pos) . ' more monthly payment' . ($apN - $pos === 1 ? ' follows' : 's follow') . ', the last on ' . uk_date(end($sched)) . " — and then your stay is all paid."
                : 'This is the final payment — after it your stay is all paid.';
    }
    $subject = $monthly ? "Coming up: {$ofN} — {$money($amt)} on {$when}" : "Coming up: we'll collect {$money($amt)} on {$when}";
    $body = $monthly
        ? "we're getting your stay at {$prop} ready. As you arranged when you paid your deposit, we'll collect your next monthly payment of " .
            $money($amt) .
            " — {$ofN} — from the card you saved on {$when}."
        : "we're getting your stay at {$prop} ready. As you arranged when you paid your deposit, we'll collect the remaining " .
            $money($amt) .
            " from the card you saved on {$when}.";
    $off = "There's nothing to do — this is just so it isn't a surprise. If you'd rather pay another way, or you'd like to stop the automatic payment, you can turn it off from your booking page any time before then.";
    $text =
        "Hello {$name},\n\n" .
        ucfirst($body) .
        ($tail !== '' ? "\n\n" . $tail : '') .
        "\n\n" .
        $off .
        "\n\n" .
        "Your booking: {$payUrl}\n\n" .
        'Cottage Holidays Blakeney';
    $rows = [['Amount', $money($amt)], ['Date', $esc($when)]];
    if ($monthly) {
        $rows[] = ['Payment', $esc($ofN)];
    }
    $rows[] = ['Cottage', $esc($prop)];
    $inner =
        email_h('A quick heads-up') .
        email_p('Hello ' . $esc($name) . ', ' . $esc($body)) .
        email_rows($rows) .
        ($tail !== '' ? email_p($esc($tail), true) : '') .
        email_p($esc($off), true) .
        email_btn($payUrl, 'View your booking') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell($subject, $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}

// A FAILED COLLECTION TELLS THE GUEST FIRST. A declined card is usually theirs
// to fix (expired, reissued), and until this email the first failure was silent
// to the very person who could mend it — only the third became an owner duty.
// autopay-lib sends it on the first soft failure and on the failure that STOPS
// the plan; the middle attempt is silence, they already know.
function send_autopay_failure($b, $why, $stopped, $today = null, $charge = null, $restNow = null)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = autopay_failure_body($b, $why, $stopped, $today, $charge, null, $restNow);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Pure, same reason as autopay_notice_body — and the one email in the plan's
// life carrying BAD news, so its jobs come in order: the booking is safe, here
// is exactly where the plan stands (the notice email's own rows, the declined
// one saying so in place), here is the one-minute fix. $why is
// autopay_square_why's prose, never a raw body. $stopped separates "we'll try
// again on <date>" from "we've stopped trying" — the two must never blur,
// because the first promises a charge and the second promises its absence.
function autopay_failure_body($b, $why, $stopped, $today = null, $charge = null, $payUrl = null, $restNow = null)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $name = first_name($b['name'], 'Guest');
    $prop = !empty($b['prop_name']) ? $b['prop_name'] : (function_exists('prop_display') ? prop_display((string) ($b['prop_key'] ?? ''))['name'] : 'your cottage');
    $amt = $charge !== null ? round((float) $charge, 2) : round((float) ($b['autopay_amount'] ?? 0), 2);
    if ($payUrl === null) {
        $payUrl = site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'];
    }
    // The retry day is derived, not promised loosely: last try + the collector's
    // own cadence. Guarded like the schedule below — mailer loads without
    // autopay-lib on some paths, and a day-shift on a date-only string is the
    // booking_balance_due_date shape.
    $retryDays = defined('AUTOPAY_RETRY_DAYS') ? AUTOPAY_RETRY_DAYS : 1;
    $retry = uk_date(date('Y-m-d', strtotime($today . ' +' . $retryDays . ' days')));
    $apN = (int) ($b['autopay_instalments'] ?? 0);
    $monthly = $apN > 1 && function_exists('booking_instalment_schedule');
    $failDate = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10) ?: substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    $ofN = '';
    $rows = [];
    if ($monthly) {
        $sched = booking_instalment_schedule(substr((string) $b['autopay_due'], 0, 10), $apN);
        $per = round((float) ($b['autopay_amount'] ?? 0), 2);
        // Rows AFTER the declined one show what the collector will TAKE, not the
        // ceiling — the my-bookings card fix, mirrored: after a manual
        // part-payment the later charges shrink, so a future row printing the
        // full £per would promise more than will be collected. $restNow is what
        // is owed right now (the collector passes it — it holds the booking
        // under lock with the DB); the remainder BEYOND this attempt is that
        // minus the declined charge. The composer stays DB-FREE: with $restNow
        // null (a caller that can't cheaply derive it) the rows fall back to
        // $per, exactly as before.
        $runAfter = $restNow !== null ? round(max(0, (float) $restNow - (float) $amt), 2) : null;
        foreach ($sched as $i => $d) {
            if ($d === $failDate) {
                $ofN = 'payment ' . ($i + 1) . ' of ' . $apN;
            }
            $future = $money($per);
            if ($d > $failDate && $runAfter !== null) {
                $take = round(min($per, max(0, $runAfter)), 2);
                $runAfter = round($runAfter - $take, 2);
                $future = $money($take);
            }
            $rows[] = [
                'Payment ' . ($i + 1) . ' — ' . uk_date($d),
                $d < $failDate
                    ? 'paid ✓'
                    : ($d === $failDate
                        ? $money($amt) . ' — declined' . ($stopped ? '' : ', retrying ' . $retry)
                        : $future . ($i + 1 === $apN ? ' · final' : '')),
            ];
        }
    } else {
        $rows = [['Amount', $money($amt)], ['Tried on', uk_date($today)], ['Cottage', $esc($prop)]];
    }
    $subject =
        ($monthly && $ofN !== '' ? ucfirst($ofN) . " didn't go through" : "Your automatic payment didn't go through") .
        ' — ' .
        ($stopped ? "let's sort the card" : 'we\'ll try again on ' . $retry);
    $happened =
        'we tried to take ' . $money($amt) . ' for your stay at ' . $prop . " today and it didn't go through — " . rtrim((string) $why, '.') . '. Your booking is completely safe.';
    $next = $stopped
        ? "We've stopped trying that card. Update it below and " .
            ($monthly ? 'the plan carries on where it left off' : 'the payment is collected as arranged') .
            ' — or pay any time, your own way. No fees either way.'
        : "We'll simply try again on {$retry}. If the card has changed, you can put it right in a minute — or pay this one now. No fees either way.";
    $tail = $stopped ? '' : 'If it keeps not going through, the plan simply pauses and the ordinary balance reminders take over — nothing is lost.';
    $text =
        "Hello {$name},\n\n" .
        ucfirst($happened) .
        "\n\n" .
        $next .
        ($tail !== '' ? "\n\n" . $tail : '') .
        "\n\n" .
        "Update your card, or pay this one now: {$payUrl}\n\n" .
        'Cottage Holidays Blakeney';
    $inner =
        email_h('Your booking is safe') .
        email_p('Hello ' . $esc($name) . ', ' . $esc($happened)) .
        email_rows($rows) .
        email_p($esc($next), true) .
        email_btn($payUrl, 'Update your card') .
        email_p('Or pay this one now, your own way — the same page does both.', true) .
        ($tail !== '' ? email_p($esc($tail), true) : '') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell($subject, $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}

function send_payment_receipt($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = payment_receipt_body($b);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Pure, same reason as autopay_notice_body above.
function payment_receipt_body($b)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $what = $b['kind'] === 'balance' ? 'balance' : 'deposit';
    // A SLICE IS NOT ITS STAGE. "we've received your balance payment of £120.00"
    // says the balance is settled — directly above this same email's own
    // "Remaining balance: £220.00". Named for what it is, the two agree.
    $partial = !empty($b['partial']);
    // The refundable damage deposit is charged WITH this payment and refunded after
    // checkout — so the amount actually taken is rental + deposit.
    $dep = round((float) ($b['deposit_charged'] ?? 0), 2);
    $paidNow = round((float) $b['amount'] + $dep, 2);
    $depLine =
        $dep > 0
            ? 'This includes a refundable damage deposit of ' .
                $money($dep) .
                ", which we'll refund after your stay."
            : '';

    // The AUTOMATIC path is named in the subject as well as the body: this lands
    // in an inbox beside nothing the guest did, so the line that identifies it
    // has to work before it is opened.
    $auto = !empty($b['automatic']);
    $subject = $auto ? "Balance collected — {$prop}" : "Payment received — {$prop}";
    // Three states, not two: a part payment can settle the whole RENTAL while
    // the refundable deposit it displaced is still to take (a slice typed at
    // the max bound). "Remaining balance: £0.00 — we'll be in touch about
    // settling it" states a figure with nothing behind it, so that case names
    // the deposit instead. The receipt stays rental-framed on purpose — the
    // deposit is the labelled exception, as it is everywhere on this document.
    $statusLine = !empty($b['fully_paid'])
        ? "Your booking is now paid in full. We can't wait to welcome you."
        : ((float) $b['balance'] <= 0.005
            ? "All that's left is your refundable damage deposit — we'll be in touch about taking it before your stay."
            : 'Remaining balance: ' . $money($b['balance']) . ". We'll be in touch about settling it before your stay.");
    $text =
        "Hello {$name},\n\n" .
        ($auto
            ? "As arranged, we've now collected your {$what} of " . $money($paidNow) . " for {$prop}. Nothing was needed from you.\n"
            : ($partial
                ? "Thank you — we've received your payment of " . $money($paidNow) . " towards your {$what} for {$prop}.\n"
                : "Thank you — we've received your {$what} payment of " . $money($paidNow) . " for {$prop}.\n")) .
        ($depLine !== '' ? $depLine . "\n" : '') .
        "Reference: {$b['ref']}\n" .
        'Rental paid so far: ' .
        $money($b['paid_so_far']) .
        ' of ' .
        $money($b['total']) .
        ".\n" .
        $statusLine .
        "\n" .
        (!empty($b['invoice_url']) ? "\nView or download your updated invoice: {$b['invoice_url']}\n" : '') .
        "\n" .
        'Cottage Holidays Blakeney';
    $inner =
        email_h($auto ? 'Balance collected' : 'Payment received') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', ' .
                // A charge nobody typed anything for must SAY so. "Thank you —
                // we've received your payment" reads as an acknowledgement of
                // something they just did; on the automatic path they did it
                // months ago, and an unrecognised charge is what a chargeback is
                // made of.
                (!empty($b['automatic'])
                    ? 'as arranged, we\'ve now collected your ' . $what . ' of <strong style="color:#2A2622;">' . $money($paidNow) . '</strong> for <strong style="color:#2A2622;">' . $esc($prop) . '</strong>. Nothing was needed from you.'
                    : ($partial
                        ? 'thank you — we\'ve received your payment of <strong style="color:#2A2622;">' . $money($paidNow) . '</strong> towards your ' . $what . ' for <strong style="color:#2A2622;">' . $esc($prop) . '</strong>.'
                        : 'thank you — we\'ve received your ' . $what . ' payment of <strong style="color:#2A2622;">' . $money($paidNow) . '</strong> for <strong style="color:#2A2622;">' . $esc($prop) . '</strong>.')),
        ) .
        ($depLine !== '' ? email_p($esc($depLine), true) : '') .
        email_rows(
            array_filter([
                ['Reference', $esc($b['ref'])],
                $dep > 0 ? ['Refundable deposit', $money($dep) . ' (refunded after checkout)'] : null,
                ['Rental paid so far', $money($b['paid_so_far']) . ' of ' . $money($b['total'])],
            ]),
        ) .
        email_p($esc($statusLine), true) .
        // The invoice always reflects the money just received — link it from the
        // receipt too, not only the original confirmation.
        (!empty($b['invoice_url']) ? email_btn($b['invoice_url'], 'View your invoice') : '') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell(($auto ? 'Balance collected — ' : 'Payment received — ') . $prop, $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}

// Build + send the arrival email for a saved booking row, then mark it sent.
// Returns the smtp_send result. Never throws. Requires db() (always loaded).
function send_arrival_for_booking($bk)
{
    try {
        $p = db()->prepare('SELECT name, address FROM properties WHERE prop_key = ?');
        $p->execute([$bk['prop_key']]);
        $prop = $p->fetch() ?: ['name' => $bk['prop_key'], 'address' => ''];
        // The door/key code (arrival-<prop>) is deliberately NOT emailed; guests
        // reveal it in-app via the geofenced "My Bookings" flow (arrival-access.php),
        // so this path never even decrypts it.
        $res = send_arrival_email([
            'prop_key' => $bk['prop_key'],
            'prop_name' => $prop['name'],
            'name' => $bk['name'],
            'email' => $bk['email'],
            'check_in' => $bk['check_in'],
            'check_out' => $bk['check_out'],
            'check_in_time' => $bk['check_in_time'] ?? '15:00',
            'address' => $prop['address'],
        ]);
        if (!empty($res['ok'])) {
            try {
                db()
                    ->prepare('UPDATE bookings SET pre_arrival_sent = NOW() WHERE id = ?')
                    ->execute([(int) $bk['id']]);
            } catch (\Throwable $e) {
            } // column may not exist yet — email still sent
        }
        return $res;
    } catch (\Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}
