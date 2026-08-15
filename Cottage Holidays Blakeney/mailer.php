<?php

// Centered crown logo for the top of customer emails. The image is embedded
// as a base64 data URI so it travels inside the email — no external URL to
// break and no dependence on the site domain. Works on a light background.
//
// A data URI cannot be stripped by the image blocking most clients apply by default,
// which is worth its bytes — it is the one thing that makes these emails look like
// they came from somewhere. But it was stored at 240x240 and DISPLAYED at 72, so it
// is now 144: 2x for a retina screen, which is all the <img> width/height can ever
// ask for. 14,026 base64 bytes down to 8,864 — every email about 5KB lighter, for no
// visible change at all.
//
// DO NOT QUANTISE IT to shave the rest. Measured: a 64-colour palette reaches 2,476
// bytes and the per-pixel arithmetic calls it fine — composited on this header, five
// pixels of 5,184 differ by more than 8/255. It still BANDS, visibly: the rose-gold
// gradient becomes stripes, because banding is a STRUCTURED artifact that a mean
// per-pixel delta underweights. Octree at 128 and 256 colours bands identically and
// is barely smaller, and Pillow will not run a better quantiser on RGBA. The
// arithmetic passed and looking at it did not, which is the whole reason to look.
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
/**
 * WARNING AND ALERT AS TEXT. The digest's needs-attention rows set the status amber and
 * red straight into 13px `color:` — measured on the rendered output, **1.73:1** for the
 * amber and 2.99 for the red, on the one email that exists to tell the owner something
 * has gone wrong. Same ink-vs-fill split the screens and email_accent_ink already make:
 * `#ffb74d` and `#e57373` are fine as FILLS (a chip, a rule), illegible as WORDS.
 * Measured white / tinted panel / outer ground, a shade past AA rather than on it.
 */
function email_warn_ink()
{
    return '#8A5000'; // 6.51 / 6.09 / 5.67
}
function email_alert_ink()
{
    return '#A3291C'; // 7.26 / 6.80 / 6.33
}
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
            '<a href="$1" style="color:' . email_accent_ink() . ';text-decoration:underline;">$1</a>',
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
// ── INK vs FILL, the email half of the app's own --accent / --accent-text split ──
// The screens learned this once already: the rose-gold is fine for a button, a rule
// or a swatch, which only have to clear the 3:1 non-text bar, and fails AA outright
// as WORDS. That fix stopped at the edge of the browser — measured on the rendered
// HTML of all 21 templates, sixteen ink/ground/size combinations sat below AA, the
// worst of them email_amount's 34px figure at 2.00:1, i.e. the one number a refund
// email exists to state.
//
// Two tokens, so a new email cannot reintroduce the problem by picking a hex that
// looks right on a white background it does not actually sit on:
//
//   email_muted_ink()  — every label and every piece of secondary prose. It replaces
//     FOUR near-identical inks (#8E877A #9A927F #A0987F #A79E8A, spanning 2.12–3.56:1)
//     that differed by a few hex points, served no hierarchy the size and letter-
//     spacing were not already carrying, and all failed. One ink now, comfortably
//     past the bar on all three grounds: 6.49:1 white, 6.02:1 tinted panel,
//     5.18:1 the outer ground.
//   email_accent_ink() — the accent when it is TEXT: a figure, a link, a status word.
//     5.87 / 5.44 / 4.68:1 on the same three grounds.
//
// Deliberately a shade PAST the pass mark rather than on it, the same discipline the
// screen tokens follow — 4.5 is the floor to clear, not to land on. test-payrail's
// contrast section measures both against every ground in the rendered output, so
// the prose here cannot drift from what ships.
function email_muted_ink()
{
    return '#655D50';
}
function email_accent_ink()
{
    return '#8A5A2B';
}
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
//    ink #262320    body #57524A   muted email_muted_ink()    accent (rose-gold) #C79A64
//    the accent AS TEXT email_accent_ink() — see the note above those two
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
        ';font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:' . email_muted_ink() . ';">' .
        email_esc($label) .
        '</div>' .
        '<div style="font-family:' .
        $serif .
        ';font-size:34px;font-weight:700;color:' .
        $valueColor .
        ';padding:7px 0 2px;">' .
        $amount .
        '</div>' .
        ($sub !== '' ? '<div style="font-family:' . $sans . ';font-size:12px;color:' . email_muted_ink() . ';">' . $sub . '</div>' : '') .
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
            ';font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' . email_muted_ink() . ';vertical-align:top;width:40%;">' .
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
        ($muted ? email_muted_ink() : '#57524A') .
        ';line-height:1.75;margin:13px 0 0;">' .
        $html .
        '</p>';
}

// ============================================================
//  DATES, TIMES AND PLACES A PERSON CAN ACT ON.
//  Every guest email used uk_date() (05/09/2026) and a raw 24-hour time. Two problems:
//  the weekday is the thing a traveller actually checks ("are we driving down on the
//  Saturday?"), and a numeric UK date reads as 9 May to anyone used to MM/DD — which for
//  a coastal holiday let is not a rare visitor. These are EMAIL-ONLY: the app's screens,
//  the ICS, the APIs and storage all keep their existing formats (uk_date / ISO), because
//  DD/MM/YYYY is the house form on screen and only prose wants a weekday.
// ============================================================
function email_date($iso, $withYear = true)
{
    $t = strtotime((string) $iso);
    if (!$t) {
        return (string) $iso;
    }
    return date('D j M', $t) . ($withYear ? date(' Y', $t) : '');
}
// "3pm", not "15:00" — and "10:30am" when there are minutes to say.
function email_time($hhmm)
{
    // AN ABSENT TIME IS NOT MIDNIGHT. strtotime('2000-01-01 ') parses fine and
    // yields 00:00, so an unset check-in time rendered "12am" — a stated fact,
    // wrong, on the line telling a guest when they can arrive. Empty in, empty out;
    // the caller decides what to print instead.
    $hhmm = trim((string) $hhmm);
    if ($hhmm === '') {
        return '';
    }
    $t = strtotime('2000-01-01 ' . $hhmm);
    if (!$t) {
        return (string) $hhmm;
    }
    return strtolower(date((int) date('i', $t) === 0 ? 'ga' : 'g:ia', $t));
}
// Works on iOS and Android without knowing which: Google's universal maps URL opens the
// native app where there is one and the web map where there isn't.
function email_maplink($addr)
{
    return 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode((string) $addr);
}
// AN ADDRESS IS NOT A FIELD VALUE. Put one in email_rows()'s 40/60 grid and it wraps to
// three right-aligned underlined lines on a phone. Its own full-width block, plain text,
// with ONE link doing the work.
function email_address_block($addr)
{
    $addr = trim((string) $addr);
    if ($addr === '') {
        return '';
    }
    $sans = email_sans();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 2px;"><tr><td style="padding:12px 0;border-top:1px solid #EDE6D8;">' .
        '<div style="font-family:' . $sans . ';font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' . email_muted_ink() . ';padding-bottom:5px;">Address</div>' .
        '<div style="font-family:' . $sans . ';font-size:14px;font-weight:600;color:#2E2A25;line-height:1.55;">' . email_esc($addr) . '</div>' .
        '<div style="padding-top:6px;"><a href="' . email_esc(email_maplink($addr)) . '" style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:#8A5A2B;text-decoration:none;">Open in Maps &rsaquo;</a></div>' .
        '</td></tr></table>';
}
// A SECOND destination without a second shout. Same 44px hit area as email_btn's 50px
// primary, outlined rather than filled, so an email can carry "pay" and "view" without
// two competing calls to action.
function email_btn2($href, $label)
{
    $sans = email_sans();
    return '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 4px;"><tr>' .
        '<td align="center" bgcolor="#FFFFFF" style="border-radius:999px;border:1px solid #D9CFB8;">' .
        '<a href="' . email_esc($href) . '" style="display:inline-block;color:#5A4A33;text-decoration:none;font-family:' . $sans .
        ';font-size:14px;font-weight:600;line-height:44px;padding:0 28px;">' . email_esc($label) . '</a>' .
        '</td></tr></table>';
}
// Small print that is PROSE. email_rows() splits its content across two columns, so a
// sentence put through it wraps 2+2 lines and reads as a label beside a value.
// Pre-escaped HTML, like email_p().
function email_footnote($html)
{
    return '<p style="font-family:' . email_sans() .
        ';font-size:12px;line-height:1.7;color:' . email_muted_ink() . ';margin:10px 2px 0;">' . $html . '</p>';
}
// MONEY ROWS IN SENTENCE CASE. email_rows() uppercases its label column, which is right
// for a field NAME (ARRIVE, PARTY) and wrong for a price line — "£130.00 × 3 NIGHTS"
// shouts and wraps. Same tinted panel the money blocks already use.
// $rows = [[labelHtml, valueHtml], …], both PRE-ESCAPED.
function email_money_rows($rows)
{
    $sans = email_sans();
    $out =
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FAF6EC" style="background:#FAF6EC;border:1px solid #ECE4D3;border-radius:16px;margin:18px 0 0;">';
    $n = count($rows);
    $i = 0;
    foreach ($rows as $r) {
        $i++;
        $bd = $i < $n ? 'border-bottom:1px solid #ECE4D3;' : '';
        $pad = $i === 1 ? '14px 18px 12px' : ($i === $n ? '12px 18px 14px' : '12px 18px');
        $out .=
            '<tr><td style="padding:' . $pad . ';' . $bd . 'font-family:' . $sans .
            ';font-size:14px;color:#57524A;">' . $r[0] . '</td>' .
            '<td align="right" style="padding:' . $pad . ';' . $bd . 'font-family:' . $sans .
            ';font-size:14px;font-weight:600;color:#2E2A25;">' . $r[1] . '</td></tr>';
    }
    return $out . '</table>';
}
// THE OWNER'S OWN WORDS, ATTRIBUTED. The refund and cancellation emails printed
// "Reason: <whatever the owner typed>" as though the SITE were explaining itself — but
// that field is a note the owner wrote for their own records, and it reads very
// differently to the guest when presented as the email's own account of events.
// Returns '' for an empty note, so a blank reason renders nothing rather than a heading
// over white space.
function email_ownernote($who, $text)
{
    $text = trim((string) $text);
    if ($text === '') {
        return '';
    }
    $sans = email_sans();
    $who = trim((string) $who) !== '' ? $who : 'us';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr>' .
        '<td bgcolor="#FAF6EC" style="background:#FAF6EC;border:1px solid #ECE4D3;border-left:3px solid #C79A64;border-radius:10px;padding:14px 17px;">' .
        '<div style="font-family:' . $sans . ';font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' . email_muted_ink() . ';padding-bottom:5px;">A note from ' .
        email_esc($who) . '</div>' .
        '<div style="font-family:' . $sans . ';font-size:13px;color:#5A554C;line-height:1.7;">' .
        email_esc($text) . '</div></td></tr></table>';
}
// The host's name for those notes, falling back to the business.
function email_host_name()
{
    // content_value takes ONE argument and already returns '' for a missing key —
    // a second "default" is accepted at runtime and silently ignored, which is why
    // this only surfaced under PHPStan.
    $n = function_exists('content_value') ? trim((string) content_value('host-name')) : '';
    return $n !== '' ? $n : (defined('SITE_NAME') ? SITE_NAME : 'us');
}
// The owner's phone, for the emails where a guest most wants to ring: '' when unset, so
// callers render nothing rather than an empty "call us on".
function email_phone()
{
    return function_exists('content_value') ? trim((string) content_value('contact-phone')) : '';
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
        ';font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:' . email_muted_ink() . ';padding-top:5px;">North Norfolk Coast</div></td></tr>' .
        '<tr><td class="ec-pad" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E7DFCF;border-top:3px solid ' .
        $accentBar .
        ';border-radius:22px;padding:34px 36px;">' .
        $inner .
        '</td></tr>' .
        '<tr><td align="center" style="padding:24px 24px 8px;font-family:' .
        $sans .
        ';font-size:11px;color:' . email_muted_ink() . ';line-height:1.8;">' .
        'Self-catering holiday cottages in Blakeney, North Norfolk &middot; NR25<br>' .
        ($footerExtra !== '' ? $footerExtra . '<br>' : '') .
        ($unsub !== ''
            ? '<a href="' . email_esc($unsub) . '" style="color:' . email_muted_ink() . ';text-decoration:underline;">Unsubscribe</a>'
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
    $settled = ($b['status'] ?? '') === 'paid';
    $statusTxt = $settled ? ' — now paid in full' : '';
    $prop = $b['prop_name'] ?? ($b['prop_key'] ?? 'a cottage');
    // THE OWNER'S ACTUAL QUESTION IS "IS THAT THE LOT?" — and the only answer this
    // notice gave was the ABSENCE of "now paid in full", which is silence rather
    // than an answer: a deposit with a balance to come and a part payment that fell
    // short both read identically. The figure was already known at the call site
    // (pay.php holds the total and the new paid figure in the same closure) and was
    // simply not passed. Stated only when there is something left, and named in the
    // SUBJECT too, because that is the half read on a lock screen.
    $left = round((float) ($b['balance'] ?? 0), 2);
    $leftTxt = !$settled && $left > 0.005 ? 'Still to collect: ' . $money($left) : '';
    return [
        'subject' => 'Payment received: ' . $money($b['amount']) . " — {$prop}"
            . ($settled ? ' (paid in full)' : ($leftTxt !== '' ? ' — ' . $money($left) . ' still to collect' : '')),
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
            "\n" .
            ($leftTxt !== '' ? $leftTxt . "\n" : '') .
            "\n" .
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

    // A QUESTION, NOT A CHORE. "How was Jollyboat? Leave a review" put the ask in
    // the subject line, where it reads as a task the guest has been given; the
    // question alone invites the reply, and the ask is inside where it belongs.
    $subject = "How was your stay at {$prop}?";
    $text =
        "Hi {$name},\n\n" .
        "Thank you for staying at {$prop}. We'd love to hear how it went — a short review " .
        "really helps other guests (and us).\n\n" .
        // "Or review us on our site" with no Google link above it began the
        // sentence with a dangling "Or" — the HTML half branched on $googleUrl and
        // this half never did.
        ($googleUrl ? "Leave us a Google review: {$googleUrl}\n\n" : '') .
        ($url ? ($googleUrl ? 'Or review us on our site' : 'Review us on our site') . ": {$url}\n\n" : '') .
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
        // THE HOUSE SECONDARY BUTTON, not a bespoke 13px centred link. This was the
        // only inline-styled anchor left in the file, written before email_btn2()
        // existed — so the alternative to Google was a 13px line of text against a
        // 44px button, which is not a choice so much as a hint. Now it is the second
        // option, at the same tap size, visibly quieter.
        $inner .= $googleUrl ? email_btn2($url, 'Or review us on our site') : email_btn($url, 'Leave a review');
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

    // The cottage's own page, not the homepage — see email_cottage_url.
    $bookUrl = email_cottage_url($b['prop_key'] ?? '');
    $subject = "{$month} at {$prop} — fancy a return visit?";
    $text =
        "Hi {$name},\n\n" .
        "Around this time last year you were getting ready for your stay at {$prop} — " .
        "we hope Blakeney has stayed with you the way it tends to.\n\n" .
        "The same {$month} weeks are starting to book up again, so if you fancy a return " .
        "we wanted you to have first pick of the dates.\n\n" .
        ($bookUrl ? "See {$prop}'s dates and prices: {$bookUrl}\n\n" : '') .
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
    if ($bookUrl) {
        // Named for the destination. "Check availability" describes a lookup; this
        // button opens the cottage's own page, where the dates AND the live price
        // are — which is what the guest is actually deciding on.
        $inner .= email_btn($bookUrl, 'See dates & prices');
    }
    $inner .= email_p('Hope to welcome you back,<br>Cottage Holidays Blakeney', true);
    // THE UNSUBSCRIBE GOES IN THE FOOTER, WHICH ALREADY HAS A SLOT FOR IT.
    // email_shell takes ['unsubscribe' => url] and renders it beside the other
    // footer text — the place a reader looks for it and the place the RFC 8058
    // header points at. This composer hand-rolled its own body paragraph instead,
    // so the shell's slot rendered nothing while a full sentence about opting out
    // sat immediately under the sign-off, in the body, as though it were part of
    // the message. Only the no-signed-link fallback stays in the body, because
    // "just reply and say so" is an instruction rather than a link.
    $inner .= $unsub === '' ? email_footnote('Prefer not to get the occasional note like this? Just reply and say so.') : '';
    $html = email_shell($month . ' at ' . $prop, $inner, $accent, $unsub !== '' ? ['unsubscribe' => $unsub] : []);

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

    $bookUrl = email_cottage_url($lead['prop_key'] ?? '');
    $subject = "The coast is calling — come back to {$prop}, direct";
    $text =
        "Hi {$name},\n\n" .
        "Thank you again for your lovely review of {$prop} — it genuinely made our week.\n\n" .
        "If North Norfolk is on your mind again — the big skies over the marshes, the walk down to the " .
        "quay, the hush once the day-trippers have gone — we'd love to have you back.\n\n" .
        "And here's the best part: book DIRECT with us and you skip the booking-site fees entirely. Best " .
        "price, no middle-man — just you and the people who look after the cottage.\n\n" .
        ($bookUrl ? "See dates & book direct: {$bookUrl}\n\n" : '') .
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
        'text-transform:uppercase;color:' . email_accent_ink() . ';margin:16px 0 0;">Book direct &middot; Best price</p>';
    $head =
        '<h1 style="font-family:' . $serif . ';text-align:center;font-size:30px;font-weight:700;color:#262320;' .
        'margin:6px 0 2px;line-height:1.25;">The coast is calling you back</h1>';
    $highlights =
        '<p style="font-family:' . $sans . ';text-align:center;font-size:12px;letter-spacing:1px;color:' . email_muted_ink() . ';' .
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
    if ($bookUrl) {
        $inner .= email_btn($bookUrl, 'See dates & book direct');
    }
    $inner .= email_p('We\'d love to welcome you back,<br>Cottage Holidays Blakeney', true);
    // Footer slot, for the reason set out in send_anniversary_email.
    $inner .= $unsub === '' ? email_footnote('Prefer not to get the occasional note like this? Just reply and say so.') : '';
    // Brand rose-gold accent bar (not a per-cottage colour) — one coherent look.
    $html = email_shell(
        'Come back to ' . $prop . ' — book direct and skip the fees',
        $inner,
        '#C79A64',
        $unsub !== '' ? ['unsubscribe' => $unsub] : [],
    );

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
    $pretty = fn($d) => $d ? email_date($d) : '';
    $dates = trim($pretty($enq['check_in'] ?? '') . ' to ' . $pretty($enq['check_out'] ?? ''), ' to');
    $url = function_exists('site_base_url') ? site_base_url() : '/';
    $acctLine = $accountExists
        ? 'You already have an account with us — sign in to track this enquiry and manage your bookings.'
        : 'Tip: create an account next time you visit (just set a password) to track this enquiry, message us and book faster.';

    $subject = "We've received your enquiry — Cottage Holidays Blakeney";
    // The preheader is the line the inbox shows beside the subject, so it earns its
    // place by carrying the answer to the next question rather than repeating the
    // subject back — which is what "We've received your enquiry" did.
    // PLAIN TEXT, not HTML: email_shell runs email_esc() over the preheader, so an
    // entity here ships as the literal characters "&rsquo;" in the inbox preview
    // (and a pre-escaped cottage name would double-escape) — the same
    // escape-at-the-boundary asymmetry email_h/email_p have.
    $pre = "We'll confirm your dates and price" . ($prop ? ' for ' . $prop : '') . ' — usually within a few hours.';
    $text =
        "Hi {$first},\n\n" .
        'Thanks for your enquiry' .
        ($prop ? " about {$prop}" : '') .
        ($dates ? " for {$dates}" : '') .
        ".\n" .
        "We'll check availability and email you back to confirm your dates and price —\n" .
        "usually within a few hours, and always by the end of the next day.\n\n" .
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
        // WHEN, not just WHAT. The one question this email leaves a guest with is
        // "so when do I hear back?" — an acknowledgement that answers it stops them
        // wondering whether to chase, or to enquire somewhere else while they wait.
        // Two bounds deliberately: the typical case sets the expectation, the outer
        // one is the promise, so a busy day doesn't read as being ignored.
        email_p(
            "We'll check availability and email you back to confirm your dates and price — " .
                'usually within a few hours, and always by the end of the next day.',
            true,
        ) .
        email_note(email_esc($acctLine)) .
        email_btn($url, $accountExists ? 'Sign in' : 'Visit the site');
    $html = email_shell($pre, $inner);
    return smtp_send($email, $name, $subject, $text, $html);
}

// Owner's direct reply to an enquirer, sent from the back office Inbox. The
// owner writes the message; the guest's enquiry details ride along underneath
// (cottage, dates, times, party, estimated price) in the house email style.
// Replies come back to the site address (smtp_send's default Reply-To).
// Build the branded reply email (subject + text + HTML) WITHOUT sending it, so the
// same output can be shown as a live preview in the composer and then sent. Single
// source of truth for both the preview endpoint and send_enquiry_reply_email().
function build_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry', $actions = [])
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
    $times = 'Arrive ' . email_time(($e['check_in_time'] ?? '') ?: '15:00') . ' · leave ' . email_time(($e['check_out_time'] ?? '') ?: '10:00');

    $subject = trim((string) $subject) ?: 'Your ' . $noun . ' — ' . $prop;

    // Saved-reply buttons: $actions is the VALIDATED list from
    // email_reply_actions() — [['id','label','url'], …] — never raw client ids.
    // The text half carries each as its own label + URL line, the shape the
    // confirmation's text half already uses for the same three links.
    $actText = '';
    foreach (is_array($actions) ? $actions : [] as $a) {
        $actText .= "\n" . $a['label'] . ': ' . $a['url'] . "\n";
    }

    $text =
        "Hello {$name},\n\n" .
        trim((string) $message) .
        ($actText !== '' ? "\n" . $actText : '') .
        "\n\n---\nYour {$noun} details\n" .
        "Cottage: {$prop}\n" .
        'Dates: ' . email_date($e['check_in'] ?? '') . ' to ' . email_date($e['check_out'] ?? '') . "\n" .
        $times . "\n" .
        "Party: {$party}\n" .
        ($priceLine !== '' ? ($noun === 'booking' ? 'Price: ' : 'Estimated price: ') . $priceLine . "\n" : '') .
        "\nJust reply to this email to reach us.\nCottage Holidays Blakeney";

    // Owner-typed message: escape, then preserve their line breaks.
    $msgHtml = nl2br(email_esc(trim((string) $message)));
    // THE HOUSE ROWS, not a private table. This composer carried its own 13px
    // label/14px value pairs at 4px padding — the only place in the file that did —
    // so the owner's reply looked like a different product from the confirmation
    // that follows it. email_rows() is the same block every other stay-detail
    // summary uses, and it puts the value on its own right-aligned rail.
    $dRows = [];
    if ($prop !== '') {
        $dRows[] = ['Cottage', email_esc($prop)];
    }
    if (!empty($e['check_in'])) {
        $dRows[] = ['Dates', '<strong>' . email_esc(email_date($e['check_in'])) . '</strong> &rarr; ' . email_esc(email_date($e['check_out'] ?? ''))];
    }
    $dRows[] = ['Times', email_esc($times)];
    if ($party !== '') {
        $dRows[] = ['Party', email_esc($party)];
    }

    // THE PRICE IS THE ANSWER, so it gets the money panel rather than being the
    // fifth row of a details table. It had been one long run-on value — total,
    // nights, per-night and the refundable deposit's whole explanation inside a
    // single cell — which at phone width wrapped into an unreadable block and put
    // the figure the guest is actually reading for in the middle of it. Split into
    // its own rows, the total leads and the deposit is a line of its own.
    $quote = '';
    if ($p) {
        $nightsN = (int) ($p['nights'] ?? 0);
        $qRows = [
            [
                email_esc($nightsN . ' night' . ($nightsN === 1 ? '' : 's') . ' at ' . $money($p['perNight'] ?? 0) . ' a night'),
                '<strong>' . email_esc($money($p['total'])) . '</strong>',
            ],
        ];
        if (!empty($p['damagesDeposit'])) {
            $qRows[] = ['Refundable damage deposit', email_esc($money($p['damagesDeposit']))];
        }
        $quote =
            email_p('<strong style="color:#2A2622;">' . ($noun === 'booking' ? 'Your price' : 'Your quote') . '</strong>', true) .
            email_money_rows($qRows) .
            (!empty($p['damagesDeposit'])
                ? email_footnote('The damage deposit is charged with your first payment and refunded after your stay.')
                : '');
    }

    // The buttons land between the owner's words and the quote — where the
    // confirmation puts its own. First one filled (email_btn), the rest outlined
    // (email_btn2): two filled buttons compete for one decision. Both take the
    // HOUSE accent+ink pair — the per-cottage accent measured 3.30:1 under words
    // on the enquiry nudges, which is why buttons never wear it.
    $actBtns = '';
    $actFirst = true;
    foreach (is_array($actions) ? $actions : [] as $a) {
        $actBtns .= $actFirst ? email_btn($a['url'], $a['label']) : email_btn2($a['url'], $a['label']);
        $actFirst = false;
    }

    $inner =
        email_h('About your ' . $noun, $accent) .
        email_p('Hello ' . email_esc($name) . ',') .
        email_p($msgHtml) .
        $actBtns .
        $quote .
        email_p('<strong style="color:#2A2622;">Your ' . $noun . ' details</strong>', true) .
        email_rows($dRows) .
        email_p('Just reply to this email to reach us.<br>Cottage Holidays Blakeney', true);
    $html = email_shell($subject, $inner, $accent);

    return ['email' => $e['email'] ?? '', 'name' => $name, 'subject' => $subject, 'text' => $text, 'html' => $html];
}
// Send the branded reply email (owner writes the message; the guest's details
// ride along underneath). Builds via build_enquiry_reply_email() so the sent
// email is byte-identical to the composer preview.
function send_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry', $attachments = [], $actions = [])
{
    $noun = $ctx === 'booking' ? 'booking' : 'enquiry';
    if (empty($e['email'])) {
        return ['ok' => false, 'error' => 'No guest email on this ' . $noun];
    }
    $m = build_enquiry_reply_email($e, $subject, $message, $ctx, $actions);
    return smtp_send($m['email'], $m['name'], $m['subject'], $m['text'], $m['html'], is_array($attachments) ? $attachments : []);
}

// ---- Saved-reply buttons ---------------------------------------------------
// The three buttons a manual reply may carry: pay / invoice / register. Each
// inherits the CONFIRMATION email's own condition for the same link (the block
// in send_confirmation_email) — reused, not re-decided, so a reply and a system
// email can never disagree about whether a guest can pay. PURE by design: the
// endpoint resolves the live facts (email_reply_facts) and this only decides,
// which is what lets test-payrail drive the whole matrix with no database.
// Returns the validated buttons in the order asked, plus every refusal WITH its
// sentence — a button the owner attached must never be dropped in silence.
function email_reply_actions($ctx, $facts, $requested)
{
    $labels = [
        'pay' => 'Pay the balance',
        'invoice' => 'View your invoice',
        'register' => 'Add your guest details',
    ];
    $ok = [];
    $refused = [];
    $seen = [];
    foreach (is_array($requested) ? $requested : [] as $id) {
        $id = (string) $id;
        if (isset($seen[$id])) {
            continue;
        }
        $seen[$id] = true;
        if (!isset($labels[$id])) {
            $refused[] = ['id' => $id, 'label' => $id, 'why' => 'Unknown button.'];
            continue;
        }
        $why = '';
        if ($ctx !== 'booking') {
            $why = 'Buttons need a booking — this is still an enquiry.';
        } elseif ($id === 'pay') {
            if ((float) ($facts['due'] ?? 0) <= 0.001) {
                $why = 'Nothing is owed — this stay is paid in full.';
            } elseif (($facts['rail'] ?? 'card') !== 'card') {
                $why = 'This guest pays by transfer — the invoice carries your bank details instead.';
            } elseif (empty($facts['square'])) {
                $why = 'Card payments are switched off.';
            }
        } elseif ($id === 'register') {
            if (!empty($facts['regDone'])) {
                $why = 'Guest details are already submitted — asking again would read as a mistake.';
            } elseif (!empty($facts['stayOver'])) {
                $why = 'The stay is over.';
            }
        }
        // invoice: every booking has one, and off the card rail it is the page
        // that carries the bank details — no further condition.
        if ($why === '') {
            $url = (string) ($facts['urls'][$id] ?? '');
            if ($url === '') {
                $why = 'No link available for this booking.';
            }
        }
        if ($why !== '') {
            $refused[] = ['id' => $id, 'label' => $labels[$id], 'why' => $why];
            continue;
        }
        $ok[] = ['id' => $id, 'label' => $labels[$id], 'url' => $facts['urls'][$id]];
    }
    return ['actions' => $ok, 'refused' => $refused];
}

// The facts email_reply_actions() decides on, resolved from a live booking row.
// Impure on purpose — the ledger-backed balance, the register count and the
// signed URLs — so the decision above stays pure. Degrades safe: an unreadable
// register counts as NOT submitted (a second ask is the smaller harm), and an
// unreadable balance as nothing owed (the pay button stands down rather than
// asking for money nothing can verify).
function email_reply_facts($b)
{
    $id = (int) ($b['id'] ?? 0);
    $due = 0.0;
    try {
        if (function_exists('booking_amount_due')) {
            $due = (float) (booking_amount_due($b, 'balance')['due'] ?? 0);
        }
    } catch (\Throwable $e) {
    }
    $regDone = false;
    try {
        $s = db()->prepare('SELECT COUNT(*) FROM guest_registrations WHERE booking_id = ?');
        $s->execute([$id]);
        $regDone = (int) $s->fetchColumn() > 0;
    } catch (\Throwable $e) {
    }
    return [
        'due' => $due,
        'rail' => payment_rail($b),
        'square' => function_exists('square_enabled') && square_enabled() && function_exists('pay_token'),
        'regDone' => $regDone,
        'stayOver' => !empty($b['check_out']) && (string) $b['check_out'] < date('Y-m-d'),
        'urls' => $id > 0
            ? [
                'pay' => site_base_url() . 'index.html?pay=' . pay_token($id) . '&b=' . $id,
                'invoice' => site_base_url() . 'invoice.php?b=' . $id . '&token=' . invoice_token($id),
                'register' => site_base_url() . 'guest-details.php?b=' . $id . '&token=' . guest_reg_token($id),
            ]
            : [],
    ];
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
        'New enquiry: ' . ($e['name'] ?: 'Someone') . ' — ' . $prop . ', ' . email_date($e['check_in']) . ' to ' . email_date($e['check_out']);

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
        ? 'Arrive ' . email_time($e['check_in_time'] ?: '15:00') . ' · leave ' . email_time($e['check_out_time'] ?: '10:00')
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
        'Dates: ' . email_date($e['check_in'] ?? '') . ' to ' . email_date($e['check_out'] ?? '') . "\n" .
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

    // Detail rows in the HOUSE block (email_rows), like every other summary in
    // this file — this composer had its own 13px/14px table, the twin of the one in
    // build_enquiry_reply_email, so the owner's copy and the guest's copy of the
    // same facts were laid out by two different pieces of code.
    //
    // THE CONTACTS ARE TAPPABLE. This email is read on a phone, and deciding on an
    // enquiry often means ringing the guest — the address and number were plain
    // text, so that meant copying a number out of an email by hand. mailto:/tel:
    // (tel: strips everything but digits and a leading +, since the owner's guests
    // type numbers with spaces and brackets).
    $dRows = [];
    $gEmail = trim((string) ($e['email'] ?? ''));
    if ($gEmail !== '') {
        $dRows[] = ['Email', '<a href="mailto:' . email_esc($gEmail) . '" style="color:#2E2A25;">' . email_esc($gEmail) . '</a>'];
    }
    $gPhone = trim((string) ($e['phone'] ?? ''));
    if ($gPhone !== '') {
        $tel = preg_replace('/[^0-9+]/', '', $gPhone);
        $dRows[] = ['Phone', '<a href="tel:' . email_esc($tel) . '" style="color:#2E2A25;">' . email_esc($gPhone) . '</a>'];
    }
    if ($addr !== '') {
        $dRows[] = ['Address', '<a href="' . email_esc(email_maplink($addr)) . '" style="color:#2E2A25;">' . email_esc($addr) . '</a>'];
    }
    if ($times !== '') {
        $dRows[] = ['Times', email_esc($times)];
    }
    if ($party !== '') {
        $dRows[] = ['Party', email_esc($party)];
    }
    if ($priceLine !== '') {
        $dRows[] = ['Est. price', email_esc($priceLine)];
    }

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
            email_esc(email_date($e['check_in'] ?? '') . ' to ' . email_date($e['check_out'] ?? '')) . ' &middot; ' . email_esc($party),
            true,
        ) .
        ($dRows ? email_rows($dRows) : '') .
        (!empty($e['message']) ? email_note(email_esc($e['message'])) : '') .
        // A DECISION IS TWO BUTTONS. Approve was a 44px button and Decline a bare
        // grey inline link inside a muted paragraph — so of the two outcomes this
        // email exists to offer, one was an affordance and the other was a footnote
        // the size of the small print, on a phone. They are a pair now: the same tap
        // target, the primary weight still on the one that makes money.
        email_btn($e['approve_url'], 'Review & approve') .
        email_btn2($e['decline_url'], 'Decline this enquiry') .
        email_footnote('Each link opens a confirmation page first &mdash; nothing happens until you press the button there.');
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
        $body .= 'Check in:  ' . email_date($b['check_in']) . ' from ' . email_time($b['check_in_time']) . "\n";
        $body .= 'Check out: ' . email_date($b['check_out']) . ' by ' . email_time($b['check_out_time']) . "\n";
        $body .= "Party: {$party}\n";
        $body .= "Payment: {$paymentLabel}\n";
        $body .= "Address: {$b['address']}\n";
        if (trim((string) $b['address']) !== '') {
            $body .= 'Directions: ' . email_maplink($b['address']) . "\n";
        }
        $body .= "\n";
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
            $dueByLine = ' — due by ' . email_date((string) $b['balance_due_date']);
        }
        if ($paidNow > 0) {
            $body .= "\nPaid so far: " . $money($paidNow) . "\n";
            $body .= ($balNow > 0.001 ? 'Balance remaining: ' . $money($balNow) . $dueByLine : 'Paid in full — thank you!') . "\n";
        } elseif ($balNow > 0.001 && $dueByLine !== '') {
            // Nothing paid yet: still say when the money is wanted, because this
            // is the email that lands before any of it has been asked for.
            $body .= "\nBalance of " . $money($balNow) . $dueByLine . ".\n";
        }
        if ($balNow > 0.001 && !empty($b['id']) && payment_rail($b) === 'card' && function_exists('square_enabled') && square_enabled() && function_exists('pay_token')) {
            $body .= "\nPay the balance: " . site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'] . "\n";
        }
        $body .= "\nYour booking page: " . site_base_url() . "index.html?open=stay\n";
        if (!empty($b['invoice_url'])) {
            $body .= "\nView or download your invoice: " . $b['invoice_url'] . "\n";
        }
        if (!empty($b['guest_reg_url'])) {
            $body .= "\nBefore you arrive, please add your guest details (a UK legal requirement — full name & nationality of everyone 16+): " . $b['guest_reg_url'] . "\n";
        }
        $body .= "\n";
        $body .= "If you have any questions, just reply to this email.\nCottage Holidays Blakeney\n";

        // The pay button + a way back to the booking. Both suppressed when there is
        // nothing outstanding, and the card button also when the guest is not on the card
        // rail or Square is off — an email must never offer a card link to a guest whose
        // money the owner collects by hand.
        $stayUrl = site_base_url() . 'index.html?open=stay';
        $payCta = '';
        if (
            $balNow > 0.001 &&
            !empty($b['id']) &&
            payment_rail($b) === 'card' &&
            function_exists('square_enabled') &&
            square_enabled() &&
            function_exists('pay_token')
        ) {
            $payCta = email_btn(
                site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'],
                'Pay the balance',
                $accent,
            );
        }
        $payCta .= email_btn2($stayUrl, 'View my booking');
        // HTML version — "Midnight Glass" shell + the booking "stay ticket".
        // NB the payment colour is NOT re-derived here. It was, with the greens and
        // ambers from the dark UPCOMING chip below — which are right on #22321f and
        // were then used as text on a WHITE row, measuring 2.23:1 for the word
        // "Unpaid". The pair derived for the text half twelve lines up is the
        // correct one and is still in scope, so this shadow is simply gone.
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
                ? $pr('Agreed price for your stay <span style="color:' . email_muted_ink() . ';">(' . $nightsTxt . ')</span>', $money($b['total']))
                : $pr($money($b['per_night']) . ' &times; ' . $nightsTxt, $money($b['nightly'])) .
                  $pr('Transaction fee (' . $esc($b['tx_pct']) . '%)', $money($b['tx_fee']))) .
            ($depAmt > 0 ? $pr('Refundable damages deposit', $money($depAmt)) : '') .
            '<tr><td colspan="2" style="border-top:1px solid #ECE4D3;font-size:0;line-height:0;">&nbsp;</td></tr>' .
            '<tr><td style="padding:12px 0 4px;font-family:' .
            $serif .
            ';font-size:19px;font-weight:700;color:#2A2622;">Total' . ($depAmt > 0 ? ' <span style="font-size:12px;font-weight:400;color:' . email_muted_ink() . ';">(incl. deposit)</span>' : '') . '</td><td align="right" style="padding:12px 0 4px;font-family:' .
            $serif .
            ';font-size:21px;font-weight:700;color:#2A2622;">' .
            $money($grandTotal) .
            '</td></tr>' .
            // (the refundable-deposit sentence is a FOOTNOTE under this box, not a row
            // inside it — as a label/value pair one sentence wrapped 2+2 lines on a
            // phone and read as a label beside a value)
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
            ';font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' . email_muted_ink() . ';margin:2px 0 16px;">Booking ref ' .
            $esc($b['ref']) .
            ' &nbsp;&middot;&nbsp; ' .
            $statusBadge .
            '</div>' .
            email_p('Dear ' . $esc(first_name($b['name'], 'Guest')) . ', good news — your stay is confirmed. Here are the details:') .
            email_rows([
                ['Arrive', '<strong>' . email_date($b['check_in']) . '</strong> &middot; from ' . email_time($b['check_in_time'])],
                ['Leave', '<strong>' . email_date($b['check_out']) . '</strong> &middot; by ' . email_time($b['check_out_time'])],
                ['Party', $esc($party)],
                ['Payment', '<span style="color:' . $paymentColor . ';font-weight:600;">' . $paymentLabel . '</span>'],
            ]) .
            // An address is its own block with a Maps link, not a value squeezed into
            // the 40/60 grid — where a long one wrapped to three right-aligned lines.
            email_address_block($b['address'] ?? '') .
            $priceBox .
            // A STATED BALANCE GETS A WAY TO PAY IT. This email carried no link at all
            // while telling the guest what they still owed, and it is the one they keep
            // and re-open. The pay link is the same login-free token the chaser uses, so
            // no new way in; it is offered only when there IS something to pay and the
            // card rail is the guest's (an owner-arranged stay is settled by hand — the
            // bookingOwnerArranged rule).
            $payCta .
            (!empty($b['invoice_url']) ? email_btn2($b['invoice_url'], 'View your invoice') : '') .
            (!empty($b['guest_reg_url']) ? email_p('<strong>Before you arrive:</strong> UK law asks us to record the name &amp; nationality of everyone staying who is 16 or over. Please add your guest details — it only takes a minute.', true) . email_btn($b['guest_reg_url'], 'Add your guest details', $accent, '#ffffff') : '') .
            ($depAmt > 0
                ? email_footnote(
                    'The ' . $money($depAmt) .
                        ' deposit is refundable — charged with your first payment and returned in full after checkout, provided there&rsquo;s no damage.',
                )
                : '') .
            email_footnote(htmlspecialchars(cancellation_policy_line($b['prop_key'] ?? ''), ENT_QUOTES, 'UTF-8')) .
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
        $subject = "New confirmed booking — {$b['prop_name']} (" . email_date($b['check_in']) . ")";
        $body = "A booking has just been confirmed.\n\n";
        $body .= "Reference: {$b['ref']}\n";
        $body .= "Property: {$b['prop_name']}\n";
        $body .= "Guest: {$b['name']}\n";
        $body .= 'Email: ' . ($b['email'] ?: '—') . "\n";
        $body .= 'Phone: ' . ($b['phone'] ?? '—') . "\n";
        $body .= 'Check in:  ' . email_date($b['check_in']) . ' (' . email_time($b['check_in_time']) . ")\n";
        $body .= 'Check out: ' . email_date($b['check_out']) . ' (' . email_time($b['check_out_time']) . ")\n";
        $body .= "Stay: {$nightsTxt}\n";
        $body .= "Guests: {$party}\n";
        $ownerDep = round((float) ($b['damages_deposit'] ?? 0), 2);
        $ownerTotal = $money(round((float) $b['total'] + $ownerDep, 2));
        $body .= 'Total: ' . $ownerTotal . ($ownerDep > 0 ? ' (incl. deposit)' : '') . "\n";
        $hubUrl = !empty($b['id']) ? site_base_url() . '?open=booking-' . (int) $b['id'] : '';
        if ($hubUrl !== '') {
            $body .= "\nOpen the booking: {$hubUrl}\n";
        }

        // AN HTML HALF, WITH THE CONTACTS TAPPABLE AND THE BOOKING ONE TAP AWAY.
        // This notification was plain text only — the sole email in the file with
        // no HTML — so the guest's phone number was characters to be copied by
        // hand, the guest's email likewise, and the booking it announces could
        // only be found by opening the app and searching for the name. The owner
        // reads this on a phone the moment it arrives, which is exactly when
        // ringing the guest or opening the record is what they want to do.
        // (`?open=booking-<id>` is the existing notification-deep-link vocabulary
        // — maybeHandleNotificationOpen in app.js routes it through the facade
        // stubs, so it works arriving cold.)
        $oRows = [['Reference', email_esc((string) $b['ref'])], ['Cottage', email_esc((string) $b['prop_name'])]];
        $oGuestEmail = trim((string) ($b['email'] ?? ''));
        if ($oGuestEmail !== '') {
            $oRows[] = ['Email', '<a href="mailto:' . email_esc($oGuestEmail) . '" style="color:#2E2A25;">' . email_esc($oGuestEmail) . '</a>'];
        }
        $oGuestPhone = trim((string) ($b['phone'] ?? ''));
        if ($oGuestPhone !== '') {
            $oRows[] = [
                'Phone',
                '<a href="tel:' . email_esc(preg_replace('/[^0-9+]/', '', $oGuestPhone)) . '" style="color:#2E2A25;">' . email_esc($oGuestPhone) . '</a>',
            ];
        }
        $oRows[] = ['Arrive', '<strong>' . email_esc(email_date($b['check_in'])) . '</strong> &middot; ' . email_esc(email_time($b['check_in_time']))];
        $oRows[] = ['Leave', '<strong>' . email_esc(email_date($b['check_out'])) . '</strong> &middot; ' . email_esc(email_time($b['check_out_time']))];
        $oRows[] = ['Stay', email_esc($nightsTxt)];
        $oRows[] = ['Guests', email_esc($party)];
        $oRows[] = ['Total', '<strong>' . email_esc($ownerTotal . ($ownerDep > 0 ? ' incl. deposit' : '')) . '</strong>'];
        $oInner =
            email_h('New confirmed booking', $accent) .
            email_p(
                '<strong style="color:#2A2622;">' . email_esc((string) $b['name']) . '</strong> is confirmed at <strong style="color:#2A2622;">' .
                    email_esc((string) $b['prop_name']) . '</strong>.',
            ) .
            email_rows($oRows) .
            ($hubUrl !== '' ? email_btn($hubUrl, 'Open the booking', $accent) : '');
        $oHtml = email_shell(
            $b['name'] . ' — ' . $b['prop_name'] . ', ' . email_date($b['check_in'], false),
            $oInner,
            $accent,
        );

        if (!empty($b['defer_owner'])) {
            // The caller only needs the GUEST result (that's what the UI shows);
            // the owner copy can go out after the response has been flushed, so
            // the save isn't kept waiting on a second SMTP handshake.
            mail_after_response(function () use ($subject, $body, $oHtml) {
                send_owner($subject, $body, $oHtml);
            });
            $out['owner'] = ['ok' => true, 'deferred' => true];
        } else {
            $out['owner'] = send_owner($subject, $body, $oHtml);
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
    // Derive the cottage name rather than depending on the caller to pass prop_name —
    // prop_display() is right here and 'your cottage' is a poor thing to send someone.
    $prop = trim((string) ($b['prop_name'] ?? '')) !== ''
        ? $b['prop_name']
        : (prop_display($b['prop_key'] ?? '')['name'] ?: 'your cottage');
    $inDate = email_date($b['check_in']);
    $outDate = !empty($b['check_out']) ? email_date($b['check_out']) : '';
    $time = email_time($b['check_in_time'] ?: '15:00');
    $outTime = email_time($b['check_out_time'] ?: '10:00');
    $addr = trim($b['address'] ?? '');
    $phone = email_phone();
    // THE INSTRUCTION AND THE WAY TO FOLLOW IT TRAVEL TOGETHER. This email said "log in
    // to your account on our website and open My Bookings" and carried NO LINK — read on
    // a phone on the way to Norfolk, with nothing to tap. The entry code itself is still
    // never emailed (see send_arrival_for_booking); the guest reveals it in-app once
    // they're there. What changed is that the app is now one tap away.
    $stayUrl = site_base_url() . 'index.html?open=stay';

    $subject = "You arrive {$inDate} — everything you need for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Arrive: {$inDate}, any time from {$time}\n" .
        ($outDate !== '' ? "Leave:  {$outDate}, by {$outTime}\n" : '') .
        "\n" .
        ($addr !== '' ? "Address:\n{$addr}\nDirections: " . email_maplink($addr) . "\n\n" : '') .
        "Your entry details appear on your booking page once you're here:\n{$stayUrl}\n\n" .
        ($phone !== '' ? "Trouble getting in, or running late? Call {$phone} — or just reply to this email.\n\n" : "Running late or stuck? Just reply to this email.\n\n") .
        "We look forward to seeing you.\n\nCottage Holidays Blakeney";

    $rows = [
        [
            'Arrive',
            '<strong>' . $inDate . '</strong><br><span style="font-weight:400;color:' . email_muted_ink() . ';">any time from ' . $time . '</span>',
        ],
    ];
    // Check-out was absent from this email entirely, and it is the second thing guests
    // forget.
    if ($outDate !== '') {
        $rows[] = [
            'Leave',
            '<strong>' . $outDate . '</strong><br><span style="font-weight:400;color:' . email_muted_ink() . ';">by ' . $outTime . '</span>',
        ];
    }
    $inner =
        email_h('You arrive ' . email_date($b['check_in'], false), $accent) .
        email_p(
            'Hello ' . email_esc($name) . ' — everything you need for <strong>' .
                email_esc($prop) . '</strong> is below. We look forward to seeing you.',
        ) .
        email_rows($rows) .
        email_address_block($addr) .
        email_note(
            '<strong style="color:#2A2622;">Your entry details</strong><br>They appear on your booking page once you&rsquo;re here — tap below and open <strong style="color:#2A2622;">Your stay</strong>.',
            $accent,
        ) .
        email_btn($stayUrl, 'Open my booking') .
        email_footnote(
            $phone !== ''
                ? 'Trouble getting in, or running late? Call <a href="tel:' .
                    email_esc(preg_replace('/\s+/', '', $phone)) .
                    '" style="color:#8A5A2B;">' . email_esc($phone) . '</a> — or just reply to this email.'
                : 'Running late or stuck? Just reply to this email and we&rsquo;ll help.',
        );
    $html = email_shell(
        'You arrive ' . email_date($b['check_in'], false) . ' — address, times and your entry details.',
        $inner,
        $accent,
    );

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
        "It works once and expires in 30 minutes — ask for a fresh one any time.\n" .
        "If you didn't request it, you can safely ignore this email.\n\n" .
        'Cottage Holidays Blakeney';

    // THE LINK ITSELF IS PRINTED, not only wrapped in a button. A sign-in email is
    // the one email a guest is most likely to open on a DIFFERENT device from the
    // one they want to sign in on (asked for on a laptop, read on a phone), and it
    // is also the one most likely to be read in a client that strips the VML
    // button. A tappable button with no visible URL beside it is then a dead end
    // with nothing to copy. The URL is deliberately printed in full rather than
    // truncated: a shortened sign-in link cannot be pasted, which defeats the point.
    $inner =
        email_h('Sign in to your account', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', tap the button below to sign in to your Cottage Holidays Blakeney account — no password needed.',
        ) .
        email_btn($url, 'Sign me in', $accent) .
        email_footnote(
            'Button not working, or reading this on another device? Copy this link into your browser:<br>' .
                '<span style="word-break:break-all;color:#6b6b6b;">' . $esc($url) . '</span>',
        ) .
        // WHAT THE GUEST NEEDS TO KNOW BEFORE THEY TAP: that it is single-use. A
        // link that silently stops working on the second tap reads as broken —
        // saying so up front turns "it didn't work" into "I need a fresh one",
        // which the same sentence tells them how to get.
        email_footnote(
            'It works once and expires in 30 minutes — if it has gone stale, just ask for a new one. ' .
                'If you didn&rsquo;t request this, you can safely ignore this email.',
        );
    $html = email_shell('Your secure sign-in link — works once, expires in 30 minutes', $inner, $accent);

    return smtp_send($g['email'], $name, $subject, $text, $html);
}

// THE COTTAGE'S OWN PAGE. The two "come back" emails both sent the guest to the
// HOMEPAGE — so an email naming Jollyboat, carrying Jollyboat's photo and its
// accent, landed on a page listing three cottages and asked them to find it
// again. cottage.php serves /cottages/<slug> (see htaccess.txt) with that
// cottage's live price, calendar and photos, which is the page the email is
// actually about. Falls back to the site root when there is no slug, so a
// cottage added before the migration still gets a working link.
function email_cottage_url($propKey)
{
    $base = function_exists('site_base_url') ? site_base_url() : '';
    if ($base === '') {
        return '';
    }
    $slug = function_exists('prop_display') ? trim((string) (prop_display((string) $propKey)['slug'] ?? '')) : '';
    return $slug !== '' ? rtrim($base, '/') . '/cottages/' . rawurlencode($slug) : $base;
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

    // THE DEADLINE BELONGS BESIDE THE FIGURE. On a BALANCE ask the booking's
    // balance_due_date is this payment's own deadline — and it was stated nowhere
    // in this email, because payment_plan_line answers a different question (when
    // the REMAINDER is wanted, which on a balance ask is nothing, so it returns
    // ''). So the one email whose whole job is "please settle up by then" never
    // said by when. It rides the amount block's sub, where the guest is already
    // looking, rather than a sentence further down.
    $dueBy = substr((string) ($b['balance_due_date'] ?? ''), 0, 10);
    $askDeadline = $b['kind'] === 'balance' && $dueBy !== '' ? 'Due by ' . email_date($dueBy) : '';

    // THE WHOLE PICTURE, AS A PANEL. All of this was one run-on paragraph — "The
    // full stay total is £750.00 (including the refundable deposit). Already paid:
    // £225.00 (including your £50.00 refundable deposit). The remaining £292.50 is
    // due by Fri 14 Aug 2026." — three figures a guest has to hold in their head to
    // check the fourth, set as prose. The same facts as rows are scanned, not read,
    // and they visibly add up. The text half keeps the sentences: plain text has no
    // table, and prose is the right form there.
    $sumRows = [['Stay total', '<strong>' . $esc($money($f['stayTotal'])) . '</strong>']];
    if ($f['paid'] > 0.005) {
        $sumRows[] = ['Already paid', $esc($money($f['paid']))];
    }
    $sumRows[] = [
        $f['damages'] > 0 ? 'Paying now (including the deposit)' : 'Paying now',
        '<strong>' . $esc($money($f['chargedNow'])) . '</strong>',
    ];
    if ($f['restAfter'] > 0.005) {
        $sumRows[] = [
            'Still to come' . ($dueBy !== '' ? ', by ' . $esc(email_date($dueBy)) : ''),
            $esc($money($f['restAfter'])),
        ];
    }
    $sumHtml = email_money_rows($sumRows);

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
            // A SCHEDULE COLUMN STAYS NUMERIC. Every other date in these emails is
            // spoken (email_date) because it is read once and acted on; these are read
            // AGAINST EACH OTHER — four dates stacked in one column — and DD/MM/YYYY is
            // fixed-width, so the rows align and the interval between them is legible
            // at a glance. A spoken column ('Sat 29 Aug 2026' over 'Mon 28 Sep 2026')
            // is ragged and reads as prose repeated four times.
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
        "Thank you for booking {$prop} (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . ").\n\n" .
        $cta['text'] .
        $depositLineText .
        "\n\n" .
        ($askDeadline !== '' ? $askDeadline . ".\n\n" : '') .
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
                $esc(email_date($b['check_in'])) .
                ' to ' .
                $esc(email_date($b['check_out'])) .
                ').',
        ) .
        email_amount(
            $f['payLabel'],
            $money($f['chargedNow']),
            ($f['paySub'] !== '' ? $f['paySub'] . '<br>' : '') .
                ($askDeadline !== '' ? '<strong>' . $esc($askDeadline) . '</strong><br>' : '') .
                $esc($f['contextLine']),
        ) .
        // THE ACTION COMES BEFORE THE ARITHMETIC. The pay button used to sit below
        // the deposit explanation; a guest who has already decided to pay should not
        // have to read past a paragraph about a refundable deposit to reach it. The
        // panel and the small print follow for the guest who wants to check.
        $cta['html'] .
        $sumHtml .
        ($damages > 0
            ? email_footnote(
                'The <strong>' . $money($damages) . '</strong> security deposit is refundable &mdash; it comes back to you after checkout.',
            )
            : '') .
        ($planLine !== '' ? email_footnote($esc($planLine)) : '') .
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
    return 'The remaining ' . $money($rest) . ' is due by ' . email_date($due) . '.';
}

// A gentler nudge for a balance that's been requested but not yet paid, sent in
// the run-up to arrival. Same rail as the request; warmer copy + days-until-arrival.
function payment_reminder_body($b, $payUrl, $accent, $bacs)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    // ANCHORED AT UTC MIDNIGHT, like pricing.php and bookings.php already are.
    // Both timestamps were LOCAL under Europe/London, so an interval spanning the
    // spring-forward Sunday is N*86400 − 3600 seconds and floor() returns N−1: the
    // reminder told a guest "your arrival is in 6 days" for a stay 7 days away.
    // (Autumn is harmless — the extra hour rounds down inside the same day.) The
    // reminder pass runs for arrivals 3–14 days out, so late March is squarely in
    // its window. Verified: 2027-03-26 → 2027-04-02 now yields 7, was 6.
    $days = max(0, (int) floor((strtotime($b['check_in'] . ' UTC') - strtotime(date('Y-m-d') . ' UTC')) / 86400));
    $when = $days <= 1 ? 'tomorrow' : "in {$days} days";
    $rail = payment_rail($b);
    // The SAME facts the request stated, so the chase cannot quote a smaller sum
    // than the one the card will take — including in the CTA, which used to name
    // the rental half while the deposit sentence beneath added the rest.
    $f = payment_money_facts($b, 'balance');
    $cta = payment_cta($rail, $payUrl, $bacs, 'Please pay ' . $money($f['chargedNow']));
    // The SAME deadline treatment the request now gets — this is the email that
    // chases it, so it is the last email that should leave the date unstated.
    $dueBy = substr((string) ($b['balance_due_date'] ?? ''), 0, 10);
    $askDeadline = $dueBy !== '' ? 'Due by ' . email_date($dueBy) : '';
    // And the SAME panel, for the same reason: three figures that have to reconcile
    // are read as rows, not as a sentence. One composer's worth of rows would be
    // ideal, but the two emails legitimately show different sets (a reminder has no
    // "still to come" — the balance IS the remainder), so they share the FACTS
    // (payment_money_facts) rather than the layout, which is where the drift risk
    // actually lives.
    $sumRows = [['Stay total', '<strong>' . $esc($money($f['stayTotal'])) . '</strong>']];
    if ($f['paid'] > 0.005) {
        $sumRows[] = ['Already paid', $esc($money($f['paid']))];
    }
    $sumRows[] = [
        $f['damages'] > 0 ? 'Still to pay (including the deposit)' : 'Still to pay',
        '<strong>' . $esc($money($f['chargedNow'])) . '</strong>',
    ];

    $subject = "Reminder: balance due for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Just a friendly reminder that the balance for your stay at {$prop} is still outstanding, " .
        "and your arrival is {$when} (" . email_date($b['check_in']) . ").\n\n" .
        ($askDeadline !== '' ? $askDeadline . ".\n\n" : '') .
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
                $esc(email_date($b['check_in'])) .
                ').',
        ) .
        email_amount(
            $f['payLabel'],
            $money($f['chargedNow']),
            ($f['paySub'] !== '' ? $f['paySub'] . '<br>' : '') .
                ($askDeadline !== '' ? '<strong>' . $esc($askDeadline) . '</strong><br>' : '') .
                $esc($f['contextLine']),
        ) .
        $cta['html'] .
        email_money_rows($sumRows) .
        ($f['depositTail'] !== '' ? email_footnote($esc($f['depositTail'])) : '') .
        email_footnote('Already paid? Thank you &mdash; please ignore this.') .
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

    // THE SUBJECT HAS TO SAY IT ISN'T A CHARGE. "Refundable card hold" was read
    // in the inbox by a guest who has already paid a deposit, and the word it
    // lands on is "card" — so the reassurance that the whole email exists to give
    // arrived only after they opened it worried. It leads now, in both the subject
    // and the preheader.
    $subject = "Nothing to pay — a refundable card hold for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Ahead of your stay at {$prop} (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . "), please place the refundable " .
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
                $esc(email_date($b['check_in'])) .
                ' to ' .
                $esc(email_date($b['check_out'])) .
                ') please place the refundable security hold on your card.',
        ) .
        email_amount('Refundable hold', $money($b['amount']), 'held, not charged') .
        // WHAT IT IS, BEFORE THE BUTTON THAT DOES IT. This paragraph sat BELOW the
        // button, so a guest being asked to put £250 against their card had to tap
        // first and read the reassurance second. Nothing else in these emails asks
        // for an authorisation, so this is the one place the order matters.
        email_note(
            'This is a <strong>hold, not a charge</strong> &mdash; the amount is set aside on your card and released after checkout, provided there&rsquo;s no damage.',
        ) .
        email_btn($url, 'Place the card hold') .
        email_footnote('Powered by Square &mdash; we never see or store your card number.') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('A refundable hold on your card — nothing is charged', $inner, $accent);
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
        "It usually clears from your statement in 3-5 working days, though some banks take a little longer.\n\n" .
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
        email_amount('Hold released', $money($b['amount']), '', email_accent_ink()) .
        // A NUMBER, NOT "A FEW". This email exists to stop the guest wondering, and
        // "a few working days" is exactly vague enough to leave them checking their
        // statement daily and then emailing to ask. 3-5 working days is the honest
        // range for a released authorisation, and the hedge that follows it is about
        // their bank rather than about us.
        email_footnote('It usually clears from your statement in 3&ndash;5 working days, though some banks take a little longer.') .
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
        (!empty($b['check_in']) ? " (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . ")" : '') .
        ".\n\n" .
        ($reason !== '' ? "A note from " . email_host_name() . ": {$reason}\n\n" : '') .
        "It's been sent back to the card you paid with, and usually appears in 3-5 working days,\n" .
        "though some banks take a little longer.\n\n" .
        "Any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Refund on its way', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', we\'ve issued a refund for your booking at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc(email_date($b['check_in'])) . ' to ' . $esc(email_date($b['check_out'])) . ')' : '') .
                '.',
        ) .
        email_amount('Refund', $money($b['amount']), '', email_accent_ink()) .
        // "REASON:" IS A FORM FIELD, NOT A SENTENCE. That box is a note the owner
        // wrote for their own records, and rendering it under a bold "Reason:" made
        // the SITE appear to be justifying itself to the guest — in the register of
        // a rejection letter, on an email about money going back. Attributed to the
        // person who wrote it, the same words read as what they are.
        email_ownernote(email_host_name(), $reason) .
        email_footnote(
            'It&rsquo;s on its way back to the card you paid with, and usually appears in 3&ndash;5 working days &mdash; though some banks take a little longer.',
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
        ($retained > 0.001 ? 'Retained: ' . $money($retained) . ' of the ' . $money($held) . " held.\n" : '') .
        ($retained > 0.001 && $reason !== '' ? "\nA note from " . email_host_name() . ": {$reason}\n" : '') .
        "\nIt usually appears in 3-5 working days, though some banks take a little longer.\n\n" .
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
        email_amount('Deposit returned', $money($b['amount']), $esc('Sent ' . $how), email_accent_ink()) .
        // A PART-RETURN HAS TO SHOW ITS ARITHMETIC. "Amount retained: £25.00" told
        // the guest a figure and left them to work out what it was a share of — on
        // the one email most likely to be queried. The rows state held, retained and
        // returned so the three visibly reconcile, and the owner's explanation is
        // attributed to them (the "Reason:" note above) rather than presented as the
        // site's ruling.
        ($retained > 0.001
            ? email_money_rows([
                ['Deposit held', $esc($money($held))],
                ['Retained', $esc($money($retained))],
                ['Returned to you', '<strong>' . $esc($money($b['amount'])) . '</strong>'],
            ]) . email_ownernote(email_host_name(), $reason)
            : '') .
        email_footnote('It usually appears in 3&ndash;5 working days, though some banks take a little longer.') .
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
    // THE HOST'S NAME ARRIVES ON THE PAYLOAD, not from a content_value() call in
    // here — this builder is PURE by design (test-payrail drives it with no
    // database, the same reason payment_request_body takes $bacs as an argument).
    // Empty falls back to email_ownernote's own "A note from us".
    $host = trim((string) ($b['host_name'] ?? ''));
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
        (!empty($b['check_in']) ? " (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . ")" : '') .
        " has been cancelled.\n\n" .
        ($reason !== '' ? 'A note from ' . ($host !== '' ? $host : 'us') . ": {$reason}\n\n" : '') .
        ($refundLine !== '' ? $refundLine . "\n\n" : '') .
        ($depLine !== '' ? $depLine . "\n\n" : '') .
        ($refundLine !== '' || $depLine !== ''
            ? "Card refunds usually appear in 3-5 working days, though some banks take a little longer.\n\n"
            : '') .
        "If you have any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Booking cancelled') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', your booking at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc(email_date($b['check_in'])) . ' to ' . $esc(email_date($b['check_out'])) . ')' : '') .
                ' has been cancelled.',
        ) .
        // The owner's note, attributed — see send_refund_email. On a CANCELLATION the
        // register matters more than anywhere else: "Reason: guest changed their
        // mind" set as the email's own bold heading reads like a file being closed
        // on someone.
        email_ownernote($host, $reason) .
        ($refundLine !== '' ? email_note($esc($refundLine)) : '') .
        ($depLine !== '' ? email_note($esc($depLine)) : '') .
        // Money going back is the one thing this email leaves the guest waiting on,
        // so it says how long — the same 3-5 working days every other refund email
        // now states, and stated only when something is actually coming back.
        ($refundLine !== '' || $depLine !== ''
            ? email_footnote('Card refunds usually appear in 3&ndash;5 working days, though some banks take a little longer.')
            : '') .
        email_p('If you have any questions, just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Booking cancelled — ' . $prop, $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html, 'name' => $name];
}
function send_cancellation_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    // Resolve the DB-backed bits HERE, so the builder above stays pure.
    $m = send_cancellation_email_body($b + ['host_name' => email_host_name()]);
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
    $when = email_date($noticeDate !== '' ? $noticeDate : (string) ($b['autopay_due'] ?? ''));
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
                ? ($apN - $pos) . ' more monthly payment' . ($apN - $pos === 1 ? ' follows' : 's follow') . ', the last on ' . email_date(end($sched)) . " — and then your stay is all paid."
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
    $retryIso = date('Y-m-d', strtotime($today . ' +' . $retryDays . ' days'));
    // Two forms of one date, for the two places it is read. The SENTENCE gets the
    // spoken form ("we'll try again on Sat 29 Aug 2026" — a day the guest can plan
    // around); the schedule ROW gets the numeric one, so it stays flush with the
    // other payment dates stacked above and below it in that column.
    $retry = email_date($retryIso);
    $retryNum = uk_date($retryIso);
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
                // Numeric for the same reason as the offer schedule above.
                'Payment ' . ($i + 1) . ' — ' . uk_date($d),
                $d < $failDate
                    ? 'paid ✓'
                    : ($d === $failDate
                        ? $money($amt) . ' — declined' . ($stopped ? '' : ', retrying ' . $retryNum)
                        : $future . ($i + 1 === $apN ? ' · final' : '')),
            ];
        }
    } else {
        $rows = [['Amount', $money($amt)], ['Tried on', email_date($today)], ['Cottage', $esc($prop)]];
    }
    $subject =
        ($monthly && $ofN !== '' ? ucfirst($ofN) . " didn't go through" : "Your automatic payment didn't go through") .
        ' — ' .
        ($stopped ? "let's sort the card" : 'we\'ll try again on ' . $retry);
    // NOTHING WAS TAKEN, SAID BEFORE ANYTHING ELSE. "Your automatic payment didn't
    // go through" raises one fear first — that the card was hit anyway, or hit
    // twice — and the email answered every other question before that one. It is a
    // fact, not reassurance: a declined charge takes nothing.
    $happened =
        'we tried to take ' . $money($amt) . ' for your stay at ' . $prop . " today and it didn't go through — " . rtrim((string) $why, '.')
        . '. Nothing has been taken from your card, and your booking is completely safe.';
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
        email_footnote('Or pay this one now, your own way &mdash; the same page does both.') .
        ($tail !== '' ? email_footnote($esc($tail)) : '') .
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
    // WHAT HAPPENS NEXT, WITH A DATE AND A WAY TO DO IT. "We'll be in touch about
    // settling it before your stay" leaves the guest with nothing to act on and no
    // idea when — on a receipt, which is the email they keep and re-read. Three
    // things were missing and all three were already known at the call sites:
    // the booking's own due date, whether the rest is collected AUTOMATICALLY (in
    // which case "we'll be in touch" is simply wrong — nothing is needed from
    // them), and, on the card rail, the pay link.
    $dueBy = substr((string) ($b['balance_due_date'] ?? ''), 0, 10);
    $byWhen = $dueBy !== '' ? ' by ' . email_date($dueBy) : ' before your stay';
    $restLine = $auto
        ? 'Remaining balance: ' . $money($b['balance']) . '. We&rsquo;ll collect it automatically' . $byWhen . ' — nothing to do.'
        : 'Remaining balance: ' . $money($b['balance']) . '. You can settle it any time' . $byWhen . '.';
    $statusLine = !empty($b['fully_paid'])
        ? "Your booking is now paid in full. We can't wait to welcome you."
        : ((float) $b['balance'] <= 0.005
            ? "All that's left is your refundable damage deposit — we'll be in touch about taking it before your stay."
            : $restLine);
    // The plain-text half cannot carry an entity, so it gets its own copy of that
    // sentence. Same facts, one apostrophe apart.
    $statusText = str_replace('&rsquo;', "'", $statusLine);
    $payUrl = trim((string) ($b['pay_url'] ?? ''));
    $owes = empty($b['fully_paid']) && (float) $b['balance'] > 0.005;
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
        $statusText .
        "\n" .
        ($owes && $payUrl !== '' ? "\nPay the rest here: {$payUrl}\n" : '') .
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
        // A RECEIPT'S JOB IS THE FIGURE. It was stated only inside the greeting
        // sentence, at prose size, so the one thing the guest opens a receipt to
        // check — how much was taken — was the hardest thing on the page to find.
        // The label names the state (a slice is not its stage), and the sub carries
        // the running rental total, so the whole answer is one block.
        email_amount(
            $auto ? 'Collected' : ($partial ? 'Part payment received' : 'Payment received'),
            $money($paidNow),
            $esc('Rental paid so far: ' . $money($b['paid_so_far']) . ' of ' . $money($b['total'])),
        ) .
        ($depLine !== '' ? email_footnote($esc($depLine)) : '') .
        email_rows(
            array_filter([
                ['Reference', $esc($b['ref'])],
                $dep > 0 ? ['Refundable deposit', $money($dep) . ' (refunded after checkout)'] : null,
                ['Rental paid so far', $money($b['paid_so_far']) . ' of ' . $money($b['total'])],
            ]),
        ) .
        email_p($statusLine, true) .
        // WHICHEVER ACTION IS ACTUALLY WANTED LEADS. With money still owing the
        // primary action is paying it; the invoice is then the quiet one. With
        // nothing owing there is only the invoice, and it takes the primary slot
        // as it always did.
        ($owes && $payUrl !== '' ? email_btn($payUrl, 'Pay the rest now') : '') .
        (!empty($b['invoice_url'])
            ? ($owes && $payUrl !== ''
                ? email_btn2($b['invoice_url'], 'View your invoice')
                : email_btn($b['invoice_url'], 'View your invoice'))
            : '') .
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

// ============================================================
//  OWNER NOTES — the plain-text alerts, as PURE builders
// ============================================================
// These five emails composed INLINE in reviews.php / leads.php / experiences.php /
// webpush.php / diagnostics.php, which made them the only sends nothing could reach:
// email-samples.php had no way to preview them and test-emails-render.php had no way
// to render them, so a fatal in one shipped and the owner found out by not being told
// about a review. Their LOOK was never the problem — send_owner() already wraps a
// plain-text caller in owner_alert_text_html(), so they have carried the house shell
// all along; what they lacked was a function a sample could call without the route.
//
// Each returns ['subject' => …, 'text' => …] and takes everything as arguments (the
// pure-composer rule), so the gate drives the REAL builder with no DB and no SMTP.
// Plain text on purpose: owner_alert_text_html turns blank lines into paragraphs and
// bare URLs into links, which is the whole content of an alert like this.

/** A guest review submitted through the site, waiting for approval. */
function owner_note_review($guestName, $propName, $stars, $text)
{
    return [
        'subject' => 'New guest review awaiting approval',
        'text' =>
            'A review was submitted by ' . $guestName . ' for ' . $propName . ' (' . (int) $stars . "\u{2605}):\n\n" .
            trim((string) $text) .
            "\n\nApprove or decline it in Manage \u{2192} Guest reviews.",
    ];
}

/** A review left through the direct review LINK, which also carries contact details. */
function owner_note_lead($name, $propName, $stars, $text, $email, $phone = '')
{
    return [
        'subject' => 'New guest review awaiting approval',
        'text' =>
            $name . ' left a ' . (int) $stars . "\u{2605} review for " . $propName . " via the review link:\n\n" .
            trim((string) $text) .
            "\n\nContact: " . $email . ($phone ? ' / ' . $phone : '') .
            "\n\nApprove it (and privately rate the guest) in Manage \u{2192} Guest reviews.",
    ];
}

/** A guest's suggestion for the things-to-do list. */
function owner_note_experience($guestName, $title, $body, $linkUrl = '', $phone = '')
{
    return [
        'subject' => 'New experience suggestion to review',
        'text' =>
            ($guestName ?: 'A guest') . " suggested an experience:\n\n" .
            $title . "\n\n" . trim((string) $body) . "\n\n" .
            ($linkUrl ? 'Link: ' . $linkUrl . "\n" : '') .
            ($phone ? 'Phone: ' . $phone . "\n" : '') .
            "\nReview it in Manage \u{2192} Experiences.",
    ];
}

/** A push that reached NO device, so the alert falls back to email. */
function owner_note_push_fallback($title, $body)
{
    return [
        'subject' => $title,
        'text' =>
            trim((string) $body) .
            "\n\n(Sent by email because no device is currently receiving alerts \u{2014} " .
            "check Manage \u{2192} Notifications.)",
    ];
}

/**
 * The owner's own "does email work at all" test, from Manage → System check. This one
 * builds its own HTML rather than leaning on owner_alert_text_html, because the branded
 * shell IS the point: the email doubles as a live preview of what guests receive.
 */
function owner_mail_test_body()
{
    return [
        'subject' => 'Cottage Holidays Blakeney — test email',
        'text' => "This is a test email from your System check. If you're reading this, outgoing email works.",
        'html' => email_shell(
            'Test email',
            email_h('It works! 🎉') .
                email_p('This is a test email from your System check — outgoing email is set up correctly.') .
                email_p('This is exactly how your emails look to guests.', true),
        ),
    ];
}

// ---- The rest of the app's emails, as PURE builders -------------------------
// Same reason as the owner notes above: these composed inline in a route or a cron
// script, so nothing could preview or render them. Each takes its facts as arguments
// and returns ['subject','text','html'] — no DB, no SMTP, no globals.

/** The one-time code that finishes an owner sign-in on a new device. */
function admin_code_body($code)
{
    return [
        'subject' => 'Your sign-in code — Cottage Holidays Blakeney',
        'text' =>
            'Your one-time sign-in code is: ' . $code .
            "\n\nIt expires in 10 minutes. If you didn't just try to sign in to your back office, " .
            'ignore this email and consider changing your password.',
        // The code is set big enough to read off a phone screen, which is the one
        // thing this email exists to do.
        'html' => email_shell(
            'Your one-time sign-in code',
            email_h('Your sign-in code') .
                email_p(
                    'Use this code to finish signing in to your back office on a new device. It expires in 10 minutes.',
                ) .
                '<div style="text-align:center;padding:20px 0 8px;"><span style="font-family:' .
                email_sans() .
                ';font-size:34px;letter-spacing:9px;font-weight:700;color:#2A2622;">' .
                email_esc($code) .
                '</span></div>' .
                email_p(
                    'If you didn&rsquo;t just try to sign in, ignore this email and consider changing your password.',
                    true,
                ),
        ),
    ];
}

/** The weekly database backup, whose .sql.gz rides as an attachment. */
function backup_report_body($sizeLabel, $filesNote = '')
{
    return [
        'subject' => 'Weekly database backup — Cottage Holidays Blakeney',
        'text' =>
            "Attached is this week's database backup (" . $sizeLabel . ").\n\n" .
            'Keep a few of these somewhere safe (they contain all bookings, payments and guest details). ' .
            "To restore, unzip and import the .sql via your host's phpMyAdmin." .
            ($filesNote ? "\n\n" . $filesNote : ''),
        'html' => email_shell(
            'Weekly database backup',
            email_h('Weekly database backup') .
                email_p('Attached is this week&rsquo;s database backup (' . email_esc($sizeLabel) . ').') .
                email_p(
                    'Keep a few of these somewhere safe — they contain all bookings, payments and guest details. ' .
                        'To restore, unzip and import the .sql via your host&rsquo;s phpMyAdmin.',
                    !$filesNote,
                ) .
                ($filesNote ? email_p(email_esc($filesNote), true) : ''),
        ),
    ];
}

/**
 * The guest's copy of a chat reply — the message quoted, with the photo one tap away.
 * `$replyable` is whether a reply-to address exists, which changes only the sentence
 * about how to answer.
 */
function guest_chat_body($guestName, $message, $photoUrl = '', $replyable = false)
{
    $who = $guestName ?: 'there';
    $reply = 'Reply on our website chat' . ($replyable ? ' — or just reply to this email' : '') . '.';
    return [
        'subject' => 'A message from Cottage Holidays Blakeney',
        'text' =>
            'Hello ' . $who . ",\n\nYou have a new message from Cottage Holidays Blakeney:\n\n\"" .
            $message . '"' .
            ($photoUrl !== '' ? "\n\nView photo: " . $photoUrl : '') .
            "\n\n" . $reply . "\nCottage Holidays Blakeney",
        'html' => email_shell(
            'A message from Cottage Holidays Blakeney',
            email_h('You have a new message') .
                email_p('Hello ' . email_esc($who) . ',') .
                email_p('&ldquo;' . nl2br(email_esc($message)) . '&rdquo;') .
                ($photoUrl !== ''
                    ? email_p(
                        '<a href="' . email_esc($photoUrl) . '" style="color:' . email_accent_ink() .
                            ';text-decoration:underline;">View the photo</a>',
                    )
                    : '') .
                email_p(
                    'Reply on our website chat' .
                        ($replyable ? ' &mdash; or just reply to this email' : '') . '.',
                    true,
                ),
        ),
    ];
}

/** The owner's heads-up that a guest answered a chat BY EMAIL. Plain text by design. */
function owner_note_chat_reply($guestName, $guestEmail, $message, $replyable = false, $subjTag = '')
{
    return [
        'subject' => 'New website message — Cottage Holidays Blakeney' . $subjTag,
        'text' =>
            "A guest has replied by email to a website chat.\n\nFrom: " .
            ($guestName ?: '—') . ' (' . ($guestEmail ?: 'no email') . ")\n\n\"" .
            $message . "\"\n" .
            ($replyable ? "\nJust reply to this email and they get it on the website and by email." : '') .
            "\nOr open the back office → Guest messages to reply.",
    ];
}

/** The owner sending a chat message FROM the back office, as the guest receives it. */
function guest_message_body($guestName, $message)
{
    $who = $guestName ?: 'there';
    return [
        'subject' => 'Cottage Holidays Blakeney',
        'text' => 'Hello ' . $who . ",\n\n" . $message . "\n\nCottage Holidays Blakeney",
        'html' => email_shell(
            'A message from Cottage Holidays Blakeney',
            email_h('A message for you') .
                email_p('Hello ' . email_esc($who) . ',') .
                email_p(nl2br(email_esc($message))) .
                email_p('Reply any time on our website chat.', true),
        ),
    ];
}

/**
 * The owner's heads-up that a guest started a chat on the WEBSITE. Sibling of
 * owner_note_chat_reply, which is the same news arriving by email instead — two
 * different facts, so deliberately two composers rather than one with a flag.
 */
function owner_note_chat_new($guestName, $guestEmail, $message, $replyable = false, $subjTag = '')
{
    return [
        'subject' => 'New website message — Cottage Holidays Blakeney' . $subjTag,
        'text' =>
            "Someone has sent you a message via the website chat.\n\nFrom: " .
            ($guestName ?: '—') . ' (' . ($guestEmail ?: 'no email') . ")\n\n\"" .
            $message . "\"\n" .
            ($replyable ? "\nJust reply to this email and the guest gets it on the website and by email." : '') .
            "\nOr open the back office → Guest messages to reply.",
    ];
}

/**
 * The follow-up to an enquiry that went quiet. `$datesGone` is the honest half: the
 * email may only claim a hold while the dates really are free.
 */
function enquiry_nudge_body($name, $propName, $dateSpan, $link, $accent, $datesGone = false)
{
    $holdLine = $datesGone
        ? "Those exact dates have since been booked, but we'd love to help you find another stay that suits."
        : "We're still holding those dates for you.";
    $cta = $datesGone ? 'See available dates' : 'Pick up where you left off';
    $close =
        "Or just reply to this email (or message us on the website) and we'll " .
        ($datesGone ? 'happily sort out an alternative.' : 'get your booking confirmed.');
    return [
        'subject' => 'Still thinking about your Blakeney stay?',
        'text' =>
            'Hello ' . $name . ",\n\nThanks for your enquiry about " . $propName . ' for ' . $dateSpan . ".\n\n" .
            $holdLine . ' ' .
            ($link
                ? ($datesGone ? "You can see what's free here:\n" : "You can pick up where you left off here:\n") .
                    $link . "\n\n"
                : '') .
            $close . "\n\nWarm wishes,\nCottage Holidays Blakeney",
        'html' => email_shell(
            'Still thinking about your Blakeney stay?',
            email_h('Still thinking it over?') .
                email_p(
                    'Hello ' . email_esc($name) . ', thanks for your enquiry about <strong style="color:#2A2622;">' .
                        email_esc($propName) . '</strong> for ' . email_esc($dateSpan) . '.',
                ) .
                email_p(email_esc($holdLine)) .
                // THE BUTTON KEEPS THE HOUSE ACCENT, not the cottage's. These two were
                // the only templates handing a per-cottage colour to email_btn, and a
                // button carries WORDS: white on Jollyboat's green measured 3.30:1 and
                // even the design system's dark ink only reaches 4.00:1, both under AA.
                // The house accent+ink pair is the measured-safe one every other
                // template uses. The cottage colour stays where it is a FILL — the
                // shell's bar and email_h's swatch, which carry no text.
                ($link ? email_btn($link, $cta) : '') .
                email_p(email_esc($close), true),
            $accent,
        ),
    ];
}

/** The rescue for an enquiry FORM abandoned part-way — a draft, not a sent enquiry. */
function enquiry_rescue_body($name, $propName, $dateSpan, $link, $accent)
{
    $span = $dateSpan !== '' ? ' for ' . $dateSpan : '';
    return [
        'subject' => 'Finish your ' . $propName . ' enquiry?',
        'text' =>
            'Hello ' . $name . ",\n\nIt looks like you were part-way through an enquiry about " . $propName . $span .
            " and didn't quite finish. No pressure at all — if you'd still like to stay, " .
            "you can pick up where you left off here:\n" .
            ($link ? $link . "\n\n" : "\n") .
            'If you open it on the same device you started on, we\'ll have kept what you typed. ' .
            "Or just reply to this email and we'll happily sort it out for you.\n\n" .
            "Warm wishes,\nCottage Holidays Blakeney",
        'html' => email_shell(
            'Finish your ' . $propName . ' enquiry?',
            email_h('Finish your enquiry?') .
                email_p(
                    'Hello ' . email_esc($name) .
                        ', it looks like you were part-way through an enquiry about <strong style="color:#2A2622;">' .
                        email_esc($propName) . '</strong>' . email_esc($span) . " and didn't quite finish.",
                ) .
                email_p(
                    "No pressure at all — if you'd still like to stay, you can pick up where you left off in one tap. " .
                        'If you open it on the same device you started on, we\'ll have kept what you typed.',
                ) .
                ($link ? email_btn($link, 'Pick up where you left off') : '') .
                email_p("Or just reply to this email and we'll happily sort it out for you.", true),
            $accent,
        ),
    ];
}

/**
 * The owner's own reply from Manage → Email. Blank lines split paragraphs, exactly as
 * `owner_alert_text_html` does for the plain notes — the owner types prose, not markup.
 */
function mailbox_reply_body($subject, $bodyText)
{
    $inner = '';
    foreach (array_filter(array_map('trim', preg_split('/\n{2,}/', (string) $bodyText))) as $para) {
        $inner .= email_p(nl2br(email_esc($para)));
    }
    return [
        'subject' => $subject,
        'text' => $bodyText,
        'html' => email_shell($subject, $inner),
    ];
}

/**
 * One subscriber's copy of the newsletter. The unsubscribe link is PER RECIPIENT (their
 * own token), so this is built inside the send loop rather than once — and it rides
 * `email_shell`'s footer options so the link is in the document as well as the RFC 8058
 * headers. `$bodyHtml` is PRE-ESCAPED owner-authored HTML, like every email_p caller.
 */
function newsletter_body($subject, $bodyText, $bodyHtml, $unsubUrl)
{
    $foot = "You're receiving this because you signed up at Cottage Holidays Blakeney.";
    return [
        'subject' => $subject,
        'text' => $bodyText . "\n\n—\n" . $foot . "\nUnsubscribe: " . $unsubUrl,
        'html' => email_shell($subject, email_p($bodyHtml), '#D6A785', [
            'unsubscribe' => $unsubUrl,
            'footer' => $foot,
        ]),
    ];
}

/**
 * The weekly ANALYTICS email. Composed at script level from ~11 live figures, which is
 * why it stayed inline while the other thirteen were extracted — the payload IS the
 * work. It gets one now, so email-samples.php can preview it and the render gate can
 * prove it builds and that every colour in it clears AA. `?force=1` (Manage → System
 * check → More tools) still sends the REAL email with REAL data, which beats a fixture;
 * this is about the template never shipping broken.
 */
function weekly_analytics_body($d)
{
    $subject =
        'Your Blakeney week online: ' .
        $d['views'] .
        ' visit' .
        ($d['views'] === 1 ? '' : 's') .
        ($d['deltaTxt'] !== '' ? ' (' . $d['deltaTxt'] . ')' : '') .
        ', ' .
        $d['bookings'] .
        ' booking' .
        ($d['bookings'] === 1 ? '' : 's');

    $text =
        "Good evening,\n\n" .
        "Here's how Cottage Holidays Blakeney did online this week.\n\n" .
        "  • Visits: {$d['views']}" .
        ($d['deltaTxt'] !== '' ? " ({$d['deltaTxt']} vs last week)" : '') .
        "\n" .
        "  • Unique visitors: {$d['uniq']}\n" .
        "  • Conversion: {$d['convPct']}% ({$d['bookings']} booking" .
        ($d['bookings'] === 1 ? '' : 's') .
        ", {$d['enquiries']} enquir" .
        ($d['enquiries'] === 1 ? 'y' : 'ies') .
        ")\n" .
        "  • Top source: {$d['topChannel']}\n" .
        "  • Most-viewed page: {$d['topPage']}\n" .
        ($d['noResult'] > 0 ? "  • Availability searches that found nothing: {$d['noResult']}\n" : '') .
        ($d['dropPct'] !== null && $d['dropPct'] <= -30 ? "\nHeads-up: visits are down " . abs($d['dropPct']) . "% on last week.\n" : '') .
        "\nSee the full picture in Manage → Analytics.\n\nyour website";

    // ---- HTML ----
    $alertHtml =
        $d['dropPct'] !== null && $d['dropPct'] <= -30
            ? email_note(
                '<strong>Heads-up:</strong> visits are down ' .
                    abs($d['dropPct']) .
                    '% on last week. Worth a look — refresh a listing photo, post an update, or check your search rankings.',
                '#FFA726',
            )
            : '';

    $inner =
        email_h('Your week online', '#D6A785') .
        email_p(email_esc(date('l j F Y')), true) .
        $alertHtml .
        email_amount(
            'Visits this week',
            $d['views'] . ($d['deltaTxt'] !== '' ? ' <span style="font-size:15px;color:' . email_muted_ink() . ';">' . $d['deltaTxt'] . '</span>' : ''),
            $d['uniq'] . ' unique visitors',
        ) .
        email_rows(
            [
                [
                    'Conversion',
                    $d['convPct'] .
                    '% <span style="color:' . email_muted_ink() . ';">(' .
                    $d['bookings'] .
                    ' booking' .
                    ($d['bookings'] === 1 ? '' : 's') .
                    ', ' .
                    $d['enquiries'] .
                    ' enquir' .
                    ($d['enquiries'] === 1 ? 'y' : 'ies') .
                    ')</span>',
                ],
                ['Top source', email_esc($d['topChannel'])],
                ['Most-viewed page', email_esc($d['topPage'])],
            ] + ($d['noResult'] > 0 ? [3 => ['Searches finding nothing', (string) $d['noResult']]] : []),
        ) .
        email_btn($d['siteUrl'], 'Open analytics') .
        email_p('You can switch this weekly email off in Manage.', true);
    return ['subject' => $subject, 'text' => $text, 'html' => email_shell('Your Blakeney week online', $inner, '#D6A785')];
}

/**
 * The weekly OWNER DIGEST. Like weekly_analytics_body, it composed at script level from
 * a dozen live figures — the payload is the work, which is why it outlasted the other
 * thirteen. The four pure FORMATTERS move in here with the template (they format, they
 * do not query); everything that touches the database stays in the cron script.
 * `?force=1` still sends the real thing with real data; this is so the template can be
 * previewed and can never ship broken.
 */
function owner_digest_body($d)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $nameOf = fn($k) => prop_display($k)['name'];
    $pretty = fn($dt) => date('D j M', strtotime($dt));
    $accentOf = fn($k) => prop_display($k)['accent'];
    $subject =
        'Your Blakeney week: ' .
        $d['newBookings'] .
        ' new booking' .
        ($d['newBookings'] === 1 ? '' : 's') .
        ', ' .
        $money($d['received']) .
        ' in';

    $arrivalsTxt = $d['arrivals']
        ? implode(
            "\n",
            array_map(
                fn($a) => '  • ' . $pretty($a['check_in']) . ' — ' . $a['name'] . ' (' . $nameOf($a['prop_key']) . ')',
                $d['arrivals'],
            ),
        )
        : '  • No arrivals in the next 7 days.';

    $text =
        "Good morning,\n\n" .
        "Here's how Cottage Holidays Blakeney is looking.\n\n" .
        "THE WEEK JUST GONE\n" .
        "  • New bookings: {$d['newBookings']} (" .
        $money($d['newValue']) .
        " of stays)\n" .
        '  • Money received: ' .
        $money($d['received']) .
        "\n\n" .
        "THE WEEK AHEAD — arrivals\n{$arrivalsTxt}\n\n" .
        "TO KEEP AN EYE ON\n" .
        "  • Balances owed: {$d['owedCount']} booking" .
        ($d['owedCount'] === 1 ? '' : 's') .
        ' (' .
        $money($d['owedSum']) .
        ")\n" .
        "  • Pending enquiries: {$d['pending']}\n" .
        ($d['occPct'] !== null ? "  • Occupancy (next 30 days): {$d['occPct']}%\n" : '') .
        "\nACTIVITY THIS WEEK\n" .
        "  • {$d['actTotal']} logged event" .
        ($d['actTotal'] === 1 ? '' : 's') .
        "\n" .
        (count($d['actAttention'])
            ? "  • Needs attention:\n" . implode("\n", array_map(fn($a) => '     - ' . $a['summary'], $d['actAttention'])) . "\n"
            : "  • Nothing needs your attention.\n") .
        (count($d['misses'])
            ? "\nTEACH YOUR ASSISTANT\n  • " .
                count($d['misses']) .
                ' search' .
                (count($d['misses']) === 1 ? '' : 'es') .
                " found nothing this week:\n" .
                implode(
                    "\n",
                    array_map(fn($m) => '     - "' . $m['t'] . '"' . ($m['n'] > 1 ? " (asked {$m['n']} times)" : ''), $d['misses']),
                ) .
                "\n  • Open Search and type \"teach the assistant\" — each fix takes one tap.\n"
            : '') .
        "\nHave a good week,\nyour website";

    $sectionLabel = fn($t) => '<div style="font-family:' .
        email_sans() .
        ';font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:' . email_muted_ink() . ';margin:22px 0 2px;">' .
        htmlspecialchars($t) .
        '</div>';
    $arrivalsHtml = $d['arrivals']
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">' .
            implode(
                '',
                array_map(
                    fn($a) => '<tr><td style="padding:7px 0;border-bottom:1px solid #ECE4D3;font-family:' .
                        email_sans() .
                        ';font-size:14px;color:#57524A;">' .
                        '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' .
                        $accentOf($a['prop_key']) .
                        ';margin-right:9px;"></span>' .
                        htmlspecialchars($pretty($a['check_in'])) .
                        ' — <strong style="color:#2A2622;">' .
                        htmlspecialchars($a['name']) .
                        '</strong> · ' .
                        htmlspecialchars($nameOf($a['prop_key'])) .
                        '</td></tr>',
                    $d['arrivals'],
                ),
            ) .
            '</table>'
        : email_p('No arrivals in the next 7 days.', true);

    $inner =
        email_h('Your week at a glance', '#D6A785') .
        email_p(htmlspecialchars(date('l j F Y')), true) .
        $sectionLabel('The week just gone') .
        email_rows([
            ['New bookings', $d['newBookings'] . ' <span style="color:' . email_muted_ink() . ';">(' . $money($d['newValue']) . ')</span>'],
            ['Money received', $money($d['received'])],
        ]) .
        $sectionLabel('The week ahead — arrivals') .
        $arrivalsHtml .
        $sectionLabel('To keep an eye on') .
        email_rows(
            array_filter([
                ['Balances owed', $d['owedCount'] . ' <span style="color:' . email_muted_ink() . ';">(' . $money($d['owedSum']) . ')</span>'],
                ['Pending enquiries', (string) $d['pending']],
                $d['occPct'] !== null ? ['Occupancy (next 30 days)', $d['occPct'] . '%'] : null,
            ]),
        ) .
        $sectionLabel('Activity this week') .
        email_rows([['Logged events', (string) $d['actTotal']]]) .
        (count($d['actAttention'])
            ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;">' .
                implode(
                    '',
                    array_map(
                        fn($a) => '<tr><td style="padding:6px 0;border-bottom:1px solid #ECE4D3;font-family:' .
                            email_sans() .
                            ';font-size:13px;color:' .
                            ($a['severity'] === 'action' ? email_alert_ink() : email_warn_ink()) .
                            ';">⚠ ' .
                            htmlspecialchars($a['summary']) .
                            '</td></tr>',
                        $d['actAttention'],
                    ),
                ) .
                '</table>'
            : email_p('Nothing needs your attention.', true)) .
        (count($d['misses'])
            ? $sectionLabel('Teach your assistant') .
                email_p(
                    count($d['misses']) .
                        ' search' .
                        (count($d['misses']) === 1 ? '' : 'es') .
                        ' found nothing this week — open Search and type <strong>"teach the assistant"</strong>; each fix takes one tap.',
                    true,
                ) .
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;">' .
                implode(
                    '',
                    array_map(
                        fn($m) => '<tr><td style="padding:6px 0;border-bottom:1px solid #ECE4D3;font-family:' .
                            email_sans() .
                            ';font-size:13px;color:#57524A;">“' .
                            htmlspecialchars($m['t']) .
                            '”' .
                            ($m['n'] > 1 ? ' <span style="color:' . email_muted_ink() . ';">· asked ' . $m['n'] . ' times</span>' : '') .
                            '</td></tr>',
                        $d['misses'],
                    ),
                ) .
                '</table>'
            : '') .
        email_p('Have a good week.', true);
    return ['subject' => $subject, 'text' => $text, 'html' => email_shell('Your Blakeney week at a glance', $inner, '#D6A785')];
}
