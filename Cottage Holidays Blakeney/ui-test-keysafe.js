// THE KEY SAFE KEEPER, in a real browser against a stubbed keysafe.php:
//  §1 the key is in the dock and opens its own page
//  §2 the page states the record: code, who it's set for, what the guest sees
//  §3 the rotate flow — a fresh code offered, junk refused, and ONLY the
//     confirm posts (with an op_id); the card flips to "code on the safe ✓"
//  §4 the rotation DUTY on Needs-you — red when the next guest's reveal
//     window is open, gone once the safe is confirmed
//  §5 the offline shape: the day sheet's duty wiring, and a dead-link capture
//     queues the confirm exactly once (one op_id across every attempt)
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  // Hannah left this morning (her code is still on the safe); Marcus arrives
  // TOMORROW — inside the 2-day reveal window, so the duty must be red.
  const BOOKINGS = [
    { id: 1, prop_key: '21a', name: 'Hannah Whitlock', email: 'h@x.co', phone: '', address: '', postcode: '', check_in: d(-5), check_out: d(0), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-9), agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '' },
    { id: 2, prop_key: '21a', name: 'Marcus Ellery', email: 'm@x.co', phone: '', address: '', postcode: '', check_in: d(1), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-9), agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '' },
  ];
  // The stubbed safe records: 21a still set for HANNAH (booking 1);
  // jollyboat never recorded — its next stay is an AIRBNB import.
  let SAFE = { code: '9265', setAt: d(-8) + 'T09:00:00Z', forBooking: 1, forStay: 'b:1', history: [{ code: '3074', setAt: d(-15) + 'T09:00:00Z', forBooking: 0, forStay: '', guest: 'Priya Raman' }], name: '21A Westgate' };
  let SAFE_JB = { code: '', setAt: '', forBooking: 0, forStay: '', history: [], name: 'Jollyboat' };
  const confirms = []; // every confirm POST the wire sees
  let apiDead = false;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(post || '{}'); } catch (e) {}
    if (url.includes('keysafe.php') && b.action === 'confirm') confirms.push(b);
    if (apiDead) return route.abort();
    if (url.includes('keysafe.php')) {
      if (b.action === 'state') return json({ ok: true, safes: { '21a': SAFE, 'jollyboat': SAFE_JB }, revealDays: 2 });
      if (b.action === 'set_enabled') {
        if (b.prop_key === 'jollyboat') { SAFE_JB = Object.assign({}, SAFE_JB, { enabled: !!b.enabled }); return json({ ok: true, safe: SAFE_JB }); }
        SAFE = Object.assign({}, SAFE, { enabled: !!b.enabled }); return json({ ok: true, safe: SAFE });
      }
      if (b.action === 'confirm') {
        const upd = (r) => Object.assign({}, r, { code: b.code, setAt: new Date().toISOString(), forBooking: b.booking_id, forStay: b.stay_ref || '', history: (r.code ? [{ code: r.code, setAt: r.setAt, forBooking: r.forBooking, forStay: r.forStay || '', guest: r.forBooking === 1 ? 'Hannah Whitlock' : '' }] : []).concat(r.history) });
        if (b.prop_key === 'jollyboat') { SAFE_JB = upd(SAFE_JB); return json({ ok: true, safe: SAFE_JB }); }
        SAFE = upd(SAFE); return json({ ok: true, safe: SAFE });
      }
    }
    if (url.includes('ical-import.php')) return json({ ok: true, blocks: [{ id: 900, prop_key: 'jollyboat', source: 'airbnb', check_in: d(1), check_out: d(4) }] });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }, { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 140, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 }], seasons: {}, occupancy: {} });
    if (url.includes('bookings.php')) {
      if (b.action === 'email_logs') return json({ ok: true, logs: {} });
      if (b.action === 'history') return json({ ok: true, history: [] });
      return json({ bookings: BOOKINGS });
    }
    return json({ ok: true, bookings: BOOKINGS, enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(800);
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForTimeout(1600);

  console.log('§1 the key in the dock, the page behind it');
  const dockKey = page.locator('.admin-dock-btn[data-view="view-keysafe"]');
  ok(await dockKey.count() === 1, 'the dock carries a Key safes button');
  ok((await dockKey.getAttribute('aria-label')) === 'Key safes', '…named, not just an icon');
  await dockKey.click();
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => document.getElementById('view-keysafe').classList.contains('active')), 'tapping it lands on the key safe page');

  console.log('§2 the page states the record');
  const body = await page.evaluate(() => document.getElementById('keysafe-body').textContent);
  ok(/9265/.test(body), 'the current code is stated');
  ok(/Hannah Whitlock/.test(body) || /for Hannah/.test(body), '…and who the safe is set for');
  ok(/Marcus Ellery/.test(body), 'the next guest is named');
  ok(/no code set for them/.test(body), '…with the honest state: no code on the safe for them yet');
  ok(/nowhere yet — the code appears only after you confirm/.test(body), 'and the guest-visibility line says the reveal waits on the confirm');
  ok(/Priya Raman/.test(await page.evaluate(() => { const dt = document.querySelector('#keysafe-body details'); dt.open = true; return dt.textContent; })), 'the history names who had which code');

  console.log('§2b the fold anatomy — verdicts first, exceptions hoisted');
  const anat = await page.evaluate(() => {
    const host = document.getElementById('keysafe-body');
    const caps = [...host.querySelectorAll('.bhub-grpcap')].map((c) => c.textContent.trim());
    const attnCapIdx = caps.indexOf('Needs attention');
    const due = host.querySelector('.ks-card');
    return {
      pulse: (host.querySelector('.mo-pulse') || {}).textContent || '',
      caps,
      // Marcus arrives inside the window with no code set — 21A must be the
      // EXCEPTION, hoisted above "The safes" with the red warning capsule.
      dueIs21a: !!(due && /21A/.test(due.textContent)),
      dueBad: !!(due && due.querySelector('.st-cap.is-bad .st-wic')),
      dueBefore: attnCapIdx === 0,
      foldClosed: !!(due && due.querySelector('.bhub-fold') && due.querySelector('.bhub-fold').hidden),
    };
  });
  ok(/needs? a new code/.test(anat.pulse), `the pulse states the day's work (${anat.pulse})`);
  ok(anat.dueBefore && anat.caps.includes('The safes'), `the due safe hoists above The safes (${anat.caps.join(' / ')})`);
  ok(anat.dueIs21a && anat.dueBad, 'the exception wears the red warning capsule');
  ok(anat.foldClosed, 'the record folds — the verdict is the row');
  const foldRt = await page.evaluate(() => {
    bhubFoldToggle('ks-21a');
    const open = !document.getElementById('bhub-fold-ks-21a').hidden
      && !!document.querySelector('#bhub-fold-ks-21a .ks-code');
    bhubFoldToggle('ks-21a');
    return { open, closed: document.getElementById('bhub-fold-ks-21a').hidden };
  });
  ok(foldRt.open && foldRt.closed, 'the fold opens onto the code and closes again');

  // Folds decide VISIBILITY: a real click on Rotate needs its cottage's fold
  // open (the way an owner reaches it). Idempotent — never closes an open one.
  const openKsFold = (pk) => page.evaluate((k) => { const f = document.getElementById('bhub-fold-ks-' + k); if (f && f.hidden) bhubFoldToggle('ks-' + k); }, pk);
  console.log('§3 the rotate flow');
  await openKsFold('21a');
  await page.locator('.ks-card', { hasText: '21A' }).locator('button', { hasText: 'Rotate the code' }).click();
  await page.waitForTimeout(400);
  const pre = await page.evaluate(() => (document.getElementById('gdf-code') || {}).value || '');
  ok(/^\d{4}$/.test(pre), 'a fresh 4-digit code is filled in (' + pre + ')');
  ok(await page.evaluate((c) => !keysafeBad(c), pre), '…and it is never junk');
  // Junk typed by hand is refused, and NOTHING was posted.
  await page.evaluate(() => { document.getElementById('gdf-code').value = '1234'; });
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => (document.getElementById('glass-dialog-msg') || {}).textContent || ''), '(fixture) an alert answered');
  ok(confirms.length === 0, 'a junk code posts NOTHING — the refusal happens before the wire');
  await page.evaluate(() => glassDialogResolve(true));
  await page.waitForTimeout(300);
  // The real rotation: overtype a chosen code, confirm.
  await openKsFold('21a');
  await page.locator('.ks-card', { hasText: '21A' }).locator('button', { hasText: 'Rotate the code' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('gdf-code').value = '4826'; });
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(900);
  ok(confirms.length === 1 && confirms[0].code === '4826' && confirms[0].booking_id === 2, 'the confirm posts the code FOR the next booking');
  ok(typeof confirms[0].op_id === 'string' && confirms[0].op_id.length > 6, '…stamped with an op_id (the offline replay contract)');
  const body2 = await page.evaluate(() => document.getElementById('keysafe-body').textContent);
  ok(/4826/.test(body2) && /Code on the safe/.test(body2), 'the card flips: 4826, on the safe for Marcus');
  ok(/on their booking page now|on their booking page from/.test(body2), '…and says where (and when) Marcus sees it');
  // The sees-it value is a SENTENCE, and a sentence right-aligned beside a
  // wrapping label read as broken (owner screenshot) — the row stacks.
  ok((await page.evaluate(() => { const el = document.querySelector('.ks-kv.ks-prose'); return el ? getComputedStyle(el).flexDirection : 'missing'; })) === 'column',
    'the sees-it prose row stacks under its label instead of ragged right-alignment');
  ok(/Hannah Whitlock/.test(await page.evaluate(() => { const dt = document.querySelector('#keysafe-body details'); dt.open = true; return dt.textContent; })), 'the superseded code joined the history under Hannah’s name');

  console.log('§4 the rotation duty on Needs-you');
  // Reset the record to "still Hannah's" and reload the mirror: the duty fires.
  SAFE = { code: '9265', setAt: d(-8) + 'T09:00:00Z', forBooking: 1, history: [], name: '21A Westgate' };
  await page.evaluate(async () => { __keysafe = null; await keysafeLoad(); });
  // scoped to 21A — jollyboat's unrotated Airbnb stay legitimately mints its own (§6)
  const duties = await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /21A/.test(x.label)));
  const duty0 = duties[0] || {};
  ok(duties.length === 1, 'one rotation duty for the cottage');
  ok(duty0.sev === 'danger', '…RED — Marcus arrives tomorrow, his reveal window is open and empty');
  ok(/Rotate 21A/.test(duty0.label || '') && /Marcus Ellery/.test(duty0.sub || ''), 'it names the cottage and the guest');
  await page.evaluate(async () => { await openBookings(); renderNeedsYou(); });
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => /Rotate 21A/.test((document.getElementById('needs-you-list') || {}).textContent || '')), 'and it renders on Today’s strip');
  // Confirmed for Marcus → the duty stands down (never nags a done job).
  await page.evaluate(() => { __keysafe['21a'] = Object.assign({}, __keysafe['21a'], { code: '4826', forBooking: 2 }); });
  ok(await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /21A/.test(x.label)).length) === 0, 'once the safe is set for him, the duty is gone');
  // …and no mirror means NO duty — never a duty from ignorance.
  ok(await page.evaluate(() => { const keep = __keysafe; __keysafe = null; const n = chbDuties().filter((x) => x.kind === 'keysafe').length; __keysafe = keep; return n; }) === 0, 'an unloaded mirror mints no duty');

  console.log('§5 the offline shape');
  // (a) the day sheet's duty wiring: a row arriving today whose booking the
  // safe isn't set for → a keysafe duty routed to the CAPTURE.
  const sheetDuty = await page.evaluate(() => {
    __keysafe = { '21a': { code: '9265', forBooking: 1, history: [], name: '21A Westgate' } };
    const rows = [{ pk: '21a', cot: '21A Westgate', dbId: 2, nm: 'Marcus Ellery', ci: (window.todayDashed)(), co: '', due: 0, dep: 0 }];
    return odsDutiesHtml(rows);
  });
  ok(/Rotate 21A Westgate’s key safe/.test(sheetDuty) && /odsKeysafe/.test(sheetDuty), 'the sheet mints the duty and routes it to the offline capture');
  ok(/ny-danger/.test(sheetDuty), '…red on arrival day');
  ok(await page.evaluate(() => { const rows = [{ pk: '21a', cot: '21A', dbId: 1, nm: 'Hannah', ci: (window.todayDashed)(), co: '', due: 0, dep: 0 }]; return !/key safe/.test(odsDutiesHtml(rows)); }), 'a row the safe IS set for mints nothing');
  // (b) the capture queues the confirm EXACTLY once — one op_id, however many
  // wire attempts a dead link produces.
  apiDead = true;
  confirms.length = 0;
  // NOT awaited — odsKeysafe resolves only when its dialog is answered, and
  // the next lines are what answer it (awaiting would deadlock the suite).
  page.evaluate(() => odsKeysafe('21a')).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById('gdf-code').value = '5917'; });
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => oqFlush());
  await page.waitForTimeout(1200);
  const ids = [...new Set(confirms.map((c) => c.op_id))];
  ok(confirms.length >= 1 && ids.length === 1, `every wire attempt carries ONE op_id (${confirms.length} attempt(s), ${ids.length} id) — the ledger's exactly-once contract`);
  ok(await page.evaluate(() => (__keysafe['21a'] || {}).code === '5917'), 'the local mirror updated at once — the sheet stops nagging before the signal returns');
  apiDead = false;

  console.log('§6 a platform stay rotates too — identified by ref, told via the platform');
  apiDead = false;
  await page.evaluate(async () => { __keysafe = null; await keysafeLoad(); await openKeysafe(); });
  await page.waitForTimeout(900);
  const jb = await page.evaluate(() => document.getElementById('keysafe-body').textContent);
  ok(/Airbnb guest/.test(jb), 'the Airbnb stay is the jollyboat card\'s next guest — external bookings count');
  ok(/share it in your Airbnb message thread/.test(jb), '…and the reveal line is honest: platform guests don\'t see this site, share it in the thread');
  const otaDuty = await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /Jollyboat/.test(x.label))[0] || null);
  ok(!!otaDuty && otaDuty.sev === 'danger', 'the rotation duty fires for the platform stay (red — they arrive tomorrow)');
  confirms.length = 0;
  const jbCard = page.locator('.ks-card', { hasText: 'Jollyboat' });
  await openKsFold('jollyboat');
  await jbCard.locator('button', { hasText: 'Rotate the code' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('gdf-code').value = '6183'; });
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(900);
  ok(confirms.length === 1 && confirms[0].booking_id === 0 && confirms[0].stay_ref === 'o:' + d(1),
    `the confirm identifies the stay by ref, not a booking id (${confirms[0] && confirms[0].stay_ref})`);
  ok(await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /Jollyboat/.test(x.label)).length) === 0,
    'and once the safe is set for them, the duty is gone');
  ok(await page.evaluate(() => { const c = [...document.querySelectorAll('.ks-card')].find((x) => /Jollyboat/.test(x.textContent)); return !!(c && /Code on the safe/.test(c.textContent) && c.querySelector('.st-cap.is-ok .st-tick')); }),
    'the card flips — the platform stay wears the same ✓ capsule a direct one does');

  console.log('§7 the per-cottage switch (Settings → cottage → Private notes)');
  // Reset 21a to "rotation pending" so the duty is live, then switch OFF.
  SAFE = { code: '9265', setAt: d(-8) + 'T09:00:00Z', forBooking: 1, forStay: 'b:1', history: [], name: '21A Westgate', enabled: true };
  await page.evaluate(async () => { __keysafe = null; await keysafeLoad(); });
  ok(await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /21A/.test(x.label)).length) === 1, '(fixture) the rotation duty is live');
  // The REAL settings checkbox drives the switch (openArea → accommodations
  // index → the cottage → Private notes, the poorsignal §9d idiom).
  // openArea's post-load repaint re-shows the INDEX, so drilling in the same
  // breath gets undone — open, let it settle, then drill (what a thumb does).
  await page.evaluate(async () => { await openArea(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { settingsOpen('accom'); settingsOpenAccom('21a'); settingsOpenAccomSec('21a', 'opsnotes'); });
  await page.waitForTimeout(500);
  const cb = page.locator('#ks-toggle-21a');
  // The keeper control is an on/off SWITCH now (owner-asked): the real
  // checkbox stays on top at full size, the track underneath draws the state.
  const sw = await page.evaluate(() => {
    const inp = document.getElementById('ks-toggle-21a');
    const wrap = inp && inp.closest('.chb-switch');
    const track = wrap && wrap.querySelector('.chb-switch-track');
    const ir = inp ? inp.getBoundingClientRect() : null;
    return { track: !!track, covers: !!(ir && wrap && ir.width >= 40 && ir.height >= 24) };
  });
  ok(sw.track && sw.covers, 'the keeper is a switch — track drawn, the real checkbox covering it');
  ok(await cb.isChecked(), 'the Private-notes section carries the keeper toggle, ON by default');
  await cb.click();
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => (__keysafe['21a'] || {}).enabled === false), 'unticking it turns the keeper OFF for that cottage');
  ok(await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /21A/.test(x.label)).length) === 0, '…and the rotation duty stands down');
  ok(await page.evaluate(() => {
    const rows = [{ pk: '21a', cot: '21A', dbId: 2, nm: 'Marcus', ci: (window.todayDashed)(), co: '', due: 0, dep: 0 }];
    return !/key safe/i.test(odsDutiesHtml(rows));
  }), 'the offline sheet mints nothing for it either');
  await page.evaluate(async () => { await openKeysafe(); });
  await page.waitForTimeout(700);
  const pageTxt = await page.evaluate(() => document.getElementById('keysafe-body').textContent);
  ok(!/21A Westgate/.test(pageTxt) && !/9265/.test(pageTxt), 'a switched-off cottage is HIDDEN from the key screen — no card, no code, no footnote');
  ok(/Jollyboat/.test(pageTxt), '…while the cottages still on keep their cards');
  // The way back on is the Settings checkbox — tick it and the card returns.
  await page.evaluate(async () => { await openArea(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { settingsOpen('accom'); settingsOpenAccom('21a'); settingsOpenAccomSec('21a', 'opsnotes'); });
  await page.waitForTimeout(500);
  await page.locator('#ks-toggle-21a').click();
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => (__keysafe['21a'] || {}).enabled !== false), 'ticking the Settings box turns it back on');
  ok(await page.evaluate(() => chbDuties().filter((x) => x.kind === 'keysafe' && /21A/.test(x.label)).length) === 1, '…duty and all — the record was kept, not erased');
  await page.evaluate(async () => { await openKeysafe(); });
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => /21A Westgate/.test(document.getElementById('keysafe-body').textContent)), 'and its card is back on the key screen');

  console.log('§8 the audit pins — who "next" is, and the switch tells the truth');
  // Pure keysafeNextBooking logic on a scratch cottage (mutate the const
  // stores, never reassign — the dbBlocks lesson).
  const nx = await page.evaluate(() => {
    const t = (window.todayDashed)();
    const sh = (n) => ukShiftDays(t, n);
    const out = {};
    dbBookings.scratch = [
      { dbId: 71, name: 'Leaver', checkIn: sh(-3), checkOut: t },      // out this morning
      { dbId: 72, name: 'Arriver', checkIn: t, checkOut: sh(3) },      // in this afternoon
    ];
    dbBlocks.scratch = [];
    out.changeover = (keysafeNextBooking('scratch') || {}).name;       // must be the ARRIVER
    dbBookings.scratch = [
      { dbId: 73, name: 'InResidence', checkIn: sh(-1), checkOut: sh(2) },
      { dbId: 74, name: 'Tomorrow Guest', checkIn: sh(1), checkOut: sh(4) },
    ];
    out.midstay = (keysafeNextBooking('scratch') || {}).name;          // must be the guest IN the cottage
    // …and with their code on the safe, NO duty may fire (never rotate a
    // safe out from under a guest mid-stay).
    __keysafe.scratch = { code: '5917', setAt: '', forBooking: 73, forStay: 'b:73', enabled: true, history: [], name: 'Scratch' };
    out.midstayDuty = chbDuties().filter((x) => x.kind === 'keysafe' && /Scratch|scratch/.test(x.label)).length;
    // an OTA stay IN RESIDENCE outranks a later direct arrival
    dbBookings.scratch = [{ dbId: 75, name: 'Later Direct', checkIn: sh(5), checkOut: sh(8) }];
    dbBlocks.scratch = [{ id: 1, source: 'vrbo', checkIn: sh(-1), checkOut: sh(2) }];
    out.otaFirst = (keysafeNextBooking('scratch') || {}).name;         // must be the Vrbo guest
    delete dbBookings.scratch; delete dbBlocks.scratch; delete __keysafe.scratch;
    return out;
  });
  ok(nx.changeover === 'Arriver', `changeover day: the leaver never outranks the arriver (${nx.changeover})`);
  ok(nx.midstay === 'InResidence', `mid-stay: the guest IN the cottage is who the safe serves (${nx.midstay})`);
  ok(nx.midstayDuty === 0, 'and with their code on the safe there is NO duty — never rotate under a mid-stay guest');
  ok(nx.otaFirst === 'Vrbo guest', `an in-residence platform stay outranks a later direct arrival (${nx.otaFirst})`);
  // The switch tells the truth on a FAILED save: the checkbox goes back with
  // the words, and the mirror never moved.
  await page.evaluate(async () => { await openArea(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { settingsOpen('accom'); settingsOpenAccom('21a'); settingsOpenAccomSec('21a', 'opsnotes'); });
  await page.waitForTimeout(500);
  apiDead = true;
  await page.locator('#ks-toggle-21a').click();
  await page.waitForTimeout(900);
  await page.evaluate(() => glassDialogResolve(true)); // dismiss the failure alert
  await page.waitForTimeout(300);
  ok(await page.locator('#ks-toggle-21a').isChecked(), 'a failed save puts the checkbox BACK — the box never tells a state the record doesn’t hold');
  ok(await page.evaluate(() => (__keysafe['21a'] || {}).enabled !== false), '…and the mirror never moved');
  apiDead = false;

  console.log(fails ? `\n${fails} CHECK(S) FAILED ❌` : '\nKEYSAFE UI PASSED ✅');
  await done(fails);
})();
