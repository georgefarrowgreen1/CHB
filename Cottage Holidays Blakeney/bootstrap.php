<?php
// ============================================================
//  bootstrap.php — everything the public site needs for first paint, in ONE
//  round-trip: { ok, rates, content, reviews, square }. Replaces four separate
//  boot API calls (rates.php, content.php, reviews.php, square-config.php) —
//  on shared hosting each request is its own PHP process + DB connection, so
//  collapsing 4→1 cuts real latency, and the 30s live-update tick reuses it.
//
//  Each part is built by the SAME payload function its own endpoint serves
//  (rates_public_payload() etc. — the endpoints early-return before routing
//  when included), so this can never drift from the individual APIs. The
//  individual endpoints stay live as the front end's fallback.
//
//  ETag/304: the response carries a strong ETag with Cache-Control: no-cache
//  (store, but revalidate). The browser then sends If-None-Match on every
//  poll and an unchanged site costs a ~0-byte 304 instead of the full payload
//  — fetch() serves the cached body to the app transparently.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/rates.php';
require_once __DIR__ . '/content.php';
require_once __DIR__ . '/reviews.php';
require_once __DIR__ . '/square-config.php';

// Each part is byte-shape-identical to its own endpoint's GET response, so the
// front-end loaders can consume either interchangeably. An empty content map
// must encode as {} (not []) — same as json_out would produce via the assoc map.
$content = content_public_payload();
if ($content['content'] === []) {
    $content['content'] = new stdClass();
}
$payload = [
    'ok' => true,
    'rates' => rates_public_payload(),
    'content' => $content,
    'reviews' => reviews_public_payload(),
    'square' => square_config_payload(),
];

$body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($body === false) {
    json_out(['error' => 'Response encoding error'], 500);
}

// Strong ETag over the exact bytes. PHP's session machinery sends no-store
// headers by default, which would block conditional revalidation — replace
// them so the browser stores the body and revalidates each time.
$etag = '"' . md5($body) . '"';
header_remove('Pragma');
header_remove('Expires');
header('Cache-Control: no-cache, private');
header('ETag: ' . $etag);
header('Content-Type: application/json; charset=utf-8');

$inm = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($inm !== '' && $inm === $etag) {
    http_response_code(304);
    exit();
}

echo $body;
