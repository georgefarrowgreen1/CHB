<?php
// ============================================================
//  review.php — per-cottage review landing page for EXTERNAL guests.
//  Served at /review/<slug> (rewrite in htaccess.txt). This is the link the
//  owner shares with Airbnb/Vrbo/etc. guests after their stay: a fast, focused,
//  branded page to leave a star review + a few words, and — crucially — their
//  email (required) and phone (optional), so we can invite them back next year
//  to book DIRECT and skip the OTA fees. Submits to leads.php.
//
//  Deliberately STANDALONE (own short-timeout PDO, never db.php — db()'s exit
//  path would blank this page, like status.php/cottage.php). It must ALWAYS
//  render something sensible: an unknown slug shows a gentle "not found",
//  a DB problem still shows a generic (cottage-less) form that posts nothing.
// ============================================================
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow'); // a private review link — don't index
header('Cache-Control: no-store');

$esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

// ---- Resolve the cottage from the slug (best-effort) ----
$propKey = '';
$name = '';
$accent = '#8FB3C7';
$heroImg = '';
$found = false;
$source = strtolower(preg_replace('/[^a-z]/i', '', (string) ($_GET['from'] ?? 'direct'))) ?: 'direct';

try {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    $slug = '';
    if (preg_match('#/review/([a-z0-9\-]+)#i', $path, $m)) {
        $slug = strtolower($m[1]);
    }

    if ($slug !== '' && is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
        $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 3,
        ]);
        $st = $pdo->prepare('SELECT prop_key, name, accent FROM properties
                             WHERE (slug = ? OR prop_key = ?) AND archived_at IS NULL AND unlisted = 0 LIMIT 1');
        $st->execute([$slug, $slug]);
        $p = $st->fetch();
        if ($p) {
            $found = true;
            $propKey = $p['prop_key'];
            $accent = $p['accent'] ?: $accent;
            // Owner-edited title wins over the row name (mirror content_value decode).
            $cv = function ($key) use ($pdo) {
                $s = $pdo->prepare('SELECT item_value FROM content WHERE item_key = ?');
                $s->execute([$key]);
                $v = $s->fetchColumn();
                if ($v === false) {
                    return '';
                }
                $d = json_decode((string) $v, true);
                return is_string($d) ? $d : (is_scalar($d) ? (string) $d : '');
            };
            $name = trim($cv($propKey . '-title') ?: (string) ($p['name'] ?: $propKey));
            // First gallery photo → a soft header image.
            try {
                $gi = $pdo->prepare('SELECT item_value FROM content WHERE item_key = ?');
                $gi->execute(['images-' . $propKey]);
                $gv = $gi->fetchColumn();
                if ($gv !== false) {
                    $arr = json_decode((string) $gv, true);
                    if (is_array($arr) && !empty($arr[0]) && is_string($arr[0])) {
                        $heroImg = trim($arr[0]);
                    }
                }
            } catch (\Throwable $e) {
            }
        }
    }
} catch (\Throwable $e) {
    // DB/config problem — fall through with $found = false; the page still renders.
}

if (!$found) {
    http_response_code(404);
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= $found ? $esc($name) . ' — leave a review' : 'Leave a review' ?> | Cottage Holidays Blakeney</title>
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<!-- The site's own type pair (Playfair Display headings + Montserrat body).
     CSP already whitelists fonts.googleapis.com / fonts.gstatic.com; display=swap
     so text paints instantly with the system fallback if the fonts are slow. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap">
<style>
  /* Guest-facing palette (light theme — the site's default): warm linen ground,
     rose-gold brand accent, ink-slate text, frosted-white glass, gold stars. */
  :root { --accent:#c6885e; --accent-soft:rgba(198,136,94,.42);
          --ink:#1b2a34; --muted:#52646e; --line:rgba(28,46,58,.12);
          --bg:#f5f1e9; --glass:rgba(255,255,255,.82); --field:#fff;
          --danger:#c0492f; --sea:#2e8b8b;
          --cottage: <?= $esc($accent) ?>;
          --serif:"Playfair Display", Georgia, serif;
          --sans:"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; }
  body { font:16px/1.6 var(--sans); color:var(--ink); background:var(--bg);
         /* the site's ambient wash: soft sky / sand / seafoam blobs on linen */
         background-image:
           radial-gradient(60% 45% at 12% 0%, rgba(220,234,242,.7), transparent 70%),
           radial-gradient(55% 40% at 100% 8%, rgba(237,230,214,.7), transparent 70%),
           radial-gradient(70% 50% at 50% 100%, rgba(220,235,228,.55), transparent 72%);
         background-attachment:fixed;
         min-height:100dvh; padding:26px 18px calc(30px + env(safe-area-inset-bottom)); }
  .wrap { max-width:500px; margin:0 auto; }
  .brand { display:flex; flex-direction:column; align-items:center; gap:10px; margin:8px 0 24px; }
  .brand img { height:52px; width:auto; display:block; }
  .brand span { font-family:var(--sans); font-weight:600; font-size:11.5px; letter-spacing:2.5px;
                text-transform:uppercase; color:var(--muted); }
  .card { background:var(--glass); -webkit-backdrop-filter:blur(18px) saturate(150%);
          backdrop-filter:blur(18px) saturate(150%);
          border:1px solid rgba(255,255,255,.7); border-radius:32px;
          box-shadow:0 10px 34px rgba(30,54,72,.1), inset 0 1px 0 0 rgba(255,255,255,.85);
          overflow:hidden; }
  .hero { height:158px; background:#e6ddcf center/cover no-repeat; position:relative; }
  .hero::after { content:""; position:absolute; inset:0;
                 background:linear-gradient(180deg, transparent 30%, rgba(20,32,40,.5)); }
  .hero h1 { position:absolute; left:24px; right:24px; bottom:16px; margin:0; z-index:1; text-align:center;
             font-family:var(--serif); font-weight:700; color:#fff; font-size:26px; line-height:1.15;
             text-shadow:0 2px 16px rgba(0,0,0,.45); }
  .noimg { height:auto; background:none; padding:26px 26px 0; }
  .noimg::after { content:none; }
  .noimg h1 { position:static; color:var(--ink); text-shadow:none; padding:0; font-size:27px; }
  /* Centred, boutique layout: headings, copy, labels, stars and buttons all
     centre-aligned; the input fields keep their text left for legibility. */
  .body { padding:22px 26px 28px; text-align:center; }
  .lede { margin:0 0 24px; color:var(--muted); font-size:15px; }
  label { display:block; font-weight:600; font-size:12.5px; margin:0 0 8px; color:var(--ink);
          letter-spacing:.2px; text-align:center; }
  .req { color:var(--accent); font-weight:700; }
  .opt { color:var(--muted); font-weight:500; text-transform:none; letter-spacing:0; }
  input, textarea { width:100%; font:15px/1.5 var(--sans); color:var(--ink); background:var(--field);
                    border:1px solid var(--line); border-radius:16px; padding:13px 15px; margin:0 0 18px;
                    text-align:left; }
  input::placeholder, textarea::placeholder { color:#96a3ab; }
  input:focus, textarea:focus { outline:none; border-color:var(--accent);
                    box-shadow:0 0 0 3px var(--accent-soft); }
  textarea { min-height:116px; resize:vertical; }
  .stars { display:flex; gap:8px; margin:0 0 20px; justify-content:center; }
  .star { font-size:36px; line-height:1; cursor:pointer; color:#dccfb9; background:none; border:0; padding:2px;
          transition:transform .12s ease, color .12s ease; }
  .star.on { color:#e0a12f; }
  .star:active { transform:scale(.86); }
  .btn { width:100%; font:600 16px/1 var(--sans); letter-spacing:.3px; color:#fff; background:var(--accent);
         border:0; border-radius:40px; padding:17px; cursor:pointer; box-shadow:0 8px 22px rgba(198,136,94,.32);
         transition:filter .15s ease, transform .1s ease, box-shadow .15s ease; }
  .btn:hover { filter:brightness(1.05); box-shadow:0 10px 26px rgba(198,136,94,.4); }
  .btn:active { transform:translateY(1px); }
  .btn[disabled] { opacity:.6; cursor:default; box-shadow:none; }
  .err { display:none; color:var(--danger); font-size:14px; margin:0 0 16px; font-weight:500; }
  .err.show { display:block; }
  .foot { text-align:center; color:var(--muted); font-size:12px; margin:18px 0 0; line-height:1.5; }
  /* Thank-you state */
  .done { text-align:center; padding:34px 26px 38px; }
  .done .tick { width:64px; height:64px; border-radius:50%; margin:0 auto 18px;
                background:rgba(46,139,139,.14); color:var(--sea);
                display:flex; align-items:center; justify-content:center; font-size:34px; }
  .done h2 { font-family:var(--serif); font-weight:700; margin:0 0 10px; font-size:26px; }
  .done p { margin:0 0 20px; color:var(--muted); }
  .direct { background:rgba(198,136,94,.09); border:1px solid var(--accent-soft);
            border-radius:22px; padding:22px; margin:20px 0 0; text-align:center; }
  .direct b { display:block; font-family:var(--serif); font-weight:700; font-size:18px; margin-bottom:8px; color:var(--ink); }
  .direct p { margin:0; color:var(--muted); font-size:14.5px; }
  .direct a { display:inline-block; margin-top:16px; color:#fff; background:var(--accent);
              text-decoration:none; font-weight:600; letter-spacing:.3px; padding:13px 22px; border-radius:40px;
              box-shadow:0 8px 22px rgba(198,136,94,.32); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <img src="/logo.svg" alt="" onerror="this.style.display='none'">
    <span>Cottage Holidays Blakeney</span>
  </div>

  <div class="card" id="card">
<?php if (!$found): ?>
    <div class="body">
      <h1 style="margin:0 0 10px;font-family:var(--serif);font-weight:700;font-size:25px;">We couldn't find that cottage</h1>
      <p class="lede">This review link doesn't match one of our cottages. Please check the
      address, or visit <a href="/" style="color:var(--accent)">our website</a>.</p>
    </div>
<?php else: ?>
    <div class="hero<?= $heroImg === '' ? ' noimg' : '' ?>"<?= $heroImg !== '' ? ' style="background-image:url(\'' . $esc($heroImg) . '\')"' : '' ?>>
      <h1>How was <?= $esc($name) ?>?</h1>
    </div>
    <div class="body">
      <p class="lede">Thanks for staying with us. A quick review helps other guests —
      and once it's approved we'll pop it on our website.</p>

      <form id="rev" novalidate>
        <label>Your rating <span class="req">*</span></label>
        <div class="stars" id="stars" role="radiogroup" aria-label="Star rating">
          <?php for ($i = 1; $i <= 5; $i++): ?>
          <button type="button" class="star" data-v="<?= $i ?>" aria-label="<?= $i ?> star<?= $i > 1 ? 's' : '' ?>">★</button>
          <?php endfor; ?>
        </div>

        <label for="text">Your review <span class="req">*</span></label>
        <textarea id="text" maxlength="1000" placeholder="What did you love? What made your stay special?"></textarea>

        <label for="name">Your name <span class="req">*</span></label>
        <input id="name" type="text" maxlength="120" autocomplete="name" placeholder="e.g. Sarah T.">

        <label for="email">Email <span class="req">*</span></label>
        <input id="email" type="email" maxlength="190" autocomplete="email" inputmode="email" placeholder="you@example.com">

        <label for="phone">Phone <span class="opt">(optional)</span></label>
        <input id="phone" type="tel" maxlength="40" autocomplete="tel" inputmode="tel" placeholder="So we can reach you about future dates">

        <div class="err" id="err"></div>
        <button type="submit" class="btn" id="send">Send review</button>
      </form>
      <p class="foot">Your details are private and only used to contact you about staying with us again.</p>
    </div>
<?php endif; ?>
  </div>
</div>

<?php if ($found): ?>
<script>
(function () {
  var propKey = <?= json_encode($propKey) ?>;
  var source  = <?= json_encode($source) ?>;
  var stars = 0;
  var starEls = Array.prototype.slice.call(document.querySelectorAll('.star'));
  function paint() { starEls.forEach(function (b) { b.classList.toggle('on', +b.dataset.v <= stars); }); }
  starEls.forEach(function (b) {
    b.addEventListener('click', function () { stars = +b.dataset.v; paint(); });
  });

  var form = document.getElementById('rev');
  var err = document.getElementById('err');
  var send = document.getElementById('send');
  function fail(msg) { err.textContent = msg; err.classList.add('show'); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.classList.remove('show');
    var name = document.getElementById('name').value.trim();
    var email = document.getElementById('email').value.trim();
    var phone = document.getElementById('phone').value.trim();
    var text = document.getElementById('text').value.trim();
    if (!stars) return fail('Please tap a star rating.');
    if (text.length < 10) return fail('Please write at least a sentence or two.');
    if (!name) return fail('Please tell us your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.');

    send.disabled = true; send.textContent = 'Sending…';
    fetch('/leads.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', prop_key: propKey, source: source,
                             name: name, email: email, phone: phone, stars: stars, text: text })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || (res.d && res.d.error)) {
          send.disabled = false; send.textContent = 'Send review';
          return fail((res.d && res.d.error) || 'Something went wrong. Please try again.');
        }
        document.getElementById('card').innerHTML =
          '<div class="done">' +
            '<div class="tick">✓</div>' +
            '<h2>Thank you!</h2>' +
            '<p>Your review has been sent — we really appreciate it.</p>' +
            '<div class="direct">' +
              '<b>Coming back next year?</b>' +
              '<p>Book direct with us and skip the booking-site fees — you get the best price and we get to look after you again.</p>' +
              '<a href="/">Explore our cottages</a>' +
            '</div>' +
          '</div>';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function () {
        send.disabled = false; send.textContent = 'Send review';
        fail('Network error. Please check your connection and try again.');
      });
  });
})();
</script>
<?php endif; ?>
</body>
</html>
