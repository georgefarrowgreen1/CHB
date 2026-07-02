<?php
// ============================================================
//  experiences-page.php — server-rendered shell for /experiences.
//
//  The Experiences view (hand-picked local things to do) was rendered
//  entirely by JavaScript with no URL of its own, so the best "things to do
//  in Blakeney" content on the site was invisible to search engines. The
//  .htaccess rewrite gives it a real URL and this route serves the app shell
//  with the published experiences rendered into the (otherwise empty)
//  #exp-grid, plus a page-specific title / description / canonical / og:
//  tags. app.js recognises the /experiences path on boot and opens the view,
//  then re-renders the rich interactive cards over the server markup.
//
//  Same pattern and guarantees as cottage.php / home.php: standalone PDO,
//  and on ANY problem it serves index.html untouched.
// ============================================================

$html = @file_get_contents(__DIR__ . '/index.html');
if ($html === false) { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); exit('Not found'); }

$out = $html;
try {
    if (is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET,
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 3]
        );
        $rows = $pdo->query("SELECT title, body, category, distance FROM experiences
                             WHERE status = 'published' ORDER BY sort_order, id")->fetchAll();

        $esc = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $origin = 'https://cottageholidaysblakeney.co.uk';
        $canon  = $origin . '/experiences';
        $title  = 'Things to do in Blakeney & North Norfolk | Cottage Holidays Blakeney';
        $metaDesc = 'Hand-picked things to do around Blakeney: seal trips to Blakeney Point, coastal walks, beaches, pubs and food — curated by your hosts'
                  . ($rows ? ' (' . count($rows) . ' local recommendations)' : '') . '.';

        $inject = function ($pattern, $text) use (&$out, $esc) {
            $new = preg_replace_callback($pattern, fn($m) => $m[1] . $esc($text) . $m[2], $out, 1);
            if (is_string($new)) $out = $new;
        };
        $inject('#(<title>).*?(</title>)#s', $title);
        $inject('#(<meta name="description" content=")[^"]*(")#', $metaDesc);
        $inject('#(<link rel="canonical" href=")[^"]*(")#', $canon);
        $inject('#(<meta property="og:title" content=")[^"]*(")#', 'Things to do in Blakeney & North Norfolk');
        $inject('#(<meta property="og:description" content=")[^"]*(")#', $metaDesc);
        $inject('#(<meta property="og:url" content=")[^"]*(")#', $canon);
        $inject('#(<meta name="twitter:title" content=")[^"]*(")#', 'Things to do in Blakeney & North Norfolk');
        $inject('#(<meta name="twitter:description" content=")[^"]*(")#', $metaDesc);

        // The crawlable list itself: plain cards in the app's own classes, rendered
        // into the empty #exp-grid (the JS re-renders its rich version on boot).
        if ($rows) {
            $cards = '';
            foreach ($rows as $r) {
                $meta = trim($r['category'] . ($r['distance'] !== '' ? ' · ' . $r['distance'] : ''), ' ·');
                $cards .= '<div class="card glass-panel"><div class="card-title">' . $esc($r['title']) . '</div>'
                        . ($meta !== '' ? '<div class="card-meta">' . $esc($meta) . '</div>' : '')
                        . '<p class="lead" style="font-size:0.9rem;text-align:left;margin:8px 0 0;">' . $esc($r['body']) . '</p></div>';
            }
            $anchor = '<div id="exp-grid" class="grid grid-3" style="margin-top:18px;"></div>';
            $new = str_replace($anchor, '<div id="exp-grid" class="grid grid-3" style="margin-top:18px;">' . $cards . '</div>', $out);
            if (is_string($new)) $out = $new;
        }
    }
} catch (\Throwable $e) {
    $out = $html;   // any hiccup → the untouched shell
}

header('Content-Type: text/html; charset=utf-8');
echo $out;
