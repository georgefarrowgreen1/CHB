// THE SIMPLER TODAY — what the owner's landing says and shows, gated as the approved demo drew it.
//
//  §1 NO DAY SENTENCE: the card says what to do, so a line above it said it twice. The line is
//     empty and unpainted on a phone; no date line, no movements list, no ✓ capsule.
//  §2 ONE TASK IS A CARD WITH ONE BUTTON: the heading stands down and the action is a full-width
//     accent button reading the action ("Return £60"); several tasks keep the heading and the list.
//  §3 THE MONTH ROW holds ‹ Today › and a + (44px, named); there is no ⋯ beside it, and the +'s
//     menu carries Add a booking, Block dates, the zoom and the refresh.
//  §4 THE CALENDAR SAYS LESS: dates only (no ↺, no pips), today's number circled, a platform block
//     is faint hatching with no outline, and no bar's words are struck by the playhead.
//  §5 BOOKINGS: two tabs (Upcoming / Past), no ⋯, and who owes said ONCE in one line.
const { boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 900 } });
  const mkB = (id, prop, name, inD, outD, pay, dep, hold) => ({
    id, prop_key: prop, name, email: 'g@e.com', phone: '', address: '', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(outD), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: pay, deposit_paid: dep, payment_method: 'card', payment_date: '',
    agreed_total: 640, agreed_per_night: 145, agreed_nights: 4, agreed_nightly: 580, agreed_booking_fee: 60,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-10), hold_status: hold || 'none', notes: '',
  });
  let rows = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let act = ''; try { act = JSON.parse(route.request().postData() || '{}').action || ''; } catch (e) {}
    if (url.includes('cron-status.php')) return json({ stale: false, everRan: true, ageHours: 3 });
    if (url.includes('ical-import.php')) { return setTimeout(() => json({ ok: true }), 1500); }
    if (url.includes('bookings.php')) {
      if (act === 'email_logs') return json({ ok: true, logs: {} });
      if (act === 'history') return json({ ok: true, history: [] });
      return json({ bookings: rows });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, feeds: [], cron: { stale: false, everRan: true, ageHours: 3 } });
  });
  const open = async () => {
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(600);
    await page.evaluate(async () => { await openBookings(); });
    await page.waitForTimeout(1600);
  };

  // ── ONE duty: a deposit to hand back, and a stay in progress that owes nothing ──
  rows = [mkB(2, 'jollyboat', 'Emma Clarke', -6, -2, 'paid', 0, 'charged')];
  await open();
  console.log('§1 no day sentence');
  const one = await page.evaluate(() => {
    const el = document.getElementById('today-date');
    return { text: el.textContent, shown: el.getClientRects().length > 0, cap: document.getElementById('today-verdict').textContent.trim() };
  });
  ok(one.text === '' && !one.shown, `the line above the card is gone — empty and not painted ("${one.text}")`);
  ok(one.cap === '', 'and there is no ✓ capsule beside the title');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#view-backoffice .dashboard-header')).borderBottomWidth === '0px'), 'and no divider line sits under the Today title');
  console.log('§2 one task is a card with one button');
  const card = await page.evaluate(() => {
    const w = document.getElementById('needs-you');
    const head = w.querySelector('.bo-sec-title');
    const act = w.querySelector('.ny-row .ny-act');
    const r = act.getBoundingClientRect(), row = w.querySelector('.ny-row').getBoundingClientRect();
    return { solo: w.classList.contains('ny-solo'), headShown: head.getClientRects().length > 0, act: act.textContent.trim(), w: Math.round(r.width), rowW: Math.round(row.width), h: Math.round(r.height), bg: getComputedStyle(act).backgroundColor };
  });
  ok(card.solo && !card.headShown, 'the "Needs you" heading stands down for a single task');
  ok(/^Return £60/.test(card.act), `the button names the action ("${card.act}")`);
  ok(card.w > card.rowW * 0.8 && card.h >= 44, `…full width and a 44px target (${card.w} of ${card.rowW}, ${card.h}px)`);
  ok(card.bg !== 'rgba(0, 0, 0, 0)', `…filled with the accent (${card.bg})`);

  console.log('§3 the month row');
  const row = await page.evaluate(() => {
    const bar = document.querySelector('.cal-header-bar');
    const title = bar.querySelector('.cal-month-title').getBoundingClientRect();
    const seg = bar.querySelector('.tl-seg').getBoundingClientRect();
    const add = bar.querySelector('.cal-add-btn').getBoundingClientRect();
    return {
      oneRow: Math.abs(title.top - add.top) < 40 && Math.abs(seg.top - add.top) < 40,
      right: Math.round(add.right), vw: innerWidth, w: Math.round(add.width), h: Math.round(add.height),
      dots: !!bar.querySelector('.bhub-menu-btn'),
      items: [...bar.querySelectorAll('.bhub-menu [data-act]')].map((b) => b.getAttribute('data-act')),
    };
  });
  ok(row.oneRow, 'title, ‹ Today › and + share one row at 390px');
  ok(row.w >= 44 && row.h >= 44 && row.right <= row.vw, `the + is a 44px target inside the screen (${row.w}x${row.h}, right ${row.right} of ${row.vw})`);
  ok(!row.dots, 'there is no ⋯ beside it');
  ok(['openAddBooking', 'openBlockDates', 'autoSyncIcalBlocks'].every((a) => row.items.includes(a)) && !row.items.includes('tlToggleZoom'), `the + menu holds add, block and refresh, and no compact-calendar toggle (${row.items.join(', ')})`);

  console.log('§4 the calendar says less');
  await page.evaluate((o) => {
    dbBlocks['21a'] = [{ id: 9101, source: 'airbnb', kind: 'blocked', label: 'Airbnb (Not available)', checkIn: o.a, checkOut: o.b }];
    dbBookings['jollyboat'] = [{ id: 'b2', dbId: 2, propKey: 'jollyboat', name: 'Tina', email: 't@e.com', checkIn: o.z, checkOut: o.t, adults: 2, children: 0, payment: 'paid', depositPaid: 640 }];
    dbBookings['21a'] = [{ id: 'b3', dbId: 3, propKey: '21a', name: 'Nora', email: 'n@e.com', checkIn: o.z, checkOut: o.t, adults: 2, children: 0, payment: 'paid', depositPaid: 640 }];
    renderCalendar(); tlPlaceNowLine();
  }, { a: d(0), b: d(5), z: d(-2), t: d(0) });
  await page.waitForTimeout(400);
  const tl = await page.evaluate(() => {
    const num = document.querySelector('#cal-body .tl-day.is-today .tl-num');
    const ns = getComputedStyle(num);
    const line = document.querySelector('#cal-body .tl-nowline');
    const lr = line ? line.getBoundingClientRect() : null;
    // The playhead must not pass through any painted bar LABEL (a Range over its text).
    let struck = 0;
    for (const bar of document.querySelectorAll('#cal-body .tl-bar')) {
      const r = document.createRange(); r.selectNodeContents(bar);
      for (const x of r.getClientRects()) if (lr && x.width > 0 && lr.left < x.right && lr.right > x.left && lr.top < x.bottom && lr.bottom > x.top) struck++;
    }
    const blocked = [...document.querySelectorAll('#cal-body .tl-ext.tl-blocked')][0];
    const bs = blocked ? getComputedStyle(blocked) : null;
    return {
      chg: document.querySelectorAll('#cal-body .tl-chg').length, pips: document.querySelectorAll('#cal-body .tl-occ').length,
      circled: ns.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(ns.borderTopLeftRadius) > 4,
      struck, hasLine: !!line, hatched: !!bs && bs.borderTopStyle === 'none' && /repeating-linear-gradient/.test(bs.backgroundImage),
    };
  });
  ok(tl.chg === 0 && tl.pips === 0, `no ↺ marks and no occupancy pips (${tl.chg} / ${tl.pips})`);
  ok(tl.circled, "today's number is circled");
  ok(tl.hasLine && tl.struck === 0, `the playhead does not strike through any bar's words (${tl.struck})`);
  ok(tl.hatched, 'a platform block is faint hatching with no outline');

  console.log('§5 bookings');
  const bk = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('#bookings-filters [data-bfilter]')].map((b) => b.getAttribute('data-bfilter')),
    more: !!document.getElementById('bookings-more-btn'),
    owed: (document.getElementById('bookings-owed') || {}).textContent || '',
  }));
  ok(bk.tabs.join() === 'upcoming,past' && !bk.more, `two tabs and no ⋯ (${bk.tabs.join()})`);
  ok(/Nobody owes you anything/.test(bk.owed), `nobody owes → the pill says so ("${bk.owed.trim()}")`);
  const owes = await page.evaluate((o) => {
    dbBookings['jollyboat'] = [Object.assign({}, dbBookings['jollyboat'][0], { id: 'b9', dbId: 9, name: 'Sarah Pemberton', checkIn: o.f, checkOut: o.g, depositPaid: 0, payment: 'unpaid' })];
    renderBookings();
    const b = document.querySelector('#bookings-owed .head-pill');
    return { txt: b ? b.textContent.trim() : '', btn: !!b && b.tagName === 'BUTTON', label: b ? b.getAttribute('aria-label') || '' : '', tone: b ? b.dataset.tone : '' };
  }, { f: d(5), g: d(9) });
  ok(owes.btn && /^£[\d,]+ to collect$/.test(owes.txt) && owes.tone === 'warn', `someone owes → the figure, as an amber pill you can tap ("${owes.txt}")`);
  ok(/from 1 guest/.test(owes.label), `…which tells a screen reader who it is from ("${owes.label}")`);

  // THE MANAGE PILL'S PLACE: right of the Today title, centred on its line — not a row in the bookings card.
  await page.waitForTimeout(600);
  const place = await page.evaluate(() => {
    const p = document.querySelector('#bookings-owed .head-pill'), h = document.querySelector('#view-backoffice h1');
    const pr = p.getBoundingClientRect(), hr = h.getBoundingClientRect();
    const r = document.querySelector('#bookings-list .bk-row');
    return {
      right: Math.round(document.querySelector('#view-backoffice .dashboard-header').getBoundingClientRect().right - pr.right),
      dy: Math.abs((pr.top + pr.height / 2) - (hr.top + hr.height / 2)), after: pr.left > hr.right, h: Math.round(pr.height),
      inList: !!document.querySelector('#bookings-workspace .head-pill'),
      rTop: r ? parseFloat(getComputedStyle(r).borderTopLeftRadius) : -1,
      cls: [...p.classList].join(' '), manage: document.getElementById('health-pill').className,
    };
  });
  ok(place.after && place.right <= 1 && place.dy <= 2, `the pill sits right of the title on its line (${place.right}px from the edge, ${place.dy.toFixed(1)}px off centre)`);
  ok(place.h === 44 && /\bcron-pill\b/.test(place.cls) && /\bhead-pill\b/.test(place.cls), `it IS the Manage pill (${place.cls}, ${place.h}px)`);
  ok(!place.inList && place.rTop >= 16, `the bookings list is its own card, with no status row on top (first row's corner ${place.rTop}px)`);
  await page.evaluate((o) => {
    dbBookings['jollyboat'] = [Object.assign({}, dbBookings['jollyboat'][0], { id: 'b7', dbId: 7, name: 'Paid Guest', checkIn: o.f, checkOut: o.g, depositPaid: 640, payment: 'paid' })];
    renderBookings();
  }, { f: d(5), g: d(9) });
  const clear = await page.evaluate(() => {
    const p = document.querySelector('#bookings-owed .head-pill');
    return { txt: p ? p.textContent.trim() : '', tone: p ? p.dataset.tone : '', tag: p ? p.tagName : '', sum: (document.getElementById('bookings-summary') || {}).textContent || '' };
  });
  ok(clear.tone === 'ok' && clear.txt === 'Nobody owes you anything' && clear.tag === 'SPAN', `clear: a green pill that only states ("${clear.txt}")`);
  ok(/^· 1 upcoming$/.test(clear.sum.trim()), `the count is the caption's ("${clear.sum.trim()}")`);

  if (process.env.CHB_SHOT) await page.screenshot({ path: process.env.CHB_SHOT, fullPage: true });

  // The empty state is the standard one: a card of its own, with no button.
  await page.evaluate((o) => {
    // Only a FINISHED stay remains, so Upcoming is empty while the books are known to be clear.
    dbBookings['jollyboat'] = [Object.assign({}, dbBookings['jollyboat'][0], { id: 'b8', dbId: 8, name: 'Old Guest', checkIn: o.a, checkOut: o.b, depositPaid: 640, payment: 'paid' })];
    dbBookings['21a'] = []; dbBookings['pimpernel'] = []; renderBookings();
  }, { a: d(-9), b: d(-5) });
  await page.waitForTimeout(600); // let the list's own fade-in settle before measuring a gap
  const emp = await page.evaluate(() => {
    const e = document.querySelector('#bookings-list .bk-empty');
    const es = e ? getComputedStyle(e) : null;
    return {
      has: !!e, title: e ? (e.querySelector('p') || {}).textContent : '', sub: e ? (e.querySelector('small') || {}).textContent : '',
      icon: !!(e && e.querySelector('svg')), buttons: e ? e.querySelectorAll('button, a').length : -1,
      card: !!es && parseFloat(es.borderTopLeftRadius) >= 16 && es.borderTopStyle !== 'none',
      // The one look's switcher: a pill track, no floating shadow, the chosen side in the accent.
      seg: (() => {
        const f = document.getElementById('bookings-filters'), on = f.querySelector('.is-on');
        const acc = (() => { const p = document.createElement('span'); p.style.color = getComputedStyle(document.body).getPropertyValue('--accent').trim(); document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })();
        return { shadow: getComputedStyle(f).boxShadow, on: on ? getComputedStyle(on).backgroundColor : '', acc };
      })(),
    };
  });
  ok(emp.has && emp.title === 'No upcoming bookings' && /will appear here/.test(emp.sub), `the empty state names what is true and what fills it ("${emp.title}")`);
  ok(emp.icon && emp.buttons === 0, 'it carries the mark and NO button (the + in the month row is the way to add)');
  ok(emp.card, 'it is a card of its own — nothing sits on top of it now the status is the title\'s pill');
  ok(emp.seg.shadow === 'none' && emp.seg.on === emp.seg.acc, `the tabs are the one switcher — no floating shadow, the chosen side in the accent (${emp.seg.on})`);
  await page.evaluate(() => { bookingsSetFilter('customplan'); });
  ok(await page.evaluate(() => (document.querySelector('#bookings-list .bk-empty p') || {}).textContent === 'No bookings here'), 'a filter with nothing in it says so in its own words');
  await page.evaluate(() => { bookingsSetFilter('upcoming'); });

  // ── SEVERAL duties keep the heading and the list ──
  rows = [mkB(2, 'jollyboat', 'Emma Clarke', -6, -2, 'paid', 0, 'charged'), mkB(3, 'pimpernel', 'Dan Rowe', -5, -1, 'paid', 0, 'charged')];
  await open();
  const many = await page.evaluate(() => ({
    solo: document.getElementById('needs-you').classList.contains('ny-solo'),
    head: document.querySelector('#needs-you .bo-sec-title').getClientRects().length > 0,
  }));
  ok(!many.solo && many.head, 'several tasks keep the heading and the list');

  console.log(fails ? `\n${fails} SIMPLER-TODAY CHECK(S) FAILED ❌` : '\nSIMPLER TODAY GATE PASSED ✅');
  // Last, because a real refresh reloads the stores and would replace the fixtures the sections above inject.
  console.log('§3b Refresh calendar works IN the menu: it stays open, spins, and says nothing in words');
  await page.evaluate(() => { try { localStorage.removeItem('chb-ical-last-sync'); } catch (e) {} bhubMenuToggle({ stopPropagation() {}, currentTarget: document.querySelector('.cal-add-btn') }); });
  await page.waitForTimeout(300);
  await page.click('#cal-refresh-btn');
  await page.waitForTimeout(400);
  const rf = await page.evaluate(() => {
    const menu = document.querySelector('.cal-actions .bhub-menu');
    const btn = document.getElementById('cal-refresh-btn');
    const ic = btn.querySelector('.ic');
    return {
      open: !!menu && menu.style.display !== 'none' && !menu.classList.contains('bhub-menu-out'),
      syncing: btn.classList.contains('syncing'),
      anim: ic ? getComputedStyle(ic).animationName : '',
      note: (document.getElementById('cal-updated-text') || {}).textContent || '',
      label: btn.textContent.trim(),
    };
  });
  ok(rf.syncing, 'the refresh runs');
  ok(rf.open, 'the menu is still open while it runs');
  ok(/calSyncSpin/.test(rf.anim), `the refresh icon spins (${rf.anim})`);
  ok(!/sync/i.test(rf.note), `no "Syncing…" words (note: "${rf.note}")`);
  ok(rf.label === 'Refresh calendar', `the item is "Refresh calendar" (${rf.label})`);
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => { const m = document.querySelector('.cal-actions .bhub-menu'); return m.style.display !== 'none'; }), 'and it is STILL open when the refresh finishes');
  await page.mouse.click(5, 5);
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.querySelector('.cal-actions .bhub-menu').style.display === 'none'), 'a tap outside still closes it');

  await done(fails);
})().catch((e) => { console.error(e); process.exit(1); });
