#!/usr/bin/env node
// ============================================================
//  ui-test-hig.js — THE HIG SYSTEMS, stated once each and measured on the
//  real screens (dev/CI only, never deployed).
//
//  The whole-site HIG review found the same row, caption, radius and material
//  stated differently on every screen. This suite pins the systems that
//  replaced them:
//    §1 ONE MATERIAL FOR LISTS — adjacent fold groups join (no shadow, one
//       hairline, squared shared corners), Needs-you rows likewise.
//    §2 STATE IS SAID ONCE — no left rail or icon tile on a duty row; a
//       Payments row TITLE stays in ink; the calm capsule is quiet text.
//    §3 ONE CAPTION TIER — in-card captions are sentence case.
//    §4 THE CHEVRON IS A SYMBOL.
//    §5 THE PHONE'S CHROME — the spine is a sentence + ONE scrolling chip row
//       ≤640, every chip still routes; the condensed title stands down <480.
//    §6 WELLS LIFT, SHEETS ARE OPAQUE (guest, 390) — and stay glass at 1280.
//    §7 THE GUEST'S PRIMARY ACTION TAKES THE ACCENT; free nights are unfilled.
//    §8 THE FOOTER: sentence case, two columns, 44px rows on a phone.
//    §9 NO FILLED BUTTON GLOWS.
//  Every declaration was break-tested: deleting the sibling rule fails §1,
//  the spine media fails §5, the sheet surface fails §6, the CTA style §7.
// ============================================================
const path = require('path');
const { bootBrowser } = require('./ui-test-lib');

const fails = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
  { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 110, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 1, max_total: 3, sort_order: 3 },
];
const bookings = [
  { id: 1, prop_key: '21a', name: 'Priya Patel', email: 'priya@example.com', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 450, agreed_total: 450 },
  { id: 2, prop_key: 'pimpernel', name: 'Debbie McGoldrick', email: 'e@x.com', phone: '07700 900123', check_in: d(6), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, damages_deposit: 50, notes: 'Arriving late, key safe please' },
  { id: 4, prop_key: 'jollyboat', name: 'Tom Barnes', email: 't@x.com', check_in: d(17), check_out: d(24), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 0, agreed_total: 910 },
];
const enquiries = [
  { id: 11, prop_key: '21a', name: 'Nina Salt', email: 'nina@example.com', phone: '07700 900123', address: '14 Long Street', postcode: 'NR21 0AB', check_in: d(40), check_out: d(44), adults: 2, children: 0, check_in_time: '15:00', check_out_time: '10:00', message: 'Any chance of a late checkout?', created_at: d(-1) + ' 09:12:00' },
];
// A guest with a stay in progress AND an upcoming one with a balance to pay.
const midStay = { id: 3, prop_key: 'jollyboat', name: 'Priya Patel', email: 'guest@example.com', check_in: d(-2), check_out: d(2), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 495, agreed_total: 495, agreed_per_night: 120, agreed_nights: 4, agreed_nightly: 480, agreed_booking_fee: 0, agreed_txn_pct: 3, agreed_txn_fee: 15, agreed_on: d(-30) };
const upcoming = { id: 71, prop_key: '21a', name: 'Priya Patel', email: 'guest@example.com', check_in: d(10), check_out: d(13), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 400, agreed_nightly: 390, agreed_txn_fee: 10, agreed_nights: 3, damages_deposit: 50, pay_token: 'tok71', balance_due_date: d(3) };
const GUEST = { id: 9, name: 'Priya Patel', email: 'guest@example.com', phone: '', address: '', postcode: '' };

function stub(page, guest) {
  return page.route(/\.php/, (route) => {
    const url = route.request().url();
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) { if (b.action === 'guest_status') return json({ ok: true, guest: guest ? GUEST : null }); return json({ ok: true, admin: false, guest: null }); }
    if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
    // my-bookings BEFORE bookings — includes('bookings.php') matches both (the documented trap).
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [midStay, upcoming], enquiries: [], completed_stays: 1 });
    if (url.includes('bookings.php')) { if (b.action === 'email_logs') return json({ logs: {} }); if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [] }); return json({ bookings }); }
    if (url.includes('enquiries.php')) return json({ enquiries });
    if (url.includes('accounts.php')) return json({ years: [], deposit_liability: { gross: 75, feeBack: 1.31, net: 73.69, count: 1, rate: 0.0175, items: [{ outstanding: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Sarah Pemberton', prop_key: '21a', check_out: d(-3) }], transactions: { settled: 368.44, ringFence: 73.69, movable: 294.75, count: 1, items: [] }, payouts: { inBank: 294.75, onWay: 0, unknown: 0, nextArrival: null, counts: { inBank: 1, onWay: 0, unknown: 0 }, checked: Math.floor(Date.now() / 1000), error: null, known: 1, items: { inBank: [], onWay: [], unknown: [] } } } });
    if (url.includes('diagnostics.php')) return json({ ok: true, summary: { ok: 12, warn: 0, fail: 0 }, checks: [], mail_ready: true });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences: [], content: {}, blocks: [], ranges: [], events: [], results: [] });
  });
}
const rgb = (v) => (String(v).match(/[\d.]+/g) || []).map(Number);

(async () => {
  const t = await bootBrowser();
  const newPage = async (w, guest) => {
    const page = await t.browser.newPage({ viewport: { width: w, height: w < 600 ? 844 : 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await stub(page, guest);
    page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
    await page.goto(t.base + '/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (!document.body.classList.contains('light-mode')) { try { toggleTheme(); } catch (e) { document.body.classList.add('light-mode'); } } });
    await page.waitForTimeout(500);
    return page;
  };
  const open = async (page, code, ms) => { await page.evaluate((c) => eval(c), code); await page.waitForTimeout(ms || 900); };

  // ================= OWNER, 390 =================
  let page = await newPage(390, false);
  await open(page, "(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); })()", 1400);

  console.log('§1/§2 Today — Needs-you rows are one grouped material, state said once');
  const ny = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#needs-you-list .ny-row')];
    const cs = rows.map((r) => getComputedStyle(r));
    return {
      n: rows.length,
      shadows: cs.map((c) => c.boxShadow),
      leftRail: cs.map((c) => parseFloat(c.borderLeftWidth)),
      topBorders: cs.map((c) => parseFloat(c.borderTopWidth)),
      firstTL: cs[0] ? parseFloat(cs[0].borderTopLeftRadius) : null,
      firstBL: cs[0] ? parseFloat(cs[0].borderBottomLeftRadius) : null,
      lastBL: cs.length ? parseFloat(cs[cs.length - 1].borderBottomLeftRadius) : null,
      icBg: rows[0] ? getComputedStyle(rows[0].querySelector('.ny-ic')).backgroundColor : null,
      act: rows[0] && rows[0].querySelector('.ny-act') ? getComputedStyle(rows[0].querySelector('.ny-act')).textTransform : null,
      gapY: rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom) : null,
    };
  });
  ok(ny.n >= 3, `fixture mints ${ny.n} duty rows (vacuity guard)`);
  ok(ny.shadows.every((s) => s === 'none'), 'no duty row carries a shadow');
  ok(ny.leftRail.every((w) => w <= 1), 'no duty row carries a coloured left rail (state is the capsule)');
  ok(ny.icBg === 'rgba(0, 0, 0, 0)' || ny.icBg === 'transparent', `the icon tile has no fill (${ny.icBg})`);
  ok(ny.act === 'none', `the action verb is sentence case (${ny.act})`);
  ok(ny.firstTL > 0 && ny.firstBL === 0 && ny.lastBL > 0, `the rows join: outer corners on the run's ends only (${ny.firstTL}/${ny.firstBL}/${ny.lastBL})`);
  ok(ny.gapY === 0 && ny.topBorders.slice(1).every((w) => w === 0), `rows share one hairline, no gap (gap ${ny.gapY}px)`);

  console.log('§1/§3/§4 Booking hub — inset fold groups, sentence-case caption, symbol chevron');
  await open(page, "(async () => { await openBookingHub('b2'); })()", 1200);
  const hub = await page.evaluate(() => {
    const grps = [...document.querySelectorAll('#booking-hub-content .bhub-fold-grp')];
    const pairs = [];
    for (let i = 1; i < grps.length; i++) {
      const a = grps[i - 1], b = grps[i];
      if (a.nextElementSibling !== b) continue;
      pairs.push({
        gap: Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom),
        aBL: parseFloat(getComputedStyle(a).borderBottomLeftRadius),
        bTL: parseFloat(getComputedStyle(b).borderTopLeftRadius),
        bTop: parseFloat(getComputedStyle(b).borderTopWidth),
      });
    }
    const chev = document.querySelector('#booking-hub-content .bhub-fold-grp .bhub-chev');
    const cap = document.querySelector('#booking-hub-content .bhub-next-cap');
    return {
      n: grps.length,
      shadows: grps.map((g) => getComputedStyle(g).boxShadow),
      pairs,
      chevSvg: !!(chev && chev.querySelector('svg')),
      chevText: chev ? chev.textContent.trim() : null,
      chevBox: chev ? chev.getBoundingClientRect().width : 0,
      capTT: cap ? getComputedStyle(cap).textTransform : null,
      capText: cap ? cap.textContent.trim() : '',
      menuRadius: (() => { const m = document.querySelector('#booking-hub-content .bhub-menu-btn'); return m ? getComputedStyle(m).borderRadius : null; })(),
    };
  });
  ok(hub.n >= 3, `${hub.n} fold groups on the hub (vacuity guard)`);
  ok(hub.shadows.every((s) => s === 'none'), 'no fold group carries a shadow');
  ok(hub.pairs.length >= 2 && hub.pairs.every((p) => p.gap === 0 && p.aBL === 0 && p.bTL === 0 && p.bTop === 0), `adjacent groups JOIN — no gap, squared shared corners, one hairline (${hub.pairs.map((p) => p.gap + '/' + p.aBL + '/' + p.bTL).join(' ')})`);
  ok(hub.chevSvg && hub.chevText === '' && hub.chevBox >= 12, 'the disclosure chevron is a stroke SVG, not the "›" glyph');
  ok(hub.capTT === 'none' && /^Next · /.test(hub.capText), `the in-card caption is sentence case ("${hub.capText}")`);
  ok(/999|9999/.test(hub.menuRadius || ''), `the ⋯ menu button is a circle (${hub.menuRadius})`);

  console.log('§3 Enquiry hub — eyebrow, state caption and message caption are sentence case');
  await open(page, "(async () => { await openEnquiryHub(11); })()", 1200);
  const enq = await page.evaluate(() => ['.bhub-eyebrow', '.bhub-next-cap', '.bhub-msg-cap'].map((s) => { const el = document.querySelector('#enquiry-hub-content ' + s) || document.querySelector(s); return el ? getComputedStyle(el).textTransform + ':' + el.textContent.trim().slice(0, 30) : 'missing'; }));
  ok(enq.every((e) => e.startsWith('none:')), `all three captions sentence case (${enq.join(' | ')})`);

  console.log('§2 Payments — row titles in ink, the capsule carries the state');
  await open(page, "(async () => { await openAccounts(); })()", 1200);
  const pay = await page.evaluate(() => {
    const body = getComputedStyle(document.body).getPropertyValue('--text-light').trim();
    const lbls = [...document.querySelectorAll('#money-overview .bhub-fold-lbl')].map((l) => { const inner = l.firstElementChild && l.firstElementChild.tagName === 'SPAN' && !l.firstElementChild.classList.length ? l.firstElementChild : l; return { text: l.textContent.trim().slice(0, 14), color: getComputedStyle(inner).color, style: inner.getAttribute('style') || '' }; });
    const probe = document.createElement('span'); probe.style.color = body; document.body.appendChild(probe); const ink = getComputedStyle(probe).color; probe.remove();
    return { ink, lbls: lbls.filter((x) => /^To (collect|move|give)|^The books/.test(x.text)) };
  });
  ok(pay.lbls.length >= 3, `${pay.lbls.length} answer rows found (vacuity guard)`);
  ok(pay.lbls.every((l) => l.color === pay.ink && !/ok-text/.test(l.style)), `every answer title is body ink, none green (${pay.lbls.map((l) => l.text + '=' + l.color).join('; ')})`);

  console.log('§2 Manage — the calm capsule is quiet text with a green tick');
  await open(page, "(async () => { await openArea('manage'); })()", 1000);
  const calm = await page.evaluate(() => {
    const c = document.querySelector('#manage-verdicts .st-cap.is-ok');
    if (!c) return null;
    const cs = getComputedStyle(c);
    const tick = c.querySelector('.st-tick');
    const okText = getComputedStyle(document.body).getPropertyValue('--ok-text').trim();
    const probe = document.createElement('span'); probe.style.color = okText; document.body.appendChild(probe); const okRgb = getComputedStyle(probe).color; probe.remove();
    return { bg: cs.backgroundColor, border: parseFloat(cs.borderTopWidth), tickColor: tick ? getComputedStyle(tick).color : null, okRgb, n: document.querySelectorAll('#manage-verdicts .st-cap.is-ok').length };
  });
  ok(calm && calm.n >= 2, `Manage shows ${calm && calm.n} calm capsules (vacuity guard)`);
  ok(calm && (calm.bg === 'rgba(0, 0, 0, 0)' || calm.bg === 'transparent') && calm.border === 0, `the OK capsule has no tint and no border (${calm && calm.bg})`);
  ok(calm && calm.tickColor === calm.okRgb, 'and its tick is the ONE green mark');

  console.log('§5 The spine ≤640 — a sentence, then ONE scrolling row of chips that still route');
  const spine = await page.evaluate(() => {
    const sp = document.getElementById('day-spine');
    const row = sp ? sp.querySelector('.spine-duties') : null;
    const chips = row ? [...row.querySelectorAll('.spine-duty')] : [];
    return {
      painted: !!sp && sp.getClientRects().length > 0,
      h: sp ? Math.round(sp.getBoundingClientRect().height) : null,
      rowDisplay: row ? getComputedStyle(row).display : null,
      overflowX: row ? getComputedStyle(row).overflowX : null,
      oneLine: chips.length > 1 ? Math.abs(chips[0].getBoundingClientRect().top - chips[chips.length - 1].getBoundingClientRect().top) < 2 : null,
      heights: chips.map((c) => Math.round(c.getBoundingClientRect().height)),
      routed: chips.filter((c) => c.hasAttribute('data-act')).length,
      n: chips.length,
      scrolls: row ? row.scrollWidth > row.clientWidth : null,
    };
  });
  ok(spine.painted, 'Payments/Manage carry the spine at 390');
  ok(spine.n >= 3, `the fixture mints ${spine.n} chips (vacuity guard)`);
  ok(spine.rowDisplay === 'flex' && spine.overflowX === 'auto', `the chips are one scrolling row (${spine.rowDisplay}/${spine.overflowX})`);
  ok(spine.oneLine === true, 'every chip sits on ONE line');
  ok(spine.scrolls === true, 'and the row scrolls to reach the rest');
  ok(spine.heights.every((h) => h >= 30 && h <= 36), `chips are 32px (${spine.heights.join(',')})`);
  ok(spine.routed === spine.n, `every chip still carries its route (${spine.routed}/${spine.n})`);
  ok(spine.h !== null && spine.h <= 110, `the whole spine is ≤110px tall at 390 (${spine.h}px)`);
  await page.close();

  // ================= OWNER, 1280 — the grouping holds on the docked hub =================
  page = await newPage(1280, false);
  await open(page, "(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); })()", 1400);
  await open(page, "(async () => { await openBookingHub('b2'); })()", 1200);
  const wideHub = await page.evaluate(() => {
    const grps = [...document.querySelectorAll('#booking-hub-content .bhub-fold-grp')];
    let joined = 0;
    for (let i = 1; i < grps.length; i++) if (grps[i - 1].nextElementSibling === grps[i] && Math.round(grps[i].getBoundingClientRect().top - grps[i - 1].getBoundingClientRect().bottom) === 0) joined++;
    return { n: grps.length, joined, shadows: grps.every((g) => getComputedStyle(g).boxShadow === 'none') };
  });
  ok(wideHub.n >= 3 && wideHub.joined >= 2 && wideHub.shadows, `at 1280 the docked hub's groups join too (${wideHub.joined} joins of ${wideHub.n})`);
  await page.close();

  // ================= GUEST, 390 =================
  page = await newPage(390, true);
  console.log('§6 The enquiry sheet — opaque cream over the scrim, wells that lift');
  await open(page, "openProperty('21a')", 900);
  await open(page, 'openEnquireModal()', 900);
  const sheet = await page.evaluate(() => {
    const box = document.querySelector('#enquire-modal .modal-box');
    const cs = getComputedStyle(box);
    const well = document.querySelector('#enquire-modal .date-range-trigger');
    const host = document.querySelector('#enquire-modal .enq-host');
    return { bg: cs.backgroundColor, bf: cs.backdropFilter || cs.webkitBackdropFilter, well: well ? getComputedStyle(well).backgroundColor : null, host: host ? getComputedStyle(host).backgroundColor : null };
  });
  const opaque = (c) => { const p = rgb(c); return p.length === 3 || (p.length === 4 && p[3] >= 0.99); };
  const whiteAlpha = (c) => { const p = rgb(c); return p.length === 4 && p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] > 0 && p[3] < 1; };
  ok(opaque(sheet.bg) && (sheet.bf === 'none' || !sheet.bf), `at 390 the sheet is OPAQUE with no blur (${sheet.bg} / ${sheet.bf})`);
  ok(whiteAlpha(sheet.well), `the dates field is a lifted well — white alpha, not black (${sheet.well})`);
  ok(whiteAlpha(sheet.host), `so is the reassurance note (${sheet.host})`);
  await open(page, 'closeEnquireModal()', 500);

  console.log('§7 The cottage calendar — free is unfilled, taken is marked');
  const cal = await page.evaluate(() => {
    const free = document.querySelector('#prop-avail-cal .avail-cell.free');
    const cell = document.querySelector('#prop-avail-cal .avail-cell');
    return { n: document.querySelectorAll('#prop-avail-cal .avail-cell.free').length, bg: free ? getComputedStyle(free).backgroundColor : null, ring: free ? getComputedStyle(free).boxShadow : null, radius: cell ? getComputedStyle(cell).borderRadius : null };
  });
  ok(cal.n >= 10, `${cal.n} free cells rendered (vacuity guard)`);
  ok(cal.bg === 'rgba(0, 0, 0, 0)' || cal.bg === 'transparent', `a free night has NO fill (${cal.bg})`);
  ok(/inset/.test(cal.ring || ''), 'and carries a hairline instead');
  ok(cal.radius === '12px', `cells take the cell radius (${cal.radius})`);

  console.log('§7 My Stays — the pay button takes the accent; the progress well has no box');
  await open(page, "(async () => { currentGuest = { id: 9, name: 'Priya Patel', email: 'guest@example.com' }; try { setAuthUI(); } catch (e) {} nav('view-guest-bookings'); await renderGuestBookings(); })()", 1200);
  const stays = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#guest-bookings-list .gb2-cta button')].find((b) => /Pay balance/.test(b.textContent));
    const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    const probe = document.createElement('span'); probe.style.backgroundColor = acc; document.body.appendChild(probe); const accRgb = getComputedStyle(probe).backgroundColor; probe.remove();
    const flow = document.querySelector('#guest-bookings-list .bkflow');
    const count = document.querySelector('.my-stay-hub-soon .hub-count');
    return { has: !!btn, bg: btn ? getComputedStyle(btn).backgroundColor : null, accRgb, flowBg: flow ? getComputedStyle(flow).backgroundColor : null, flowBorder: flow ? parseFloat(getComputedStyle(flow).borderTopWidth) : null, countBorder: count ? parseFloat(getComputedStyle(count).borderTopWidth) : null };
  });
  ok(stays.has, 'the upcoming stay offers "Pay balance"');
  ok(stays.bg === stays.accRgb, `and it is painted in the ACCENT, not the done-state green (${stays.bg})`);
  ok((stays.flowBg === 'rgba(0, 0, 0, 0)' || stays.flowBg === 'transparent') && stays.flowBorder === 0, 'the booking-progress pills sit in the card\'s own flow (no well)');
  ok(stays.countBorder === 0, 'the countdown badge keeps its tint and drops its border');

  console.log('§8 The footer at 390 — sentence case, two columns, 44px rows');
  await open(page, "nav('view-main')", 600);
  const foot = await page.evaluate(() => {
    const nav = document.querySelector('.footer-links');
    const as = [...nav.querySelectorAll('a')];
    const lefts = new Set(as.map((a) => Math.round(a.getBoundingClientRect().left)));
    return { display: getComputedStyle(nav).display, tt: as.map((a) => getComputedStyle(a).textTransform), heights: as.map((a) => Math.round(a.getBoundingClientRect().height)), columns: lefts.size, n: as.length };
  });
  ok(foot.n >= 6, `${foot.n} footer links (vacuity guard)`);
  ok(foot.display === 'grid' && foot.columns === 2, `two left-aligned columns on a phone (${foot.display}, ${foot.columns} column starts)`);
  ok(foot.tt.every((x) => x === 'none'), 'every link is sentence case — the header keeps the caps, the sitemap does not');
  ok(foot.heights.every((h) => h >= 44), `every link is a 44px row (min ${Math.min(...foot.heights)})`);

  console.log('§9 No filled button glows');
  const glow = await page.evaluate(() => {
    const b = document.querySelector('.hero-cta');
    const s = getComputedStyle(b).boxShadow;
    const blur = (s.match(/\) (-?\d+)px (-?\d+)px (\d+)px/) || [])[3];
    return { s, blur: blur ? +blur : null };
  });
  ok(glow.blur !== null && glow.blur <= 4, `the hero button's shadow is a hairline lift, not a 24px glow (${glow.s})`);
  await page.close();

  // ================= GUEST, 1280 — the sheet stays glass on a desktop =================
  page = await newPage(1280, true);
  await open(page, "openProperty('21a')", 900);
  await open(page, 'openEnquireModal()', 900);
  const deskSheet = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#enquire-modal .modal-box')); return { bf: cs.backdropFilter || cs.webkitBackdropFilter }; });
  ok(deskSheet.bf && deskSheet.bf !== 'none', `at 1280 the modal keeps its glass (${deskSheet.bf})`);
  await page.close();

  console.log(fails.length ? `\n  ${fails.length} HIG CHECK(S) FAILED ❌` : '\n  HIG SUITE PASSED ✅');
  await t.done(fails.length);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
