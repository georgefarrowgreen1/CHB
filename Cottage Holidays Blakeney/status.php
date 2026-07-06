<?php
// ============================================================
//  status.php — public, login-free "is the site working?" page.
//  Served at /status (rewrite in htaccess.txt). Shows the owner (or anyone)
//  at a glance whether the core systems are up: the site itself, the database,
//  whether it's accepting enquiries/bookings, card payments, and email.
//
//  Deliberately STANDALONE (own short-timeout PDO, never db.php — db()'s exit
//  path would blank this page). It must ALWAYS render: any failure just shows
//  that subsystem as down rather than a 500. No secrets, no counts, no data —
//  only on/off health, so it's safe to expose without a login.
// ============================================================

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow'); // a status page shouldn't be indexed
header('Cache-Control: no-store'); // always live

// ---- Probe each subsystem (best-effort; a throw = that check is "down") ----
$dbUp = false;
$paymentsOn = false;
$emailOn = false;
$configLoaded = false;

try {
    if (is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
        $configLoaded = true;
    }
} catch (\Throwable $e) {
}

if ($configLoaded) {
    try {
        if (defined('DB_HOST')) {
            $pdo = new PDO(
                'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . (defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4'),
                DB_USER,
                DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3],
            );
            $pdo->query('SELECT 1');
            $dbUp = true;
        }
    } catch (\Throwable $e) {
        $dbUp = false;
    }

    // Card payments: Square switched on AND credentials present (mirrors
    // square_enabled() in db.php, re-checked here so we don't pull in db.php).
    $paymentsOn =
        defined('SQUARE_PAYMENTS_ENABLED') &&
        SQUARE_PAYMENTS_ENABLED &&
        defined('SQUARE_ACCESS_TOKEN') &&
        SQUARE_ACCESS_TOKEN !== '' &&
        defined('SQUARE_LOCATION_ID') &&
        SQUARE_LOCATION_ID !== '';

    // Email: turned on AND an SMTP host set.
    $emailOn = defined('MAIL_ENABLED') && MAIL_ENABLED && defined('SMTP_HOST') && SMTP_HOST !== '';
}

// The site is "online" simply because this script ran. Bookings/enquiries need
// the database; everything else is independent.
$rows = [
    ['Website', true, 'Online — pages are loading'],
    ['Database', $dbUp, $dbUp ? 'Connected' : 'Not reachable right now'],
    ['Enquiries & bookings', $dbUp, $dbUp ? 'Accepting new enquiries' : 'Temporarily unavailable'],
    ['Card payments', $paymentsOn, $paymentsOn ? 'Online — cards accepted' : 'Off — pay by bank transfer'],
    ['Email', $emailOn, $emailOn ? 'Sending confirmations & updates' : 'Off — emails paused'],
];

// Overall: green only if the site + database are up (payments/email being off is
// a valid owner choice, not an outage).
$allCore = $rows[0][1] && $dbUp;
$overallLabel = $allCore ? 'All systems operational' : 'Some systems are having trouble';

// GMT stamp so the page shows when it was checked.
$checkedAt = gmdate('j M Y, H:i') . ' UTC';

function status_esc($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Service status — Cottage Holidays Blakeney</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f3ee; color: #2b2b2b; padding: 24px; line-height: 1.5;
  }
  .card {
    width: 100%; max-width: 520px; background: #fff; border-radius: 20px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.08); padding: 28px 26px; border: 1px solid rgba(0,0,0,0.05);
  }
  h1 { font-size: 1.15rem; margin: 0 0 2px; font-weight: 600; }
  .sub { font-size: 0.82rem; color: #8a8377; margin: 0 0 20px; }
  .overall {
    display: flex; align-items: center; gap: 10px; padding: 13px 15px; border-radius: 13px;
    font-weight: 600; font-size: 0.95rem; margin-bottom: 18px;
  }
  .overall.ok { background: #e9f6ec; color: #1c7a35; }
  .overall.bad { background: #fdecec; color: #b23c3c; }
  .dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
  .dot.ok { background: #34a853; box-shadow: 0 0 0 4px rgba(52,168,83,0.15); }
  .dot.bad { background: #e0a020; box-shadow: 0 0 0 4px rgba(224,160,32,0.18); }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex; align-items: center; gap: 12px; padding: 13px 2px;
    border-bottom: 1px solid rgba(0,0,0,0.06);
  }
  li:last-child { border-bottom: 0; }
  .name { font-weight: 550; font-size: 0.92rem; }
  .desc { font-size: 0.8rem; color: #8a8377; margin-top: 1px; }
  .txt { flex: 1; min-width: 0; }
  .foot { margin-top: 20px; font-size: 0.78rem; color: #a49c8d; text-align: center; }
  .foot a { color: #8a7a55; }
  @media (prefers-color-scheme: dark) {
    body { background: #17150f; color: #eee7d8; }
    .card { background: #211e16; border-color: rgba(255,255,255,0.06); box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
    .sub, .desc, .foot { color: #9a9080; }
    li { border-color: rgba(255,255,255,0.07); }
    .overall.ok { background: rgba(52,168,83,0.14); color: #6bd188; }
    .overall.bad { background: rgba(224,160,32,0.14); color: #e6b74e; }
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Cottage Holidays Blakeney</h1>
    <p class="sub">Service status</p>
    <div class="overall <?= $allCore ? 'ok' : 'bad' ?>">
      <span class="dot <?= $allCore ? 'ok' : 'bad' ?>"></span>
      <?= status_esc($overallLabel) ?>
    </div>
    <ul>
      <?php foreach ($rows as $r): ?>
      <li>
        <span class="dot <?= $r[1] ? 'ok' : 'bad' ?>"></span>
        <span class="txt">
          <div class="name"><?= status_esc($r[0]) ?></div>
          <div class="desc"><?= status_esc($r[2]) ?></div>
        </span>
      </li>
      <?php endforeach; ?>
    </ul>
    <div class="foot">
      Checked <?= status_esc($checkedAt) ?> · <a href="/">Back to the website</a>
    </div>
  </div>
</body>
</html>
