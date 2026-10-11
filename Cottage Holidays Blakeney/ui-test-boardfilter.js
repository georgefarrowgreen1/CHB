// THE BOARD FILTER SAYS ONLY WHAT IT CAN SEE — the search window's "Filter the … board".
//
//  §1 TODAY: the words dim the bookings and calendar bars that don't match, and the banner
//     counts the records on screen. A re-render keeps the dimming: Today redraws its rows on
//     every data refresh, and the dims used to drop while the banner went on claiming them.
//  §2 A HIDDEN ROW IS NOT A MATCH: the count is of rows anyone can see.
//  §3 PAYMENTS has no list to narrow, so the action names Today and goes there — and the
//     reload that landing triggers keeps the filter.
//  §4 THE INBOX: the words go into the Inbox's own search, which narrows the one list. Its
//     old [data-search] rows are hidden, so dimming them claimed matches nobody could see.
//     A phone's open conversation steps aside so the list shows.
const { boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = require('./ui-test-lib').d;

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 900 } });
  const mkB = (id, prop, name, email, inD, outD) => ({
    id, prop_key: prop, name, email, phone: '', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(outD), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'paid', deposit_paid: 580, payment_method: 'card', payment_date: '',
    agreed_total: 580, agreed_per_night: 145, agreed_nights: 4, agreed_nightly: 580, agreed_booking_fee: 0,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-10), hold_status: 'none', notes: '', created_at: `${d(-10)} 10:00:00`,
  });
  const rows = [mkB(1, 'jollyboat', 'Sarah Pemberton', 'sarah@example.com', 3, 7), mkB(2, '21a', 'Bob Carter', 'bob@example.com', 5, 9)];
  const enquiries = [{ id: 21, prop_key: 'pimpernel', name: 'Tom Barrett', email: 'tom@example.com', phone: '', check_in: d(30), check_out: d(33), adults: 2, children: 0, message: 'Do you allow late checkout?', created_at: `${d(-1)} 09:14:00` }];
  await page.route(/\.php/, (route) => {
    const req = route.request();
    const url = req.url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let act = ''; try { act = JSON.parse(req.postData() || '{}').action || ''; } catch (e) {}
    if (url.includes('cron-status.php')) return json({ stale: false, everRan: true, ageHours: 3 });
    if (url.includes('bookings.php')) {
      if (act === 'email_logs') return json({ ok: true, logs: {} });
      if (act) return json({ ok: true, history: [], events: [], payments: [] });
      return json({ bookings: rows });
    }
    if (url.includes('enquiries.php')) {
      if (act === 'declined') return json({ ok: true, enquiries: [] });
      if (act) return json({ ok: true });
      return json({ enquiries });
    }
    if (url.includes('mailbox.php')) return json({ ok: true, messages: [], total: 0, hasMore: false });
    if (url.includes('messages.php')) return json({ ok: true, threads: [] });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, feeds: [], years: [], cron: { stale: false, everRan: true, ageHours: 3 } });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForFunction(() => document.querySelectorAll('#bookings-list .bk-row').length === 2, null, { timeout: 15000 }).catch(() => {});

  // Ask the search window, as the owner would: type, then tap the action's own row.
  const ask = async (q, label) => {
    await page.evaluate(() => openCmdK());
    await page.waitForSelector('#cmdk-input', { state: 'visible' });
    await page.fill('#cmdk-input', '');
    await page.type('#cmdk-input', q);
    const labels = async () => page.$$eval('#cmdk .cmdk-row', (r) => r.map((x) => (x.querySelector('.cmdk-row-label') || x).textContent.trim()));
    let seen = [];
    for (let i = 0; i < 40; i++) { seen = await labels(); if (seen.some((l) => l === label)) break; await page.waitForTimeout(100); }
    const hit = seen.some((l) => l === label);
    if (hit) {
      await page.evaluate((lb) => {
        const row = [...document.querySelectorAll('#cmdk .cmdk-row')].find((x) => ((x.querySelector('.cmdk-row-label') || x).textContent.trim()) === lb);
        row.click();
      }, label);
    }
    return { hit, seen };
  };
  const today = () => page.evaluate(() => {
    const row = (n) => [...document.querySelectorAll('#bookings-list .bk-row')].find((r) => r.textContent.includes(n));
    const bar = (n) => [...document.querySelectorAll('#cal-body .tl-bar')].find((r) => (r.getAttribute('data-search') || '').includes(n));
    const bn = document.getElementById('today-filter-bar');
    const s = row('Sarah'), b = row('Bob'), sb = bar('sarah'), bb = bar('bob');
    return {
      view: (document.querySelector('.page-view.active') || {}).id,
      banner: bn && bn.closest('#view-backoffice') && bn.getClientRects().length ? (bn.querySelector('span') || bn).textContent.replace(/\s+/g, ' ').trim() : '',
      sarahDim: !!s && s.classList.contains('cmdk-dim'), bobDim: !!b && b.classList.contains('cmdk-dim'),
      sarahBarDim: !!sb && sb.classList.contains('cmdk-dim'), bobBarDim: !!bb && bb.classList.contains('cmdk-dim'),
      bars: !!sb && !!bb, old: !!b && !!b.__old,
    };
  });

  console.log('§1 Today: the words dim what does not match');
  const a1 = await ask('filter today board sarah', 'Filter the Today board');
  ok(a1.hit, `the action names the Today board (${a1.seen.slice(0, 4).join(' | ')})`);
  await page.waitForTimeout(400);
  let t = await today();
  ok(t.view === 'view-backoffice', `it stays on Today (${t.view})`);
  ok(/Filtering for sarah · 1 match\b/.test(t.banner), `the banner counts one record ("${t.banner}")`);
  ok(!t.sarahDim && t.bobDim, 'Bob’s row is dimmed, Sarah’s is not');
  ok(t.bars && !t.sarahBarDim && t.bobBarDim, 'and the same on the calendar bars');
  // Each renderer on its own: one repainting the whole view would hide the other's miss.
  await page.evaluate(() => { renderBookings(); });
  await page.waitForTimeout(150);
  t = await today();
  ok(!t.sarahDim && t.bobDim, 'the bookings list drawn afresh keeps the dimming');
  await page.evaluate(() => { renderCalendar(); });
  await page.waitForTimeout(150);
  t = await today();
  ok(t.bars && !t.sarahBarDim && t.bobBarDim, 'the calendar drawn afresh keeps it too');
  ok(/1 match\b/.test(t.banner), `and the banner still counts one (“${t.banner}”)`);

  console.log('§2 a hidden row is not a match');
  const n = await page.evaluate(() => {
    const v = document.getElementById('view-backoffice');
    const x = document.createElement('div');
    x.id = 'bf-hidden'; x.setAttribute('data-search', 'sarah hidden'); x.style.display = 'none';
    v.appendChild(x);
    const c = paintTodayFilter();
    x.remove();
    return c;
  });
  ok(n === 1, `a matching row nobody can see is not counted (${n})`);
  await page.evaluate(() => { const b = document.querySelector('#today-filter-bar [data-act="clearTodayFilter"]'); if (b) b.click(); });
  await page.waitForTimeout(150);
  t = await today();
  ok(!t.banner && !t.bobDim, 'Clear takes the banner and the dimming away');

  console.log('§3 Payments: the action names Today and goes there');
  await page.evaluate(() => { document.querySelectorAll('#bookings-list .bk-row').forEach((r) => { /** @type {any} */ (r).__old = true; }); });
  await page.evaluate(async () => { await openAccounts(); });
  await page.waitForFunction(() => (document.querySelector('.page-view.active') || {}).id === 'view-accounts', null, { timeout: 8000 }).catch(() => {});
  const a3 = await ask('filter the board bob', 'Filter the Today board');
  ok(a3.hit && !a3.seen.some((l) => /Payments board/.test(l)), `no "Filter the Payments board" — it offers Today (${a3.seen.slice(0, 3).join(' | ')})`);
  await page.waitForFunction(() => (document.querySelector('.page-view.active') || {}).id === 'view-backoffice', null, { timeout: 8000 }).catch(() => {});
  // The landing reloads Today's data and draws the rows again; wait for that redraw.
  await page.waitForFunction(() => { const r = document.querySelector('#bookings-list .bk-row'); return r && !/** @type {any} */ (r).__old; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  t = await today();
  ok(t.view === 'view-backoffice' && !t.old, `it lands on Today, whose rows were drawn afresh (${t.view}, redrawn ${!t.old})`);
  ok(t.sarahDim && !t.bobDim, 'and the redrawn rows keep the filter: Sarah dimmed, Bob not');
  ok(/Filtering for bob · 1 match\b/.test(t.banner), `the banner says so ("${t.banner}")`);
  await page.evaluate(() => clearTodayFilter());

  console.log('§4 the Inbox: the words go into its own search');
  await page.evaluate(async () => { await openInbox(); });
  await page.waitForFunction(() => document.querySelectorAll('#ib-rows .ib-rowwrap').length >= 3, null, { timeout: 15000 }).catch(() => {});
  // A phone with a conversation open: the list sits behind it.
  await page.click('#ib-rows .ib-rowwrap[data-key="e:sarah@example.com"] .ib-row').catch(() => {});
  await page.waitForTimeout(500);
  const conv = await page.evaluate(() => document.getElementById('ib').classList.contains('is-conv'));
  const a4 = await ask('filter inbox tom', 'Search the Inbox');
  ok(a4.hit && !a4.seen.includes('Filter the Today board'), `the action reads "Search the Inbox" (${a4.seen.slice(0, 3).join(' | ')})`);
  await page.waitForTimeout(700);
  const ib = await page.evaluate(() => ({
    q: /** @type {HTMLInputElement} */ (document.getElementById('ib-q')).value,
    clear: !/** @type {HTMLElement} */ (document.getElementById('ib-q-clear')).hidden,
    keys: [...document.querySelectorAll('#ib-rows .ib-rowwrap')].filter((r) => r.getClientRects().length).map((r) => r.getAttribute('data-key')),
    conv: document.getElementById('ib').classList.contains('is-conv'),
    banner: !!document.querySelector('#view-inbox #today-filter-bar'),
    dims: document.querySelectorAll('#view-inbox .cmdk-dim').length,
    view: (document.querySelector('.page-view.active') || {}).id,
  }));
  ok(ib.view === 'view-inbox', `it stays on the Inbox (${ib.view})`);
  ok(ib.q === 'tom' && ib.clear, `the Inbox's own search box holds the words, with its clear button ("${ib.q}")`);
  ok(ib.keys.length === 1 && ib.keys[0] === 'e:tom@example.com', `the list shows only who matches (${ib.keys.join(', ')})`);
  ok(conv && !ib.conv, `the open conversation stepped aside so the list shows (open before: ${conv})`);
  ok(!ib.banner && ib.dims === 0, `no banner and nothing dimmed in the hidden old lists (${ib.dims} dimmed)`);

  await done(fails);
})();
