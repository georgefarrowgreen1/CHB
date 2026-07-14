<?php
// ============================================================
//  blocked.php — the "you've been bounced" page for requests that trip the
//  request firewall in .htaccess (obvious URL/injection attack signatures).
//  Served at /blocked (rewrite in htaccess.txt) after a 302 from the attacking
//  URL. Returns 403, tells the attacker off, and best-effort logs the attempt to
//  the owner's activity log ("Needs attention").
//
//  DELIBERATELY STANDALONE — own short-timeout PDO, never db.php (db()'s exit
//  path would blank this page). It must ALWAYS render; logging is best-effort and
//  can never break the page. No secrets, no app bundle, no data.
// ============================================================

http_response_code(403);
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

// ---- Best-effort: record the attempt so the owner sees it in the activity log.
// Everything here is wrapped so a DB hiccup (or a pre-migration schema) can never
// stop the page from rendering.
try {
    if (is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
        if (defined('DB_HOST')) {
            $pdo = new PDO(
                'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . (defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4'),
                DB_USER,
                DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3],
            );
            // The forwarding proxy (IONOS) puts the real client IP in X-Forwarded-For.
            $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
            $ip = $fwd !== '' ? trim(explode(',', $fwd)[0]) : ($_SERVER['REMOTE_ADDR'] ?? '');
            $meta = json_encode([
                'uri' => mb_substr((string) ($_SERVER['REQUEST_URI'] ?? ''), 0, 300),
                'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 160),
                'ref' => mb_substr((string) ($_SERVER['HTTP_REFERER'] ?? ''), 0, 200),
            ]);
            // De-dupe: at most one blocked-request log per IP per hour, so a scanner
            // firing hundreds of probes can't flood the log.
            $recent = $pdo->prepare(
                "SELECT 1 FROM activity_log WHERE action = 'request.blocked' AND ip = ? AND created_at > (NOW() - INTERVAL 1 HOUR) LIMIT 1",
            );
            $recent->execute([$ip]);
            if (!$recent->fetchColumn()) {
                $pdo->prepare(
                    "INSERT INTO activity_log (actor, category, action, summary, ip, meta, severity)
                     VALUES ('system', 'security', 'request.blocked', 'Blocked a suspicious request (possible injection attempt)', ?, ?, 'warn')",
                )->execute([mb_substr((string) $ip, 0, 60), $meta]);
            }
        }
    }
} catch (\Throwable $e) {
    // logging is optional — never let it affect the response
}

// A fixed, safe home URL (the attacker's Host header is never echoed here).
$home = 'https://cottageholidaysblakeney.co.uk/';
?>
<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Request blocked — Cottage Holidays Blakeney</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 28px; background: #f5f1e9; color: #1b2a34;
    font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .card {
    width: 100%; max-width: 520px; background: rgba(255, 255, 255, 0.82);
    border: 1px solid rgba(28, 46, 58, 0.12); border-radius: 28px;
    padding: 40px 34px; box-shadow: 0 18px 50px rgba(30, 54, 72, 0.16); text-align: center;
  }
  .eyebrow {
    font-size: 0.72rem; letter-spacing: 3px; text-transform: uppercase;
    color: #c62828; font-weight: 700; margin: 0 0 10px;
  }
  h1 {
    font-family: Georgia, "Times New Roman", serif; font-size: 2rem; margin: 0 0 14px; color: #1b2a34;
  }
  p { margin: 0 0 14px; color: #33454f; font-size: 0.98rem; }
  .muted { color: #6a7a83; font-size: 0.86rem; }
  a.home {
    display: inline-block; margin-top: 12px; padding: 13px 26px; border-radius: 999px;
    background: #c6885e; color: #fff; text-decoration: none; font-weight: 600; font-size: 0.9rem;
  }
  .crown { width: 40px; height: 40px; margin: 0 auto 14px; display: block; opacity: 0.85; }
</style>
</head>
<body>
  <main class="card" role="main">
    <svg class="crown" viewBox="0 0 24 24" fill="none" stroke="#c6885e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>
    </svg>
    <p class="eyebrow">Request blocked</p>
    <h1>Nice try.</h1>
    <p>That request looked like an attempt to attack this website. It's been <strong>blocked and logged</strong>, along with your address.</p>
    <p>Cottage Holidays Blakeney is a small family business on the North Norfolk coast — a few holiday cottages, not a target. There's nothing here worth breaking into, so please don't.</p>
    <p class="muted">If you're a real guest and landed here by mistake, no harm done — just head back and try again.</p>
    <a class="home" href="<?php echo htmlspecialchars($home, ENT_QUOTES); ?>">← Back to the cottages</a>
  </main>
</body>
</html>
