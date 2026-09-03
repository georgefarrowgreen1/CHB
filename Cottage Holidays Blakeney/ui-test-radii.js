#!/usr/bin/env node
// ============================================================
//  ui-test-radii.js — THREE RADII, and the small things (dev/CI only).
//
//  The whole-site HIG review counted twelve distinct corner radii on one screen.
//  The system is three: the CELL (--r-sm 12: list cells, fields, chips, calendar
//  and picker cells), the CARD (--r-lg 20: cards, wells, the to-do card) and the
//  PILL (999). Sheets keep their panel radius. check-css-conventions ratchets the
//  raw values in the stylesheets; this suite reads the PAINT:
//    §1 a fold group's outer corners are the cell radius; a card is the card radius
//    §2 the picker's cells are 44px tall and the card is padded to fit seven at 390
//    §3 Move money out's fields are 44px at 17px type (no iOS zoom on focus)
//    §4 the chat header is a 52px bar; the terms sheet carries ONE close
//    §5 the system check's mark is a 28px symbol, Re-run is a text button,
//       the income headline has no stripe
//  Break-tested: the token edit (§1), the picker padding (§2), the field height
//  (§3), the terms foot (§4), the status mark (§5).
// ============================================================
const { bootBrowser } = require('./ui-test-lib');
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
];
const bookings = [
  { id: 2, prop_key: 'jollyboat', name: 'Debbie McGoldrick', email: 'e@x.com', phone: '07700 900123', check_in: d(6), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, damages_deposit: 50 },
];
function stub(page) {
  return page.route(/\.php/, (route) => {
    const url = route.request().url();
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) return json({ ok: true, admin: false, guest: null });
    if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [], enquiries: [], completed_stays: 0 });
    if (url.includes('bookings.php')) { if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [] }); if (b.action === 'email_logs') return json({ logs: {} }); return json({ bookings }); }
    if (url.includes('accounts.php')) return json({ years: [], deposit_liability: { gross: 75, feeBack: 1.31, net: 73.69, count: 1, rate: 0.0175, items: [], transactions: { settled: 368.44, ringFence: 73.69, movable: 294.75, count: 1, items: [] }, payouts: { inBank: 294.75, onWay: 0, unknown: 0, nextArrival: null, counts: { inBank: 1, onWay: 0, unknown: 0 }, checked: Math.floor(Date.now() / 1000), error: null, known: 1, items: { inBank: [], onWay: [], unknown: [] } } } });
    if (url.includes('diagnostics.php')) return json({ ok: true, summary: { ok: 12, warn: 0, fail: 0 }, checks: [], mail_ready: true });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences: [], content: {}, blocks: [], ranges: [], events: [], results: [] });
  });
}
const px = (v) => Math.round(parseFloat(v) || 0);

(async () => {
  const t = await bootBrowser();
  const newPage = async (w) => {
    const page = await t.browser.newPage({ viewport: { width: w, height: 844 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await stub(page);
    page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
    await page.goto(t.base + '/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (!document.body.classList.contains('light-mode')) { try { toggleTheme(); } catch (e) { document.body.classList.add('light-mode'); } } });
    await page.waitForTimeout(400);
    return page;
  };
  const open = async (page, code, ms) => { await page.evaluate((c) => eval(c), code); await page.waitForTimeout(ms || 900); };

  console.log('§1 three radii — cells at 12, cards at 20');
  let page = await newPage(390);
  await open(page, "(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); })()", 1400);
  await open(page, "(async () => { await openBookingHub('b2'); })()", 1200);
  const r1 = await page.evaluate(() => {
    const grps = [...document.querySelectorAll('#booking-hub-content .bhub-fold-grp')];
    const first = grps[0], last = grps[grps.length - 1];
    const card = document.querySelector('#booking-hub-content .bhub-next');
    const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return { n: grps.length, firstTL: getComputedStyle(first).borderTopLeftRadius, lastBL: getComputedStyle(last).borderBottomLeftRadius, card: card ? getComputedStyle(card).borderTopLeftRadius : null, rSm: tok('--r-sm'), rLg: tok('--r-lg') };
  });
  ok(r1.rSm === '12px' && r1.rLg === '20px', `the tokens are the cell and the card (${r1.rSm} / ${r1.rLg})`);
  ok(r1.n >= 3 && r1.firstTL === '12px' && r1.lastBL === '12px', `a fold run's outer corners are the CELL radius (${r1.firstTL} / ${r1.lastBL})`);
  ok(r1.card === '20px', `the to-do card is the CARD radius (${r1.card})`);

  console.log('§3 Move money out — the fields are 44px at 17px type');
  await open(page, "(async () => { await openAccounts(); accountsOpen('sweep'); })()", 1200);
  const sweep = await page.evaluate(() => ['#sweep-balance', '#sweep-buffer'].map((s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return { h: Math.round(el.getBoundingClientRect().height), fs: Math.round(parseFloat(cs.fontSize)), r: cs.borderTopLeftRadius }; }));
  ok(sweep.every((f) => f && f.h >= 44), `both money fields stand at 44 (${sweep.map((f) => f && f.h).join('/')})`);
  ok(sweep.every((f) => f && f.fs >= 16), `…at 16px or more, so iOS does not zoom on focus (${sweep.map((f) => f && f.fs).join('/')})`);
  ok(sweep.every((f) => f && f.r === '12px'), `…with the cell radius (${sweep.map((f) => f && f.r).join('/')})`);

  console.log('§5 System check — a 28px mark, a text button, no stripe');
  await open(page, "(async () => { await openArea('settings'); settingsOpen('diagnostics'); })()", 1200);
  const sys = await page.evaluate(() => {
    const mark = document.querySelector('.status-hero-mark');
    const rerun = document.querySelector('.status-rerun');
    return { mark: mark ? Math.round(mark.getBoundingClientRect().width) : null, rerunUnderline: rerun ? getComputedStyle(rerun).textDecorationLine : null, rerunH: rerun ? Math.round(rerun.getBoundingClientRect().height) : null };
  });
  ok(sys.mark !== null && sys.mark <= 30, `the verdict mark is a 28px symbol, not a 46px disc (${sys.mark}px)`);
  ok(sys.rerunUnderline === 'none' && sys.rerunH >= 44, `Re-run is a text button at the floor, not an underlined link (${sys.rerunUnderline}, ${sys.rerunH}px)`);
  await open(page, "(async () => { await openAccounts(); accountsOpen('income'); })()", 1200);
  const inc = await page.evaluate(() => { const el = document.querySelector('.accounts-stat.headline'); return el ? { stripe: parseFloat(getComputedStyle(el).borderLeftWidth), r: getComputedStyle(el).borderTopLeftRadius } : null; });
  // The card's own hairline (1px) is not a stripe; the stripe was 4px of --ok.
  ok(inc && inc.stripe <= 1, `the income headline has no green stripe (left border ${inc && inc.stripe}px) — its figure already says it`);
  ok(inc && inc.r === '20px', `and wears the card radius (${inc && inc.r})`);
  await page.close();

  console.log('§2 the picker — 44px cells, seven across at 390');
  page = await newPage(390);
  await open(page, "openProperty('21a')", 900);
  await open(page, 'openEnquireModal()', 900);
  await open(page, "(async () => { const tr = document.querySelector('#enquire-modal .date-range-trigger'); if (tr) tr.click(); })()", 1200);
  const pick = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#dp-grid .dp-day')].filter((c) => c.textContent.trim());
    const card = document.querySelector('.datepicker-card');
    const hs = cells.map((c) => Math.round(c.getBoundingClientRect().height));
    const rows = new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)));
    return { n: cells.length, minH: Math.min(...hs), rights: Math.max(...cells.map((c) => c.getBoundingClientRect().right)), cardRight: card.getBoundingClientRect().right, pad: getComputedStyle(card).paddingLeft, r: cells.length ? getComputedStyle(cells[0]).borderTopLeftRadius : null, cols: Math.round(cells.length / rows.size) };
  });
  ok(pick.n >= 28, `${pick.n} day cells rendered (vacuity guard)`);
  ok(pick.minH >= 44, `every day cell is at least 44px tall (${pick.minH})`);
  ok(pick.rights <= pick.cardRight + 1, 'and seven still fit inside the card at 390');
  ok(pick.r === '12px', `cells take the cell radius (${pick.r})`);
  await open(page, "(async () => { try { closeDatePicker(); } catch (e) {} closeEnquireModal(); })()", 500);

  console.log('§4 the chat header and the terms sheet');
  await open(page, "(async () => { try { toggleChat(); } catch (e) {} })()", 900);
  const chat = await page.evaluate(() => { const h = document.querySelector('.chat-widget-head'); return h ? Math.round(h.getBoundingClientRect().height) : null; });
  ok(chat !== null && chat <= 60, `the chat header is a bar, ≤60px for a title and a status line (${chat}px)`);
  await open(page, "(async () => { try { closeChat(); } catch (e) {} })()", 400);
  await open(page, "(async () => { openTermsModal(null, '21a'); })()", 900);
  const terms = await page.evaluate(() => ({ foot: !!document.querySelector('.terms-modal-foot'), closes: [...document.querySelectorAll('#terms-modal [data-act="closeTermsModal"]')].filter((b) => b.getClientRects().length).length }));
  ok(!terms.foot && terms.closes === 1, `the terms sheet carries ONE close, the ✕ — no bottom bar (${terms.closes} close control(s))`);
  await open(page, 'closeTermsModal()', 400);
  await page.close();

  console.log(fails.length ? `\n  ${fails.length} RADII CHECK(S) FAILED ❌` : '\n  RADII SUITE PASSED ✅');
  await t.done(fails.length);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
