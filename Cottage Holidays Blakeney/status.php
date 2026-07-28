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
//
//  The LOOK is standalone for the same reason: its own inline CSS, never
//  app.css. It borrows the brand's TOKEN VALUES (copied below, with the
//  measured contrast noted beside each) rather than the file, so a broken or
//  missing stylesheet can never take the status page down with it, and 60KB
//  isn't fetched to render one card. The crown is inlined for the same reason.
//  The only external references are the two self-hosted fonts, which fall back
//  to system faces via font-display: swap if they don't arrive.
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

$pdo = null;
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
        $pdo = null;
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

// ---- 30-day uptime strip -------------------------------------------------
// cron.php stamps one entry per UTC day it actually ran ('ok' / 'warn'); a
// missing day means the automation (or the whole site) was down. Render the
// last 30 days oldest→newest. No history yet (fresh install / DB down) → the
// strip is simply hidden rather than showing a wall of grey.
$uptimeDays = [];
$uptimeUp = 0;
$uptimeKnown = 0;
$uptimeNone = 0;
if ($pdo) {
    try {
        $s = $pdo->prepare("SELECT item_value FROM content WHERE item_key = 'uptime-history'");
        $s->execute();
        $raw = $s->fetchColumn();
        $hist = $raw !== false ? json_decode((string) $raw, true) : null;
        if (is_array($hist) && $hist) {
            for ($i = 29; $i >= 0; $i--) {
                $day = gmdate('Y-m-d', time() - $i * 86400);
                $state = $hist[$day] ?? 'none';
                if (!in_array($state, ['ok', 'warn'], true)) {
                    $state = 'none';
                }
                $uptimeDays[] = ['day' => $day, 'state' => $state];
                if ($state !== 'none') {
                    $uptimeKnown++;
                } else {
                    $uptimeNone++;
                }
                if ($state === 'ok') {
                    $uptimeUp++;
                }
            }
        }
    } catch (\Throwable $e) {
        $uptimeDays = [];
    }
}

// The site is "online" simply because this script ran. Bookings/enquiries need
// the database; everything else is independent.
//
// THREE states, not two. A subsystem that is switched OFF is not a fault: the
// owner may simply not take card payments, and the overall verdict already
// ignores payments/email for exactly that reason. Painting "Card payments off"
// in the same alarm colour as "Database not reachable" made the row colours
// disagree with the verdict printed directly above them. 'off' reads as chosen.
$rows = [
    ['Website', 'ok', 'Online — pages are loading'],
    ['Database', $dbUp ? 'ok' : 'down', $dbUp ? 'Connected' : 'Not reachable right now'],
    ['Enquiries & bookings', $dbUp ? 'ok' : 'down', $dbUp ? 'Accepting new enquiries' : 'Temporarily unavailable'],
    ['Card payments', $paymentsOn ? 'ok' : 'off', $paymentsOn ? 'Online — cards accepted' : 'Off — pay by bank transfer'],
    ['Email', $emailOn ? 'ok' : 'off', $emailOn ? 'Sending confirmations & updates' : 'Off — emails paused'],
];

// Overall: green only if the site + database are up (payments/email being off is
// a valid owner choice, not an outage). The website row is true by definition —
// this script ran — so the database IS the verdict.
$allCore = $dbUp;
$overallLabel = $allCore ? 'All systems operational' : 'Some systems are having trouble';
$overallSub = $allCore
    ? 'The website, bookings and enquiries are all working normally.'
    : 'The website is up, but part of it isn’t responding. Please try again shortly.';

// Stamped in UK time, not UTC: this is a UK business and the owner compares it
// against the clock on their own phone — under BST the two were an hour apart,
// which reads as a stale page. The zone is named so it still can't be misread.
// (uk_date()/fmtDate() live in db.php, which this page must not load.)
$ukNow = new DateTime('now', new DateTimeZone('Europe/London'));
$checkedAt = $ukNow->format('j M Y, H:i') . ' ' . $ukNow->format('T');

function status_esc($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

// State → the glyph inside its badge. SHAPE as well as colour, so the state
// survives a colour-blind reading, a greyscale print and a phone in bright sun.
function status_glyph($state)
{
    if ($state === 'ok') {
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 8.4l2.9 2.9 5.9-5.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if ($state === 'off') {
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="11.8" r="1.15" fill="currentColor"/></svg>';
}
// Said to a screen reader, which can't see the badge colour or the glyph.
function status_word($state)
{
    return $state === 'ok' ? 'Working' : ($state === 'off' ? 'Switched off' : 'Not working');
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Service status — Cottage Holidays Blakeney</title>
<link rel="icon" href="/favicon.png">
<style>
  /* The brand's own faces, self-hosted and same-origin. font-display: swap so a
     missing or slow file falls back to the system stack instead of blocking a
     page whose whole job is to render when things are broken. */
  @font-face {
    font-family: 'Montserrat';
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url('/fonts/montserrat-latin.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Playfair Display';
    font-style: normal;
    font-weight: 400 900;
    font-display: swap;
    src: url('/fonts/playfair-latin.woff2') format('woff2');
  }
  :root {
    color-scheme: light dark;
    /* Values copied from app.css's :root — the VALUES, not the file, so this
       page keeps no stylesheet dependency. Each was re-checked by arithmetic
       against the surface it actually paints on here. */
    --ink: #1b2a34;
    --muted: #52646e;        /* 6.16:1 on the card, 5.56:1 on the page */
    --accent-text: #965c35;  /* 5.41:1 on the card */
    --page: #f5f3ee;
    --card: #ffffff;
    --line: rgba(27, 42, 52, 0.09);
    /* Status FILLS carry meaning, so they are 1.4.11 non-text cases at 3:1 —
       and the light-mode pair this page shipped with measured 3.06 and 2.28,
       i.e. the amber failed outright. These are the deeper steps that clear it
       AND take a white glyph at 4.5+ (5.13 and 4.24). */
    --ok: #2e7d32;
    --warn: #b26a00;
    --ok-tint: rgba(76, 175, 80, 0.13);
    --warn-tint: rgba(255, 167, 38, 0.13);
    --ok-text: #29712d;      /* 5.32:1 on its own tint */
    --warn-text: #9c5300;    /* 5.27:1 on its own tint */
    --glyph-ink: #ffffff;    /* on the light-mode fills */
    --bar-none: rgba(27, 42, 52, 0.10);
    --shadow: 0 18px 50px -22px rgba(27, 42, 52, 0.35), 0 2px 8px rgba(27, 42, 52, 0.05);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #f4f5f7;
      --muted: #b4b8c6;       /* 8.41:1 on the dark card */
      --accent-text: #d6a785; /* 7.71:1 */
      --page: #17150f;
      --card: #211e16;
      --line: rgba(244, 245, 247, 0.08);
      /* On the dark ground the app's own brighter steps already clear 3:1
         (5.99 and 8.56) — and they take a DARK glyph, because white on amber
         is 1.94, the trap --accent-ink exists for in DESIGN.md. */
      --ok: #4caf50;
      --warn: #ffa726;
      --ok-tint: rgba(76, 175, 80, 0.15);
      --warn-tint: rgba(255, 167, 38, 0.15);
      --ok-text: #81c784;     /* 6.55:1 on its own tint */
      --warn-text: #ffb74d;   /* 7.08:1 on its own tint */
      --glyph-ink: #211e16;
      --bar-none: rgba(244, 245, 247, 0.12);
      --shadow: 0 18px 50px -20px rgba(0, 0, 0, 0.6);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    align-items: safe center; /* tall card on a short screen: never clip the top
                                 out of reach (ignored where unsupported, so the
                                 plain value above stays the fallback) */
    justify-content: center;
    font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--page);
    color: var(--ink);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    /* The notch and home-indicator insets matter here: of every page on the
       site this is the one most likely to be pinned to a phone home screen. */
    padding: max(24px, env(safe-area-inset-top, 0px)) max(20px, env(safe-area-inset-right, 0px))
             max(24px, env(safe-area-inset-bottom, 0px)) max(20px, env(safe-area-inset-left, 0px));
  }
  .card {
    width: 100%;
    max-width: 480px;
    background: var(--card);
    border-radius: 22px;
    box-shadow: var(--shadow);
    padding: 30px 26px 22px;
    border: 1px solid var(--line);
  }

  /* ---- head: the crown, the name, then what this page IS ---- */
  .head { text-align: center; margin-bottom: 22px; }
  .mark { display: block; width: 46px; margin: 0 auto 12px; }
  .mark svg { display: block; width: 100%; height: auto; }
  h1 {
    font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
    font-size: 1.45rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    margin: 0;
    line-height: 1.25;
  }
  .eyebrow {
    margin: 7px 0 0;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* ---- the verdict: the one thing people come here for ---- */
  .overall {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 15px 16px;
    border-radius: 15px;
  }
  .overall.ok { background: var(--ok-tint); color: var(--ok-text); }
  .overall.bad { background: var(--warn-tint); color: var(--warn-text); }
  .overall-title { font-weight: 700; font-size: 1rem; }
  .overall-sub { font-weight: 400; font-size: 0.8rem; color: var(--muted); margin-top: 3px; }
  .overall .badge { margin-top: 1px; }

  /* ---- one badge spec, shared by the verdict and every row ---- */
  .badge {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--glyph-ink);
  }
  .badge svg { width: 15px; height: 15px; display: block; }
  .badge.ok { background: var(--ok); }
  .badge.down { background: var(--warn); }
  .badge.off { background: var(--muted); }

  /* ---- the systems list ---- */
  ul { list-style: none; margin: 14px 0 0; padding: 0; }
  li {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 13px 2px;
    border-bottom: 1px solid var(--line);
  }
  li:last-child { border-bottom: 0; }
  .txt { flex: 1; min-width: 0; }
  .name, .desc, .overall-title, .overall-sub { display: block; }
  .name { font-weight: 600; font-size: 0.9rem; }
  .desc { font-size: 0.79rem; color: var(--muted); margin-top: 1px; }

  /* ---- 30-day strip ---- */
  .uptime { margin-top: 16px; padding-top: 18px; border-top: 1px solid var(--line); }
  .uptime-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 9px; }
  .uptime-title { font-size: 0.8rem; font-weight: 600; }
  .uptime-count { font-size: 0.74rem; color: var(--muted); }
  .uptime-strip { display: flex; gap: 3px; align-items: stretch; }
  .uptime-strip i { flex: 1 1 0; height: 26px; border-radius: 3px; background: var(--bar-none); }
  .uptime-strip i.u-ok { background: var(--ok); }
  .uptime-strip i.u-warn { background: var(--warn); }
  /* The axis is what stops the strip lying: without it the leading no-record
     days read as an outage that the count line has just denied. */
  .uptime-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 7px;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .uptime-key { margin: 9px 0 0; font-size: 0.72rem; color: var(--muted); display: flex; align-items: flex-start; gap: 7px; }
  .uptime-key i { width: 11px; height: 11px; border-radius: 3px; background: var(--bar-none); flex: 0 0 auto; margin-top: 4px; }

  /* ---- foot ---- */
  .foot { margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line); font-size: 0.75rem; color: var(--muted); text-align: center; }
  .foot a { color: var(--accent-text); text-decoration: none; border-bottom: 1px solid currentColor; padding-bottom: 1px; }
  .foot a:hover, .foot a:focus-visible { color: var(--ink); }
  .foot-links { margin-top: 7px; display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
  :focus-visible { outline: 2px solid var(--accent-text); outline-offset: 3px; border-radius: 3px; }

  /* Announced but not painted (app.css's .sr-only, restated locally). */
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  @media (max-width: 380px) {
    .card { padding: 24px 18px 18px; }
    h1 { font-size: 1.3rem; }
    .uptime-strip { gap: 2px; }
  }
</style>
</head>
<body>
  <main class="card">
    <header class="head">
      <span class="mark" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="4.449 8.173 17.446 10.496"><defs><linearGradient id="cr0" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#dfb9a4" offset="0"></stop><stop stop-color="#af877b" offset="1"></stop></linearGradient><linearGradient id="cr1" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#c49d8d" offset="0"></stop><stop stop-color="#956c65" offset="1"></stop></linearGradient><linearGradient id="cr2" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#d8b19e" offset="0"></stop><stop stop-color="#a67d73" offset="1"></stop></linearGradient><linearGradient id="cr3" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#b99284" offset="0"></stop><stop stop-color="#916862" offset="1"></stop></linearGradient></defs><g transform="matrix(0.8571428571428572,0,0,0.8571428571428572,3.8686100378989408,23.159729244099083)"><path d=" M 9.305130371658928 -8.279466277516764 L 9.309300329634548 -8.279466277516764 L 9.699124142968216 -8.279466277516764 L 6.994906395779325 -12.590664765213132 L 1.2601380611160131 -14.529022650008908 L 5.479597473348762 -8.279466277516764 L 9.305130371658928 -8.279466277516764 Z" fill="url(#cr0)" fill-rule="nonzero"></path><path d=" M 16.227193353799684 -8.279466277516764 L 20.44665276603243 -14.529022650008908 L 14.711884431369116 -12.590664765213132 L 12.007666684180228 -8.279466277516764 L 16.227193353799684 -8.279466277516764 Z" fill="url(#cr1)" fill-rule="nonzero"></path><path d=" M 13.557411388602999 -12.590664765213132 L 10.853395413574221 -16.900652619948836 L 8.149379438545443 -12.590664765213132 L 10.853395413574221 -8.28067691047743 L 13.557411388602999 -12.590664765213132 Z" fill="url(#cr2)" fill-rule="nonzero"></path><path d=" M 4.156779191663706 -5.821881367369727 L 17.550011635484744 -5.821881367369727 L 16.235735041911028 -7.47943966267826 L 5.471055785237414 -7.47943966267826 L 4.156779191663706 -5.821881367369727 Z" fill="url(#cr3)" fill-rule="nonzero"></path></g></svg></span>
      <h1>Cottage Holidays Blakeney</h1>
      <p class="eyebrow">Service status</p>
    </header>

    <div class="overall <?= $allCore ? 'ok' : 'bad' ?>" role="status">
      <span class="badge <?= $allCore ? 'ok' : 'down' ?>"><?= status_glyph($allCore ? 'ok' : 'down') ?></span>
      <span class="txt">
        <span class="overall-title"><?= status_esc($overallLabel) ?></span>
        <span class="overall-sub"><?= status_esc($overallSub) ?></span>
      </span>
    </div>

    <ul>
      <?php foreach ($rows as $r): ?>
      <li>
        <span class="badge <?= status_esc($r[1]) ?>"><?= status_glyph($r[1]) ?></span>
        <span class="txt">
          <span class="name"><?= status_esc($r[0]) ?></span>
          <span class="desc"><?= status_esc($r[2]) ?></span>
        </span>
        <span class="sr-only"><?= status_esc(status_word($r[1])) ?></span>
      </li>
      <?php endforeach; ?>
    </ul>

    <?php if ($uptimeDays): ?>
    <section class="uptime">
      <div class="uptime-head">
        <span class="uptime-title">Last 30 days</span>
        <span class="uptime-count"><?= (int) $uptimeUp ?> of <?= (int) $uptimeKnown ?> recorded days healthy</span>
      </div>
      <?php
      // One sentence for a screen reader. Once it has been said the bars are
      // decoration, so they're hidden from the tree rather than read out thirty
      // times over.
      $stripLabel =
          'Daily health for the last 30 days, oldest first: ' .
          (int) $uptimeUp .
          ' healthy, ' .
          (int) ($uptimeKnown - $uptimeUp) .
          ' with failures, ' .
          (int) $uptimeNone .
          ' with no check recorded.';
      ?>
      <div class="uptime-strip" role="img" aria-label="<?= status_esc($stripLabel) ?>">
        <?php foreach ($uptimeDays as $d): ?>
        <i aria-hidden="true" class="<?= $d['state'] === 'ok' ? 'u-ok' : ($d['state'] === 'warn' ? 'u-warn' : '') ?>" title="<?= status_esc($d['day'] . ' — ' . ($d['state'] === 'ok' ? 'healthy' : ($d['state'] === 'warn' ? 'ran with failures' : 'no record'))) ?>"></i>
        <?php endforeach; ?>
      </div>
      <div class="uptime-axis" aria-hidden="true"><span>30 days ago</span><span>Today</span></div>
      <?php if ($uptimeNone): ?>
      <p class="uptime-key"><i aria-hidden="true"></i> Faded = no check recorded that day.</p>
      <?php endif; ?>
    </section>
    <?php endif; ?>

    <footer class="foot">
      Checked <?= status_esc($checkedAt) ?>
      <span class="foot-links">
        <a href="/status">Check again</a>
        <a href="/">Back to the website</a>
      </span>
    </footer>
  </main>
</body>
</html>
