// ASSIST BAR intelligence parity with the palette, end to end:
//  1. knot states: GREEN breathing when the on-device model answers (NLU
//     paraphrase) — and NOT on literal intents; ORANGE learning flash on
//     teach, on every bar knot alongside the dock, clearing after ~2.2s
//  2. dead-end capture: walking away (focusout leaving the host) with an
//     unanswered query files a search miss; acting/deep-pivot/clearing don't;
//     bar misses surface in the palette's "search dead ends" teach flow
//  3. voice: per-bar mic via the shared chbVoiceStart core (fake
//     SpeechRecognition) — dictation routes, a FINAL transcript's answer is
//     SPOKEN (fake speechSynthesis records it), typed queries stay silent
//  4. conversation carry palette → bar
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8263;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    // Controllable speech APIs, present BEFORE any app script runs.
    window.__fakeRecs = [];
    window.SpeechRecognition = class {
      constructor() { window.__fakeRecs.push(this); }
      start() { this.started = true; }
      stop() { if (this.onend) this.onend(); }
      fire(text, isFinal) { const r = [{ transcript: text }]; r.isFinal = !!isFinal; if (this.onresult) this.onresult({ results: [r] }); }
      end() { if (this.onend) this.onend(); }
    };
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function (t) { this.text = t; this.lang = ''; this.rate = 1; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(u) { window.__spoken.push(u.text); if (u.onend) setTimeout(u.onend, 5); }, speaking: false, pending: false }, configurable: true });
  });

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const mkB = (id, pk, ci, co, name, pay) => ({ id, prop_key: pk, name, email: 'g@x.co', phone: '', check_in: ci, check_out: co, adults: 2, children: 0, payment: pay || 'paid', agreed_total: 440, agreed_on: d(-10), hold_status: 'none', notes: '' });
  const bookings = [mkB(1, 'jollyboat', d(3), d(6), 'Alice Harper'), mkB(2, 'jollyboat', d(20), d(23), 'Bob Mariner', 'deposit')];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const post = route.request().method() === 'POST';
    if (url.includes('bookings.php') && !post) return json({ bookings });
    if (url.includes('rates.php') && !post) return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(600);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(500);
  const type = async (q) => { await page.evaluate((x) => { const el = document.getElementById('abar-today-input'); el.value = x; abarRoute('abar-today', x); }, q); await page.waitForTimeout(250); };

  // 1) GREEN on NLU paraphrase; not on a literal intent.
  await type('is anyone in arrears with me');
  let g = await page.evaluate(() => ({ ml: document.getElementById('abar-today').classList.contains('ml-active'), color: getComputedStyle(document.querySelector('#abar-today .abar-ic')).color, anim: getComputedStyle(document.querySelector('#abar-today .abar-ic')).animationName }));
  ok(g.ml && g.color === 'rgb(76, 175, 80)' && /cmdk-ml-glow/.test(g.anim), `NLU paraphrase → bar knot GREEN + breathing (${g.color})`);
  await type('who owes me money');
  g = await page.evaluate(() => document.getElementById('abar-today').classList.contains('ml-active'));
  ok(!g, 'literal intent → no glow');
  await page.evaluate(() => abarClear('abar-today'));

  // 2) ORANGE learning flash reaches the bar knots, then clears.
  await page.evaluate(() => chbNluLearn('utterly novel phrasing zq', 'who owes me money'));
  await page.waitForTimeout(150);
  const o = await page.evaluate(() => ({
    bar: document.querySelector('#abar-today .abar-ic').classList.contains('ml-learning'),
    color: getComputedStyle(document.querySelector('#abar-today .abar-ic')).color,
    dock: document.querySelector('.admin-dock-btn[data-act="openCmdK"]').classList.contains('ml-learning') }));
  ok(o.bar && o.dock && o.color === 'rgb(255, 167, 38)', `teach → bar knot flashes ORANGE with the dock (${o.color})`);
  await page.waitForTimeout(2400);
  const oc = await page.evaluate(() => document.querySelectorAll('.ml-learning').length);
  ok(oc === 0, 'flash clears');

  // 3) Dead-end capture on walk-away + exemptions.
  await page.evaluate(() => chbNluStore('chb-search-misses', []));
  await type('fizzlewick doodah');
  await page.evaluate(() => { const e = new FocusEvent('focusout', { bubbles: true, relatedTarget: document.querySelector('.admin-dock-btn') }); document.getElementById('abar-today-input').dispatchEvent(e); });
  await page.waitForTimeout(150);
  let misses = await page.evaluate(() => chbMissList().map((m) => m.t));
  ok(misses.includes('fizzlewick doodah'), `walk-away files the dead end (${misses.join(',')})`);
  // Pivoting to deep search hands the query to the palette — the bar doesn't file it.
  await type('quibbly wobble');
  await page.evaluate(() => abarDeep('abar-today')); await page.waitForTimeout(300);
  misses = await page.evaluate(() => chbMissList().map((m) => m.t));
  ok(!misses.includes('quibbly wobble'), 'deep-search pivot is not filed by the bar');
  await page.evaluate(() => { __cmdkMiss = null; closeCmdK(); });
  // Clearing is deliberate — not a miss.
  await type('smorgas nonsense');
  await page.evaluate(() => abarClear('abar-today'));
  await page.evaluate(() => { const e = new FocusEvent('focusout', { bubbles: true }); document.getElementById('abar-today-input').dispatchEvent(e); });
  misses = await page.evaluate(() => chbMissList().map((m) => m.t));
  ok(!misses.includes('smorgas nonsense'), 'cleared query is not filed');
  // The bar's misses surface in the palette teach flow.
  const teach = await page.evaluate(() => { openCmdK(); const i = document.getElementById('cmdk-input'); i.value = 'search dead ends'; cmdkSearchCore('search dead ends', false); return [...document.querySelectorAll('#cmdk-results .cmdk-row')].map((r) => r.textContent).join(' '); });
  ok(/fizzlewick doodah/.test(teach), 'bar miss appears in the palette teach flow');
  await page.evaluate(() => closeCmdK());

  // 4) Voice: mic revealed, dictation routes, final answers are SPOKEN.
  const micVis = await page.evaluate(() => getComputedStyle(document.getElementById('abar-today-mic')).display);
  ok(micVis === 'flex', `bar mic revealed when speech recognition exists (${micVis})`);
  await page.evaluate(() => { window.__spoken.length = 0; abarVoice('abar-today'); });
  const listening = await page.evaluate(() => ({ started: window.__fakeRecs.length > 0 && window.__fakeRecs[window.__fakeRecs.length - 1].started, cls: document.getElementById('abar-today-mic').classList.contains('is-listening') }));
  ok(listening.started && listening.cls, 'mic tap starts recognition + listening state');
  await page.evaluate(() => { const r = window.__fakeRecs[window.__fakeRecs.length - 1]; r.fire('who owes me money', true); r.end(); });
  await page.waitForTimeout(300);
  const voiced = await page.evaluate(() => ({ v: document.getElementById('abar-today-input').value, rows: document.querySelectorAll('#abar-today-panel .abar-row').length, spoken: window.__spoken.slice() }));
  ok(voiced.v === 'who owes me money' && voiced.rows > 0, `dictation fills the bar + answers inline (${voiced.v})`);
  ok(voiced.spoken.length > 0 && /owes/i.test(voiced.spoken[0]), `the answer is SPOKEN back (${String(voiced.spoken[0] || '').slice(0, 40)})`);
  await page.evaluate(() => { window.__spoken.length = 0; });
  await type('who owes me money');
  const silent = await page.evaluate(() => window.__spoken.length);
  ok(silent === 0, 'typed query is not spoken');
  await page.evaluate(() => abarClear('abar-today'));

  // 5) Conversation carry palette → bar: ask there, follow up here.
  await page.evaluate(() => { openCmdK(); const i = document.getElementById('cmdk-input'); i.value = 'who owes me money'; cmdkSearchCore('who owes me money', true); });
  await page.waitForTimeout(250);
  const carried = await page.evaluate(() => { document.getElementById('cmdk').style.display = 'none'; return __cmdkConvCtx ? __cmdkConvCtx.id : null; });
  await type('email them');
  const conv = await page.evaluate(() => [...document.querySelectorAll('#abar-today-panel .abar-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).join(' '));
  ok(carried === 'b2' && /Bob/i.test(conv), `palette answer → bar follow-up "email them" resolves Bob (ctx=${carried})`);
  await page.evaluate(() => abarClear('abar-today'));

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} FAIL(S) ❌` : '\n  ASSIST BAR PARITY SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
