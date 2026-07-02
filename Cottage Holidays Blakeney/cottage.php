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

        // The lookup ran fine and no live cottage matches: a real 404 (not a "soft
        // 404" 200), so search engines drop stale/typo'd URLs. Humans still get the
        // full app shell below and can navigate on.
        if (!$p) http_response_code(404);

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

            // Social preview image: this cottage's first gallery photo (content key
            // images-<key> is a JSON array of upload paths), falling back to the
            // live hero — never the static hero.jpg, which 404s on the live host.
            $ogImg = '';
            try {
                $gi = $pdo->prepare('SELECT item_value FROM content WHERE item_key = ?');
                $gi->execute(['images-' . $key]);
                $gv = $gi->fetchColumn();
                if ($gv !== false) { $arr = json_decode((string)$gv, true); if (is_array($arr) && !empty($arr[0]) && is_string($arr[0])) $ogImg = trim($arr[0]); }
                if ($ogImg === '') { $hv = $cv('hero-bg'); if ($hv !== '') $ogImg = $hv; }
            } catch (\Throwable $e) {}
            $safeImg = ($ogImg !== '' && preg_match('#^[a-z0-9/_.\-]+\.(jpe?g|png|webp)$#i', $ogImg)) ? ($origin . '/' . ltrim($ogImg, '/')) : '';

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
            if ($safeImg !== '') {
                $inject('#(<meta property="og:image" content=")[^"]*(")#', $safeImg);
                $inject('#(<meta name="twitter:image" content=")[^"]*(")#', $safeImg);
                $inject('#(<meta property="og:image:alt" content=")[^"]*(")#', 'Photo of ' . $name);
                $inject('#(<meta name="twitter:image:alt" content=")[^"]*(")#', 'Photo of ' . $name);
            }

            // Search-result stars: inject this cottage's real review rating into its
            // JSON-LD node so Google can show gold stars under the listing. The static
            // nodes only exist for the original three — no match just skips (added
            // cottages still get theirs client-side).
            try {
                $rs = $pdo->prepare("SELECT COUNT(*) c, AVG(stars) a FROM guest_reviews WHERE prop_key = ? AND status = 'approved'");
                $rs->execute([$key]);
                $agg = $rs->fetch();
                if ($agg && (int)$agg['c'] > 0) {
                    $frag = json_encode([
                        '@type' => 'AggregateRating',
                        'ratingValue' => number_format(min(5, max(1, (float)$agg['a'])), 1),
                        'reviewCount' => (string)(int)$agg['c'],
                        'bestRating' => '5', 'worstRating' => '1',
                    ], JSON_UNESCAPED_SLASHES);
                    $anchor = '"@id": "' . $origin . '/#cottage-' . $key . '",';
                    $new = str_replace($anchor, $anchor . "\n          \"aggregateRating\": " . $frag . ',', $out);
                    if (is_string($new)) $out = $new;
                }
            } catch (\Throwable $e) {}

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
