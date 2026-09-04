#!/usr/bin/env node
// ============================================================
//  ui-test-round8.js — the round-eight sweep's fixes, measured (dev/CI only).
//
//  Twelve screens driven after the header, radii and type-scale PRs and probed for
//  truncation, orphans, targets under 44 and ink overlap. What survived, and the
//  gate that holds each:
//    §1 the cottage title paints in the serif (an owner-editable heading's
//       [data-edit-text]{font-family:inherit} tied with .section-title and won)
//    §2 everything you tap reaches 44 — measured as the EFFECTIVE hit region
//       (the element plus any absolutely-positioned ::before/::after region), on
//       the search window's chrome, the hub's contact links, the picker's month
//       arrows, Today's money pill and the deposit stepper
//    §3 a sub beside a capsule loses no words at 360 or 390 — neither to an
//       ellipsis nor past its two-line clamp — on Today, the enquiry hub, the Inbox
//       landing and the search rows
//    §4 the timeline lane reads its monogram below 640 ("J", never "Jolly" or
//       "Pimp"), the short name above it, the full name announced either way
//    §5 the bookings rows say their state once: the chip, no coloured rail
//    §6 the guest's journey is a caption in the hub's grammar, not a pill strip
//    §7 prose wraps pretty by default; a booking ref and "£X to pay" hold as units
//    §8 the hub's guest-detail labels read at 13px sentence case; the bookings
//       caption says "· 3 upcoming", not "· 3 bookings upcoming"
//  The search-scale decision (§9 of the demo) is gated in ui-test-searchpage §16c
//  and by ui-test-typescale sweeping the window.
// ============================================================
const { bootBrowser } = require('./ui-test-lib');
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 15, weekend_days: '5,6', max_adults: 2, max_children: 2, max_total: 4, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
  { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 145, extra_adult_rate: 30, child_rate: 20, booking_fee: 75, transaction_pct: 3, weekend_pct: 10, weekend_days: '5,6', max_adults: 4, max_children: 2, max_total: 6, sort_order: 3 },
];
const bookings = [
  { id: 1, prop_key: '21a', name: 'Priya Patel', email: 'priya@example.com', phone: '07700 900111', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 450, agreed_total: 450 },
  { id: 2, prop_key: 'jollyboat', name: 'Debbie McGoldrick', email: 'e@x.com', phone: '07700 900123', check_in: d(6), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, damages_deposit: 50 },
  { id: 3, prop_key: 'pimpernel', name: 'Alexandrina Featherstonehaugh-Smythe', email: 'a@x.com', phone: '07700 900999', check_in: d(14), check_out: d(21), check_in_time: '16:00', check_out_time: '10:00', adults: 4, children: 2, payment: 'deposit', deposit_paid: 300, agreed_total: 1260, damages_deposit: 75 },
];
const enquiries = [
  { id: 11, prop_key: '21a', name: 'Nina Salt', email: 'nina@example.com', phone: '07700 900123', address: '14 Long Street', postcode: 'NR21 0AB', check_in: d(40), check_out: d(44), adults: 2, children: 0, check_in_time: '15:00', check_out_time: '10:00', message: 'Any chance of a late checkout? We have a long drive back to Leeds and would love an extra hour if at all possible.', created_at: d(-1) + ' 09:12:00' },
  { id: 12, prop_key: 'pimpernel', name: 'Oliver Wren', email: 'ow@example.com', phone: '', address: '', postcode: '', check_in: d(60), check_out: d(63), adults: 2, children: 1, check_in_time: '15:00', check_out_time: '10:00', message: 'Is the garden enclosed?', created_at: d(-4) + ' 18:40:00' },
];
const midStay = { id: 3, prop_key: 'jollyboat', name: 'Priya Patel', email: 'guest@example.com', check_in: d(-2), check_out: d(2), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 495, agreed_total: 495, agreed_per_night: 120, agreed_nights: 4, agreed_nightly: 480, agreed_booking_fee: 0, agreed_txn_pct: 3, agreed_txn_fee: 15, agreed_on: d(-30) };
const upcoming = { id: 71, prop_key: '21a', name: 'Priya Patel', email: 'guest@example.com', check_in: d(10), check_out: d(13), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 400, agreed_nightly: 390, agreed_txn_fee: 10, agreed_nights: 3, damages_deposit: 50, pay_token: 'tok71', balance_due_date: d(3) };
const GUEST = { id: 9, name: 'Priya Patel', email: 'guest@example.com', phone: '', address: '', postcode: '' };
const threads = [{ id: 5, guest_name: 'Debbie McGoldrick', guest_email: 'e@x.com', last_message: 'Is there a hairdryer in the cottage?', last_at: d(0) + ' 08:12:00', unread: 1, booking_id: 2 }];
function stub(page, guest) {
  return page.route(/\.php/, (route) => {
    const url = route.request().url();
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) { if (b.action === 'guest_status') return json({ ok: true, guest: guest ? GUEST : null }); return json({ ok: true, admin: false, guest: null }); }
    if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [midStay, upcoming], enquiries: [], completed_stays: 1 });
    if (url.includes('bookings.php')) { if (b.action === 'email_logs') return json({ logs: {} }); if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [] }); return json({ bookings }); }
    if (url.includes('enquiries.php')) return json({ enquiries });
    if (url.includes('messages.php')) return json({ ok: true, threads, messages: [] });
    if (url.includes('diagnostics.php')) return json({ ok: true, summary: { ok: 12, warn: 0, fail: 0 }, checks: [], mail_ready: true });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences: [], content: {}, blocks: [], ranges: [], events: [], results: [], logs: {} });
  });
}
// The effective hit region of a control: its box grown by any absolutely
// positioned ::before/::after region (the round-seven mechanism), in px.
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
    const w = box.r - box.l, h = box.b - box.t;
    out.push({ who: (el.id ? '#' + el.id : el.className.toString().split(' ')[0]) + ' “' + (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 18) + '”', min: Math.round(Math.min(w, h)) });
  }
  return out;
};
const reachOk = (name, list, floor) => {
  const bad = list.filter((x) => x.min < 44);
  ok(list.length >= floor, `${name}: ${list.length} controls measured (vacuity guard ≥${floor})`);
  ok(bad.length === 0, `${name}: every effective hit region reaches 44${bad.length ? ' — ' + bad.map((x) => x.who + ' ' + x.min).join('; ') : ''}`);
};
// No sub loses words: not clipped sideways (ellipsis), not past its two-line clamp.
const SUBS = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length && el.textContent.trim()).map((el) => ({ t: el.textContent.trim().slice(0, 40), cutW: el.scrollWidth > el.clientWidth + 1, cutH: el.scrollHeight > el.clientHeight + 1 }));
const subsOk = (name, list, floor) => {
  const bad = list.filter((s) => s.cutW || s.cutH);
  ok(list.length >= floor, `${name}: ${list.length} subs measured (vacuity guard ≥${floor})`);
  ok(bad.length === 0, `${name}: no sub loses words${bad.length ? ' — ' + bad.map((s) => '“' + s.t + '”').join('; ') : ''}`);
};

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
    await page.waitForTimeout(400);
    return page;
  };
  const open = async (page, code, ms) => { await page.evaluate((c) => eval(c), code); await page.waitForTimeout(ms || 900); };

  console.log('§1 the cottage title is the serif');
  for (const w of [390, 1280]) {
    const page = await newPage(w, false);
    await open(page, "openProperty('pimpernel')");
    const face = await page.evaluate(() => { const h = document.getElementById('prop-title'); const serif = getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim().split(',')[0].replace(/["']/g, '').trim(); return { fam: getComputedStyle(h).fontFamily, serif, edit: h.hasAttribute('data-edit-text') }; });
    ok(face.edit && face.fam.includes(face.serif), `${w}: #prop-title is owner-editable AND paints in ${face.serif} (${face.fam.split(',')[0]})`);
    // §7 the rag, on the guest side
    const rag = await page.evaluate(() => ({ p: getComputedStyle(document.querySelector('#prop-desc, .prop-feature-sub, p')).textWrap, sub: getComputedStyle(document.querySelector('.prop-feature-sub') || document.body).textWrap }));
    if (w === 390) ok(rag.p === 'pretty' && rag.sub === 'pretty', `prose and the feature subs wrap pretty (${rag.p} / ${rag.sub})`);
    if (w === 390) {
      console.log('§2 reach 44 — the picker\'s month arrows');
      await open(page, 'openEnquireModal()');
      await open(page, "(async () => { const tr = document.querySelector('#enquire-modal .date-range-trigger'); if (tr) tr.click(); })()", 1000);
      reachOk('picker arrows', await page.evaluate(REACH, '.dp-nav-btn'), 2);
      await open(page, "(async () => { try { closeDatePicker(); } catch (e) {} closeEnquireModal(); })()", 400);
      console.log('§6 the guest\'s journey is a caption · §7 the units hold');
      await open(page, "(async () => { currentGuest = { id: 9, name: 'Priya Patel', email: 'guest@example.com' }; try { setAuthUI(); } catch (e) {} nav('view-guest-bookings'); await renderGuestBookings(); })()", 1200);
      const j = await page.evaluate(() => {
        const caps = [...document.querySelectorAll('#guest-bookings-list .bkflow-cap')].map((c) => c.textContent.trim());
        const refs = [...document.querySelectorAll('#guest-bookings-list .gb2-ref')].map((r) => { const rects = r.getClientRects(); return { nowrap: getComputedStyle(r).whiteSpace === 'nowrap', lines: rects.length }; });
        const unit = document.querySelector('#guest-bookings-list .gb2-pl-unit');
        return { caps, pills: document.querySelectorAll('#guest-bookings-list .bkflow-step').length, refs, unit: unit ? { nowrap: getComputedStyle(unit).whiteSpace === 'nowrap', lines: unit.getClientRects().length, t: unit.textContent } : null, when: getComputedStyle(document.querySelector('.gb2-when')).textWrap };
      });
      ok(j.caps.length >= 2 && j.caps.every((c) => /^Next · \d of \d · (Booked|Deposit|Your details|Balance|Arrival info|Your stay|Deposit back)$/.test(c)), `every stay card carries the journey caption in the hub's grammar (${j.caps.join(' | ')})`);
      ok(j.pills === 0, 'and no pill strip remains');
      ok(j.refs.length >= 2 && j.refs.every((r) => r.nowrap && r.lines === 1), `the booking ref stays on one line with its word (${j.refs.length} refs)`);
      ok(j.unit && j.unit.nowrap && j.unit.lines === 1, `"${j.unit && j.unit.t}" is one unit beside the figure`);
      ok(j.when === 'pretty', `the when-line wraps pretty (${j.when})`);
      // §2 the footer's theme switch
      await open(page, "(async () => { document.getElementById('theme-toggle').scrollIntoView({ block: 'center' }); })()", 400);
      reachOk('theme switch', await page.evaluate(REACH, '#theme-toggle'), 1);
    }
    await page.close();
  }

  console.log('§2–§5, §8 the owner side');
  for (const w of [360, 390, 1280]) {
    const page = await newPage(w, false);
    await open(page, "(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); })()", 1500);
    if (w !== 1280) subsOk(`Today ${w}`, await page.evaluate(SUBS, '#needs-you-list .ny-sub'), 2);
    if (w === 390) reachOk('Today money pill', await page.evaluate(REACH, '.ops-owed'), 1);
    // §4 the lane
    const lane = await page.evaluate(() => {
      const l = [...document.querySelectorAll('.tl-label')].find((el) => /Jollyboat/.test(el.getAttribute('title') || ''));
      if (!l) return null;
      const painted = [...l.querySelectorAll('.tl-name, .tl-mono')].filter((s) => s.getClientRects().length).map((s) => s.textContent.trim());
      const code = [...document.querySelectorAll('.tl-label')].find((el) => /21A/.test(el.getAttribute('title') || ''));
      return { painted, aria: l.getAttribute('aria-label'), clipped: l.scrollWidth > l.clientWidth + 1, code: code ? [...code.querySelectorAll('.tl-name, .tl-mono')].filter((s) => s.getClientRects().length).map((s) => s.textContent.trim()) : null };
    });
    if (w === 1280) ok(lane && lane.painted.join('') === 'Jolly' && lane.aria === 'Jollyboat', `${w}: the lane paints the short name (${lane && lane.painted.join('')}), the full name announced`);
    else ok(lane && lane.painted.join('') === 'J' && lane.aria === 'Jollyboat' && !lane.clipped, `${w}: the lane paints the monogram (${lane && lane.painted.join('')}), nothing clipped, the full name announced`);
    if (w === 390) ok(lane && lane.code && lane.code.join('') === '21A', `${w}: a three-character code keeps its code (${lane && lane.code && lane.code.join('')})`);
    // §5 the rail, §8 the caption
    const rows = await page.evaluate(() => ({ rails: [...document.querySelectorAll('#bookings-list .bk-row')].map((r) => getComputedStyle(r).borderLeftColor), chips: document.querySelectorAll('#bookings-list .bk-row .prop-tag').length, sum: (document.getElementById('bookings-summary') || {}).textContent || '' }));
    ok(rows.rails.length >= 2 && rows.rails.every((c) => /rgba\(.*,\s*0\)|transparent/.test(c)) && rows.chips >= 2, `${w}: the bookings rows carry no coloured rail (${rows.rails[0]}), the state is the chip`);
    ok(/^· \d+ upcoming$/.test(rows.sum.trim()), `${w}: the caption reads "${rows.sum.trim()}"`);
    // §2 + §8 the hub's guest details
    await open(page, "(async () => { await openBookingHub('b3'); bhubFoldToggle('guest'); })()", 1200);
    if (w === 390) reachOk('hub contact links', await page.evaluate(REACH, '#booking-hub-content .bhub-kv-act, #booking-hub-content .bhub-kv a'), 2);
    const kv = await page.evaluate(() => { const l = document.querySelector('#booking-hub-content .bhub-kv-label'); const cs = getComputedStyle(l); return { tt: cs.textTransform, fs: Math.round(parseFloat(cs.fontSize)), t: l.textContent.trim() }; });
    if (w === 390) ok(kv.tt === 'none' && kv.fs === 13 && /^[A-Z][a-z]/.test(kv.t), `the guest-detail labels read sentence case at 13px (“${kv.t}”, ${kv.fs}px)`);
    // §3 the enquiry hub, the inbox and the search rows
    if (w !== 1280) {
      await open(page, "(async () => { await openEnquiryHub(11); })()", 1200);
      subsOk(`enquiry hub ${w}`, await page.evaluate(SUBS, '#enquiry-hub-content .bhub-fold-sub'), 1);
      await open(page, "(async () => { await openInbox(); })()", 1000);
      subsOk(`inbox ${w}`, await page.evaluate(SUBS, '#inbox-landing .bhub-fold-sub'), 2);
      await open(page, "(async () => { openCmdK(); })()", 900);
      await open(page, "(async () => { const i = document.getElementById('cmdk-input'); if (i) { i.value = 'who owes me money'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()", 1200);
      subsOk(`search rows ${w}`, await page.evaluate(SUBS, '#cmdk .cmdk-row-sub'), 3);
      if (w === 390) reachOk('search chrome', await page.evaluate(REACH, '#cmdk-clear, #cmdk-pin, #cmdk-close, #cmdk-help, #cmdk .cmdk-chip, #cmdk .cmdk-scope'), 6);
      await open(page, "(async () => { closeCmdK(); })()", 300);
    }
    if (w === 390) {
      await open(page, "(async () => { await openArea('settings'); settingsOpen('payments'); })()", 1200);
      reachOk('deposit stepper', await page.evaluate(REACH, '.acr-step button'), 2);
    }
    await page.close();
  }
  console.log(fails.length ? `\n  ${fails.length} ROUND-EIGHT CHECK(S) FAILED ❌` : '\n  ROUND-EIGHT SUITE PASSED ✅');
  await t.done(fails.length);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
