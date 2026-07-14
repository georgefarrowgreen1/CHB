// ASSIST BAR on the Today workspace, end to end against mocked endpoints:
//  1. injection: knot + input + time-aware ambient chips on the static host
//  2. routing: plain terms live-filter the board ([data-search] dim + count,
//     timeline bars included, NO floating banner); questions answer INLINE
//     with the palette's own rows; NLU paraphrases carry the Understood-as
//     note; zero matches offer the deep "search everything" CTA
//  3. answer rows execute (booking row → its hub); chips run
//  4. the palette's "filter this workspace" ADOPTS into the bar
//  5. Escape/clear restore; the delegated input path (real typing) works
//  6. no duplicate DOM ids once both bars are injected; no overflow at 390px
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8261;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const mk = (id, pk, ci, co, name, pay) => ({ id, prop_key: pk, name, email: 'g@x.co', phone: '', check_in: ci, check_out: co, adults: 2, children: 0, payment: pay || 'paid', agreed_total: 440, agreed_on: d(-10), hold_status: 'none', notes: '' });
  const bookings = [mk(1, 'jollyboat', d(3), d(6), 'Alice Harper'), mk(2, 'jollyboat', d(20), d(23), 'Bob Mariner', 'deposit'), mk(3, '21a', d(8), d(11), 'Cara Winslow')];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const post = route.request().method() === 'POST';
    if (url.includes('bookings.php') && !post) return json({ bookings });
    if (url.includes('rates.php') && !post) return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    // Everything else succeeds generically — an unmocked 401 would flip
    // isAuthenticated mid-test and break the hub flows under test.
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(600);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(600);

  const type = async (q) => { await page.evaluate((x) => { const el = document.getElementById('abar-today-input'); el.value = x; abarRoute('abar-today', x); }, q); await page.waitForTimeout(250); };

  // 1) Injection: knot + input, and the idle bar shows NO suggestion chips
  //    (the ambient "suggested searches" were removed at the owner's request).
  const boot = await page.evaluate(() => {
    const host = document.getElementById('abar-today');
    return { has: !!host && host.classList.contains('abar'),
             knot: !!host.querySelector('.abar-ic svg path'), circles: host.querySelectorAll('.abar-ic circle').length,
             input: !!document.getElementById('abar-today-input'),
             chips: host.querySelectorAll('.abar-ambient .abar-chip').length,
             panel: (document.getElementById('abar-today-panel').innerHTML || '').trim() };
  });
  ok(boot.has && boot.knot && boot.circles === 0 && boot.input, 'bar injected on Today (knot + input)');
  ok(boot.chips === 0 && boot.panel === '', 'idle bar shows no suggested-search chips');

  // Duplicate-id sweep: both bars injected → every DOM id still unique.
  const dupes = await page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1));
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  });
  ok(dupes.length === 0, `no duplicate DOM ids with both bars injected${dupes.length ? ' (' + dupes.join(',') + ')' : ''}`);

  // 3) Plain guest name → FILTER mode.
  await type('alice');
  const flt = await page.evaluate(() => {
    const rowsAll = [...document.querySelectorAll('#view-backoffice .bk-row')];
    const dim = rowsAll.filter((r) => r.classList.contains('cmdk-dim')).length;
    const lit = rowsAll.filter((r) => !r.classList.contains('cmdk-dim')).map((r) => r.textContent).join(' ');
    return { total: rowsAll.length, dim, lit,
             count: document.getElementById('abar-today-count').textContent,
             banner: !!document.getElementById('today-filter-bar'),
             answer: document.getElementById('abar-today').classList.contains('has-answer'),
             tlDim: document.querySelectorAll('#view-backoffice .tl-bar.cmdk-dim').length };
  });
  ok(flt.total >= 3 && flt.dim >= 2, `plain name live-filters the board (${flt.dim}/${flt.total} dimmed)`);
  ok(/Alice/.test(flt.lit), 'Alice stays lit');
  ok(/\d+ match/.test(flt.count), `match count in the bar (${flt.count})`);
  ok(!flt.banner, 'no floating banner (the bar IS the filter UI)');
  ok(flt.tlDim >= 1, `timeline bars dim too (${flt.tlDim})`);
  ok(!flt.answer, 'not answer mode');

  // 4) A question → ANSWER mode, filter released.
  await type('who owes me money');
  const ans = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#abar-today-panel .abar-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    dims: document.querySelectorAll('#view-backoffice .cmdk-dim').length,
    answer: document.getElementById('abar-today').classList.contains('has-answer'),
    count: document.getElementById('abar-today-count').textContent }));
  ok(ans.answer && ans.rows.length > 0 && /Bob|balance|owe|Outstanding/i.test(ans.rows.join(' ')), `question answers inline (${(ans.rows[0] || '').slice(0, 50)})`);
  ok(ans.dims === 0 && ans.count === '', 'board filter released (no dims)');

  // 5) Answer row executes: booking row → its hub.
  const execI = await page.evaluate(() => { const st = __abars['abar-today']; const i = st.rows.findIndex((r) => r.type === 'booking'); if (i >= 0) abarExec('abar-today', i); return i; });
  await page.waitForTimeout(600);
  const execV = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(execI >= 0 && execV === 'view-booking-hub', `answer row runs (booking → hub, view=${execV})`);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(400);

  // 6) NLU paraphrase → Understood-as note.
  await type('is anyone in arrears with me');
  const nlu = await page.evaluate(() => ({ note: (document.querySelector('#abar-today-panel .abar-note') || {}).textContent || '', rows: document.querySelectorAll('#abar-today-panel .abar-row').length }));
  ok(nlu.rows > 0 && /Understood as/.test(nlu.note), `NLU paraphrase answers with the Understood-as note (${nlu.note.slice(0, 40)})`);

  // 7) Zero matches → deep CTA + honest count.
  await type('zzqxv');
  const zero = await page.evaluate(() => ({ deep: !!document.querySelector('#abar-today-panel .abar-deep'), count: document.getElementById('abar-today-count').textContent }));
  ok(zero.deep && /^0 matches/.test(zero.count), `zero matches → deep CTA + honest count (${zero.count})`);

  // 8) Deep CTA hands off to the palette.
  await page.evaluate(() => abarDeep('abar-today')); await page.waitForTimeout(400);
  const deep = await page.evaluate(() => ({ open: getComputedStyle(document.getElementById('cmdk')).display !== 'none', q: document.getElementById('cmdk-input').value, barV: document.getElementById('abar-today-input').value }));
  ok(deep.open && deep.q === 'zzqxv' && deep.barV === '', `deep CTA opens the palette with the query (${deep.q})`);
  await page.evaluate(() => { __cmdkMiss = null; closeCmdK(); });

  // 9) Clear restores the empty resting state (filter released, panel empty).
  await type('alice');
  await page.evaluate(() => abarClear('abar-today')); await page.waitForTimeout(200);
  const clr = await page.evaluate(() => ({ dims: document.querySelectorAll('#view-backoffice .cmdk-dim').length, panel: (document.getElementById('abar-today-panel').innerHTML || '').trim(), v: document.getElementById('abar-today-input').value }));
  ok(clr.dims === 0 && clr.panel === '' && clr.v === '', 'clear releases the filter + empties the bar');

  // 10) Palette "filter this workspace" adopts into the bar.
  await page.evaluate(() => applyTodayFilter('bob')); await page.waitForTimeout(500);
  const adopt = await page.evaluate(() => ({ v: document.getElementById('abar-today-input').value, count: document.getElementById('abar-today-count').textContent, banner: !!document.getElementById('today-filter-bar'), dims: document.querySelectorAll('#view-backoffice .cmdk-dim').length }));
  ok(adopt.v === 'bob' && /\d+ match/.test(adopt.count) && !adopt.banner && adopt.dims > 0, `palette filter lands IN the bar (${adopt.v} · ${adopt.count})`);
  await page.evaluate(() => abarClear('abar-today'));

  // 11) Escape clears via the delegated keydown.
  await type('alice');
  await page.focus('#abar-today-input'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const esc = await page.evaluate(() => ({ v: document.getElementById('abar-today-input').value, dims: document.querySelectorAll('#view-backoffice .cmdk-dim').length }));
  ok(esc.v === '' && esc.dims === 0, 'Escape clears the bar + filter');

  // 12) Real typing (delegated input event + debounce).
  await page.focus('#abar-today-input'); await page.keyboard.type('cara'); await page.waitForTimeout(500);
  const typed = await page.evaluate(() => ({ count: document.getElementById('abar-today-count').textContent, dims: document.querySelectorAll('#view-backoffice .cmdk-dim').length }));
  ok(/\d+ match/.test(typed.count) && typed.dims > 0, `typed input (delegated) filters live (${typed.count})`);
  await page.evaluate(() => abarClear('abar-today'));

  // 13) Phone width: no horizontal overflow.
  const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(spill <= 0, `no horizontal overflow at 390px (spill=${spill})`);

  // 14) Darkstar ONLINE glow — once the semantic model loads, the knot lights
  //     up. (The owner-side idle auto-loader may already have fired; force it
  //     to be deterministic, then assert the ready class + the knot glow.)
  await page.evaluate(() => darkstarLoad()); // real darkstar.bin served by php -S
  const glow = await page.evaluate(() => {
    const ready = document.body.classList.contains('darkstar-ready');
    const cs = getComputedStyle(document.querySelector('#abar-today .abar-ic'));
    return { ready, filter: cs.filter, color: cs.color };
  });
  ok(glow.ready, 'body.darkstar-ready set once Darkstar is loaded + indexed');
  ok(/drop-shadow/.test(glow.filter) && glow.filter !== 'none', `knot glows (filter: ${glow.filter.slice(0, 40)})`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} FAIL(S) ❌` : '\n  ASSIST BAR (TODAY) SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
