// The dedicated SEARCH PAGE (all search now lives behind the dock's knot
// logo), end to end in a real browser — consolidating the essential coverage
// the retired per-workspace Assist Bar suites carried:
//  1. openCmdK → view-search page active, input focused, morning brief renders
//  2. answers render on the page; a literal query doesn't light the model
//  3. an NLU paraphrase lights the logo (understood/meaning) — colour, no words
//  4. conversational follow-up: a surfaced booking resolves "email them"
//  5. teaching flashes the logo + dock orange, then clears
//  6. Darkstar load → body flag + quiet purple ready logo
//  7. cmdkBack / ⌘K toggle return to the workspace you came from
//  8. leaving on an unanswered query files a search miss (teach loop)
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8291;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookings = [{ id: 1, prop_key: 'jollyboat', name: 'Bob Carter', email: 'b@x.co', phone: '', check_in: d(10), check_out: d(13), adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 500, hold_status: 'none' }];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
    if (url.includes('rates.php') && route.request().method() !== 'POST') return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 20, child_rate: 10, transaction_pct: 0, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [], content: {} });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(400);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(300);

  // 1) The dock's knot → the dedicated search page.
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(400);
  let st = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    focused: document.activeElement === document.getElementById('cmdk-input'),
    rows: document.querySelectorAll('#cmdk-results .cmdk-row').length,
  }));
  ok(st.view === 'view-search', `openCmdK lands on the search PAGE (${st.view})`);
  ok(st.focused, 'the input takes focus');
  ok(st.rows > 0, `the empty landing renders the brief (${st.rows} rows)`);

  // 2) A literal query answers on the page without lighting the model.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'who owes money'; cmdkSearchCore('who owes money', false); });
  await page.waitForTimeout(300);
  st = await page.evaluate(() => ({
    top: (document.querySelector('#cmdk-results .cmdk-row .cmdk-row-label') || {}).textContent || '',
    mstate: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
  }));
  ok(/£400/.test(st.top), `literal ops question answers on the page (${st.top.slice(0, 50)})`);
  // (Darkstar auto-loads during boot, so semantic recall may tag extra rows
  // "meaning" — the check is that a literal query is never an NLU REWRITE.)
  ok(!/understood|guess/.test(st.mstate || ''), `literal query is never an NLU rewrite (${st.mstate || 'rest'})`);

  // 3) An NLU paraphrase lights the logo.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'is anyone in arrears with me'; cmdkSearchCore('is anyone in arrears with me', false); });
  await page.waitForTimeout(300);
  st = await page.evaluate(() => {
    const ml = document.getElementById('cmdk-ml');
    return { mstate: ml.dataset.mstate, title: ml.title };
  });
  ok(/understood|meaning/.test(st.mstate || ''), `NLU paraphrase lights the logo (${st.mstate})`);
  ok(/Matched your wording|Found by meaning/.test(st.title || ''), 'the hover title explains the state');

  // 4) Conversational follow-up: the surfaced booking resolves a pronoun.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'when does bob arrive'; cmdkSearchCore('when does bob arrive', false); });
  await page.waitForTimeout(200);
  const follow = await page.evaluate(() => { const r = cmdkIntent('email them') || []; return { head: r[0] ? r[0].label : '(none)', mail: r.some((x) => /email|mail/i.test((x && x.label) || '')) }; });
  ok(/Bob Carter/.test(follow.head) && follow.mail, `"email them" resolves the surfaced booking (${follow.head})`);

  // 5) Teaching flashes the logo + dock orange, then clears.
  await page.evaluate(() => chbNluLearn('utterly novel phrasing zq', 'who owes me money'));
  await page.waitForTimeout(150);
  st = await page.evaluate(() => ({
    ml: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
    dock: document.querySelector('.admin-dock-btn[data-act="openCmdK"]').classList.contains('ml-learning'),
  }));
  ok(st.ml === 'learning' && st.dock, `teach → learning flash on logo + dock (${st.ml})`);
  await page.waitForTimeout(2400);
  st = await page.evaluate(() => (document.getElementById('cmdk-ml') || {}).dataset.mstate);
  ok(st !== 'learning', 'the learning flash clears');

  // 6) Darkstar online → ready tint on the logo.
  await page.evaluate(() => darkstarLoad()); // real darkstar.bin served by php -S
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('cmdk-input').value = ''; cmdkSearchCore('', false); });
  st = await page.evaluate(() => ({
    ready: document.body.classList.contains('darkstar-ready'),
    mstate: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
    color: getComputedStyle(document.getElementById('cmdk-ml')).color,
  }));
  ok(st.ready, 'body.darkstar-ready set once the model is loaded + indexed');
  ok(st.mstate === 'ready' && st.color === 'rgb(168, 85, 247)', `logo rests on the Darkstar purple (${st.mstate}, ${st.color})`);

  // 7) cmdkBack returns to the workspace you came from; ⌘K toggles.
  await page.evaluate(() => cmdkBack()); await page.waitForTimeout(300);
  let view = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(view === 'view-backoffice', `cmdkBack returns to the origin workspace (${view})`);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  view = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(view === 'view-search', `⌘K opens the search page (${view})`);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  view = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(view === 'view-backoffice', `⌘K again toggles back (${view})`);

  // 8) Leaving on an unanswered query files a search miss (the teach loop).
  await page.evaluate(() => { chbNluStore('chb-search-misses', []); CHB_NLU.misses = null; });
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'fizzlewick doodah'; cmdkSearchCore('fizzlewick doodah', false); });
  await page.waitForTimeout(200);
  await page.evaluate(() => cmdkBack());
  const misses = await page.evaluate(() => chbMissList().map((m) => m.t));
  ok(misses.includes('fizzlewick doodah'), `dead-end query filed as a miss (${misses.join(', ')})`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} SEARCH-PAGE CHECK(S) FAILED ❌` : '\n  SEARCH-PAGE SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
