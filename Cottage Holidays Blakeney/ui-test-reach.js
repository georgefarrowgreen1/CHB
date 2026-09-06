#!/usr/bin/env node
// ============================================================
//  ui-test-reach.js — nothing covers the words, and everything meets the thumb.
//  (dev/CI only, never deployed.)
//
//  §1 THE FIXED CHROME COVERS NOTHING. The floating Messages pill is the only
//     thing in the guest shell that floats over the page, and it was sitting on
//     money (the pay journey's "Deposit back" figure, read as "£50.0"), on the
//     first Experiences card's Directions button, on the sign-in sheet's last
//     line and on the home page's two CENTRED blocks. This walks every scroll
//     position of four views in 40px steps and asserts the pill's rect
//     intersects ZERO INKED TEXT RECTS.
//     IT MEASURES INK WITH A Range, NEVER AN ELEMENT BOX — this codebase has
//     twice produced a confident "covering none" from box arithmetic, because a
//     block-level .card-title spans the whole card while its words stop 89px
//     short of the corner. The box is not the ink.
//     HOME IS SCOPED, AND THAT IS THE HONEST PART. The pill is stood down on
//     the other three views, so their claim is absolute: nothing, anywhere, at
//     any offset. On Home it stays (there is no other route to a person there),
//     and a fixed pill on a 3,000px page WILL pass under something at some
//     offset — that is what a floating action button is. What the fix
//     guarantees, and what this asserts, is the RESTING state (which is what
//     the audit measured) plus the whole scroll of Home's four CENTRED blocks.
//     KNOWN AND DELIBERATE: deep in the scroll the pill passes over the hero
//     search panel's ± chips and steppers (measured 28×15px and 7×20px). Left,
//     because clearing them means insetting a form, and the alternative —
//     standing the pill down on Home — costs the chat route on the one page a
//     hesitant visitor is most likely to want it.
//
//  §2 EVERY CONTROL MEETS THE THUMB. The EFFECTIVE hit region of a control —
//     its own box grown by any absolutely-positioned ::before/::after — must
//     reach 44 in the axis being fixed, swept over six guest and six owner
//     screens. Vertical-only regions are asserted on the axis they fix: the
//     segmented switches and the expense glyphs sit side by side, and a
//     horizontal region between contiguous controls steals a neighbour's taps.
//
//  §3 THE CHANGEOVER CARD IS NOT PAINTED WHILE THE ASSISTANT IS UP. It was
//     z-index 2000 against the pop-out's 1440 and covered 183px of it — the
//     foot and the last rows, in every state.
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

// ---- fixtures -------------------------------------------------------------
const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 15, weekend_days: '5,6', max_adults: 2, max_children: 2, max_total: 4, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
  { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 145, extra_adult_rate: 30, child_rate: 20, booking_fee: 75, transaction_pct: 3, weekend_pct: 10, weekend_days: '5,6', max_adults: 4, max_children: 2, max_total: 6, sort_order: 3 },
];
const bookings = [
  { id: 1, prop_key: '21a', name: 'Priya Patel', email: 'priya@example.com', phone: '07700 900111', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 450, agreed_total: 450 },
  { id: 2, prop_key: 'jollyboat', name: 'Debbie McGoldrick', email: 'e@x.com', phone: '07700 900123', check_in: d(6), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, damages_deposit: 50 },
  { id: 3, prop_key: 'pimpernel', name: 'Nina Salt', email: 'a@x.com', phone: '07700 900999', check_in: d(14), check_out: d(21), check_in_time: '16:00', check_out_time: '10:00', adults: 4, children: 2, payment: 'deposit', deposit_paid: 300, agreed_total: 1260, damages_deposit: 75 },
  // A SAME-DAY CHANGEOVER on 21A: this pair is what makes #changeover-toasts render at all.
  { id: 4, prop_key: '21a', name: 'Oliver Wren', email: 'ow@example.com', phone: '', check_in: d(4), check_out: d(7), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 400 },
];
const enquiries = [
  { id: 11, prop_key: '21a', name: 'Nina Salt', email: 'nina@example.com', phone: '07700 900123', address: '14 Long Street', postcode: 'NR21 0AB', check_in: d(40), check_out: d(44), adults: 2, children: 0, check_in_time: '15:00', check_out_time: '10:00', message: 'Any chance of a late checkout?', created_at: d(-1) + ' 09:12:00' },
];
const expenses = [
  { id: 21, date: d(-9), category: 'Cleaning', description: 'Changeover clean', amount: 65, prop_key: '21a', recurring: 0 },
  { id: 22, date: d(-20), category: 'Utilities', description: 'Electricity', amount: 118.4, prop_key: 'jollyboat', recurring: 1 },
];
const experiences = [
  { id: 31, title: 'Blakeney Point seal trips', category: 'Boat trips & wildlife', blurb: 'An hour on the water among the grey seals.', icon: 'exp-seals.svg', lat: 52.96, lng: 1.0, phone: '01263 740505', website: 'https://example.com', address: 'The Quay, Blakeney', status: 'approved', published: 1 },
  { id: 32, title: 'The Kings Arms', category: 'Food & drink', blurb: 'Village pub two minutes from the cottage.', icon: 'exp-pub.svg', lat: 52.95, lng: 1.01, phone: '01263 740341', website: 'https://example.com', address: 'Westgate Street, Blakeney', status: 'approved', published: 1 },
  { id: 33, title: 'Blakeney Deli', category: 'Walks & nature', blurb: 'Local cheese, bread and picnic things.', icon: 'exp-deli.svg', lat: 52.951, lng: 1.011, phone: '01263 740000', website: 'https://example.com', address: 'High Street, Blakeney', status: 'approved', published: 1 },
];
const GUEST = { id: 9, name: 'Priya Patel', email: 'guest@example.com', phone: '', address: '', postcode: '' };
const midStay = { id: 3, prop_key: 'jollyboat', name: 'Priya Patel', email: 'guest@example.com', check_in: d(-2), check_out: d(2), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 495, agreed_total: 495, agreed_per_night: 120, agreed_nights: 4, agreed_nightly: 480, agreed_booking_fee: 0, agreed_txn_pct: 3, agreed_txn_fee: 15, agreed_on: d(-30), door_code: '7302', door_code_from: d(-3) };

// The PAY summary is the audit's own case: a £50 refundable deposit, so the
// journey renders its "Deposit back £50.00" row — the figure the pill covered.
const PAY_SUMMARY = {
  ok: true, propName: 'Jollyboat', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
  checkIn: d(20), checkOut: d(23), currency: 'GBP', kind: 'balance',
  total: 390, alreadyPaid: 100, balance: 290, depositPct: 25, amountDue: 290,
  damagesDue: 50, holdAmount: 0, holdStatus: 'none', balanceDueDate: d(60),
  part: { min: 20, max: 290 }, quote: '7:balance:340.00:0123456789abcdef0123456789abcdef',
};

function stub(page, who) {
  const guest = who === 'guest';
  const owner = who === 'owner';
  return page.route(/\.php/, (route) => {
    const url = route.request().url();
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) { if (b.action === 'guest_status') return json({ ok: true, guest: guest ? GUEST : null }); return json({ ok: true, admin: owner, guest: null }); }
    if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
    if (url.includes('square-config.php')) return json({ enabled: true, applicationId: 'app-id', locationId: 'loc-id', environment: 'sandbox' });
    if (url.includes('pay.php')) { if (b.action === 'summary') return json(PAY_SUMMARY); return json({ ok: true }); }
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [midStay], enquiries: [], completed_stays: 1 });
    if (url.includes('experiences.php')) return json({ ok: true, experiences });
    if (url.includes('expenses.php')) return json({ ok: true, expenses, categories: [] });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, name: 'Ann', prop: '21a', rating: 5, text: 'A lovely week by the quay, and the cottage was spotless throughout.', status: 'approved', created_at: d(-40) }] });
    if (url.includes('bookings.php')) {
      if (b.action === 'email_logs') return json({ logs: { 3: [{ id: 1, kind: 'confirmation', subject: 'Your booking is confirmed', sent_at: d(-5) + ' 10:00:00', body: '<p>Confirmed</p>' }] } });
      if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [{ id: 1, at: d(-5) + ' 10:00:00', type: 'email.sent', message: 'Confirmation sent', subject: 'Your booking is confirmed', body: '<p>Confirmed</p>', severity: 'info' }] });
      return json({ bookings });
    }
    if (url.includes('enquiries.php')) return json({ enquiries });
    if (url.includes('search.php')) return json({ ok: true, counts: { message: 2, email: 1, review: 1 }, results: [
      { type: 'message', id: 1, title: 'Debbie McGoldrick', text: 'Is there a hairdryer in the cottage?', date: d(-2) },
      { type: 'message', id: 2, title: 'Nina Salt', text: 'Could we have a late checkout?', date: d(-3) },
      { type: 'email', id: 3, title: 'Booking confirmed', text: 'Your stay is confirmed', date: d(-5) },
      { type: 'review', id: 4, title: 'Ann', text: 'A lovely week by the quay', date: d(-40) },
    ] });
    if (url.includes('diagnostics.php')) return json({ ok: true, summary: { ok: 12, warn: 0, fail: 0 }, checks: [], mail_ready: true });
    if (url.includes('cron-status.php')) return json({ ok: true, stale: false, last: d(0) + ' 06:00:00', feeds: [] });
    if (url.includes('activity.php')) return json({ ok: true, events: [{ id: 1, at: d(-1) + ' 09:00:00', type: 'booking.added', message: 'Booking added', severity: 'info' }] });
    if (url.includes('content.php')) return json({ ok: true, content: { 'images-21a': JSON.stringify(['uploads/a.jpg', 'uploads/b.jpg', 'uploads/c.jpg']) }, value: null });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences: [], content: {}, blocks: [], ranges: [], events: [], results: [], logs: {}, value: null });
  });
}

// ---- §1's instrument: INKED TEXT, measured with a Range ---------------------
// Every non-empty text node in the document, as the rectangles its glyphs
// actually occupy — never the element's own box, and never a node inside
// something that is not painted.
const INK_VS_FAB = (scope) => {
  const fab = document.getElementById('guest-msg-fab');
  if (!fab || !fab.getClientRects().length) return { painted: false, hits: [] };
  const f = fab.getBoundingClientRect();
  if (!f.width || !f.height) return { painted: false, hits: [] };
  const hits = [];
  const roots = scope ? [...document.querySelectorAll(scope)] : [document.body];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (scope && !roots.some((r) => r.contains(n))) continue;
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const p = n.parentElement;
    if (!p || fab.contains(p)) continue;
    if (!p.getClientRects().length) continue;
    const cs = getComputedStyle(p);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    // VISUALLY-HIDDEN TEXT IS NOT INK, and its rects lie: `clip: rect(0,0,0,0)`
    // stops the PAINT but getClientRects still returns the full, unclipped
    // glyph boxes — which is how the .seo-text crawler block (an <h1>/<h2> pair
    // the size of the real page) reported as covered on the gate's first run.
    let hidden = false;
    for (let a = p; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (/rect\(0px,?\s*0px,?\s*0px,?\s*0px\)/.test(acs.clip) || acs.clipPath === 'inset(50%)') { hidden = true; break; }
    }
    if (hidden) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const box of r.getClientRects()) {
      if (!box.width || !box.height) continue;
      const ox = Math.min(f.right, box.right) - Math.max(f.left, box.left);
      const oy = Math.min(f.bottom, box.bottom) - Math.max(f.top, box.top);
      if (ox > 0.5 && oy > 0.5) {
        // The pill only counts as covering something it is actually ON TOP of.
        // elementFromPoint at the overlap's centre is the honest test — the
        // property is not the pixel.
        const cx = Math.max(f.left, box.left) + ox / 2;
        const cy = Math.max(f.top, box.top) + oy / 2;
        const top = document.elementFromPoint(cx, cy);
        if (!top || !fab.contains(top)) continue;
        hits.push({ text: n.nodeValue.trim().slice(0, 40), w: Math.round(ox), h: Math.round(oy), who: p.className.toString().split(' ')[0] || p.tagName });
      }
    }
  }
  return { painted: true, hits };
};

// ---- §2's instrument: the EFFECTIVE hit region ------------------------------
// The control's box grown by any absolutely-positioned ::before/::after region
// (the round-seven mechanism, shared with ui-test-round8 §2).
const REACH = (sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (const ps of ['::before', '::after']) {
      const cs = getComputedStyle(el, ps);
      if (cs.content === 'none' || cs.position !== 'absolute' || !/px/.test(cs.top) || !/px/.test(cs.left)) continue;
      const p = (v) => parseFloat(v) || 0;
      box.t = Math.min(box.t, r.top + p(cs.top)); box.l = Math.min(box.l, r.left + p(cs.left));
      box.r = Math.max(box.r, r.right - p(cs.right)); box.b = Math.max(box.b, r.bottom - p(cs.bottom));
    }
    out.push({
      who: (el.id ? '#' + el.id : (el.className.toString().split(' ')[0] || el.tagName)) + ' “' + (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 20) + '”',
      w: Math.round((box.r - box.l) * 10) / 10, h: Math.round((box.b - box.t) * 10) / 10,
    });
  }
  return out;
};
// axis: 'both' | 'y' (a vertical-only region on a control whose neighbours are
// contiguous — the axis being fixed is the one asserted).
const reachOk = (name, list, floor, axis) => {
  const val = (x) => (axis === 'y' ? x.h : Math.min(x.w, x.h));
  const bad = list.filter((x) => val(x) < 44);
  ok(list.length >= floor, `${name}: ${list.length} control(s) measured (vacuity guard ≥${floor})`);
  ok(bad.length === 0, `${name}: every effective hit region reaches 44${axis === 'y' ? ' vertically' : ''}${bad.length ? ' — ' + bad.map((x) => `${x.who} ${x.w}×${x.h}`).join('; ') : ''}`);
};

(async () => {
  const t = await bootBrowser();
  const newPage = async (w, who) => {
    const page = await t.browser.newPage({ viewport: { width: w, height: w < 600 ? 844 : 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
      window.Square = { payments: () => ({ card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok' }) }), paymentRequest: () => { throw new Error('no wallets'); } }) };
    });
    await stub(page, who);
    page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
    await page.goto(t.base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    return page;
  };
  const run = async (page, code, ms) => { await page.evaluate((c) => eval(c), code); await page.waitForTimeout(ms || 700); };

  // A SCROLL THEN A MEASURE NEEDS A REAL TIMEOUT, never a bare rAF —
  // requestAnimationFrame alone does not commit a scrollTo before the next
  // read, and re-measuring the same frame 24 times is how an earlier pass
  // reported 24 phantom overlaps.
  const sweepFab = async (page, label, scope) => {
    const H = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    const vp = page.viewportSize().height;
    const stops = [];
    for (let y = 0; y <= Math.max(0, H - vp); y += 40) stops.push(y);
    if (!stops.length) stops.push(0);
    let painted = false;
    const hits = [];
    for (const y of stops) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(60);
      const r = await page.evaluate(INK_VS_FAB, scope || null);
      if (r.painted) painted = true;
      for (const h of r.hits) hits.push({ ...h, y });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return { label, stops: stops.length, painted, hits };
  };
  const fabOk = (r) => {
    ok(r.stops >= 1, `${r.label}: swept ${r.stops} scroll position(s) in 40px steps`);
    ok(r.hits.length === 0,
      `${r.label}: the Messages pill covers no inked text${r.hits.length ? ' — ' + [...new Set(r.hits.map((h) => `“${h.text}” (${h.who}) ${h.w}×${h.h}px @y${h.y}`))].slice(0, 4).join('; ') : (r.painted ? ' (pill painted)' : ' (pill stood down here)')}`);
  };

  // =====================================================================
  console.log('§1 the fixed chrome covers nothing');
  {
    const page = await newPage(390, 'guest');
    ok(await page.evaluate(() => document.body.classList.contains('guest-app') && !document.body.classList.contains('owner-mode')),
      'the guest shell is on at 390 (so the Messages pill exists to be measured)');

    // HOME — the one view where the pill STAYS and the content moves. Both
    // centred blocks are forced on: the late-availability card and the guest
    // quote (renderGuestWords only paints once approved reviews land).
    await run(page, `(async () => {
      nav('view-main');
      const la = document.getElementById('late-avail');
      la.innerHTML = '<div class="late-avail"><span>Late availability — <strong>Jollyboat Cottage</strong> is available 7 Sept to 11 Sept 2026</span><button type="button" class="btn-sm btn-edit">Check dates</button></div>';
      const gw = document.getElementById('home-guestwords');
      gw.style.display = '';
      document.getElementById('guestwords-quote').textContent = 'A lovely week by the quay — the cottage was spotless, the welcome basket was a delight, and we will be back before the year is out.';
      document.getElementById('guestwords-meta').textContent = 'Ann · 21A Westgate';
    })()`, 500);
    ok(await page.evaluate(() => { const f = document.getElementById('guest-msg-fab'); return !!f && f.getClientRects().length > 0; }),
      'home 390: the pill is PAINTED here — home is the one view with no other route to a person, so the CONTENT moves instead');
    // AT REST — the state the page opens in, and the state the audit measured
    // ("with the heritage rating hidden the card sits 88px higher and the same
    // overlap happens at rest").
    const homeRest = await page.evaluate(INK_VS_FAB, null);
    ok(homeRest.hits.length === 0,
      `home 390 at rest: the Messages pill covers no inked text${homeRest.hits.length ? ' — ' + [...new Set(homeRest.hits.map((h) => `\u201c${h.text}\u201d (${h.who}) ${h.w}\u00d7${h.h}px`))].slice(0, 4).join('; ') : ''}`);
    // AND ACROSS THE WHOLE SCROLL, over the four CENTRED blocks the fix insets.
    // Scoped, and the scope is the honest part: a fixed pill on a 3,000px page
    // WILL pass under something at some offset — that is what a floating action
    // button is. What the fix guarantees is the resting state and Home's centred
    // prose, which is what the audit measured; standing the pill down here (the
    // alternative) was refused because Home is where a hesitant visitor most
    // wants the chat. The known exception is stated in §1b below.
    fabOk(await sweepFab(page, 'home 390 · the centred blocks', '#late-avail, .home-guestwords, .home-trust, .avail-lead'));
    // AND THE INVARIANT BEHIND IT, because the sweep alone is fixture-luck: a
    // block only registers a hit if it happens to pass through the pill's band,
    // and in this harness the late-availability card sits above it for the whole
    // scroll (the audit's page had more above it). The x-axis claim is
    // scroll-independent — every centred block's INK must stop before the pill's
    // left edge — so it holds wherever the block lands.
    const rails = await page.evaluate(() => {
      const fab = document.getElementById('guest-msg-fab');
      const left = fab.getBoundingClientRect().left;
      const out = [];
      for (const sel of ['#late-avail', '.home-guestwords', '.home-trust', '.avail-lead']) {
        const el = document.querySelector(sel);
        if (!el || !el.getClientRects().length) continue;
        let max = 0;
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          if (!n.nodeValue.trim()) continue;
          const r = document.createRange(); r.selectNodeContents(n);
          for (const b of r.getClientRects()) if (b.width && b.height) max = Math.max(max, b.right);
        }
        if (max) out.push({ sel, ink: Math.round(max) });
      }
      return { left: Math.round(left), out };
    });
    ok(rails.out.length === 4, `home 390: all four centred blocks are on screen to measure (${rails.out.length})`);
    ok(rails.out.every((x) => x.ink <= rails.left),
      `home 390: every centred block's ink stops before the pill's left edge (${rails.left}) — ` + rails.out.map((x) => `${x.sel} ${x.ink}`).join(', '));

    // THE PAY SCREEN — money.
    await run(page, "openPayView('paytok', '7', 'balance')", 1100);
    const paid = await page.evaluate(() => {
      const f = [...document.querySelectorAll('#pay-journey .pj-fig')].map((e) => e.textContent.trim());
      return { figs: f, view: (document.querySelector('#view-pay') || {}).className };
    });
    ok(/active/.test(paid.view || ''), 'the pay screen is up');
    ok(paid.figs.some((x) => /£50\.00/.test(x)), `the journey states the £50.00 that comes back (${paid.figs.join(' · ')})`);
    fabOk(await sweepFab(page, 'pay 390'));

    // EXPERIENCES — the first card's Directions button.
    await run(page, "nav('view-experiences')", 1100);
    ok(await page.evaluate(() => !!document.querySelector('#exp-grid .exp-card')), 'the experiences cards rendered');
    fabOk(await sweepFab(page, 'experiences 390'));

    // THE SIGN-IN SHEET — its last line names the password-less route.
    await run(page, "(async () => { nav('view-main'); openGuestAuthModal && openGuestAuthModal(); const h = document.getElementById('passkey-hint'); if (h) h.style.display = ''; })()", 700);
    ok(await page.evaluate(() => !!document.querySelector('#guest-auth-modal.open')), 'the sign-in sheet is open');
    fabOk(await sweepFab(page, 'sign-in 390'));
    await run(page, "(async () => { try { closeGuestAuthModal(); } catch (e) {} })()", 400);
    await page.close();
  }

  // =====================================================================
  console.log('§2 every control meets the thumb — the guest screens');
  {
    const page = await newPage(390, 'guest');
    // 1. HOME: the crown (the only Home control on a phone) and the steppers.
    await run(page, "nav('view-main')", 400);
    reachOk('home 390 · the crown', await page.evaluate(REACH, 'header .logo'), 1, 'y');
    reachOk('home 390 · the availability steppers', await page.evaluate(REACH, '.hero-search .hs-step'), 2, 'both');
    // 2. THE CHAT: the quick-reply chips and the intro fields.
    await run(page, "(async () => { toggleChat(); const ci = document.getElementById('chat-intro'); if (ci) ci.style.display = ''; })()", 700);
    reachOk('chat 390 · the quick-reply chips', await page.evaluate(REACH, '#chat-quick .chat-chip'), 3, 'y');
    reachOk('chat 390 · the intro fields', await page.evaluate(REACH, '#chat-intro .input-glass'), 2, 'y');
    reachOk('chat 390 · the close', await page.evaluate(REACH, '#chat-widget .reviews-modal-close'), 1, 'both');
    await run(page, "(async () => { closeChat(); })()", 500);
    // 3. EXPERIENCES: the category filter chips.
    await run(page, "nav('view-experiences')", 900);
    reachOk('experiences 390 · the filter chips', await page.evaluate(REACH, '#exp-filters .exp-chip'), 3, 'y');
    const rows = await page.evaluate(() => {
      const els = [...document.querySelectorAll('#exp-filters .exp-chip')].filter((e) => e.getClientRects().length);
      return new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size;
    });
    ok(rows === 1, `experiences 390 · the filters are ONE scrolling row, not three wrapped (${rows})`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'experiences 390 · the page itself does not scroll sideways (the ROW is the scroll container)');
    // 4. SIGN-IN: the password-less route and the two tabs.
    await run(page, "(async () => { nav('view-main'); openGuestAuthModal && openGuestAuthModal(); })()", 600);
    reachOk('sign-in 390 · the magic-link route', await page.evaluate(REACH, '#magic-link-cta'), 1, 'y');
    reachOk('sign-in 390 · the Log in / Create account tabs', await page.evaluate(REACH, '#guest-auth-modal .guest-tab'), 2, 'y');
    const tabFs = await page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.querySelector('#guest-auth-modal .guest-tab')).fontSize)));
    ok(tabFs === 13, `sign-in 390 · the tabs read at 13px, not the 11px micro step (${tabFs}px)`);
    await run(page, "(async () => { try { closeGuestAuthModal(); } catch (e) {} })()", 300);
    // 5. MY STAYS: Copy code.
    await run(page, "(async () => { nav('view-guest-bookings'); await renderGuestBookings(); })()", 1200);
    reachOk('my stays 390 · Copy code', await page.evaluate(REACH, '.hub-code-copy'), 1, 'y');
    // 6. THE COTTAGE PAGE's map zoom. Leaflet is a CDN script, so the rule is
    //    measured against a real element painted from the real stylesheet
    //    rather than waiting on a third party inside a gate.
    await run(page, "openProperty('pimpernel')", 900);
    const zoom = await page.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'leaflet-bar leaflet-control-zoom';
      d.innerHTML = '<a href="#" class="leaflet-control-zoom-in">+</a><a href="#" class="leaflet-control-zoom-out">\u2212</a>';
      document.querySelector('#view-property .container, #view-property, body').appendChild(d);
      const out = [...d.querySelectorAll('a')].map((a) => { const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
      d.remove();
      return out;
    });
    ok(zoom.length === 2 && zoom.every((z) => z.w >= 44 && z.h >= 44), `cottage 390 · the map's +/− reach 44 (${zoom.map((z) => z.w + '×' + z.h).join(', ')})`);
    await page.close();
  }
  {
    // The desktop half: the nav links, the account button and the footer.
    const page = await newPage(1280, 'anon');
    await run(page, "nav('view-main')", 400);
    reachOk('home 1280 · the nav links', await page.evaluate(REACH, 'header nav ul li a:not(.btn-glass)'), 2, 'y');
    reachOk('home 1280 · the account button', await page.evaluate(REACH, '#account-btn'), 1, 'both');
    reachOk('home 1280 · the newsletter field and button', await page.evaluate(REACH, '.footer-newsletter .input-glass, .footer-newsletter .btn-glass'), 2, 'y');
    const nl = await page.evaluate(() => {
      const i = document.getElementById('nl-email'); const cs = getComputedStyle(i);
      return { radius: cs.borderTopLeftRadius, fs: Math.round(parseFloat(cs.fontSize)), inline: i.getAttribute('style') || '' };
    });
    ok(!nl.inline, 'home 1280 · the newsletter field carries NO inline sizing (the ratchets can see it now)');
    ok(nl.radius === '12px', `home 1280 · its radius is the cell token, not the inline 10px (${nl.radius})`);
    const barH = await page.evaluate(() => Math.round(document.querySelector('header').getBoundingClientRect().height));
    ok(barH >= 50 && barH <= 64, `home 1280 · the resting bar is unmoved by the account button's region (${barH}px, ui-test-hig §10's 50–64)`);
    await page.close();
  }

  // =====================================================================
  console.log('§2 every control meets the thumb — the owner screens');
  {
    const page = await newPage(390, 'owner');
    await run(page, "(async () => { await window.loadAdminBundle(); nav('view-backoffice'); await initBackOffice(); })()", 2500);
    // 1. TODAY: the five booking filters.
    reachOk('today 390 · the booking filters', await page.evaluate(REACH, '#bookings-filters .inbox-sort-btn'), 4, 'y');
    // 2. THE INBOX: the folder switch and the sort segments.
    // the folder SWITCH is hidden on the stacked landing by design, so the seg
    // measured here is the enquiry tab bar inside the folder (the fold rule:
    // anything that MEASURES has to open the fold first).
    await run(page, "(async () => { await openInbox(); const f = document.getElementById('iv-fold-enquiries'); if (!f || f.hidden) inboxFolder('enquiries'); })()", 1500);
    reachOk('inbox 390 · the segmented switches', await page.evaluate(REACH, '#view-inbox .inbox-sort.seg .inbox-sort-btn'), 2, 'y');
    ok(await page.evaluate(() => {
      const seg = document.querySelector('#view-inbox .inbox-sort.seg');
      const btn = seg && seg.querySelector('.inbox-sort-btn');
      if (!seg || !btn) return false;
      // AN OVERFLOW SCROLLER CLIPS AT ITS PADDING BOX, not its border box — the
      // first version of this compared against getBoundingClientRect() (which
      // includes the 1px hairline) and so PASSED with the track put back to 3px,
      // i.e. with the region clipped by the very pixel it was measuring.
      const s = seg.getBoundingClientRect(), b = btn.getBoundingClientRect();
      const sc = getComputedStyle(seg);
      const padTop = s.top + (parseFloat(sc.borderTopWidth) || 0);
      const padBot = s.bottom - (parseFloat(sc.borderBottomWidth) || 0);
      const cs = getComputedStyle(btn, '::before');
      const top = b.top + (parseFloat(cs.top) || 0), bot = b.bottom - (parseFloat(cs.bottom) || 0);
      return top >= padTop - 0.05 && bot <= padBot + 0.05;
    }), 'inbox 390 · the region lives INSIDE the seg\u2019s own overflow-x scroller, so nothing clips it');
    // 3. THE BOOKING HUB: "Show email".
    await run(page, "(async () => { await openBookingHub('b3'); bhubFoldToggle('activity'); })()", 1400);
    reachOk('hub 390 · Show email', await page.evaluate(REACH, '#booking-hub-content .bhub-feed-mail summary'), 1, 'y');
    // 4. EXPENSES: Edit and Remove.
    await run(page, "(async () => { await openAccounts(); await loadExpenses(); accountsOpen('expenses'); renderExpenses(); })()", 1600);
    reachOk('expenses 390 · the row controls', await page.evaluate(REACH, '#expenses-body .feed-del'), 2, 'both');
    const pitch = await page.evaluate(() => {
      const g = [...document.querySelectorAll('#expenses-body .feed-del')].map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top || a.left - b.left);
      let worst = 0;
      for (let i = 1; i < g.length; i++) if (Math.abs(g[i].top - g[i - 1].top) < 4) worst = Math.max(worst, Math.max(0, (g[i - 1].right + 6) - (g[i].left - 6)));
      return Math.round(worst);
    });
    ok(pitch === 0, `expenses 390 · no 44px region overlaps its neighbour — and one of them is Remove (${pitch}px of overlap)`);
    // 5. MANAGE: the health pill and the activity-log filter chips.
    await run(page, "(async () => { await openArea('settings'); settingsShowIndex(); await checkSystemHealth(); })()", 1600);
    reachOk('manage 390 \u00b7 the health pill', await page.evaluate(REACH, '#health-pill'), 1, 'y');
    await run(page, "(async () => { nav('view-activity-log'); await renderActivityLog(); })()", 1600);
    reachOk('manage 390 · the activity-log filters', await page.evaluate(REACH, '#act-log-filters .act-log-chip'), 6, 'y');
    const wrapped = await page.evaluate(() => getComputedStyle(document.getElementById('act-log-filters')).flexWrap);
    ok(wrapped === 'wrap', `manage 390 · the fourteen filters still WRAP — none hides behind a swipe (${wrapped})`);
    // 6. THE ASSISTANT: the deep-search chips and its Back.
    await run(page, `(async () => {
      openCmdK();
      const i = document.getElementById('cmdk-input');
      i.value = 'hairdryer'; cmdkSearchCore('hairdryer', false);
      await new Promise((r) => setTimeout(r, 400));
      cmdkDeepOpen();
      const t0 = Date.now();
      while (!window.__cmdkDeep && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 60));
    })()`, 900);
    reachOk('search 390 · the deep-search chips', await page.evaluate(REACH, '#cmdk .cmdk-deep-chip'), 2, 'y');
    reachOk('search 390 · the deep-search Back', await page.evaluate(REACH, '#cmdk .cmdk-deep-head .cmdk-back'), 1, 'y');
    await run(page, "(async () => { closeCmdK(); })()", 400);
    // 7. THE PHOTO GRID is ONE ⋯ menu now, and it reaches 44.
    await run(page, "(async () => { siteContent['images-21a'] = ['uploads/a.jpg','uploads/b.jpg','uploads/c.jpg']; await openArea('settings'); settingsOpen('accom'); settingsOpenAccomSec('21a','photos'); })()", 1800);
    const photo = await page.evaluate(() => {
      const cell = document.querySelector('#accom-photos-21a .acp-cell');
      if (!cell) return null;
      const before = ['accomMovePhoto', 'accomReplacePhoto', 'accomRemovePhoto'].map((fn) => {
        const el = cell.querySelector(`[data-act="${fn}"]`);
        return el ? el.getClientRects().length > 0 : null;
      });
      return { before, hasMore: !!cell.querySelector('.bhub-menu-btn') };
    });
    ok(photo && photo.hasMore, 'photos 390 · each cell carries ONE ⋯ button');
    ok(photo && photo.before.every((v) => v === false), 'photos 390 · …and the four actions are not painted until it is opened');
    reachOk('photos 390 · the ⋯ button', await page.evaluate(REACH, '#accom-photos-21a .acp-cell .bhub-menu-btn'), 3, 'both');
    const opened = await page.evaluate(() => {
      const cell = document.querySelector('#accom-photos-21a .acp-cell');
      cell.querySelector('.bhub-menu-btn').click();
      const menu = cell.querySelector('.bhub-menu');
      const acts = ['accomMovePhoto', 'accomReplacePhoto', 'accomRemovePhoto'].every((fn) => menu.querySelector(`[data-act="${fn}"]`));
      const painted = menu.getClientRects().length > 0;
      const min = Math.min(...[...menu.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height));
      return { acts, painted, min: Math.round(min) };
    });
    ok(opened.painted && opened.acts, 'photos 390 · reorder / replace / remove sit inside the opened menu, on the same data-acts');
    ok(opened.min >= 44, `photos 390 · every item in it reaches 44 (${opened.min}px)`);
    await page.close();
  }
  {
    // The AI chat page keeps its own page — it needs the night-shift switch on.
    const page = await newPage(390, 'owner');
    await run(page, "(async () => { await window.loadAdminBundle(); window.__nightPre = { on: 1 }; nav('view-aichat'); })()", 1500);
    // INJECTED AFTER THE PAGE HAS SETTLED — renderMacChat rewrites #mc-log on
    // its own clock, and an injection racing it is silently swept away (three
    // of the six controls vanished on the gate's first run). These six markups
    // are admin.js's own, quoted; what is being measured is the STYLESHEET.
    await run(page, `(() => {
      const log = document.getElementById('mc-log');
      log.insertAdjacentHTML('beforeend',
        '<div class="mc-rail"><button class="mc-rail-chip">New conversation</button><button class="mc-rail-chip">Yesterday</button></div>' +
        '<div class="mc-day"><div class="mc-day-t">Today</div><div class="mc-day-r"><span class="mc-day-l">Key safe</span><button class="mc-day-go">Rotate</button></div></div>' +
        '<details class="mc-think"><summary>Thought about it</summary><div class="mc-think-b">\u2026</div></details>' +
        '<div class="mc-act"><div class="mc-act-t">Proposal</div><div><button class="mc-act-go">Block the dates</button><button class="mc-act-no">Dismiss</button></div></div>' +
        '<button class="ac-more" aria-label="More">\u22ef</button>');
    })()`, 500);
    reachOk('chat 390 · the day card, rail, thinking fold and act buttons',
      await page.evaluate(REACH, '#view-aichat .mc-day-go, #view-aichat .mc-rail-chip, #view-aichat .mc-think > summary, #view-aichat .mc-act-go, #view-aichat .mc-act-no'), 6, 'y');
    reachOk('chat 390 · the ⋯', await page.evaluate(REACH, '#view-aichat .ac-more'), 1, 'both');
    const phantom = await page.evaluate(() => {
      const d = document.createElement('div'); d.className = 'mc-chip'; d.textContent = 'Checked the website';
      document.querySelector('#view-aichat').appendChild(d);
      const cs = getComputedStyle(d, '::before'); const out = cs.content;
      d.remove(); return out;
    });
    ok(phantom === 'none', `chat 390 · .mc-chip gets NO region — it is a plain <div>, and one there would be a phantom target (${phantom})`);
    await page.close();
  }

  // =====================================================================
  console.log('§3 the changeover card does not paint over the assistant');
  {
    const page = await newPage(390, 'owner');
    await run(page, "(async () => { await window.loadAdminBundle(); nav('view-backoffice'); await initBackOffice(); showChangeoverToasts(); })()", 2500);
    const card = await page.evaluate(() => {
      const w = document.getElementById('changeover-toasts');
      return { n: w ? w.querySelectorAll('.toast').length : 0, z: w ? getComputedStyle(w).zIndex : '', date: (w && w.querySelector('.toast-date') || {}).textContent };
    });
    ok(card.n >= 1, `a same-day changeover card is on Today (${card.n})`);
    ok(/^\d{2}\/\d{2}\/\d{4}$/.test((card.date || '').trim()), `it prints its date DD/MM/YYYY, not raw ISO (${card.date})`);
    const cmdkZ = await page.evaluate(() => getComputedStyle(document.getElementById('cmdk')).zIndex);
    ok(Number(card.z) < Number(cmdkZ), `the card sits BELOW the pop-out (${card.z} < ${cmdkZ})`);
    const over = await page.evaluate(async () => {
      openCmdK();
      await new Promise((r) => setTimeout(r, 500));
      const w = document.getElementById('changeover-toasts');
      const cs = getComputedStyle(w);
      const el = w.querySelector('.toast');
      const r = el.getBoundingClientRect();
      const box = document.querySelector('#cmdk .cmdk-box').getBoundingClientRect();
      const ox = Math.min(box.right, r.right) - Math.max(box.left, r.left);
      const oy = Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top);
      const cx = Math.max(box.left, r.left) + Math.max(0, ox) / 2;
      const cy = Math.max(box.top, r.top) + Math.max(0, oy) / 2;
      const hit = (ox > 0 && oy > 0) ? document.elementFromPoint(cx, cy) : null;
      return { open: document.body.classList.contains('cmdk-open'), vis: cs.visibility, overlap: Math.round(Math.max(0, ox) * Math.max(0, oy)), inCard: !!(hit && w.contains(hit)) };
    });
    ok(over.open, 'the assistant is open');
    ok(over.vis === 'hidden', `the changeover card is not painted while it is up (visibility: ${over.vis})`);
    ok(!over.inCard, `nothing of the card hit-tests over the pop-out (${over.overlap}px² of geometry, 0 of it painted)`);
    await page.close();
  }

  console.log(fails.length ? `\n  ${fails.length} REACH CHECK(S) FAILED \u274c\n   - ` + fails.join('\n   - ') : '\n  REACH SUITE PASSED \u2705');
  await t.done(fails.length);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
