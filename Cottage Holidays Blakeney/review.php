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
<style>
  :root { --accent: <?= $esc($accent) ?>; --ink:#1b2a34; --muted:#5c6f7a; --line:rgba(27,42,52,.12);
          --bg:#f3f0e9; --card:#fffdf8; --danger:#c0492f; --ok:#2e7d5b; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; }
  body { font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
         color:var(--ink); background:var(--bg);
         background-image:radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%);
         min-height:100dvh; padding:24px 18px calc(28px + env(safe-area-inset-bottom)); }
  .wrap { max-width:520px; margin:0 auto; }
  .brand { display:flex; align-items:center; gap:10px; justify-content:center; margin:6px 0 22px; }
  .brand img { height:34px; width:auto; }
  .brand span { font-weight:600; letter-spacing:.2px; color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:22px;
          box-shadow:0 18px 50px -28px rgba(27,42,52,.5); overflow:hidden; }
  .hero { height:150px; background:#e6ddcf center/cover no-repeat; position:relative; }
  .hero::after { content:""; position:absolute; inset:0;
                 background:linear-gradient(180deg, transparent 35%, rgba(0,0,0,.42)); }
  .hero h1 { position:absolute; left:20px; right:20px; bottom:14px; margin:0; z-index:1;
             color:#fff; font-size:22px; font-weight:650; text-shadow:0 2px 12px rgba(0,0,0,.4); }
  .noimg { height:auto; background:none; padding:22px 22px 0; }
  .noimg::after { content:none; }
  .noimg h1 { position:static; color:var(--ink); text-shadow:none; padding:0; font-size:23px; }
  .body { padding:20px 22px 24px; }
  .lede { margin:0 0 18px; color:var(--muted); font-size:15px; }
  label { display:block; font-weight:600; font-size:13px; margin:0 0 7px; color:var(--ink); }
  .req { color:var(--danger); font-weight:600; }
  .opt { color:var(--muted); font-weight:500; }
  input, textarea { width:100%; font:inherit; color:var(--ink); background:#fff;
                    border:1px solid var(--line); border-radius:13px; padding:12px 13px; margin:0 0 16px; }
  input:focus, textarea:focus { outline:none; border-color:var(--accent);
                    box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  textarea { min-height:110px; resize:vertical; }
  .stars { display:flex; gap:6px; margin:0 0 18px; }
  .star { font-size:34px; line-height:1; cursor:pointer; color:#d8cdb8; background:none; border:0; padding:2px;
          transition:transform .12s ease, color .12s ease; }
  .star.on { color:#e8a838; }
  .star:active { transform:scale(.88); }
  .btn { width:100%; font:inherit; font-weight:650; font-size:16px; color:#fff; background:var(--accent);
         border:0; border-radius:14px; padding:15px; cursor:pointer; transition:filter .15s ease, transform .1s ease; }
  .btn:hover { filter:brightness(1.04); }
  .btn:active { transform:translateY(1px); }
  .btn[disabled] { opacity:.6; cursor:default; }
  .err { display:none; color:var(--danger); font-size:14px; margin:0 0 14px; font-weight:500; }
  .err.show { display:block; }
  .foot { text-align:center; color:var(--muted); font-size:12px; margin:16px 0 0; }
  /* Thank-you state */
  .done { text-align:center; padding:30px 24px 34px; }
  .done .tick { width:60px; height:60px; border-radius:50%; margin:0 auto 16px;
                background:color-mix(in srgb, var(--ok) 16%, transparent); color:var(--ok);
                display:flex; align-items:center; justify-content:center; font-size:32px; }
  .done h2 { margin:0 0 8px; font-size:22px; }
  .done p { margin:0 0 18px; color:var(--muted); }
  .direct { background:color-mix(in srgb, var(--accent) 10%, #fff); border:1px solid var(--line);
            border-radius:16px; padding:18px; margin:18px 0 0; text-align:left; }
  .direct b { display:block; margin-bottom:6px; }
  .direct p { margin:0; }
  .direct a { display:inline-block; margin-top:14px; color:#fff; background:var(--accent);
              text-decoration:none; font-weight:650; padding:11px 18px; border-radius:12px; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#eef3f6; --muted:#9fb2bd; --line:rgba(255,255,255,.14); --bg:#0f1a20; --card:#16242c; }
    input, textarea { background:#0f1a20; }
    .direct { background:color-mix(in srgb, var(--accent) 14%, #16242c); }
  }
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
      <h1 style="margin:0 0 10px;font-size:22px;">We couldn't find that cottage</h1>
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
