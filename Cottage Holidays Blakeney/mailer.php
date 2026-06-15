<?php

// Centered crown logo for the top of customer emails. The image is embedded
// as a base64 data URI so it travels inside the email — no external URL to
// break and no dependence on the site domain. Works on a light background.
function email_crown_header($bg) {
    $src = 'data:image/png;base64,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';
    return '<tr><td align="center" style="padding:30px 40px 0;background:' . $bg . ';">'
        . '<img src="' . $src . '" width="72" height="72" alt="Cottage Holidays Blakeney" '
        . 'style="display:block;width:72px;height:72px;border:0;outline:none;">'
        . '</td></tr>';
}

// ============================================================
//  mailer.php — minimal, dependency-free SMTP sender.
//  Speaks SMTP directly (EHLO / STARTTLS / AUTH LOGIN / DATA) so no
//  external library or Composer is needed on shared hosting.
//  Public entry point: send_booking_emails($booking) — sends a guest
//  confirmation and a separate owner notification. Never throws; returns
//  a small status array so the caller can log but not fail on email errors.
// ============================================================

/**
 * Low-level: send one email via SMTP. Returns [ok=>bool, error=>string].
 */
function smtp_send($toEmail, $toName, $subject, $bodyText, $bodyHtml = null) {
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        return ['ok' => false, 'error' => 'Mail disabled'];
    }
    $host = SMTP_HOST; $port = (int)SMTP_PORT; $secure = strtolower(SMTP_SECURE);
    $timeout = 15;

    // For SSL (port 465) we connect with an ssl:// wrapper; for TLS (587) we
    // connect plain then upgrade with STARTTLS.
    $transport = ($secure === 'ssl') ? "ssl://{$host}" : $host;

    // Some shared hosts (incl. IONOS) present certs that don't perfectly match the
    // hostname; allow the connection rather than failing silently. Mail is still
    // encrypted — we just don't hard-verify the peer name.
    $ctx = stream_context_create(['ssl' => [
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'allow_self_signed' => true,
    ]]);

    $errno = 0; $errstr = '';
    $fp = @stream_socket_client("{$transport}:{$port}", $errno, $errstr, $timeout,
        STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) return ['ok' => false, 'error' => "Connect failed: {$errstr} ({$errno})"];
    stream_set_timeout($fp, $timeout);

    // Helper to read a (possibly multi-line) SMTP reply and check the code.
    $read = function() use ($fp) {
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            // Lines like "250-..." continue; "250 ..." (space) ends the reply.
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $data;
    };
    $cmd = function($command) use ($fp) { fwrite($fp, $command . "\r\n"); };
    $code = function($reply) { return (int)substr(ltrim($reply), 0, 3); };

    $fail = function($msg) use ($fp) {
        @fwrite($fp, "QUIT\r\n"); @fclose($fp);
        return ['ok' => false, 'error' => $msg];
    };

    // Greeting
    if ($code($read()) !== 220) return $fail('No 220 greeting');

    $ehloHost = $_SERVER['SERVER_NAME'] ?? 'localhost';
    $cmd("EHLO {$ehloHost}");
    if ($code($read()) !== 250) return $fail('EHLO rejected');

    // Upgrade to TLS on 587
    if ($secure === 'tls') {
        $cmd('STARTTLS');
        if ($code($read()) !== 220) return $fail('STARTTLS rejected');
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT |
                STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT)) {
            return $fail('TLS negotiation failed');
        }
        $cmd("EHLO {$ehloHost}");
        if ($code($read()) !== 250) return $fail('EHLO after TLS rejected');
    }

    // AUTH LOGIN
    $cmd('AUTH LOGIN');
    if ($code($read()) !== 334) return $fail('AUTH not accepted');
    $cmd(base64_encode(SMTP_USER));
    if ($code($read()) !== 334) return $fail('Username rejected');
    $cmd(base64_encode(SMTP_PASS));
    if ($code($read()) !== 235) return $fail('Login failed (check user/password)');

    // Envelope
    $from = MAIL_FROM;
    $cmd("MAIL FROM:<{$from}>");
    if ($code($read()) !== 250) return $fail('MAIL FROM rejected');
    $cmd("RCPT TO:<{$toEmail}>");
    $rc = $code($read());
    if ($rc !== 250 && $rc !== 251) return $fail('RCPT TO rejected');

    // Data
    $cmd('DATA');
    if ($code($read()) !== 354) return $fail('DATA not accepted');

    $fromName = defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : $from;
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $fromDomain = substr(strrchr($from, '@') ?: '@localhost', 1);
    $headers   = "From: " . mb_encode_safe($fromName) . " <{$from}>\r\n";
    $headers  .= "To: " . mb_encode_safe($toName) . " <{$toEmail}>\r\n";
    $headers  .= "Reply-To: {$from}\r\n";
    $headers  .= "Subject: {$encSubject}\r\n";
    $headers  .= "MIME-Version: 1.0\r\n";
    $headers  .= "Date: " . date('r') . "\r\n";
    // Message-ID is required by many MTAs (incl. IONOS) — a message without one
    // can be rejected at the end of DATA ("Message not accepted").
    $headers  .= "Message-ID: <" . bin2hex(random_bytes(12)) . "@{$fromDomain}>\r\n";

    // Base64-encode bodies in 76-char lines. This guarantees no line ever exceeds
    // the SMTP limit (which caused "501 line too long" with raw 8-bit HTML), and
    // safely carries UTF-8. chunk_split adds CRLF every 76 chars.
    $b64 = function($s) { return rtrim(chunk_split(base64_encode($s), 76, "\r\n"), "\r\n"); };

    if ($bodyHtml !== null && $bodyHtml !== '') {
        // multipart/alternative: plain-text fallback + HTML
        $boundary = 'chb_' . bin2hex(random_bytes(8));
        $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";
        $msg  = "--{$boundary}\r\n";
        $msg .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $msg .= "Content-Transfer-Encoding: base64\r\n\r\n";
        $msg .= $b64($bodyText) . "\r\n\r\n";
        $msg .= "--{$boundary}\r\n";
        $msg .= "Content-Type: text/html; charset=UTF-8\r\n";
        $msg .= "Content-Transfer-Encoding: base64\r\n\r\n";
        $msg .= $b64($bodyHtml) . "\r\n\r\n";
        $msg .= "--{$boundary}--";
        $payload = $headers . "\r\n" . $msg . "\r\n.";
    } else {
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $headers .= "Content-Transfer-Encoding: base64\r\n";
        $payload = $headers . "\r\n" . $b64($bodyText) . "\r\n.";
    }

    $cmd($payload);
    $finalReply = $read();
    if ($code($finalReply) !== 250) return $fail('Message not accepted: ' . trim($finalReply));

    $cmd('QUIT'); @fclose($fp);
    return ['ok' => true, 'error' => ''];
}

/** Encode a display name safely for a header (handles non-ASCII). */
function mb_encode_safe($name) {
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
function send_booking_emails($b) {
    $out = ['guest' => ['ok' => false, 'error' => 'not attempted'],
            'owner' => ['ok' => false, 'error' => 'not attempted']];
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        $out['guest']['error'] = $out['owner']['error'] = 'Mail disabled';
        return $out;
    }

    $money = fn($n) => '£' . number_format((float)$n, 2);
    $nightsTxt = $b['nights'] . ' night' . ((int)$b['nights'] === 1 ? '' : 's');
    $party = $b['adults'] . ' adult' . ((int)$b['adults'] === 1 ? '' : 's')
           . ((int)$b['children'] > 0 ? ', ' . $b['children'] . ' child' . ((int)$b['children'] === 1 ? '' : 'ren') : '');

    // Property accent colour (matches the site's calendar/tag colours)
    $colors = ['21a' => '#42A5F5', 'jollyboat' => '#43A047', 'pimpernel' => '#9C27B0'];
    $accent = $colors[$b['prop_key'] ?? ''] ?? '#42A5F5';
    $paymentLabel = ucfirst($b['payment'] ?? 'unpaid');
    $paymentColor = ($b['payment'] ?? 'unpaid') === 'paid' ? '#2E7D32' : '#C62828';
    $esc = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

    // ---- Guest confirmation ----
    if (!empty($b['email'])) {
        $subject = "Your booking is confirmed — {$b['prop_name']}";

        // Plain-text fallback (clients that block HTML still get this)
        $body  = "Dear {$b['name']},\n\n";
        $body .= "Good news — your booking at {$b['prop_name']} is confirmed.\n\n";
        $body .= "Booking reference: {$b['ref']}\n";
        $body .= "Check in:  {$b['check_in']} from {$b['check_in_time']}\n";
        $body .= "Check out: {$b['check_out']} by {$b['check_out_time']}\n";
        $body .= "Party: {$party}\n";
        $body .= "Payment: {$paymentLabel}\n";
        $body .= "Address: {$b['address']}\n\n";
        $body .= $money($b['per_night']) . " x {$nightsTxt}: " . $money($b['nightly']) . "\n";
        $body .= "Transaction fee ({$b['tx_pct']}%): " . $money($b['tx_fee']) . "\n";
        $body .= "Refundable damages deposit: " . $money($b['damages_deposit']) . "\n";
        $body .= "Total: " . $money($b['total']) . "\n\n";
        $body .= "If you have any questions, just reply to this email.\nCottage Holidays Blakeney\n";

        // HTML version — table-based, all-inline styles for email-client safety,
        // styled to match the on-site booking detail card.
        $serif = "'Georgia','Times New Roman',serif";
        $sans  = "'Helvetica Neue',Arial,sans-serif";
        $row = fn($label,$value) => '<td style="padding:0 0 6px;"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8e9c;font-family:'.$sans.';">'.$label.'</div><div style="font-size:16px;color:#1c1e26;font-family:'.$sans.';padding-top:3px;">'.$value.'</div></td>';
        $priceRow = fn($l,$v) => '<tr><td style="padding:7px 0;font-size:15px;color:#3a3d49;font-family:'.$sans.';">'.$l.'</td><td align="right" style="padding:7px 0;font-size:15px;color:#3a3d49;font-family:'.$sans.';">'.$v.'</td></tr>';

        $html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eceef4;">'
          . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceef4;padding:30px 12px;"><tr><td align="center">'
          . '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fbfbfd;border-radius:24px;overflow:hidden;border:1px solid #e2e4ec;">'
          . email_crown_header('#fbfbfd')
          // header band
          . '<tr><td style="padding:34px 40px 8px;">'
          . '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
          . '<td style="vertical-align:middle;"><span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:'.$accent.';"></span></td>'
          . '<td style="vertical-align:middle;padding-left:12px;"><span style="font-family:'.$serif.';font-size:30px;font-weight:700;color:#1c1e26;">'.$esc($b['prop_name']).'</span></td>'
          . '<td style="vertical-align:middle;padding-left:14px;"><span style="display:inline-block;background:#c7e7cb;color:#2e7d32;font-family:'.$sans.';font-size:11px;font-weight:700;letter-spacing:1px;padding:6px 14px;border-radius:14px;">UPCOMING</span></td>'
          . '</tr></table>'
          . '<div style="font-family:'.$sans.';font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8a8e9c;padding-top:12px;">Booking Ref '.$esc($b['ref']).'</div>'
          . '</td></tr>'
          // check in / out
          . '<tr><td style="padding:22px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
          . $row('Check in', $esc($b['check_in']).' &middot; '.$esc($b['check_in_time']))
          . $row('Check out', $esc($b['check_out']).' &middot; '.$esc($b['check_out_time']))
          . '</tr></table><div style="border-bottom:1px solid #e8eaf0;margin-top:14px;"></div></td></tr>'
          // party / payment
          . '<tr><td style="padding:18px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
          . $row('Party', $esc($party))
          . '<td style="padding:0 0 6px;"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8e9c;font-family:'.$sans.';">Payment</div><div style="font-size:16px;color:'.$paymentColor.';font-family:'.$sans.';padding-top:3px;">'.$paymentLabel.'</div></td>'
          . '</tr></table><div style="border-bottom:1px solid #e8eaf0;margin-top:14px;"></div></td></tr>'
          // address
          . '<tr><td style="padding:18px 40px 0;"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8e9c;font-family:'.$sans.';">Address</div><div style="font-size:16px;color:#1c1e26;font-family:'.$sans.';padding-top:5px;">'.$esc($b['address']).'</div><div style="border-bottom:1px solid #e8eaf0;margin-top:16px;"></div></td></tr>'
          // price box
          . '<tr><td style="padding:24px 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;border:1px solid #e6e8f0;border-radius:14px;"><tr><td style="padding:6px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
          . $priceRow($money($b['per_night']).' &times; '.$nightsTxt, $money($b['nightly']))
          . $priceRow('Transaction fee ('.$esc($b['tx_pct']).'%)', $money($b['tx_fee']))
          . $priceRow('Refundable damages deposit', $money($b['damages_deposit']))
          . '<tr><td colspan="2" style="border-bottom:1px solid #dcdee8;padding-top:4px;"></td></tr>'
          . '<tr><td style="padding:14px 0 6px;font-family:'.$serif.';font-size:20px;font-weight:700;color:#1c1e26;">Total</td><td align="right" style="padding:14px 0 6px;font-family:'.$serif.';font-size:22px;font-weight:700;color:#1c1e26;">'.$money($b['total']).'</td></tr>'
          . '</table></td></tr></table></td></tr>'
          // footer
          . '<tr><td style="padding:18px 40px 36px;text-align:center;font-family:'.$sans.';font-size:13px;color:#8a8e9c;line-height:1.6;">Any questions? Just reply to this email.<br>We look forward to welcoming you.<br><strong style="color:#1c1e26;">Cottage Holidays Blakeney</strong></td></tr>'
          . '</table></td></tr></table></body></html>';

        $out['guest'] = smtp_send($b['email'], $b['name'], $subject, $body, $html);
    } else {
        $out['guest']['error'] = 'No guest email on file';
    }

    // ---- Owner notification ----
    if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) {
        $subject = "New confirmed booking — {$b['prop_name']} ({$b['check_in']})";
        $body  = "A booking has just been confirmed.\n\n";
        $body .= "Reference: {$b['ref']}\n";
        $body .= "Property: {$b['prop_name']}\n";
        $body .= "Guest: {$b['name']}\n";
        $body .= "Email: " . ($b['email'] ?: '—') . "\n";
        $body .= "Phone: " . ($b['phone'] ?? '—') . "\n";
        $body .= "Check in:  {$b['check_in']} ({$b['check_in_time']})\n";
        $body .= "Check out: {$b['check_out']} ({$b['check_out_time']})\n";
        $body .= "Stay: {$nightsTxt}\n";
        $body .= "Guests: {$party}\n";
        $body .= "Total: " . $money($b['total']) . "\n";
        $out['owner'] = smtp_send(OWNER_NOTIFY_EMAIL, 'Owner', $subject, $body);
    }

    return $out;
}

// ------------------------------------------------------------------
//  Pre-arrival "arrival info" email: sent a few days before check-in
//  (via pre-arrival.php cron) or manually from the back office.
//  $b: prop_key, prop_name, guest name/email, check_in, check_out,
//      check_in_time, address, info (owner-written arrival details).
// ------------------------------------------------------------------
function send_arrival_email($b) {
    if (empty($b['email'])) return ['ok' => false, 'error' => 'No guest email on file'];
    $colors = ['21a' => '#42A5F5', 'jollyboat' => '#43A047', 'pimpernel' => '#9C27B0'];
    $accent = $colors[$b['prop_key'] ?? ''] ?? '#42A5F5';
    $name = $b['name'] ?: 'Guest';
    $prop = $b['prop_name'] ?: 'your cottage';
    $inDate  = date('D j M Y', strtotime($b['check_in']));
    $time = $b['check_in_time'] ?: '15:00';
    $addr = trim($b['address'] ?? '');
    // The actual entry/key code is NOT emailed (see send_arrival_for_booking);
    // guests reveal it in-app once they're at the cottage. We just point them there.
    $reveal = 'When you arrive, log in to your account on our website and open "My Bookings" to reveal your entry details for the cottage.';

    $subject = "Your stay at {$prop} — arrival information";
    $text = "Hello {$name},\n\n"
          . "Your stay at {$prop} begins on {$inDate}. Check-in is from {$time}.\n\n"
          . ($addr !== '' ? "Address:\n{$addr}\n\n" : '')
          . $reveal . "\n\n"
          . "We look forward to welcoming you.\n\nCottage Holidays Blakeney";

    $addrHtml = $addr !== '' ? nl2br(htmlspecialchars($addr, ENT_QUOTES, 'UTF-8')) : '';
    $html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f6;">'
      . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:24px 0;"><tr><td align="center">'
      . '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">'
      . email_crown_header('#ffffff')
      . '<tr><td style="padding:26px 30px 18px;">'
      . '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
      . '<td style="width:12px;height:12px;background:' . $accent . ';border-radius:3px;"></td>'
      . '<td style="padding-left:10px;font-size:18px;font-weight:bold;color:#1a1a1a;">' . htmlspecialchars($prop, ENT_QUOTES, 'UTF-8') . '</td>'
      . '</tr></table>'
      . '<p style="font-size:14px;color:#333;line-height:1.6;margin:18px 0 0;">Hello ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . ',</p>'
      . '<p style="font-size:14px;color:#333;line-height:1.6;margin:10px 0 0;">Your stay begins on <strong>' . $inDate . '</strong>. Check-in is from <strong>' . htmlspecialchars($time, ENT_QUOTES, 'UTF-8') . '</strong>.</p>'
      . ($addrHtml !== '' ? '<p style="font-size:13px;color:#555;line-height:1.6;margin:16px 0 0;"><strong style="color:#333;">Address</strong><br>' . $addrHtml . '</p>' : '')
      . '<div style="margin:18px 0 0;padding:16px 18px;background:#f8f8fa;border-left:4px solid ' . $accent . ';border-radius:8px;font-size:13px;color:#444;line-height:1.7;">When you arrive, log in to your account on our website and open <strong>My Bookings</strong> to reveal your entry details for the cottage.</div>'
      . '<p style="font-size:13px;color:#777;line-height:1.6;margin:22px 0 4px;">We look forward to welcoming you.</p>'
      . '<p style="font-size:13px;color:#777;margin:0 0 6px;">Cottage Holidays Blakeney</p>'
      . '</td></tr></table></td></tr></table></body></html>';

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Build + send the arrival email for a saved booking row, then mark it sent.
// Returns the smtp_send result. Never throws. Requires db() (always loaded).
function send_arrival_for_booking($bk) {
    try {
        $p = db()->prepare('SELECT name, address FROM properties WHERE prop_key = ?');
        $p->execute([$bk['prop_key']]);
        $prop = $p->fetch() ?: ['name' => $bk['prop_key'], 'address' => ''];
        // The door/key code (arrival-<prop>) is deliberately NOT emailed; guests
        // reveal it in-app via the geofenced "My Bookings" flow (arrival-access.php),
        // so this path never even decrypts it.
        $res = send_arrival_email([
            'prop_key' => $bk['prop_key'], 'prop_name' => $prop['name'],
            'name' => $bk['name'], 'email' => $bk['email'],
            'check_in' => $bk['check_in'], 'check_out' => $bk['check_out'],
            'check_in_time' => $bk['check_in_time'] ?? '15:00',
            'address' => $prop['address'],
        ]);
        if (!empty($res['ok'])) {
            try { db()->prepare('UPDATE bookings SET pre_arrival_sent = NOW() WHERE id = ?')->execute([(int)$bk['id']]); }
            catch (\Throwable $e) {} // column may not exist yet — email still sent
        }
        return $res;
    } catch (\Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}
