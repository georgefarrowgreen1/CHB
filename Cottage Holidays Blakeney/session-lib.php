<?php
// ============================================================
//  session-lib.php — the session's lifetime and the daily sweep
//  of the session folder. Pure: no database, no output, so
//  test-session-lock.php drives it directly.
//
//  THE SESSION LOCK. PHP's file sessions hold an exclusive lock
//  from session_start() until the request ends, so while one
//  request held it every other request from the same browser
//  waited: one slow call (the POP3 mailbox, a Square refresh, a
//  calendar sync, a photo being resized) stalled the whole screen
//  behind it. db.php now lets go of the lock as soon as its own
//  checks are done (the CSRF token and the signed-out check both
//  write before that point), EXCEPT in an endpoint that declares
//  define('CHB_KEEPS_SESSION', true) before requiring db.php —
//  the only files that write the session. test-session-lock.php
//  fails if any other file writes it or calls a helper that does.
// ============================================================

// How long a session lasts. db.php sets the cookie and PHP's own garbage
// collection from it, and the sweep below uses it as the age past which a file
// can only belong to a session whose cookie has expired as well.
const CHB_SESSION_TTL = 60 * 60 * 24 * 60; // 60 days

// The session folder is the app's own (db.php moves it out of the host's default
// path), so the host's clean-up never reaches it, and PHP's garbage collection is
// often switched off (session.gc_probability = 0 on Debian-style hosts). Measured
// on a test machine: 6,675 files, every one of them empty. Two kinds of file go:
//  * an EMPTY one over a day old. Every request that arrives without a cookie (a
//    crawler, the first burst of a new visitor's page) creates one, and an empty
//    session holds nothing that could be lost;
//  * any file untouched for longer than the session lifetime. PHP refreshes a live
//    session's file on every request, so these belong to sessions whose cookie
//    has expired too.
// Only names PHP itself writes (sess_ + the id) are ever touched.
function session_files_prune(string $dir, int $now, int $ttl = CHB_SESSION_TTL, int $emptyAge = 86400): array
{
    $out = ['empty' => 0, 'expired' => 0, 'kept' => 0];
    $h = is_dir($dir) ? @opendir($dir) : false;
    if (!$h) {
        return $out;
    }
    while (($f = readdir($h)) !== false) {
        if (!preg_match('/^sess_[A-Za-z0-9,-]{20,256}$/', $f)) {
            continue;
        }
        $p = $dir . '/' . $f;
        if (is_link($p) || !is_file($p)) {
            continue;
        }
        $st = @stat($p);
        if (!$st) {
            continue;
        }
        $age = $now - (int) $st['mtime'];
        if ((int) $st['size'] === 0 && $age > $emptyAge) {
            $out['empty'] += @unlink($p) ? 1 : 0;
        } elseif ($age > $ttl) {
            $out['expired'] += @unlink($p) ? 1 : 0;
        } else {
            $out['kept']++;
        }
    }
    closedir($h);
    return $out;
}
