// ASSIST BAR on the Inbox, end to end against mocked endpoints:
//  1. injection above the folder switch (phone); tops the LIST column in the
//     three-pane layout at 1280px (not the folder rail)
//  2. folder-aware filtering: one query dims [data-search] rows across ALL
//     folders (chat threads included), per-folder .ifold-match pills on the
//     switch, unread chips step aside (.is-filtered), no floating banner
//  3. questions answer inline; conversation carry ("email them" resolves the
//     guest the previous answer surfaced)
//  4. the palette's "filter this workspace" adopts into this bar
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8262;
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
  const mkB = (id, pk, ci, co, name, pay) => ({ id, prop_key: pk, name, email: 'g@x.co', phone: '', check_in: ci, check_out: co, adults: 2, children: 0, payment: pay || 'paid', agreed_total: 440, agreed_on: d(-10), hold_status: 'none', notes: '' });
  const bookings = [mkB(1, 'jollyboat', d(3), d(6), 'Alice Harper'), mkB(2, 'jollyboat', d(20), d(23), 'Bob Mariner', 'deposit')];
  const enqs = [
    { id: 11, prop_key: 'jollyboat', name: 'Daisy Quill', email: 'd@x.co', check_in: d(30), check_out: d(33), adults: 2, children: 0, message: 'Is the cottage dog friendly?', created_at: d(-1) + ' 10:00:00', status: 'new' },
    { id: 12, prop_key: '21a', name: 'Ed Sorrel', email: 'e@x.co', check_in: d(40), check_out: d(43), adults: 2, children: 0, message: 'Parking?', created_at: d(-2) + ' 10:00:00', status: 'new' },
  ];
  const threads = [{ thread_id: 7, name: 'Daisy Quill', email: 'd@x.co', last_body: 'hello about my stay', last_at: new Date().toISOString(), unread: 1, is_guest: 1, archived: 0 }];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const post = route.request().method() === 'POST';
    if (url.includes('messages.php') && post) {
      let body = {}; try { body = route.request().postDataJSON(); } catch (e) {}
      if (body.action === 'threads') return json({ threads });
      return json({ ok: true, messages: [] });
    }
    if (url.includes('enquiries.php') && !post) return json({ enquiries: enqs });
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
  await page.evaluate(() => openInbox()); await page.waitForTimeout(600);
  // Prime the Messages folder so its thread rows exist in the DOM, then back.
  await page.evaluate(() => inboxFolder('messages')); await page.waitForTimeout(600);
  await page.evaluate(() => inboxFolder('enquiries')); await page.waitForTimeout(300);

  const type = async (q) => { await page.evaluate((x) => { const el = document.getElementById('abar-inbox-input'); el.value = x; abarRoute('abar-inbox', x); }, q); await page.waitForTimeout(250); };

  // 1) Injection above the folder switch.
  const boot = await page.evaluate(() => {
    const host = document.getElementById('abar-inbox');
    const rail = document.getElementById('inbox-folders');
    return { has: !!host && host.classList.contains('abar'), input: !!document.getElementById('abar-inbox-input'),
             aboveRail: !!(host && rail && (host.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING)) };
  });
  ok(boot.has && boot.input && boot.aboveRail, 'bar injected on Inbox, above the folder switch');

  // 2) Filter → per-folder pills, chips aside, threads counted.
  await type('daisy');
  const flt = await page.evaluate(() => {
    const enqRows = [...document.querySelectorAll('#inbox-folder-enquiries [data-search]')];
    const pills = {}; document.querySelectorAll('#inbox-folders [data-ifolder]').forEach((b) => { const m = b.querySelector('.ifold-match'); pills[b.getAttribute('data-ifolder')] = m ? m.textContent : null; });
    return { total: enqRows.length, dim: enqRows.filter((r) => r.classList.contains('cmdk-dim')).length,
             lit: enqRows.filter((r) => !r.classList.contains('cmdk-dim')).map((r) => r.textContent).join(' '),
             pills, filtered: document.getElementById('inbox-folders').classList.contains('is-filtered'),
             chipHidden: getComputedStyle(document.getElementById('ifold-count-enq')).display === 'none',
             count: document.getElementById('abar-inbox-count').textContent,
             banner: !!document.getElementById('today-filter-bar') };
  });
  ok(flt.total === 2 && flt.dim === 1 && /Daisy/.test(flt.lit), `enquiry filter: Daisy lit, Ed dimmed (${flt.dim}/${flt.total})`);
  ok(flt.pills.enquiries === '1' && flt.pills.messages === '1' && flt.pills.email === '0', `per-folder match pills (enq=${flt.pills.enquiries}, msg=${flt.pills.messages}, email=${flt.pills.email})`);
  ok(flt.filtered && flt.chipHidden, 'unread chips step aside while filtering');
  ok(/^2 matches/.test(flt.count), `bar count spans folders (${flt.count})`);
  ok(!flt.banner, 'no floating banner');

  // 3) Switching to Messages mid-filter shows the matching thread lit.
  await page.evaluate(() => inboxFolder('messages')); await page.waitForTimeout(300);
  const msg = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#inbox-folder-messages .msg-thread-row')];
    return { n: rows.length, dim: rows.filter((r) => r.classList.contains('cmdk-dim')).length };
  });
  ok(msg.n === 1 && msg.dim === 0, `thread rows filter too (${msg.n} thread, ${msg.dim} dimmed)`);
  await page.evaluate(() => inboxFolder('enquiries')); await page.waitForTimeout(200);

  // 4) Clear restores pills + chips.
  await page.evaluate(() => abarClear('abar-inbox')); await page.waitForTimeout(200);
  const clr = await page.evaluate(() => ({
    pills: document.querySelectorAll('#inbox-folders .ifold-match').length,
    filtered: document.getElementById('inbox-folders').classList.contains('is-filtered'),
    chipShown: getComputedStyle(document.getElementById('ifold-count-enq')).display !== 'none',
    dims: document.querySelectorAll('#view-inbox .cmdk-dim').length }));
  ok(clr.pills === 0 && !clr.filtered && clr.chipShown && clr.dims === 0, 'clear restores the folder switch');

  // 5) A question answers inline here too.
  await type('who owes me money');
  const ans = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#abar-inbox-panel .abar-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    answer: document.getElementById('abar-inbox').classList.contains('has-answer') }));
  ok(ans.answer && ans.rows.length > 0 && /owes|Bob/i.test(ans.rows.join(' ')), `question answers inline (${(ans.rows[0] || '').slice(0, 50)})`);

  // 6) Conversation carry: "email them" resolves the surfaced guest.
  await type('email them');
  const conv = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#abar-inbox-panel .abar-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).join(' '),
    ctx: typeof __cmdkConvCtx === 'object' && __cmdkConvCtx ? __cmdkConvCtx.id : null }));
  ok(/Bob/i.test(conv.rows), `conversation carry: "email them" resolves Bob (ctx=${conv.ctx})`);

  // 7) Palette "filter this workspace" adopts into THIS bar.
  await page.evaluate(() => abarClear('abar-inbox'));
  await page.evaluate(() => applyTodayFilter('ed sorrel')); await page.waitForTimeout(500);
  const adopt = await page.evaluate(() => ({ v: document.getElementById('abar-inbox-input').value, count: document.getElementById('abar-inbox-count').textContent, banner: !!document.getElementById('today-filter-bar') }));
  ok(adopt.v === 'ed sorrel' && /1 match/.test(adopt.count) && !adopt.banner, `palette filter lands in the Inbox bar (${adopt.v} · ${adopt.count})`);
  await page.evaluate(() => abarClear('abar-inbox'));

  // 8) Phone width: no horizontal overflow.
  const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(spill <= 0, `no horizontal overflow at 390px (spill=${spill})`);

  // 9) Three-pane 1280px: the bar tops the LIST column, right of the rail.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => {
    const host = document.getElementById('abar-inbox').getBoundingClientRect();
    const rail = document.getElementById('inbox-folders').getBoundingClientRect();
    const list = document.getElementById('inbox-folder-enquiries').getBoundingClientRect();
    return { hostX: Math.round(host.x), railR: Math.round(rail.right), listX: Math.round(list.x) };
  });
  ok(wide.hostX >= wide.railR && Math.abs(wide.hostX - wide.listX) < 8, `1280px: bar over the list column, not the rail (host x ${wide.hostX} vs rail right ${wide.railR})`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} FAIL(S) ❌` : '\n  ASSIST BAR (INBOX) SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
