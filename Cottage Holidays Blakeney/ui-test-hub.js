// Behavioural checks for the booking hub + live modal availability:
//  A. showDetails() routes to the hub page; header/pipeline/cards render.
//  B. Next action follows state (unpaid → deposit ask; part-paid → balance).
//  C. History card renders the bookings.php `history` events.
//  D. Emails card shows the logged email with its Show email button.
//  E. Guest card lists the same guest's other stay; clicking swaps hubs.
//  F. Back button returns to the Bookings list.
//  G. Modal availability strip: booked days shaded, clash note on overlap,
//     no self-clash when editing the same booking, none when dates free.
//  H. Deleting from the hub exits to the Bookings list.
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8276;
const dir = __dirname;
// Fixture dates are TODAY-relative (a fixed anchor rots as real time passes)
// and formatted locally — toISOString() is UTC and slips a day near midnight.
const d = (o) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + o); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const ok = (cond, label) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) throw new Error('FAILED: ' + label);
};

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  // Wait for php -S to actually accept connections (a fixed sleep flakes on slow CI runners).
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  // <1200px so sections A–H exercise the STANDALONE hub flow (the ≥1200
  // master–detail split gets its own section I at the end).
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
  // Top frame only — the email-preview iframes are sandboxed (no serviceWorker),
  // so running this inside them just throws a noise pageerror.
  await page.addInitScript(() => { if (window.top === window && navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const mk = (id, over = {}) => Object.assign({
    id, prop_key: '21a', name: 'Walk-in Guest', email: 'guest@gmail.com', phone: '07700 900000',
    address: '1 Lane', postcode: 'NR25 7AB', check_in: d(30), check_out: d(33), check_in_time: '15:00',
    check_out_time: '10:00', adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0,
    payment_method: '', payment_date: '', agreed_total: 440, agreed_per_night: 130, agreed_nights: 3,
    agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0),
    hold_status: 'none', notes: 'VIP',
  }, over);
  let rows = [mk(1), mk(2, { name: 'Return Visit', check_in: d(90), check_out: d(93) })];
  let enqs = [
    { id: 6, prop_key: '21a', name: 'Enq Alpha', email: 'enq@gmail.com', phone: '', address: '2 Lane', postcode: 'NR25 7AB', check_in: d(40), check_out: d(43), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: 'Dog friendly?', created_at: d(-1) + ' 09:00:00' },
    { id: 7, prop_key: '21a', name: 'Enq Beta', email: 'beta@gmail.com', phone: '', address: '3 Lane', postcode: 'NR25 7AB', check_in: d(80), check_out: d(83), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: '', created_at: d(0) + ' 08:00:00' },
  ];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'bookings.php') {
        if (b.action === 'history') return json({ ok: true, events: [
          { action: 'booking.update', summary: 'Booking edited — dates changed', actor: 'owner', at: d(-1) + ' 09:12:00' },
          { action: 'booking.add', summary: 'Booking created — Walk-in Guest', actor: 'owner', at: d(-2) + ' 18:30:00' },
        ] });
        if (b.action === 'email_logs') return json({ logs: { 1: [{ action: 'email.confirmation', summary: 'Booking confirmation emailed', at: d(-2) + ' 18:31:00' }] } });
        if (b.action === 'email_render') return json({ ok: true, subject: 'Your booking is confirmed', html: '<p>Preview</p>' });
        if (b.action === 'set_payment') { const r = rows.find((x) => x.id === b.id); if (r) { r.payment = b.payment; r.deposit_paid = b.deposit || (b.payment === 'paid' ? r.agreed_total : 0); } return json({ ok: true }); }
        if (b.action === 'delete') { rows = rows.filter((x) => x.id !== b.id); return json({ ok: true }); }
        return json({ ok: true });
      }
      if (b.__url === 'enquiries.php') {
        if (b.action === 'approve_preview') return json({ ok: true, subject: 'Your booking is confirmed', html: '<p>Preview</p>' });
        if (b.action === 'approve') {
          const enq = enqs.find((x) => x.id === b.id);
          rows.push(mk(70, { name: enq ? enq.name : 'Approved Guest', email: 'enq@gmail.com', check_in: d(40), check_out: d(43) }));
          enqs = enqs.filter((x) => x.id !== b.id);
          return json({ ok: true, booking_id: 70, email: { guest: { ok: true } }, payment_request: null, email_check: null });
        }
        if (b.action === 'decline') { enqs = enqs.filter((x) => x.id !== b.id); return json({ ok: true }); }
        return json({ ok: true });
      }
      if (b.__url === 'ical-import.php' && b.action === 'blocks') {
        return json({ ok: true, blocks: [{ id: 9, prop_key: '21a', source: 'airbnb', check_in: d(50), check_out: d(53) }] });
      }
      return json({ ok: true });
    }
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('enquiries.php')) return json({ enquiries: enqs });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    if (url.includes('ical-import.php')) return json({ ok: true, blocks: [{ id: 9, prop_key: '21a', source: 'airbnb', check_in: d(50), check_out: d(53) }] });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(600);

  // ---------- A. showDetails → hub ----------
  console.log('A. routing + render');
  await page.evaluate(() => showDetails('21a', findBookingById('b1')));
  await page.waitForTimeout(700);
  const a = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
    pipeSteps: document.querySelectorAll('.bhub-pipe3 .pipe-step').length,
    fullSteps: document.querySelectorAll('.bhub-pipe-full .pipe-step').length,
    fullVisible: !!document.querySelector('.bhub-pipe-full') && getComputedStyle(document.querySelector('.bhub-pipe-full')).display !== 'none',
    compactHidden: !!document.querySelector('.bhub-pipe3') && getComputedStyle(document.querySelector('.bhub-pipe3')).display === 'none',
    caps: Array.from(document.querySelectorAll('.pipe3-cap')).map((t) => t.textContent),
    nowPill: (document.querySelector('.pipe-step.is-now') || {}).textContent || '',
    donePill: (document.querySelector('.pipe-step.is-done') || {}).textContent || '',
    cards: document.querySelectorAll('.bhub-card').length,
    hasGuestReg: Array.from(document.querySelectorAll('.bhub-card-title')).some((t) => /Guest register/.test(t.textContent || '')),
    notes: (document.querySelector('[id^="bk-notes-"]') || {}).value || '',
  }));
  ok(a.active === 'view-booking-hub', `hub view active (${a.active})`);
  ok(a.name === 'Walk-in Guest', `guest name in header (${a.name})`);
  ok(a.pipeSteps === 3, `dynamic 3-pill journey window (${a.pipeSteps} pills)`);
  ok(a.fullSteps >= 5, `desktop full-journey strip carries every stage (${a.fullSteps} pills)`);
  ok(a.fullVisible && a.compactHidden, 'desktop shows the FULL strip and hides the compact window');
  ok(a.caps.join('|') === 'Done|Now · 2 of 6|Next', `window captions with step counter (${a.caps.join('|')})`);
  ok(a.donePill.includes('Booked') && a.nowPill.includes('Deposit'), `unpaid → Done:Booked, Now:Deposit (${a.nowPill})`);
  ok(a.cards === 5, `five cards rendered — incl. Guest register (${a.cards})`);
  ok(a.hasGuestReg, 'Guest register card present (UK hotel-records duty)');
  ok(a.notes === 'VIP', 'staff note prefilled');
  // Email actions live in ONE place: the Emails card.
  const em1 = await page.evaluate(() => ({
    headerEmail: !!document.querySelector('.bhub-actions [data-act="openBookingEmail"]'),
    writeBtns: document.querySelectorAll('#booking-hub-content [data-act="openBookingEmail"]').length,
    updConf: document.querySelectorAll('#booking-hub-content [data-act="offerUpdatedConfirmationEmail"]').length,
  }));
  ok(!em1.headerEmail && em1.writeBtns === 1, 'ONE email entry point (Emails card), none in the header');
  ok(em1.updConf === 0, 'no updated-confirmation button while nothing is paid');

  // ---------- B. next action follows state ----------
  console.log('B. next action');
  const next1 = await page.evaluate(() => (document.querySelector('.bhub-next') || {}).textContent || '');
  // £490 = £440 rental + £50 refundable damages deposit (charged with the
  // guest's first payment) — same figure the Money area shows as due.
  ok(/Nothing received yet/.test(next1) && /£490\.00 due/.test(next1), `unpaid → deposit ask (${next1.trim().slice(0, 60)}…)`);
  // Record £100 through the unified flow, hub should re-render with balance ask.
  const rp = page.evaluate(() => window.recordPayment('b1'));
  await page.waitForTimeout(700);
  await page.evaluate(() => { document.getElementById('gdf-amount').value = '100'; });
  await page.evaluate(() => glassDialogResolve(true));
  await page.waitForTimeout(700);
  // The updated-confirmation offer now PREVIEWS the email first — cancel that
  // send-confirm modal (or the plain confirm if no preview was produced).
  await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-cancel').click();
    else try { glassDialogResolve(false); } catch (e) {}
  });
  await rp.catch(() => {});
  await rp;
  await page.waitForTimeout(500);
  const next2 = await page.evaluate(() => (document.querySelector('.bhub-next') || {}).textContent || '');
  ok(/£390\.00 balance remaining/.test(next2), `after £100 recorded → balance ask (${next2.trim().slice(0, 50)}…)`);
  const pipe2 = await page.evaluate(() => ({
    now: (document.querySelector('.pipe-step.is-now') || {}).textContent || '',
    done: (document.querySelector('.pipe-step.is-done') || {}).textContent || '',
  }));
  ok(pipe2.done.includes('Deposit') && pipe2.now.includes('Paid in full'), `journey window advanced with the payment (now: ${pipe2.now.trim()})`);
  // Settled money folds to one line; the breakdown stays one tap away.
  // (Settle b1 for this check, restore its part-paid state afterwards.)
  await page.evaluate(() => { findBookingById('b1').payment = 'paid'; openBookingHub('b1', true); });
  await page.waitForTimeout(400);
  const fold = await page.evaluate(() => {
    const box = document.querySelector('#booking-hub-content .price-box');
    return {
      folded: !!document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]'),
      rows: box ? box.querySelectorAll('.price-row').length : -1,
      line: box ? ((box.querySelector('.price-row.total') || {}).textContent || '') : '',
    };
  });
  ok(fold.folded && fold.rows === 1 && /Paid in full/.test(fold.line), `settled money folds to one line (${fold.rows} row)`);
  // The full breakdown opens as a WINDOW over the page, not a reflow of it.
  await page.evaluate(() => document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]').click());
  await page.waitForTimeout(400);
  const modal = await page.evaluate(() => ({
    open: document.getElementById('breakdown-modal').classList.contains('open'),
    rows: document.querySelectorAll('#breakdown-modal-body .price-row').length,
    pageRows: document.querySelector('#booking-hub-content .price-box').querySelectorAll('.price-row').length,
  }));
  ok(modal.open && modal.rows >= 4, `breakdown opens in a pop-up window (${modal.rows} rows)`);
  ok(modal.pageRows === 1, 'the page itself does not reflow (still one line)');
  await page.evaluate(() => closeBreakdownModal());
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('breakdown-modal').classList.contains('open')), 'breakdown window closes');
  await page.evaluate(() => { findBookingById('b1').payment = 'deposit'; openBookingHub('b1', true); });
  await page.waitForTimeout(400);
  const em2 = await page.evaluate(() => ({
    inEmails: !!document.querySelector('#booking-hub-content .bhub-card:nth-of-type(2) [data-act="offerUpdatedConfirmationEmail"]') ||
      Array.from(document.querySelectorAll('.bhub-card')).some((c) => /Emails/.test((c.querySelector('.bhub-card-title') || {}).textContent || '') && c.querySelector('[data-act="offerUpdatedConfirmationEmail"]')),
    inMoney: Array.from(document.querySelectorAll('.bhub-card')).some((c) => /Payments/.test((c.querySelector('.bhub-card-title') || {}).textContent || '') && c.querySelector('[data-act="offerUpdatedConfirmationEmail"]')),
  }));
  ok(em2.inEmails && !em2.inMoney, 'updated-confirmation button lives in the Emails card (not Money)');

  // ---------- C. history card ----------
  console.log('C. history');
  const hist = await page.evaluate(() => (document.getElementById('hub-history') || {}).innerHTML || '');
  ok(/Booking edited — dates changed/.test(hist) && /Booking created/.test(hist), 'history events rendered');

  // ---------- D. emails card ----------
  const elog = await page.evaluate(() => (document.getElementById('hub-email-log') || {}).textContent || '');
  ok(/Booking confirmation/.test(elog), 'logged email shown in Emails card');
  const showBtn = await page.evaluate(() => !!document.querySelector('#hub-email-log .bk-email-log-view'));
  ok(showBtn, '"Show email" preview button present');

  // ---------- E. other stays ----------
  console.log('E. guest card');
  const stays = await page.evaluate(() => Array.from(document.querySelectorAll('.bhub-stay-row')).map((x) => x.textContent));
  ok(stays.length === 1, `one other stay listed (${stays.length})`);
  await page.click('.bhub-stay-row');
  await page.waitForTimeout(600);
  const swapped = await page.evaluate(() => (document.querySelector('.bhub-name') || {}).textContent);
  ok(swapped === 'Return Visit', `clicking a stay opens ITS hub (${swapped})`);

  // ---------- F. back ----------
  await page.evaluate(() => window.bookingHubBack());
  await page.waitForTimeout(600);
  const backView = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(backView === 'view-backoffice', `back lands on the dashboard workspace (${backView})`);

  // ---------- G. glass date picker (admin mode) + availability strip ----------
  console.log('G. glass picker + availability strip');
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(400);
  // The consumer glass calendar opens from the modal's date trigger, in admin
  // mode: taken nights shaded but still pickable.
  await page.click('#modal-date-trigger');
  await page.waitForTimeout(300);
  // b1's stay (d+30) is next month — flip the calendar forward to see it.
  await page.evaluate(() => dpChangeMonth(1));
  await page.waitForTimeout(200);
  const dp1 = await page.evaluate(() => ({
    open: document.getElementById('date-picker').classList.contains('open'),
    admin: document.getElementById('date-picker').classList.contains('dp-admin'),
    shaded: document.querySelectorAll('#dp-grid .dp-day.dp-booked').length,
    shadedClickable: Array.from(document.querySelectorAll('#dp-grid .dp-day.dp-booked')).every((c) => c.getAttribute('onclick') || c.getAttribute('data-act')),
  }));
  ok(dp1.open && dp1.admin, 'glass calendar opens from the modal in admin mode');
  ok(dp1.shaded >= 1 && dp1.shadedClickable, `taken nights shaded yet pickable (${dp1.shaded})`);
  await page.evaluate(([a, b]) => { dpPick(a); dpPick(b); dpDone(); }, [d(60), d(63)]);
  await page.waitForTimeout(300);
  const dp2 = await page.evaluate(() => ({
    ci: document.getElementById('modal-checkin').value,
    co: document.getElementById('modal-checkout').value,
    label: (document.getElementById('modal-date-display') || {}).textContent || '',
    closed: !document.getElementById('date-picker').classList.contains('open'),
  }));
  ok(dp2.ci === d(60) && dp2.co === d(63) && dp2.closed, `picked range lands in the booking fields (${dp2.ci} → ${dp2.co})`);
  ok(/→/.test(dp2.label), `trigger shows the chosen range (${dp2.label.trim()})`);
  await page.evaluate((v) => { document.getElementById('modal-checkin').value = v; updateModalPrice(); }, d(31)); // overlaps booking 1 (d30→d33)
  await page.evaluate((v) => { document.getElementById('modal-checkout').value = v; updateModalPrice(); }, d(34));
  await page.waitForTimeout(300);
  const g1 = await page.evaluate(() => ({
    shown: (document.getElementById('modal-availability') || {}).style.display !== 'none',
    booked: document.querySelectorAll('#modal-availability .mav-day.is-booked').length,
    external: document.querySelectorAll('#modal-availability .mav-day.is-external').length,
    clash: (document.querySelector('#modal-availability .mav-clash') || {}).textContent || '',
  }));
  ok(g1.shown && g1.booked >= 3, `strip visible with booked days shaded (${g1.booked})`);
  ok(/overlap/.test(g1.clash) && /Walk-in Guest/.test(g1.clash), `clash note names the conflict (${g1.clash.trim().slice(0, 60)})`);
  await page.evaluate((v) => { document.getElementById('modal-checkin').value = v; updateModalPrice(); }, d(60)); // free dates
  await page.evaluate((v) => { document.getElementById('modal-checkout').value = v; updateModalPrice(); }, d(63));
  await page.waitForTimeout(300);
  const g2 = await page.evaluate(() => !document.querySelector('#modal-availability .mav-clash'));
  ok(g2, 'no clash note on free dates');
  // Airbnb import visible when the window covers it.
  await page.evaluate((v) => { document.getElementById('modal-checkin').value = v; updateModalPrice(); }, d(49));
  await page.evaluate((v) => { document.getElementById('modal-checkout').value = v; updateModalPrice(); }, d(51));
  await page.waitForTimeout(300);
  const g3 = await page.evaluate(() => ({
    external: document.querySelectorAll('#modal-availability .mav-day.is-external').length,
    clash: (document.querySelector('#modal-availability .mav-clash') || {}).textContent || '',
  }));
  ok(g3.external >= 3 && /airbnb import/.test(g3.clash), `imported block shaded + named (${g3.external} days)`);
  await page.evaluate(() => closeModal());
  // Editing booking 1: its own dates must NOT self-clash.
  await page.evaluate(() => window.openEditBooking('b1'));
  await page.waitForTimeout(400);
  const g4 = await page.evaluate(() => !document.querySelector('#modal-availability .mav-clash'));
  ok(g4, 'editing a booking does not flag itself as a clash');
  await page.evaluate(() => closeModal());

  // ---------- H. delete rules: money in → no delete; money-free → deletes ----------
  console.log('H. delete rules');
  // b1 now has £100 recorded — Delete must be hidden on its hub…
  await page.evaluate(() => window.openBookingHub('b1'));
  await page.waitForTimeout(500);
  const delBtnPaid = await page.evaluate(() => !!document.querySelector('.bhub-actions [data-act="bhubDelete"]'));
  ok(!delBtnPaid, 'Delete button hidden on a booking that has taken money');
  // Header declutter: secondary + destructive actions live in ONE ⋯ menu.
  const menu1 = await page.evaluate(() => {
    const menu = document.querySelector('.bhub-menu');
    return {
      hidden: menu && menu.style.display === 'none',
      items: menu ? menu.innerHTML : '',
      headerBtns: document.querySelectorAll('.bhub-actions > .btn-sm').length,
    };
  });
  ok(menu1.hidden, 'overflow menu starts closed');
  ok(menu1.headerBtns === 1, `header shows just the Edit/Move/Cancel button (${menu1.headerBtns})`);
  ok(/openEditBooking|bhubEdit/.test(menu1.items) && /cancelBooking|bhubCancel/.test(menu1.items) && !/addBookingToCalendar/.test(menu1.items), 'Edit/Move + Cancel & refund live in the menu; no Add to calendar');
  await page.evaluate(() => document.querySelector('.bhub-menu-btn').click());
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('.bhub-menu').style.display !== 'none'), 'tapping Edit/Move/Cancel opens the menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('.bhub-menu').style.display === 'none'), 'Escape closes the menu');
  // …and blocked in code even if something calls it directly.
  const guard = page.evaluate(() => deleteBooking('b1'));
  await page.waitForTimeout(500);
  const guardMsg = await page.evaluate(() => (document.getElementById('glass-dialog-msg') || {}).innerText || '');
  ok(/taken money/.test(guardMsg) && /Cancel & refund/.test(guardMsg), 'direct delete call blocked with the cancel guidance');
  await page.evaluate(() => glassDialogResolve(true));
  await guard;
  ok(!posts.some((p) => p.action === 'delete' && p.id === 1), 'no delete POST reached the server for the paid booking');
  // b2 is money-free — Delete shows, works, and the hub exits to Bookings.
  await page.evaluate(() => window.openBookingHub('b2'));
  await page.waitForTimeout(500);
  const delBtnFree = await page.evaluate(() => !!document.querySelector('.bhub-actions [data-act="bhubDelete"]'));
  ok(delBtnFree, 'Delete present in the menu on a money-free booking');
  const del = page.evaluate(() => deleteBooking('b2'));
  await page.waitForTimeout(500);
  await page.evaluate(() => glassDialogResolve(true));
  await del;
  await page.waitForTimeout(700);
  const h = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(h === 'view-backoffice' && posts.some((p) => p.action === 'delete' && p.id === 2), `money-free delete works and exits to the dashboard (${h})`);

  // ---------- H2. read-only calendar + relocated features ----------
  console.log('H2. read-only calendar + external blocks + derived changeover');
  // A back-to-back booking in the same cottage: b5 arrives the day b1 leaves.
  rows.push(mk(5, { name: 'Next Guest', email: 'next@gmail.com', check_in: d(33), check_out: d(36) }));
  // And a stay spanning TODAY so the current month's calendar has pills to test.
  rows.push(mk(6, { name: 'Cal Guest', email: 'cal@gmail.com', check_in: d(-1), check_out: d(2) }));
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);
  await page.evaluate(() => { nav('view-backoffice'); renderCalendar(); });
  await page.waitForTimeout(400);
  const cal = await page.evaluate(() => ({
    bars: document.querySelectorAll('#cal-body .tl-bar:not(.tl-ext)').length,
    barClick: !!document.querySelector('#cal-body .tl-bar:not(.tl-ext)[data-act="openBookingHub"]'),
    extBars: document.querySelectorAll('#cal-body .tl-ext').length,
    extClickable: Array.from(document.querySelectorAll('#cal-body .tl-ext')).some((x) => x.getAttribute('onclick') || x.getAttribute('data-act')),
    days: document.querySelectorAll('#cal-body .tl-day').length,
  }));
  ok(cal.days > 100 && cal.bars > 0 && cal.barClick, `timeline rendered — booking bars open the hub (${cal.bars} bars)`);
  ok(cal.extBars > 0 && !cal.extClickable, `external bars greyed + display-only (${cal.extBars})`);
  // A free day cell starts an Add Booking on that cottage/date.
  await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll('#cal-body .tl-cell[data-act="tlAddAt"]')).pop();
    cell.click();
  });
  await page.waitForTimeout(400);
  const gap = await page.evaluate(() => ({
    open: document.getElementById('edit-modal').classList.contains('open'),
    ci: document.getElementById('modal-checkin').value,
    prop: document.getElementById('modal-property').value,
  }));
  ok(gap.open && /^\d{4}-\d{2}-\d{2}$/.test(gap.ci) && gap.prop !== '', `gap tap prefills Add Booking (${gap.prop} · ${gap.ci})`);
  await page.evaluate(() => closeModal());
  // Bar tap → the booking's hub (narrow → standalone screen).
  await page.evaluate(() => { nav('view-backoffice'); });
  await page.click('#cal-body .tl-bar:not(.tl-ext)');
  await page.waitForTimeout(600);
  const barNav = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('#view-enquiry-hub .bhub-name, #view-booking-hub .bhub-name') || {}).textContent || '',
  }));
  ok(barNav.active === 'view-booking-hub' && barNav.name !== '', `bar tap opens the booking hub (${barNav.name})`);
  // External blocks are calendar-only: NOT listed on the Bookings page, and
  // their calendar pills carry no handlers (checked above with all pills).
  await page.evaluate(() => window.openBookings());
  await page.waitForTimeout(700);
  const extBits = await page.evaluate(() => ({
    rows: document.querySelectorAll('#bookings-list .bk-row-ext').length,
    modal: !!document.getElementById('details-modal'),
  }));
  ok(extBits.rows === 0, 'external blocks NOT listed on the Bookings page');
  ok(!extBits.modal, 'old details modal removed from the page');
  // The hub derives the same-day changeover on its own.
  await page.evaluate(() => window.openBookingHub('b1'));
  await page.waitForTimeout(500);
  const chTxt = await page.evaluate(() => (document.querySelector('.bhub-changeover') || {}).textContent || '');
  ok(/Same-day changeover — Next Guest arrives/.test(chTxt), `hub derives the changeover companion (${chTxt.trim().slice(0, 50)}…)`);
  await page.evaluate(() => { const c = document.querySelector('.bhub-changeover'); c.click(); });
  await page.waitForTimeout(500);
  const chName = await page.evaluate(() => (document.querySelector('.bhub-name') || {}).textContent);
  ok(chName === 'Next Guest', `changeover chip opens the other side (${chName})`);
  const chBack = await page.evaluate(() => (document.querySelector('.bhub-changeover') || {}).textContent || '');
  ok(/Walk-in Guest leaves as this guest arrives/.test(chBack), 'reverse chip on the arriving guest\'s hub');

  // ---------- I. wide master–detail split (≥1200px) ----------
  console.log('I. wide split dashboard');
  rows.push(mk(3, { name: 'Second Guest', email: 'other@gmail.com', check_in: d(70), check_out: d(72) }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__hubReset = true; });
  await page.evaluate(() => window.openBookings());
  await page.waitForTimeout(800);
  const i1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    paneShown: getComputedStyle(document.getElementById('bookings-detail-pane')).display !== 'none',
    hubInPane: !!document.querySelector('#bookings-detail-pane #booking-hub-content'),
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
    rows: document.querySelectorAll('#bookings-list .bk-row[data-bkid]').length,
    openRows: document.querySelectorAll('#bookings-list .bk-row.is-open').length,
    oldControls: document.querySelectorAll('#bookings-list .money-actions, #bookings-list .bk-email-log').length,
  }));
  ok(i1.active === 'view-backoffice', `stays on the merged dashboard (${i1.active})`);
  ok(i1.paneShown && i1.hubInPane, 'hub docked in the right-hand pane');
  ok(i1.name !== '', `a booking auto-selected (${i1.name})`);
  ok(i1.rows === 4 && i1.openRows === 1, `compact rows with one selected (${i1.rows} rows)`);
  ok(i1.oldControls === 0, 'per-row buttons + email logs gone from the index');
  // Traffic-light edge: every row carries exactly one payment-state class.
  const lights = await page.evaluate(() => Array.from(document.querySelectorAll('#bookings-list .bk-row[data-bkid]')).map((r) => ['pay-ok', 'pay-warn', 'pay-danger'].filter((c) => r.classList.contains(c)).length));
  ok(lights.length > 0 && lights.every((n) => n === 1), 'every row has ONE traffic-light payment edge');
  // Click ANOTHER booking row → pane swaps, highlight moves, no page change.
  await page.evaluate((sel) => {
    const other = Array.from(document.querySelectorAll('#bookings-list .bk-row[data-bkid]')).find((r) => !r.classList.contains('is-open'));
    other.click();
  });
  await page.waitForTimeout(700);
  const i2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
    openRow: (document.querySelector('#bookings-list .bk-row.is-open .bk-row-name') || {}).textContent || '',
  }));
  ok(i2.active === 'view-backoffice', 'row click keeps the dashboard (no page swap)');
  ok(i2.name === i2.openRow && i2.name !== i1.name, `pane swapped to the clicked booking (${i2.name})`);

  // ---------- J. inbox master–detail (same playbook) ----------
  console.log('J. inbox workspace');
  await page.evaluate(() => window.openInbox());
  await page.waitForTimeout(800);
  const j1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    rows: document.querySelectorAll('#inbox-list .bk-row[data-enqid]').length,
    oldCards: document.querySelectorAll('#inbox-list .enquiry-card').length,
    paneHub: !!document.querySelector('#inbox-detail-pane #enquiry-hub-content .bhub-head'),
    name: (document.querySelector('#inbox-detail-pane .bhub-name') || {}).textContent || '',
    openRows: document.querySelectorAll('#inbox-list .bk-row.is-open').length,
    actions: document.querySelectorAll('#inbox-detail-pane .bhub-actions .btn-sm').length,
    priceBtn: !!document.querySelector('#inbox-detail-pane [data-act="setEnquiryPrice"]'),
  }));
  ok(j1.active === 'view-inbox' && j1.rows === 2 && j1.oldCards === 0, `compact enquiry rows (${j1.rows}), old cards gone`);
  ok(j1.paneHub && j1.name !== '' && j1.openRows === 1, `enquiry hub auto-docked (${j1.name})`);
  ok(j1.actions === 4 && j1.priceBtn, 'approve/edit/email/decline + agreed-price on the hub');
  // Approve from the hub → lands on the NEW booking's hub.
  const apr = page.evaluate(() => approveEnquiry(document.querySelector('#inbox-list .bk-row[data-enqid]').getAttribute('data-enqid')));
  await page.waitForTimeout(700);
  await page.evaluate(() => { try { glassDialogResolve(true); } catch (e) {} }); // clash/confirm if any
  // Approving now PREVIEWS the confirmation first — hit Send to proceed.
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-send').click();
  });
  await apr;
  await page.waitForTimeout(900);
  const j2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('#bookings-detail-pane .bhub-name') || {}).textContent || '',
  }));
  ok(j2.active === 'view-backoffice' && /Enq/.test(j2.name), `approve lands on the new booking's hub (${j2.name})`);
  // Narrow: the enquiry hub is its own screen; declining exits to the Inbox.
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(() => window.openEnquiryHub('e7'));
  await page.waitForTimeout(600);
  const j3 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('#view-enquiry-hub .bhub-name') || {}).textContent || '',
  }));
  ok(j3.active === 'view-enquiry-hub' && j3.name === 'Enq Beta', `standalone enquiry hub on narrow (${j3.name})`);
  const dec = page.evaluate(() => declineEnquiry('e7'));
  await page.waitForTimeout(500);
  await page.evaluate(() => glassDialogResolve(true));
  await dec;
  await page.waitForTimeout(700);
  const j4 = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(j4 === 'view-inbox', `decline exits the hub to the Inbox (${j4})`);

  // ---------- K. inbox-zero clears the docked pane (hardening audit C1) ----------
  console.log('K. inbox-zero pane');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.openInbox()); // both enquiries handled in J → inbox zero
  await page.waitForTimeout(800);
  const k = await page.evaluate(() => ({
    emptyShown: getComputedStyle(document.getElementById('inbox-detail-empty')).display !== 'none',
    hubEmpty: !document.querySelector('#enquiry-hub-content .bhub-head'),
    zeroNote: /Inbox zero/.test((document.getElementById('inbox-list') || {}).textContent || ''),
  }));
  ok(k.zeroNote && k.emptyShown && k.hubEmpty, `empty inbox restores the pane placeholder (no stale enquiry hub) ${JSON.stringify(k)}`);

  // ---------- L. Money workspace: find-rows → booking hub → back to Money ----------
  console.log('L. money workspace');
  await page.evaluate(() => window.openAccounts());
  await page.waitForTimeout(900);
  await page.evaluate(() => accountsOpen('payments'));
  await page.waitForTimeout(600);
  const l1 = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#money-panel .bk-row'));
    const r = rows[0];
    return {
      count: rows.length,
      actionCards: document.querySelectorAll('#money-panel .money-row').length,
      edge: r ? Array.from(r.classList).find((c) => c.startsWith('pay-')) : '',
      chip: r ? (r.querySelector('.bk-chip') || {}).textContent : '',
      figures: r ? (r.querySelector('.bk-row-dates') || {}).textContent : '',
      owed: /owed/.test((document.querySelector('#money-panel .money-owed') || {}).textContent || ''),
    };
  });
  ok(l1.count >= 1 && l1.actionCards === 0, `payments section is find-rows, not action cards (${l1.count} rows)`);
  ok(l1.edge === 'pay-danger' && /Unpaid/.test(l1.chip), `unpaid row: red edge + chip with balance (${l1.chip.trim()})`);
  ok(/received/.test(l1.figures), `row shows received-of-total figures (${l1.figures.trim()})`);
  ok(l1.owed, 'owed banner still leads the section');
  await page.click('#money-panel .bk-row');
  await page.waitForTimeout(800);
  const l2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    recordBtn: /Record payment/.test(document.getElementById('view-booking-hub').textContent + document.getElementById('bookings-detail-pane').textContent),
  }));
  ok((l2.active === 'view-booking-hub' || l2.active === 'view-backoffice') && l2.recordBtn, `money row opens the booking hub (${l2.active})`);
  await page.evaluate(() => bookingHubBack());
  await page.waitForTimeout(900);
  const l3 = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(l3 === 'view-accounts', `hub back returns to Money (${l3})`);

  console.log('HUB TEST PASSED ✅');
  await browser.close();
  server.kill();
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
