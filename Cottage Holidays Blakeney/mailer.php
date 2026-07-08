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

/**
 * Low-level: send one email via SMTP. Returns [ok=>bool, error=>string].
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
    // Defence-in-depth: strip any CR/LF from the recipient so it can never inject
    // extra SMTP commands (RCPT TO) or email headers. Addresses are also validated
    // with FILTER_VALIDATE_EMAIL on input.
    $toEmail = preg_replace('/[\r\n]+/', '', (string) $toEmail);
    // The staging Test centre marks sample emails so they're unmistakable in the inbox.
    if (!empty($GLOBALS['__chb_test_prefix'])) {
        $subject = $GLOBALS['__chb_test_prefix'] . $subject;
    }
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
        if (function_exists('log_activity')) {
            log_activity('system', 'email.fail', 'Email could not be sent — mail server unreachable', [
                'severity' => 'warn',
                'entity' => 'email',
                'meta' => ['detail' => 'to ' . $toName . ' · ' . $errstr],
            ]);
        }
        return ['ok' => false, 'error' => "Connect failed: {$errstr} ({$errno})"];
    }
    stream_set_timeout($fp, $timeout);

    // Helper to read a (possibly multi-line) SMTP reply and check the code.
    $read = function () use ($fp) {
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            // Lines like "250-..." continue; "250 ..." (space) ends the reply.
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }
        return $data;
    };
    $cmd = function ($command) use ($fp) {
        fwrite($fp, $command . "\r\n");
    };
    $code = function ($reply) {
        return (int) substr(ltrim($reply), 0, 3);
    };

    // $reply (optional) is the server's raw response line. Include a trimmed,
    // single-line copy in the error + log so a rejection tells us WHY (e.g.
    // "550 relaying denied", "452 too many recipients", a rate-limit notice)
    // instead of just which step failed.
    $fail = function ($msg, $reply = '') use ($fp, $toName) {
        @fwrite($fp, "QUIT\r\n");
        @fclose($fp);
        $detail = trim(preg_replace('/\s+/', ' ', (string) $reply));
        $full = $detail !== '' ? $msg . ' — ' . $detail : $msg;
        if (function_exists('log_activity')) {
            log_activity('system', 'email.fail', 'Email failed to send — ' . $toName, [
                'severity' => 'warn',
                'entity' => 'email',
                'meta' => ['detail' => mb_substr($full, 0, 200)],
            ]);
        }
        return ['ok' => false, 'error' => mb_substr($full, 0, 200)];
    };

    // Greeting
    if ($code($read()) !== 220) {
        return $fail('No 220 greeting');
    }

    $ehloHost = $_SERVER['SERVER_NAME'] ?? 'localhost';
    $cmd("EHLO {$ehloHost}");
    if ($code($read()) !== 250) {
        return $fail('EHLO rejected');
    }

    // Upgrade to TLS on 587
    if ($secure === 'tls') {
        $cmd('STARTTLS');
        if ($code($read()) !== 220) {
            return $fail('STARTTLS rejected');
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
            return $fail('TLS negotiation failed');
        }
        $cmd("EHLO {$ehloHost}");
        if ($code($read()) !== 250) {
            return $fail('EHLO after TLS rejected');
        }
    }

    // AUTH LOGIN
    $cmd('AUTH LOGIN');
    if ($code($read()) !== 334) {
        return $fail('AUTH not accepted');
    }
    $cmd(base64_encode(SMTP_USER));
    if ($code($read()) !== 334) {
        return $fail('Username rejected');
    }
    $cmd(base64_encode(SMTP_PASS));
    if ($code($read()) !== 235) {
        return $fail('Login failed (check user/password)');
    }

    // Envelope
    $from = MAIL_FROM;
    $cmd("MAIL FROM:<{$from}>");
    $mfReply = $read();
    if ($code($mfReply) !== 250) {
        return $fail('MAIL FROM rejected', $mfReply);
    }
    $cmd("RCPT TO:<{$toEmail}>");
    $rcptReply = $read();
    $rc = $code($rcptReply);
    if ($rc !== 250 && $rc !== 251) {
        return $fail('RCPT TO rejected', $rcptReply);
    }

    // Data
    $cmd('DATA');
    $dataReply = $read();
    if ($code($dataReply) !== 354) {
        return $fail('DATA not accepted', $dataReply);
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

    $cmd($payload);
    $finalReply = $read();
    if ($code($finalReply) !== 250) {
        return $fail('Message not accepted: ' . trim($finalReply));
    }

    $cmd('QUIT');
    @fclose($fp);
    return ['ok' => true, 'error' => ''];
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

// Send ONE owner/admin notification to every recipient (owner_recipients()).
// Returns the primary send's result so existing callers keep their {ok,error}
// contract; copies to the extra addresses are best-effort.
function send_owner($subject, $text, $html = null, $atts = [], $replyTo = null, $messageId = null)
{
    $rcpts = owner_recipients();
    if (!$rcpts) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $first = null;
    foreach ($rcpts as $i => $to) {
        $r = smtp_send($to, 'Owner', $subject, $text, $html, $atts, $replyTo, $messageId);
        if ($i === 0) {
            $first = $r;
        }
    }
    return $first ?: ['ok' => false, 'error' => 'No owner email'];
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
function send_owner_payment_notice($b)
{
    if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $what = ($b['kind'] ?? '') === 'balance' ? 'balance' : 'deposit';
    $statusTxt = ($b['status'] ?? '') === 'paid' ? ' — now paid in full' : '';
    $prop = $b['prop_name'] ?? ($b['prop_key'] ?? 'a cottage');
    $subject = 'Payment received: ' . $money($b['amount']) . " — {$prop}";
    $text =
        "Good news — a payment has come in.\n\n" .
        'Guest: ' .
        ($b['name'] ?? '—') .
        "\n" .
        "Property: {$prop}\n" .
        "Type: {$what}\n" .
        'Amount: ' .
        $money($b['amount']) .
        $statusTxt .
        "\n\n" .
        "See Money & income for the full picture.\nCottage Holidays Blakeney";
    return send_owner($subject, $text);
}

// Ask a past guest to leave a review. $b: name, email, prop_key, prop_name, reviewUrl.
function send_review_request_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = $b['name'] ?: 'there';
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

    $subject = "{$month} at {$prop} — fancy a return visit?";
    $text =
        "Hi {$name},\n\n" .
        "Around this time last year you were getting ready for your stay at {$prop} — " .
        "we hope Blakeney has stayed with you the way it tends to.\n\n" .
        "The same {$month} weeks are starting to book up again, so if you fancy a return " .
        'we wanted you to have first pick of the dates. As a returning guest, just mention ' .
        "the returning-guest rate when you enquire and we'll apply it.\n\n" .
        ($url ? "Check availability: {$url}\n\n" : '') .
        "Hope to welcome you back,\nCottage Holidays Blakeney\n\n" .
        'P.S. Prefer not to get the occasional note like this? Just reply and say so.';

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
                '</strong> weeks are starting to book up again, so we wanted you to have first pick of the dates. As a returning guest, just mention the <strong style="color:#2A2622;">returning-guest rate</strong> when you enquire and we\'ll apply it.',
        );
    if ($url) {
        $inner .= email_btn($url, 'Check availability');
    }
    $inner .=
        email_p('Hope to welcome you back,<br>Cottage Holidays Blakeney', true) .
        email_p('Prefer not to get the occasional note like this? Just reply and say so.', true);
    $html = email_shell($month . ' at ' . $prop, $inner, $accent);

    return smtp_send($b['email'], $b['name'] ?? '', $subject, $text, $html);
}

// Acknowledge a guest's enquiry by email. $accountExists tailors the closing line:
// returning guests are pointed to sign in; new guests are invited to create an account.
function send_enquiry_ack($enq, $accountExists = false)
{
    $email = trim((string) ($enq['email'] ?? ''));
    if ($email === '') {
        return ['ok' => false, 'error' => 'no email'];
    }
    $name = trim((string) ($enq['name'] ?? '')) ?: 'there';
    $first = explode(' ', $name)[0] ?: 'there';
    $prop = function_exists('prop_display') ? prop_display($enq['prop_key'] ?? '')['name'] ?? '' : '';
    $pretty = fn($d) => $d ? date('D j M Y', strtotime($d)) : '';
    $dates = trim($pretty($enq['check_in'] ?? '') . ' – ' . $pretty($enq['check_out'] ?? ''), ' –');
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
    $name = $e['name'] ?: 'Guest';
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
            (!empty($p['damagesDeposit']) ? ' + ' . $money($p['damagesDeposit']) . ' refundable deposit (refunded after your stay)' : '')
        : '';
    $times = 'Arrive ' . (($e['check_in_time'] ?? '') ?: '15:00') . ' · leave ' . (($e['check_out_time'] ?? '') ?: '10:00');

    $subject = trim((string) $subject) ?: 'Your ' . $noun . ' — ' . $prop;

    $text =
        "Hello {$name},\n\n" .
        trim((string) $message) .
        "\n\n---\nYour {$noun} details\n" .
        "Cottage: {$prop}\n" .
        'Dates: ' . ($e['check_in'] ?? '') . ' to ' . ($e['check_out'] ?? '') . "\n" .
        $times . "\n" .
        "Party: {$party}\n" .
        ($priceLine !== '' ? 'Estimated price: ' . $priceLine . "\n" : '') .
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
    $kv('Dates', ($e['check_in'] ?? '') . ' to ' . ($e['check_out'] ?? ''));
    $kv('Times', $times);
    $kv('Party', $party);
    $kv('Est. price', $priceLine);

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
function send_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry')
{
    $noun = $ctx === 'booking' ? 'booking' : 'enquiry';
    if (empty($e['email'])) {
        return ['ok' => false, 'error' => 'No guest email on this ' . $noun];
    }
    $m = build_enquiry_reply_email($e, $subject, $message, $ctx);
    return smtp_send($m['email'], $m['name'], $m['subject'], $m['text'], $m['html']);
}

// New-enquiry alert for the owner, with signed one-tap action links. $e carries
// the enquiry fields + prebuilt approve_url / decline_url (enquiry-action.php).
function send_owner_enquiry_email($e)
{
    if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) {
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
        'New enquiry: ' . ($e['name'] ?: 'Someone') . ' — ' . $prop . ', ' . $e['check_in'] . ' to ' . $e['check_out'];

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
        'Dates: ' . ($e['check_in'] ?? '') . ' to ' . ($e['check_out'] ?? '') . "\n" .
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
            email_esc(($e['check_in'] ?? '') . ' to ' . ($e['check_out'] ?? '')) . ' &middot; ' . email_esc($party),
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
        $body = "Dear {$b['name']},\n\n";
        $body .= "Good news — your booking at {$b['prop_name']} is confirmed.\n\n";
        $body .= "Booking reference: {$b['ref']}\n";
        $body .= "Check in:  {$b['check_in']} from {$b['check_in_time']}\n";
        $body .= "Check out: {$b['check_out']} by {$b['check_out_time']}\n";
        $body .= "Party: {$party}\n";
        $body .= "Payment: {$paymentLabel}\n";
        $body .= "Address: {$b['address']}\n\n";
        // The refundable deposit is charged with the first payment & refunded after
        // the stay, so it's part of the total the guest pays until then.
        $depAmt = round((float) ($b['damages_deposit'] ?? 0), 2);
        $grandTotal = round((float) $b['total'] + $depAmt, 2);
        $body .= $money($b['per_night']) . " x {$nightsTxt}: " . $money($b['nightly']) . "\n";
        $body .= "Transaction fee ({$b['tx_pct']}%): " . $money($b['tx_fee']) . "\n";
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
        if (!empty($b['invoice_url'])) {
            $body .= "\nView or download your invoice: " . $b['invoice_url'] . "\n";
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
            $pr($money($b['per_night']) . ' &times; ' . $nightsTxt, $money($b['nightly'])) .
            $pr('Transaction fee (' . $esc($b['tx_pct']) . '%)', $money($b['tx_fee'])) .
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
            email_p('Dear ' . $esc($b['name']) . ', good news — your stay is confirmed. Here are the details:') .
            email_rows([
                ['Check in', $esc($b['check_in']) . ' &middot; ' . $esc($b['check_in_time'])],
                ['Check out', $esc($b['check_out']) . ' &middot; ' . $esc($b['check_out_time'])],
                ['Party', $esc($party)],
                ['Payment', '<span style="color:' . $paymentColor . ';font-weight:600;">' . $paymentLabel . '</span>'],
                ['Address', $esc($b['address'])],
            ]) .
            $priceBox .
            (!empty($b['invoice_url']) ? email_btn($b['invoice_url'], 'View your invoice', $accent, '#ffffff') : '') .
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
    if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) {
        $subject = "New confirmed booking — {$b['prop_name']} ({$b['check_in']})";
        $body = "A booking has just been confirmed.\n\n";
        $body .= "Reference: {$b['ref']}\n";
        $body .= "Property: {$b['prop_name']}\n";
        $body .= "Guest: {$b['name']}\n";
        $body .= 'Email: ' . ($b['email'] ?: '—') . "\n";
        $body .= 'Phone: ' . ($b['phone'] ?? '—') . "\n";
        $body .= "Check in:  {$b['check_in']} ({$b['check_in_time']})\n";
        $body .= "Check out: {$b['check_out']} ({$b['check_out_time']})\n";
        $body .= "Stay: {$nightsTxt}\n";
        $body .= "Guests: {$party}\n";
        $ownerDep = round((float) ($b['damages_deposit'] ?? 0), 2);
        $body .= 'Total: ' . $money(round((float) $b['total'] + $ownerDep, 2)) . ($ownerDep > 0 ? ' (incl. deposit)' : '') . "\n";
        $out['owner'] = send_owner($subject, $body);
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
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';
    $inDate = date('D j M Y', strtotime($b['check_in']));
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
    $name = $g['name'] ?: 'there';

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

// ------------------------------------------------------------------
//  Square payments — request + receipt emails. Both reuse smtp_send and the
//  crown header. $b: name, email, prop_key, prop_name, check_in, check_out,
//  kind ('deposit'|'balance'), amount, total. $payUrl: the secure pay link.
// ------------------------------------------------------------------
function send_payment_request($b, $payUrl)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';
    $what = $b['kind'] === 'balance' ? 'remaining balance' : 'deposit';

    // When the refundable deposit rides this payment (first payment), state the true
    // amount the card will be charged today so the emailed figure matches checkout.
    $damages = round((float) ($b['damages'] ?? 0), 2);
    $chargedToday = round((float) $b['amount'] + $damages, 2);
    // Full stay total includes the refundable deposit while it's still being charged.
    $stayTotalGrand = round((float) $b['total'] + $damages, 2);
    $depositLineText =
        $damages > 0
            ? "\n\nThis payment also includes a refundable security deposit of " .
                $money($damages) .
                ' (returned after checkout), so ' .
                $money($chargedToday) .
                ' will be charged to your card today.'
            : '';

    $subject = "Pay your {$what} — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for booking {$prop} ({$b['check_in']} to {$b['check_out']}).\n\n" .
        "To secure your stay, please pay your {$what} of " .
        $money($b['amount']) .
        " securely by card here:\n" .
        $payUrl .
        $depositLineText .
        "\n\n" .
        'The full stay total is ' .
        $money($stayTotalGrand) .
        ($damages > 0 ? ' (including the refundable deposit)' : '') .
        ". You can reply to this email with any questions.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h($prop, $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for booking <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong> (' .
                $esc($b['check_in']) .
                ' to ' .
                $esc($b['check_out']) .
                ').',
        ) .
        email_amount(ucfirst($what) . ' due', $money($b['amount']), 'of ' . $money($stayTotalGrand) . ' total') .
        ($damages > 0
            ? email_p(
                'This payment also includes a <strong>' .
                    $money($damages) .
                    '</strong> refundable security deposit (returned after checkout), so <strong>' .
                    $money($chargedToday) .
                    '</strong> will be charged to your card today.',
                true,
            )
            : '') .
        email_btn($payUrl, 'Pay securely by card') .
        email_p('Powered by Square — we never see or store your card number.', true) .
        email_p('Any questions? Just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Pay your ' . $what . ' for ' . $prop, $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
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
    $payUrl = site_base_url() . 'index.html?pay=' . pay_token($b['id']) . '&b=' . (int) $b['id'] . '&k=' . $kind;
    $rate = get_rate($b['prop_key']);
    // The refundable damage deposit is CHARGED with the guest's first rental payment
    // (only while hold_status is 'none') and returned after checkout. Mirror pay.php's
    // derivation so the email states the full amount the card will be charged, not
    // just the rental portion. Zero once the deposit has already ridden a payment.
    $damages = 0.0;
    if (($b['hold_status'] ?? 'none') === 'none') {
        $damages = round((float) ($b['agreed_booking_fee'] ?? 0), 2);
        if ($damages <= 0 && $rate) {
            $pp = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $damages = round((float) ($pp['damagesDeposit'] ?? 0), 2);
        }
    }
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
    ];
    $res = $reminder ? send_payment_reminder($payload, $payUrl) : send_payment_request($payload, $payUrl);
    $res['amount'] = $amt['due'];
    return $res;
}

// A gentler nudge for a balance that's been requested but not yet paid, sent in
// the run-up to arrival. Same secure link; warmer copy + days-until-arrival.
function send_payment_reminder($b, $payUrl)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';
    $days = max(0, (int) floor((strtotime($b['check_in']) - strtotime(date('Y-m-d'))) / 86400));
    $when = $days <= 1 ? 'tomorrow' : "in {$days} days";

    $subject = "Reminder: balance due for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Just a friendly reminder that the balance for your stay at {$prop} is still outstanding, " .
        "and your arrival is {$when} ({$b['check_in']}).\n\n" .
        'Please pay the remaining ' .
        $money($b['amount']) .
        " securely by card here:\n" .
        $payUrl .
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
                $esc($b['check_in']) .
                ').',
        ) .
        email_amount('Balance due', $money($b['amount'])) .
        email_btn($payUrl, 'Pay securely by card') .
        email_p('Already paid? Thank you — please ignore this. Powered by Square.', true) .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('Balance reminder for ' . $prop, $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
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
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';

    $subject = "Secure your stay — refundable card hold for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Ahead of your stay at {$prop} ({$b['check_in']} to {$b['check_out']}), please place the refundable " .
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
                $esc($b['check_in']) .
                ' to ' .
                $esc($b['check_out']) .
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
    $name = $b['name'] ?: 'Guest';
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
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));

    $subject = "Refund on its way — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "We've issued a refund of " .
        $money($b['amount']) .
        " for your booking at {$prop}" .
        (!empty($b['check_in']) ? " ({$b['check_in']} to {$b['check_out']})" : '') .
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
                (!empty($b['check_in']) ? ' (' . $esc($b['check_in']) . ' to ' . $esc($b['check_out']) . ')' : '') .
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
    $name = $b['name'] ?: 'Guest';
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
function send_cancellation_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = $b['name'] ?: 'Guest';
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

    $subject = "Booking cancelled — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Your booking at {$prop}" .
        (!empty($b['check_in']) ? " ({$b['check_in']} to {$b['check_out']})" : '') .
        " has been cancelled.\n\n" .
        ($reason !== '' ? "Reason: {$reason}\n\n" : '') .
        ($refundLine !== '' ? $refundLine . "\n\n" : '') .
        "If you have any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Booking cancelled') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', your booking at <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc($b['check_in']) . ' to ' . $esc($b['check_out']) . ')' : '') .
                ' has been cancelled.',
        ) .
        ($reason !== '' ? email_p('<strong style="color:#2A2622;">Reason:</strong> ' . $esc($reason), true) : '') .
        ($refundLine !== '' ? email_note($esc($refundLine)) : '') .
        email_p('If you have any questions, just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Booking cancelled — ' . $prop, $inner);

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

function send_payment_receipt($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';
    $what = $b['kind'] === 'balance' ? 'balance' : 'deposit';
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

    $subject = "Payment received — {$prop}";
    $statusLine = !empty($b['fully_paid'])
        ? "Your booking is now paid in full. We can't wait to welcome you."
        : 'Remaining balance: ' . $money($b['balance']) . ". We'll be in touch about settling it before your stay.";
    $text =
        "Hello {$name},\n\n" .
        "Thank you — we've received your {$what} payment of " .
        $money($paidNow) .
        " for {$prop}.\n" .
        ($depLine !== '' ? $depLine . "\n" : '') .
        "Reference: {$b['ref']}\n" .
        'Rental paid so far: ' .
        $money($b['paid_so_far']) .
        ' of ' .
        $money($b['total']) .
        ".\n" .
        $statusLine .
        "\n\n" .
        'Cottage Holidays Blakeney';
    $inner =
        email_h('Payment received') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you — we\'ve received your ' .
                $what .
                ' payment of <strong style="color:#2A2622;">' .
                $money($paidNow) .
                '</strong> for <strong style="color:#2A2622;">' .
                $esc($prop) .
                '</strong>.',
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
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('Payment received — ' . $prop, $inner);

    return smtp_send($b['email'], $name, $subject, $text, $html);
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
