<?php
// ============================================================================
//  shell-etag.php — the conditional-GET ending for the three SSR shell routes
//  (home.php, cottage.php, experiences-page.php), stated ONCE.
//
//  WHY. All three emitted only `Content-Type: text/html` — no ETag, no
//  Last-Modified, no Cache-Control — and none calls session_start(), so PHP
//  added no validator either. The shell gzips to ~34.5KB, and sw.js's navigation
//  branch is network-first and always awaits the network, so an INSTALLED PWA
//  re-downloaded all 34.5KB on the critical path of every launch even though its
//  cached copy was byte-identical. Measured against a repeat visit's ~1.7KB of
//  real wire traffic, the unchanged shell was ~95% of what a returning visitor
//  downloaded.
//
//  THE COMPARISON MUST BE TOLERANT, or it silently never fires in production.
//  htaccess enables `AddOutputFilterByType DEFLATE text/html` and carries no
//  `DeflateAlterETag` directive, and Apache 2.4's default is AddSuffix — so
//  mod_deflate rewrites `ETag: "abc"` to `"abc-gzip"` ON THE WIRE and the
//  browser echoes back `If-None-Match: "abc-gzip"`. A byte-exact comparison
//  would therefore match nothing, on every request, while looking perfectly
//  correct in the source and passing any test that spoke to PHP directly. The
//  suffix is stripped here rather than fixed in htaccess because this works
//  whatever the host's deflate configuration turns out to be.
//
//  A browser may also send a weak validator (`W/"abc"`) or a comma-separated
//  list, and RFC 9110 allows `*`. All four shapes are handled.
//
//  NEVER FATAL. These routes exist to serve the app shell and their whole
//  contract is that any hiccup still returns the page — so nothing here throws,
//  and if headers are already gone the body is simply sent as before.
// ============================================================================

// Normalise one client validator to the form this file mints: drop the weak
// prefix, and drop the content-coding suffix Apache appends.
function shell_etag_norm(string $tag): string
{
    $tag = trim($tag);
    if (stripos($tag, 'W/') === 0) {
        $tag = substr($tag, 2);
    }
    // "abc-gzip" -> "abc"   (also -br, and Apache's older -gzip without quotes)
    $tag = (string) preg_replace('/-(gzip|br|deflate)("?)$/i', '$2', $tag);
    return trim($tag);
}

// Does the client's If-None-Match cover this entity? RFC 9110: a comma-separated
// list, or `*` meaning "any current representation".
function shell_etag_matches(string $inm, string $etag): bool
{
    $inm = trim($inm);
    if ($inm === '') {
        return false;
    }
    if ($inm === '*') {
        return true;
    }
    foreach (explode(',', $inm) as $one) {
        if (shell_etag_norm($one) === $etag) {
            return true;
        }
    }
    return false;
}

// Send the shell with a strong ETag, answering 304 when the client already has
// these exact bytes. `Cache-Control: no-cache` means STORE IT, then revalidate —
// which is what turns a launch into a ~0-byte round trip rather than 34.5KB.
function shell_send_html(string $out): void
{
    $etag = '"' . md5($out) . '"';
    if (!headers_sent()) {
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-cache');
        header('ETag: ' . $etag);
        // Vary on Accept-Encoding: the same URL is served gzipped or not, and a
        // shared cache must not hand one encoding to a client that negotiated
        // the other (the same rule htaccess applies to the versioned assets).
        header('Vary: Accept-Encoding');
        if (shell_etag_matches((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''), $etag)) {
            http_response_code(304);
            exit();
        }
    }
    echo $out;
}
