// PR-2 behaviours: the Today dashboard IS the bookings workspace.
//  1. wide: one screen holds timeline + rows + auto-docked hub, and the
//     auto-select must NOT scroll the page (quiet)
//  2. wide: tapping a TIMELINE BAR swaps the docked hub on the same screen
//     and scrolls the pane into view
//  3. narrow: a bar tap opens the standalone hub view
//  4. openBookings() alias lands on the dashboard at the workspace
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
// Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1280, height: 800 } });

  const mk = (id, ci, co, name) => ({
    id, prop_key: '21a', name, email: 'g@gmail.com', phone: '', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: ci, check_out: co, check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
    payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '', agreed_total: 440,
    agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0,
    agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
  });
  // Second Guest is on a CUSTOM plan (50% deposit) — the filter below exists to
  // find exactly this row among the standard ones.
  const rows = [mk(1, d(5), d(8), 'First Guest'),
    Object.assign(mk(2, d(20), d(23), 'Second Guest'), { deposit_pct_override: 50 })];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') return json({ ok: true, events: [], logs: {} });
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { nav('view-backoffice'); await initBackOffice(); });
  await page.waitForTimeout(1200);

  console.log('1. one wide screen: timeline + rows + quiet auto-dock');
  const w1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    tlDays: document.querySelectorAll('#cal-body .tl-day').length,
    rows: document.querySelectorAll('#bookings-list .bk-row').length,
    docked: !!document.querySelector('#bookings-detail-pane #booking-hub-content .bhub-head'),
    hubName: (document.querySelector('#bookings-detail-pane .bhub-name') || {}).textContent || '',
    scrollY: window.scrollY,
  }));
  ok(w1.active === 'view-backoffice', `dashboard active (${w1.active})`);
  ok(w1.tlDays > 20 && w1.rows === 2, `timeline (${w1.tlDays} days) + ${w1.rows} booking rows on ONE screen`);
  ok(w1.docked && w1.hubName === 'First Guest', `first booking auto-docked in the pane (${w1.hubName})`);
  ok(w1.scrollY === 0, `auto-select did NOT scroll the page (scrollY ${w1.scrollY})`);

  // 1c. WHICH BOOKINGS ARE NOT ON THE STANDARD SCHEDULE? The override columns
  // were read only inside the hub's own plan panel, so a mistyped plan stayed
  // invisible until the money came out wrong. Driven by CLICKING the chip — a
  // filter reachable only by calling the function is a filter nobody has.
  const plan = await page.evaluate(async () => {
    const chip = document.querySelector('#bookings-filters [data-bfilter="customplan"]');
    if (!chip) return { missing: true };
    chip.click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      on: chip.classList.contains('is-on'),
      names: [...document.querySelectorAll('#bookings-list .bk-row strong')].map((e) => e.textContent.trim()),
    };
  });
  ok(!plan.missing && plan.on, 'the bookings list offers a Custom plan filter');
  ok(plan.names.length === 1 && plan.names[0] === 'Second Guest',
    `…and it finds the one booking off the standard schedule (${JSON.stringify(plan.names)})`);
  await page.evaluate(async () => {
    document.querySelector('#bookings-filters [data-bfilter="upcoming"]').click();
    await new Promise((r) => setTimeout(r, 250));
  });

  // ---- The lane's own cells must agree with the bars on it ----------------
  // Bars are inset half a day at each end so a changeover reads as shared, which
  // leaves a bare strip on the check-in day and the checkout day. Measured, BOTH
  // offered "add a booking here": the checkout one is right (that night is free
  // again) and the check-in one prefilled a stay on a night already sold, which
  // the server then refuses. Hit-tested at the real pixels, because the defect is
  // the exposed strip and a class check cannot see it.
  console.log('1b. every day cell answers for the night it actually is');
  const lane = await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('#cal-body .tl-bar')).find((b) => b.textContent.trim() === 'First');
    if (!bar) return { err: 'no bar' };
    const r = bar.getBoundingClientRect();
    const dayW = parseFloat(getComputedStyle(document.querySelector('#cal-body .tl-cell')).width);
    const y = r.top + r.height / 2;
    const at = (x) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.getAttribute('data-act') || '-' : 'none';
    };
    return {
      checkinLeftHalf: at(r.left - dayW * 0.25),
      insideBar: at(r.left + 10),
      checkoutRightHalf: at(r.right + dayW * 0.25),
      // A day nobody has booked, well clear of both stays.
      freeDay: at(r.right + dayW * 3),
    };
  });
  ok(lane.checkinLeftHalf === 'openBookingHub',
    `the exposed strip of a check-in day belongs to that stay, not to a new one (${lane.checkinLeftHalf})`);
  ok(lane.insideBar === 'openBookingHub', `the bar itself still opens the booking (${lane.insideBar})`);
  ok(lane.checkoutRightHalf === 'tlCellTap',
    `a checkout day still starts a range — that night IS free (${lane.checkoutRightHalf})`);
  ok(lane.freeDay === 'tlCellTap', `and a genuinely free day still does (${lane.freeDay})`);

  // 1c) TWO-TAP RANGE (the approved Today demo): the first tap ARMS a night
  // (visible mark, nothing opens), the second on the same lane completes the
  // range and the chooser offers Add booking / Block dates for exactly those
  // dates; a range crossing a stay REFUSES and names whose stay it crosses.
  console.log('1c. two-tap range: arm, choose, and the honest refusal');
  const rng = await page.evaluate(async () => {
    const free = Array.from(document.querySelectorAll('#cal-body .tl-cell[data-act]'))
      .filter((c) => (c.getAttribute('data-act') || '') === 'tlCellTap');
    if (free.length < 2) return { err: 'no free cells' };
    // Two free nights on the SAME lane, adjacent in the list (same data-pk).
    const pk = free[0].getAttribute('data-pk');
    const laneFree = free.filter((c) => c.getAttribute('data-pk') === pk);
    laneFree[0].click();
    await new Promise((r) => setTimeout(r, 200));
    const armed = !!document.querySelector('#cal-body .tl-cell.is-selstart');
    const openedEarly = !!document.querySelector('#glass-dialog.open, .modal-overlay.open');
    laneFree[1].click();
    await new Promise((r) => setTimeout(r, 300));
    const dlg = document.getElementById('glass-dialog');
    const dlgOpen = !!(dlg && getComputedStyle(dlg).display !== 'none' && dlg.textContent.includes('free'));
    const hasChooser = !!document.querySelector('#gdf-what');
    const options = hasChooser ? [...document.querySelectorAll('#gdf-what option')].map((o) => o.textContent) : [];
    // Back out — nothing marked, nothing saved.
    try { glassDialogResolve(false); } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
    const cleared = !document.querySelector('#cal-body .tl-cell.is-selstart');
    return { armed, openedEarly, dlgOpen, options, cleared };
  });
  ok(!rng.err && rng.armed && !rng.openedEarly, `first tap ARMS the night — a mark, not a modal (${JSON.stringify({ armed: rng.armed, early: rng.openedEarly })})`);
  ok(rng.dlgOpen && rng.options.length === 2 && /booking/i.test(rng.options[0]) && /block/i.test(rng.options[1]),
    `second tap opens the chooser with both actions (${(rng.options || []).join(' / ')})`);
  ok(rng.cleared, 'backing out clears the mark — nothing saved');
  const refuse = await page.evaluate(async () => {
    // The FIRST and LAST free cells on the lane: with two stays seeded
    // mid-window, the widest range must cross one — it has to refuse and
    // name whose stay it crosses.
    const cells = Array.from(document.querySelectorAll('#cal-body .tl-cell[data-act="tlCellTap"]'))
      .filter((c) => c.getAttribute('data-pk') === '21a');
    if (cells.length < 2) return { err: 'no free cells' };
    cells[0].click();
    await new Promise((r) => setTimeout(r, 150));
    cells[cells.length - 1].click();
    await new Promise((r) => setTimeout(r, 300));
    const dlg = document.getElementById('glass-dialog');
    const txt = dlg ? dlg.textContent : '';
    const refused = /aren't all free|crosses/.test(txt);
    const named = /First Guest|Second Guest|stay/.test(txt);
    try { glassDialogResolve(false); } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
    return { refused, named };
  });
  ok(!refuse.err && refuse.refused, 'a range crossing a stay is refused, not silently clipped');
  ok(refuse.named, '…and the refusal names whose stay it crosses');

  console.log('2. timeline bar tap swaps the docked hub + scrolls to it');
  await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('#cal-body .tl-bar')).find((b) => b.textContent.trim() === 'Second');
    bar.click();
  });
  await page.waitForTimeout(1200);
  const w2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    hubName: (document.querySelector('#bookings-detail-pane .bhub-name') || {}).textContent || '',
    rowOpen: (document.querySelector('#bookings-list .bk-row.is-open strong') || {}).textContent || '',
    paneVisible: (() => { const r = document.getElementById('bookings-detail-pane').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })(),
  }));
  ok(w2.active === 'view-backoffice', `bar tap keeps the dashboard (${w2.active})`);
  ok(w2.hubName === 'Second Guest', `docked hub swapped to the tapped booking (${w2.hubName})`);
  ok(w2.rowOpen === 'Second Guest', `its index row highlights (${w2.rowOpen})`);
  ok(w2.paneVisible, 'the docked hub was scrolled into view');

  console.log('3. narrow: bar tap opens the standalone hub');
  await page.setViewportSize({ width: 390, height: 850 });
  await page.waitForTimeout(900); // resize listener re-parents
  await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('#cal-body .tl-bar')).find((b) => b.textContent.trim() === 'First');
    if (bar) bar.click();
  });
  await page.waitForTimeout(900);
  const n1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    hubName: (document.querySelector('#view-booking-hub .bhub-name') || {}).textContent || '',
  }));
  ok(n1.active === 'view-booking-hub' && n1.hubName === 'First Guest', `narrow bar tap → standalone hub (${n1.active}, ${n1.hubName})`);
  await page.evaluate(() => bookingHubBack());
  await page.waitForTimeout(900);
  const n2 = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(n2 === 'view-backoffice', `hub back returns to the dashboard (${n2})`);

  console.log('4. openBookings alias');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { nav('view-main'); window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.openBookings());
  await page.waitForTimeout(1400);
  const a1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    wsVisible: (() => { const r = document.getElementById('bookings-workspace').getBoundingClientRect(); return r.top < window.innerHeight; })(),
    rows: document.querySelectorAll('#bookings-list .bk-row').length,
  }));
  ok(a1.active === 'view-backoffice' && a1.rows === 2, `openBookings lands on the dashboard with the list rendered (${a1.active}, ${a1.rows} rows)`);
  ok(a1.wsVisible, 'and scrolls to the bookings workspace');

  console.log('5. Block-out dates: the BUILT-IN calendar over the glass dialog');
  // The dates open openFieldDatePicker in admin mode — never a native
  // input[type=date] — raised ABOVE the dialog (z 6000 vs the picker's home
  // 2100), with Enter/Escape routed to the PICKER while it's up: unguarded,
  // Escape answered the FORM underneath and cancelled it under the calendar.
  await page.evaluate(() => { openBlockDates(); });
  await page.waitForTimeout(400);
  const bd1 = await page.evaluate(() => ({
    open: document.getElementById('glass-dialog').classList.contains('open'),
    noNative: !document.querySelector('#glass-dialog-fields input[type="date"]'),
    trigger: !!document.getElementById('gdf-range'),
    // The house calendar GLYPH, not the 📅 emoji (which paints in platform
    // colours — iOS rendered a red "July 17" on the owner's phone).
    glyph: !!document.querySelector('#gdf-range .gdf-cal svg.ic'),
    noEmoji: !/📅/.test((document.getElementById('gdf-range') || {}).textContent || ''),
  }));
  ok(bd1.open && bd1.noNative && bd1.trigger, 'the dialog opens with a daterange trigger and NO native date input');
  ok(bd1.glyph && bd1.noEmoji, 'the trigger wears the house calendar glyph, not the platform emoji');
  await page.evaluate(() => document.getElementById('gdf-range').click());
  await page.waitForTimeout(300);
  const bd2 = await page.evaluate(() => {
    const dp = document.getElementById('date-picker');
    return {
      open: dp.classList.contains('open'),
      admin: dp.classList.contains('dp-admin'),
      lifted: dp.classList.contains('dp-over-glass'),
      z: parseInt(getComputedStyle(dp).zIndex, 10),
      gz: parseInt(getComputedStyle(document.getElementById('glass-dialog')).zIndex, 10),
      // The chosen cottage's stays shade the calendar — the cue this dialog
      // exists for. The fixture's First Guest starts in 5 days.
      crossed: document.querySelectorAll('#dp-grid .dp-booked').length,
    };
  });
  ok(bd2.open && bd2.admin && bd2.lifted && bd2.z > bd2.gz, `the picker opens in admin mode ABOVE the dialog (${bd2.z} > ${bd2.gz})`);
  ok(bd2.crossed >= 3, `…with the chosen cottage's stays shaded (${bd2.crossed} crossed nights)`);
  // Escape closes the PICKER and the form survives underneath.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const bd3 = await page.evaluate(() => ({
    dp: document.getElementById('date-picker').classList.contains('open'),
    gd: document.getElementById('glass-dialog').classList.contains('open'),
    focused: (document.activeElement || {}).id,
  }));
  ok(!bd3.dp && bd3.gd, 'Escape closes the picker; the form survives underneath');
  ok(bd3.focused === 'gdf-range', `…and focus returns to the trigger (${bd3.focused})`);
  // Pick a clear range for real, Done, then Block — the payload is the picker's.
  await page.evaluate(() => document.getElementById('gdf-range').click());
  await page.waitForTimeout(250);
  const picks = await page.evaluate((iso) => {
    const tap = (ds) => { const c = document.querySelector(`#dp-grid [data-day="${ds}"]`); if (c) { c.click(); return true; } return false; };
    return [tap(iso.a), tap(iso.b)];
  }, { a: (() => { const t = new Date(); t.setDate(t.getDate() + 40); return t.toISOString().slice(0, 10); })(), b: (() => { const t = new Date(); t.setDate(t.getDate() + 42); return t.toISOString().slice(0, 10); })() });
  // +40 days may sit in next month's grid — page forward until both taps land.
  if (!(picks[0] && picks[1])) {
    await page.evaluate(() => dpChangeMonth(1));
    await page.waitForTimeout(150);
    await page.evaluate((iso) => {
      const tap = (ds) => { const c = document.querySelector(`#dp-grid [data-day="${ds}"]`); if (c) c.click(); };
      tap(iso.a); tap(iso.b);
    }, { a: (() => { const t = new Date(); t.setDate(t.getDate() + 40); return t.toISOString().slice(0, 10); })(), b: (() => { const t = new Date(); t.setDate(t.getDate() + 42); return t.toISOString().slice(0, 10); })() });
  }
  await page.evaluate(() => { const b = document.querySelector('#date-picker [data-act="dpDone"]'); if (b) b.click(); });
  await page.waitForTimeout(250);
  const blocks = [];
  await page.evaluate(() => {
    const realPost = window.apiPost;
    window.__bdPosts = [];
    window.apiPost = async (url, body) => {
      if (String(url).includes('ical-import.php') && body.action === 'add_block') { window.__bdPosts.push(body); return { ok: true }; }
      return realPost(url, body);
    };
  });
  const bd4 = await page.evaluate(() => ({
    lbl: (document.getElementById('gdf-range-lbl') || {}).textContent || '',
    ci: dpVal('gdf-range-ci'),
    co: dpVal('gdf-range-co'),
  }));
  ok(/→/.test(bd4.lbl) && bd4.ci && bd4.co && bd4.co > bd4.ci, `Done writes the range back and the trigger repaints (${bd4.ci} → ${bd4.co})`);
  await page.evaluate(() => document.getElementById('glass-dialog-ok').click());
  await page.waitForTimeout(400);
  const bd5 = await page.evaluate(() => window.__bdPosts);
  ok(bd5.length === 1 && bd5[0].check_in === bd4.ci && bd5[0].check_out === bd4.co && bd5[0].prop,
    `Block posts the picked range through the same add_block payload (${bd5.length ? bd5[0].check_in + '→' + bd5[0].check_out : 'none'})`);

  console.log(fails ? `MERGED WORKSPACE TEST FAILED ❌ (${fails})` : 'MERGED WORKSPACE TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
