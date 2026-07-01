<?php
// ============================================================
//  cottage.php — server-rendered shell for /cottages/<slug>.
//
//  The .htaccess rewrite sends clean cottage URLs here instead of straight to
//  index.html. We serve the SAME app shell, but with that cottage's real
//  content injected server-side — <title>, meta description, canonical, the
//  og:/twitter: preview tags, and the visible <h1>/subtitle/description — so
//  search engines and link-preview bots see unique, indexable content without
//  executing JavaScript. app.js still boots and re-renders exactly as before
//  (it overwrites these same elements), so nothing changes for visitors.
//
//  Deliberately standalone (no db.php): db.php starts a session, sets a JSON
//  content type, and its db() helper EXITS with a JSON error if the database
//  is down — any of which would corrupt this public HTML page. A private PDO
//  here throws instead, so every failure is caught below.
//
//  Safety: ANY problem — DB down, unknown slug, config missing, markup moved —
//  falls back to serving index.html completely untouched, byte for byte.
// ============================================================

$html = @file_get_contents(__DIR__ . '/index.html');
if ($html === false) { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); exit('Not found'); }

$out = $html;
try {
    // The slug is the path segment after /cottages/ (the rewrite keeps REQUEST_URI).
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    $slug = '';
    if (preg_match('#/cottages/([a-z0-9\-]+)#i', $path, $m)) $slug = strtolower($m[1]);

    if ($slug !== '' && is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';

        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET,
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 3]
        );

        // Match by slug, falling back to prop_key (pre-migration cottages have no slug).
        $st = $pdo->prepare('SELECT prop_key, name, slug, max_total FROM properties
                             WHERE (slug = ? OR prop_key = ?) AND archived_at IS NULL LIMIT 1');
        $st->execute([$slug, $slug]);
        $p = $st->fetch();

        if ($p) {
            // Owner-edited copy lives in the content table under the same keys the
            // front end reads (<prop_key>-title/-subtitle/-desc), JSON-encoded —
            // mirror content_value()'s decode. '' when unset.
            $cv = function ($key) use ($pdo) {
                $s = $pdo->prepare('SELECT item_value FROM content WHERE item_key = ?');
                $s->execute([$key]);
                $v = $s->fetchColumn();
                if ($v === false) return '';
                $d = json_decode((string)$v, true);
                if (is_string($d)) return $d;
                return is_scalar($d) ? (string)$d : '';
            };

            $esc  = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
            $key  = $p['prop_key'];
            $name     = trim($cv($key . '-title') ?: (string)($p['name'] ?: $key));
            $subtitle = trim($cv($key . '-subtitle'));
            $desc     = trim($cv($key . '-desc'));
            if ($desc === '') {
                $sleeps = (int)($p['max_total'] ?? 0);
                $desc = $name . ' — self-catering holiday cottage in Blakeney on the North Norfolk coast'
                      . ($sleeps ? ', sleeping up to ' . $sleeps : '')
                      . '. Near the quay, the coastal path and Blakeney Point. Book directly with the owner — no booking fees.';
            }
            $metaDesc = mb_strlen($desc) > 158 ? rtrim(mb_substr($desc, 0, 155)) . '…' : $desc;

            $origin = 'https://cottageholidaysblakeney.co.uk';
            $canon  = $origin . '/cottages/' . rawurlencode($p['slug'] ?: $key);
            $title  = $name . ' — Holiday Cottage in Blakeney, Norfolk | Cottage Holidays Blakeney';

            // Replace the first match of $pattern with group1 + escaped text + group2.
            // preg_replace_callback so '$' or '\' in owner copy can never be misread
            // as a backreference; a pattern that no longer matches (markup moved) is
            // silently skipped — never fatal.
            $inject = function ($pattern, $text) use (&$out, $esc) {
                $new = preg_replace_callback($pattern, fn($m) => $m[1] . $esc($text) . $m[2], $out, 1);
                if (is_string($new)) $out = $new;
            };

            // Head: title, description, canonical, social preview tags.
            $inject('#(<title>).*?(</title>)#s', $title);
            $inject('#(<meta name="description" content=")[^"]*(")#', $metaDesc);
            $inject('#(<link rel="canonical" href=")[^"]*(")#', $canon);
            $inject('#(<meta property="og:title" content=")[^"]*(")#', $name . ' | Cottage Holidays Blakeney');
            $inject('#(<meta property="og:description" content=")[^"]*(")#', $metaDesc);
            $inject('#(<meta property="og:url" content=")[^"]*(")#', $canon);
            $inject('#(<meta name="twitter:title" content=")[^"]*(")#', $name . ' | Cottage Holidays Blakeney');
            $inject('#(<meta name="twitter:description" content=")[^"]*(")#', $metaDesc);

            // Body: the crawlable page content itself (app.js re-renders these on boot).
            $inject('#(<h1 class="section-title prop-h1" id="prop-title">)(</h1>)#', $name);
            if ($subtitle !== '') $inject('#(<p class="prop-subtitle" id="prop-subtitle">)(</p>)#', $subtitle);
            $inject('#(id="prop-desc">)(</p>)#', $desc);
        }
    }
} catch (\Throwable $e) {
    $out = $html;   // any hiccup → the untouched shell, exactly as before this file existed
}

header('Content-Type: text/html; charset=utf-8');
echo $out;
