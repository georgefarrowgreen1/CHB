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
$subtitle = '';
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
            $subtitle = trim($cv($propKey . '-subtitle'));
            // Make a stored asset path safe to use from /review/<slug>: absolute
            // URLs pass through; anything else becomes ROOT-relative ("/uploads/…")
            // so it resolves against the site root, not the /review/ path.
            $rootRel = function ($p) {
                $p = trim((string) $p);
                if ($p === '' || preg_match('#^https?://#i', $p)) {
                    return $p;
                }
                return '/' . ltrim($p, '/');
            };
            // First gallery photo → the hero image. Fall back to the site hero.
            try {
                $gi = $pdo->prepare('SELECT item_value FROM content WHERE item_key = ?');
                $gi->execute(['images-' . $propKey]);
                $gv = $gi->fetchColumn();
                if ($gv !== false) {
                    $arr = json_decode((string) $gv, true);
                    if (is_array($arr) && !empty($arr[0]) && is_string($arr[0])) {
                        $heroImg = $rootRel($arr[0]);
                    }
                }
                if ($heroImg === '') {
                    $hb = $cv('hero-bg');
                    if ($hb !== '') {
                        $heroImg = $rootRel($hb);
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
  .brand { animation:fadeUp .5s ease both; }
  .card { background:var(--glass); -webkit-backdrop-filter:blur(18px) saturate(150%);
          backdrop-filter:blur(18px) saturate(150%);
          border:1px solid rgba(255,255,255,.7); border-radius:32px;
          box-shadow:0 12px 40px rgba(30,54,72,.12), inset 0 1px 0 0 rgba(255,255,255,.85);
          overflow:hidden; animation:riseIn .6s cubic-bezier(.2,.7,.2,1) .06s both; }
  @keyframes riseIn { from { opacity:0; transform:translateY(22px) scale(.985); } to { opacity:1; transform:none; } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
  /* Immersive hero: the cottage's own photo behind a warm scrim, slowly
     drifting (Ken Burns). No photo? A coastal sky→sea→sand gradient still reads
     as "the place", never a broken grey box. */
  .hero { position:relative; min-height:252px; display:flex; align-items:flex-end; overflow:hidden;
          background:linear-gradient(155deg, #cfe0ea 0%, #a7c1cd 52%, #d8c8ac 100%); }
  .hero-img { position:absolute; inset:0; z-index:0; background:center/cover no-repeat;
              animation:kenburns 22s ease-out both; transform-origin:52% 42%; }
  .hero::after { content:""; position:absolute; inset:0; z-index:1;
                 background:linear-gradient(180deg, rgba(16,28,36,0) 26%, rgba(16,28,36,.18) 52%, rgba(16,28,36,.66) 100%); }
  .hero .htxt { position:relative; z-index:2; width:100%; padding:24px 26px 22px; text-align:center; }
  .hero .eyebrow { font-family:var(--sans); font-size:10.5px; font-weight:600; letter-spacing:2.8px;
                   text-transform:uppercase; color:rgba(255,255,255,.9); margin:0 0 9px;
                   text-shadow:0 1px 10px rgba(0,0,0,.45); }
  .hero .eyebrow::before, .hero .eyebrow::after { content:"—"; opacity:.5; margin:0 8px; }
  .hero h1 { margin:0; font-family:var(--serif); font-weight:700; color:#fff; font-size:29px;
             line-height:1.16; text-shadow:0 2px 20px rgba(0,0,0,.55); }
  .hero .hsub { margin:10px 0 0; font-family:var(--sans); font-size:13.5px; font-weight:500;
                color:rgba(255,255,255,.94); text-shadow:0 1px 10px rgba(0,0,0,.45); }
  @keyframes kenburns { from { transform:scale(1.001); } to { transform:scale(1.1); } }
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
  .stars { display:flex; gap:10px; margin:0 0 6px; justify-content:center; }
  .star { font-size:40px; line-height:1; cursor:pointer; color:#e2d6c1; background:none; border:0; padding:2px;
          transition:transform .16s var(--spring, cubic-bezier(.34,1.56,.64,1)), color .14s ease;
          filter:drop-shadow(0 1px 1px rgba(0,0,0,.04)); }
  .star.on { color:#e6a52c; }
  .star.on { transform:scale(1.06); }
  .star:active { transform:scale(.84); }
  .star.pop { animation:starPop .34s cubic-bezier(.34,1.56,.64,1); }
  @keyframes starPop { 0% { transform:scale(.7); } 60% { transform:scale(1.28); } 100% { transform:scale(1.06); } }
  /* Live rating word beneath the stars — a warm, human cue as they pick. */
  .rate-word { min-height:20px; margin:0 0 18px; font-family:var(--serif); font-style:italic;
               font-size:15px; color:var(--accent); font-weight:600; opacity:0; transform:translateY(3px);
               transition:opacity .2s ease, transform .2s ease; }
  .rate-word.show { opacity:1; transform:none; }
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
  .done { text-align:center; padding:36px 26px 38px; }
  .done > * { animation:fadeUp .5s ease both; }
  .done > *:nth-child(2) { animation-delay:.06s; }
  .done > *:nth-child(3) { animation-delay:.12s; }
  .done > *:nth-child(4) { animation-delay:.2s; }
  .done .tick { width:66px; height:66px; border-radius:50%; margin:0 auto 20px;
                background:rgba(46,139,139,.14); color:var(--sea);
                box-shadow:0 0 0 8px rgba(46,139,139,.06);
                display:flex; align-items:center; justify-content:center; font-size:34px;
                animation:tickIn .55s cubic-bezier(.34,1.56,.64,1) both; }
  @keyframes tickIn { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:none; } }
  .done h2 { font-family:var(--serif); font-weight:700; margin:0 0 10px; font-size:27px; }
  .done p { margin:0 0 20px; color:var(--muted); }
  .direct { background:linear-gradient(140deg, rgba(198,136,94,.13), rgba(214,167,133,.05));
            border:1px solid var(--accent-soft); border-radius:24px; padding:24px 22px; margin:24px 0 0; text-align:center; }
  .offer-tag { display:inline-block; font-family:var(--sans); font-size:10.5px; font-weight:700;
               letter-spacing:1.6px; text-transform:uppercase; color:var(--accent);
               background:rgba(198,136,94,.15); padding:6px 13px; border-radius:40px; margin-bottom:14px; }
  .direct b { display:block; font-family:var(--serif); font-weight:700; font-size:19px; margin-bottom:8px; color:var(--ink); }
  .direct p { margin:0; color:var(--muted); font-size:14.5px; }
  .direct a { display:inline-block; margin-top:18px; color:#fff; background:var(--accent);
              text-decoration:none; font-weight:600; letter-spacing:.3px; padding:14px 24px; border-radius:40px;
              box-shadow:0 8px 22px rgba(198,136,94,.32); transition:filter .15s ease, box-shadow .15s ease, transform .1s ease; }
  .direct a:hover { filter:brightness(1.05); box-shadow:0 10px 28px rgba(198,136,94,.42); }
  .direct a:active { transform:translateY(1px); }
  @media (prefers-reduced-motion: reduce) {
    .brand, .card, .done > *, .done .tick, .star.pop, .hero-img { animation:none !important; }
    .rate-word { transition:none; }
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
      <h1 style="margin:0 0 10px;font-family:var(--serif);font-weight:700;font-size:25px;">We couldn't find that cottage</h1>
      <p class="lede">This review link doesn't match one of our cottages. Please check the
      address, or visit <a href="/" style="color:var(--accent)">our website</a>.</p>
    </div>
<?php else: ?>
    <div class="hero">
<?php if ($heroImg !== ''): ?>      <div class="hero-img" style="background-image:url('<?= $esc($heroImg) ?>')"></div>
<?php endif; ?>      <div class="htxt">
        <div class="eyebrow">North Norfolk Coast</div>
        <h1>How was <?= $esc($name) ?>?</h1>
<?php if ($subtitle !== ''): ?>        <div class="hsub"><?= $esc($subtitle) ?></div>
<?php endif; ?>      </div>
    </div>
    <div class="body">
      <p class="lede">Thanks for staying with us. A quick review helps other guests —
      and we'd love to share it on our website.</p>

      <form id="rev" novalidate>
        <label>Your rating <span class="req">*</span></label>
        <div class="stars" id="stars" role="radiogroup" aria-label="Star rating">
          <?php for ($i = 1; $i <= 5; $i++): ?>
          <button type="button" class="star" data-v="<?= $i ?>" aria-label="<?= $i ?> star<?= $i > 1 ? 's' : '' ?>">★</button>
          <?php endfor; ?>
        </div>
        <div class="rate-word" id="rateWord" aria-live="polite"></div>

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
  var WORDS = ['', 'Sorry to hear that', 'Room to improve', 'Good', 'Really good', 'Wonderful — thank you!'];
  var starEls = Array.prototype.slice.call(document.querySelectorAll('.star'));
  var rateWord = document.getElementById('rateWord');
  function paint(n) { starEls.forEach(function (b) { b.classList.toggle('on', +b.dataset.v <= n); }); }
  function word(n) {
    if (n > 0) { rateWord.textContent = WORDS[n]; rateWord.classList.add('show'); }
    else { rateWord.classList.remove('show'); }
  }
  starEls.forEach(function (b) {
    var v = +b.dataset.v;
    b.addEventListener('click', function () {
      stars = v; paint(v); word(v);
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    });
    // Desktop hover preview (fill up to the hovered star; no effect on touch).
    b.addEventListener('mouseenter', function () { paint(v); word(v); });
  });
  var starsWrap = document.getElementById('stars');
  starsWrap.addEventListener('mouseleave', function () { paint(stars); word(stars); });

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
              '<span class="offer-tag">Best price, direct</span>' +
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
