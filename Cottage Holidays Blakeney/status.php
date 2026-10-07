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
$uptimeWarn = 0;
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
                if ($state === 'warn') {
                    $uptimeWarn++;
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
$overallLabel = $allCore ? 'Everything’s working' : 'Some things aren’t working';
$overallSub = $allCore
    ? 'The website, bookings and enquiries are all working normally.'
    : 'The website is up, but bookings aren’t going through right now. Please try again shortly.';

// Stamped in UK time, not UTC: this is a UK business and the owner compares it
// against the clock on their own phone — under BST the two were an hour apart,
// which reads as a stale page. The zone is named so it still can't be misread.
// (uk_date()/fmtDate() live in db.php, which this page must not load.)
$ukNow = new DateTime('now', new DateTimeZone('Europe/London'));
$checkedAt = $ukNow->format('j M Y, H:i') . ' ' . $ukNow->format('T');
$checkedClock = 'Today at ' . $ukNow->format('H:i') . ' ' . $ukNow->format('T');
// The ring is the verdict: full when everything that is switched ON works; a
// switched-off row is the owner's choice, so it is neither counted for nor against.
$onRows = array_values(array_filter($rows, fn($r) => $r[1] !== 'off'));
$okRows = count(array_filter($onRows, fn($r) => $r[1] === 'ok'));
$ringFrac = $onRows ? $okRows / count($onRows) : 1;
$ringOff = (int) round(214 - 214 * $ringFrac);
$uptimePct = $uptimeKnown ? round($uptimeUp / $uptimeKnown * 100, 1) : 0;
$uptimePctTxt = rtrim(rtrim(number_format($uptimePct, 1, '.', ''), '0'), '.');
// The little script is SAME-ORIGIN on purpose: the site's CSP carries no
// 'unsafe-inline' for scripts. Pinned by its own content so a change reaches
// every visitor however long their cache keeps it.
$jsV = is_file(__DIR__ . '/status.js') ? substr(md5_file(__DIR__ . '/status.js'), 0, 8) : '0';
$ICONS = [
    'Website' => 'M3 5h18v12H3z M8 21h8 M12 17v4',
    'Database' => 'M12 3c5 0 8 1.3 8 3v12c0 1.7-3 3-8 3s-8-1.3-8-3V6c0-1.7 3-3 8-3z M4 6c0 1.7 3 3 8 3s8-1.3 8-3 M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
    'Enquiries & bookings' => 'M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4',
    'Card payments' => 'M3 7h18v10H3z M3 10h18',
    'Email' => 'M4 6h16v12H4z M4 7l8 6 8-6',
];

function status_esc($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

// State → the glyph inside its round badge. SHAPE as well as colour, so the
// state survives a colour-blind reading, a greyscale print and bright sun.
function status_glyph($state)
{
    if ($state === 'ok') {
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 8.4l2.9 2.9 5.9-5.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if ($state === 'off') {
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
}
// Said to a screen reader, which can't see the badge colour or the glyph.
function status_word($state)
{
    return $state === 'ok' ? 'Working' : ($state === 'off' ? 'Switched off' : 'Not working');
}
function status_icon($d)
{
    return '<span class="ic" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' . status_esc($d) . '"/></svg></span>';
}
$dayWords = ['ok' => 'Everything worked all day', 'warn' => 'Running, with a hiccup that sorted itself out', 'none' => 'No check recorded that day'];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark light">
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
    src: url('/fonts/montserrat-latin.woff2?v=06b16db7') format('woff2');
  }
  @font-face {
    font-family: 'Playfair Display';
    font-style: normal;
    font-weight: 400 900;
    font-display: swap;
    src: url('/fonts/playfair-latin.woff2?v=e0c764a8') format('woff2');
  }
  /* THE ADMIN STATUS PAGE'S LOOK (the approved demo), restated as values: this
     page keeps no stylesheet dependency, so a broken app.css can never take the
     one page you check when things are broken down with it. Dark is the default
     (the back office's), light follows the visitor's setting. */
  :root {
    color-scheme: dark light;
    --ground: #121316;
    --ink: #f4f5f7;
    --muted: #b4b8c6;      /* 9.5:1 on the ground */
    --faint: #8d92a0;      /* 6.0:1 */
    --card: rgba(255, 255, 255, 0.035);
    --hair: rgba(255, 255, 255, 0.08);
    --chip: rgba(255, 255, 255, 0.06);
    --track: rgba(255, 255, 255, 0.08);
    --accent: #d6a785;
    --accent-text: #d6a785;
    --ok: #81c784;
    --ok-bg: rgba(129, 199, 132, 0.14);
    --bad: #ef9a9a;
    --bad-bg: rgba(229, 115, 115, 0.15);
    --day-ok: #81c784;
    --day-warn: #ffb74d;
    --day-none: rgba(255, 255, 255, 0.12);
    --out: cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --ground: #f7f4ee;
      --ink: #1c1d21;
      --muted: #55524c;     /* 7.4:1 */
      --faint: #6a655c;     /* 5.3:1 */
      --card: #ffffff;
      --hair: rgba(0, 0, 0, 0.09);
      --chip: rgba(0, 0, 0, 0.05);
      --track: rgba(0, 0, 0, 0.08);
      --accent-text: #8a5a2b;
      --ok: #2e7d32;
      --ok-bg: rgba(46, 125, 50, 0.10);
      --bad: #b3261e;
      --bad-bg: rgba(198, 40, 40, 0.10);
      --day-ok: #43a047;
      --day-warn: #ef8f00;
      --day-none: rgba(0, 0, 0, 0.14);
    }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  @keyframes fade { from { opacity: 0; } }
  @keyframes ring { from { stroke-dashoffset: 214; } }
  @keyframes pop { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes draw { from { stroke-dashoffset: 30; } to { stroke-dashoffset: 0; } }
  @keyframes grow { from { transform: scaleY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes sheen { from { transform: translateX(-120%); } to { transform: translateX(220%); } }
  @keyframes slide { from { opacity: 0; transform: translateY(-4px); } }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--ground);
    color: var(--ink);
    font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    /* Of every page on the site this is the one most likely to be pinned to a
       phone home screen, so the notch and home-indicator insets matter here. */
    padding: max(24px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px))
             max(40px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  }
  .wrap { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
  .brand { display: flex; align-items: center; gap: 10px; min-height: 44px; animation: fade 500ms ease-out both; }
  .brand svg { display: block; width: 28px; height: auto; }
  .brand span { font-family: 'Playfair Display', Georgia, serif; font-size: 17px; font-weight: 600; }
  h1 { margin: 0; font-size: 28px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.2; animation: rise 520ms var(--out) 60ms both; }
  h2 { margin: 0; padding: 0 4px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .sec { display: flex; flex-direction: column; gap: 8px; }
  .card { border-radius: 20px; border: 1px solid var(--hair); background: var(--card); }

  /* ---- the verdict: a ring that IS the answer ---- */
  .hero { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding: 20px; animation: rise 600ms var(--out) 120ms both; }
  .hero-top { display: flex; align-items: center; gap: 16px; }
  .ring { position: relative; flex: none; width: 84px; height: 84px; color: var(--ok); }
  .is-bad .ring { color: var(--bad); }
  .ring > svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  .ring .track { fill: none; stroke: var(--track); stroke-width: 6; }
  .ring .arc { fill: none; stroke: currentColor; stroke-width: 6; stroke-linecap: round; stroke-dasharray: 214; transition: stroke-dashoffset 420ms var(--out); animation: ring 1200ms var(--out) 250ms both; }
  .ring .mid { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .ring .mark { width: 32px; height: 32px; animation: pop 460ms var(--out) 950ms both; }
  .ring .mark path { stroke-dasharray: 30; animation: draw 420ms ease-out 1150ms both; }
  .ring .pct { display: none; font-size: 17px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
  .hero-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .hero-title { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; animation: rise 420ms ease-out 300ms both; }
  .hero-sub { font-size: 13px; color: var(--muted); line-height: 1.45; animation: rise 420ms ease-out 380ms both; }
  .hero-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--hair); }
  .when { display: flex; flex-direction: column; gap: 2px; }
  .when b { font-size: 13px; font-weight: 600; }
  .when span { font-size: 12px; color: var(--faint); }
  .again { flex: none; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent-text); font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; text-decoration: none; transition: transform 320ms var(--out); }
  .again:active { transform: scale(0.96); }
  .again svg { width: 15px; height: 15px; }
  .sheen { position: absolute; inset: 0; pointer-events: none; display: none; background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.07) 50%, transparent 70%); animation: sheen 1.1s ease-in-out infinite; }
  /* Checking: the ring spins and says it is checking — the reload that follows IS the check. */
  .is-checking .sheen { display: block; }
  .is-checking .ring .arc { stroke-dashoffset: 160 !important; transform-origin: 42px 42px; animation: spin 1s linear infinite; }
  .is-checking .ring .mark { display: none; }
  .is-checking .again svg { animation: spin 0.9s linear infinite; }

  /* ---- what we checked ---- */
  .list { overflow: hidden; animation: rise 520ms var(--out) 220ms both; }
  .row { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 16px; animation: rise 380ms var(--out) both; }
  .row + .row { border-top: 1px solid var(--hair); }
  .ic { flex: none; width: 36px; height: 36px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent-text); display: inline-flex; align-items: center; justify-content: center; }
  .txt { flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .name { font-size: 15px; font-weight: 600; }
  .desc { font-size: 12px; color: var(--faint); line-height: 1.4; }
  .badge { flex: none; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; animation: pop 360ms var(--out) both; }
  .badge svg { width: 15px; height: 15px; }
  .badge.ok { background: var(--ok-bg); color: var(--ok); }
  .badge.down { background: var(--bad-bg); color: var(--bad); }
  .badge.off { background: var(--chip); color: var(--muted); }
  .is-checking .badge { visibility: hidden; }

  /* ---- last 30 days ---- */
  .days { padding: 16px; display: flex; flex-direction: column; gap: 14px; animation: rise 520ms var(--out) 320ms both; }
  .days-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .big { display: flex; flex-direction: column; gap: 2px; }
  .big b { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
  .big b small { font-size: 17px; color: var(--muted); }
  .big > span { font-size: 12px; color: var(--faint); }
  .key { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 12px; color: var(--muted); }
  .key span { display: inline-flex; align-items: center; gap: 6px; }
  .key i { width: 8px; height: 8px; border-radius: 2px; }
  .bars { display: grid; grid-template-columns: repeat(30, minmax(0, 1fr)); gap: 3px; align-items: end; height: 48px; }
  .bar { height: 48px; padding: 0; border: none; background: none; display: flex; align-items: flex-end; cursor: pointer; }
  .bar i { width: 100%; height: 36px; border-radius: 3px; background: var(--day-ok); transform-origin: bottom; animation: grow 560ms var(--out) both; transition: translate 260ms var(--out), box-shadow 200ms ease; }
  .bar.warn i { height: 48px; background: var(--day-warn); }
  .bar.none i { height: 14px; background: var(--day-none); }
  .bar[aria-pressed="true"] i { translate: 0 -3px; box-shadow: 0 0 0 2px var(--ground), 0 0 0 4px var(--ink); }
  .axis { display: flex; justify-content: space-between; font-size: 12px; color: var(--faint); }
  .day { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 12px; border-radius: 12px; background: var(--chip); font-size: 13px; }
  .day.is-new { animation: slide 260ms ease-out both; }
  .day i { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--day-ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--day-ok) 22%, transparent); }
  .day.warn i { background: var(--day-warn); box-shadow: 0 0 0 4px color-mix(in srgb, var(--day-warn) 22%, transparent); }
  .day.none i { background: var(--day-none); box-shadow: none; }
  .day b { display: block; font-weight: 600; }
  .day > span > span { color: var(--muted); }

  /* ---- back to the site ---- */
  .back { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 16px; color: var(--ink); text-decoration: none; animation: rise 520ms var(--out) 420ms both; transition: transform 320ms var(--out), border-color 200ms ease; }
  .back:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  .back:active { transform: scale(0.98); }
  .back .chev { flex: none; color: var(--faint); }
  :focus-visible { outline: 2px solid var(--accent-text); outline-offset: 3px; border-radius: 8px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .is-checking .ring .arc { animation: spin 1s linear infinite !important; }
  }
</style>
</head>
<body>
  <main class="wrap">
    <header class="brand"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="4.449 8.173 17.446 10.496"><defs><linearGradient id="cr0" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#dfb9a4" offset="0"></stop><stop stop-color="#af877b" offset="1"></stop></linearGradient><linearGradient id="cr1" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#c49d8d" offset="0"></stop><stop stop-color="#956c65" offset="1"></stop></linearGradient><linearGradient id="cr2" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#d8b19e" offset="0"></stop><stop stop-color="#a67d73" offset="1"></stop></linearGradient><linearGradient id="cr3" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#b99284" offset="0"></stop><stop stop-color="#916862" offset="1"></stop></linearGradient></defs><g transform="matrix(0.8571428571428572,0,0,0.8571428571428572,3.8686100378989408,23.159729244099083)"><path d=" M 9.305130371658928 -8.279466277516764 L 9.309300329634548 -8.279466277516764 L 9.699124142968216 -8.279466277516764 L 6.994906395779325 -12.590664765213132 L 1.2601380611160131 -14.529022650008908 L 5.479597473348762 -8.279466277516764 L 9.305130371658928 -8.279466277516764 Z" fill="url(#cr0)" fill-rule="nonzero"></path><path d=" M 16.227193353799684 -8.279466277516764 L 20.44665276603243 -14.529022650008908 L 14.711884431369116 -12.590664765213132 L 12.007666684180228 -8.279466277516764 L 16.227193353799684 -8.279466277516764 Z" fill="url(#cr1)" fill-rule="nonzero"></path><path d=" M 13.557411388602999 -12.590664765213132 L 10.853395413574221 -16.900652619948836 L 8.149379438545443 -12.590664765213132 L 10.853395413574221 -8.28067691047743 L 13.557411388602999 -12.590664765213132 Z" fill="url(#cr2)" fill-rule="nonzero"></path><path d=" M 4.156779191663706 -5.821881367369727 L 17.550011635484744 -5.821881367369727 L 16.235735041911028 -7.47943966267826 L 5.471055785237414 -7.47943966267826 L 4.156779191663706 -5.821881367369727 Z" fill="url(#cr3)" fill-rule="nonzero"></path></g></svg><span>Cottage Holidays Blakeney</span></header>
    <h1>Service status</h1>

    <section class="card hero <?= $allCore ? 'is-ok' : 'is-bad' ?>" id="sp-hero" role="status" aria-live="polite">
      <span class="sheen" aria-hidden="true"></span>
      <div class="hero-top">
        <span class="ring" aria-hidden="true">
          <svg width="84" height="84" viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="34"/><circle class="arc" cx="42" cy="42" r="34" style="stroke-dashoffset: <?= (int) $ringOff ?>"/></svg>
          <span class="mid"><?php if ($allCore): ?><svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><?php else: ?><svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 6v8"/><path d="M12 18.5v.01"/></svg><?php endif; ?></span>
        </span>
        <span class="hero-text">
          <span class="hero-title" id="sp-title"><?= status_esc($overallLabel) ?></span>
          <span class="hero-sub"><?= status_esc($overallSub) ?></span>
        </span>
      </div>
      <div class="hero-foot">
        <span class="when"><b id="sp-ago" data-at="<?= (int) $ukNow->getTimestamp() ?>">Checked just now</b><span><?= status_esc($checkedClock) ?></span></span>
        <a class="again" id="sp-again" href="/status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg><span>Check again</span></a>
      </div>
    </section>

    <section class="sec">
      <h2>What we checked</h2>
      <div class="card list">
        <?php foreach ($rows as $i => $r): ?>
        <div class="row" style="animation-delay: <?= 260 + $i * 70 ?>ms">
          <?= status_icon($ICONS[$r[0]] ?? $ICONS['Website']) ?>
          <span class="txt"><span class="name"><?= status_esc($r[0]) ?></span><span class="desc"><?= status_esc($r[2]) ?></span></span>
          <span class="badge <?= status_esc($r[1]) ?>" style="animation-delay: <?= 600 + $i * 90 ?>ms"><?= status_glyph($r[1]) ?></span>
          <span class="sr-only"><?= status_esc(status_word($r[1])) ?></span>
        </div>
        <?php endforeach; ?>
      </div>
    </section>

    <?php if ($uptimeDays): ?>
    <section class="sec">
      <h2>Last 30 days</h2>
      <div class="card days">
        <div class="days-top">
          <span class="big"><b><span id="sp-pct" data-to="<?= status_esc($uptimePctTxt) ?>"><?= status_esc($uptimePctTxt) ?></span><small>%</small></b><span>of recorded days fully healthy</span></span>
          <span class="key">
            <span><i style="background: var(--day-ok)"></i><?= (int) $uptimeUp ?> healthy</span>
            <?php if ($uptimeWarn): ?><span><i style="background: var(--day-warn)"></i><?= (int) $uptimeWarn ?> hiccup<?= $uptimeWarn === 1 ? '' : 's' ?></span><?php endif; ?>
            <?php if ($uptimeNone): ?><span><i style="background: var(--day-none)"></i><?= (int) $uptimeNone ?> not recorded</span><?php endif; ?>
          </span>
        </div>
        <div class="bars" id="sp-bars">
          <?php foreach ($uptimeDays as $j => $d):
              $dt = DateTime::createFromFormat('!Y-m-d', $d['day'], new DateTimeZone('Europe/London'));
              $label = $j === count($uptimeDays) - 1 ? 'Today' : ($dt ? $dt->format('l j F') : $d['day']);
              ?>
          <button type="button" class="bar <?= status_esc($d['state']) ?>" aria-pressed="<?= $j === count($uptimeDays) - 1 ? 'true' : 'false' ?>" data-date="<?= status_esc($label) ?>" data-word="<?= status_esc($dayWords[$d['state']]) ?>" aria-label="<?= status_esc($label . ': ' . $dayWords[$d['state']]) ?>"><i style="animation-delay: <?= 520 + $j * 22 ?>ms"></i></button>
          <?php endforeach; ?>
        </div>
        <div class="axis" aria-hidden="true"><span><?= status_esc((new DateTime($uptimeDays[0]['day']))->format('j M')) ?></span><span>Today</span></div>
        <?php $last = $uptimeDays[count($uptimeDays) - 1]; ?>
        <div class="day <?= status_esc($last['state']) ?>" id="sp-day" aria-live="polite"><i aria-hidden="true"></i><span><b>Today</b><span><?= status_esc($dayWords[$last['state']]) ?></span></span></div>
      </div>
    </section>
    <?php endif; ?>

    <a class="card back" href="/"><?= status_icon('M4 11l8-7 8 7v9H4z M10 20v-6h4v6') ?><span class="txt"><span class="name">Back to the website</span><span class="desc">See the cottages and book</span></span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>
  </main>
  <script src="/status.js?v=<?= status_esc($jsV) ?>" defer></script>
</body>
</html>
