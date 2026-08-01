// THE ADD/EDIT BOOKING FORM'S REDESIGN, driven in a real browser.
//
// The form went from one flat ~2,100px column to four named sections with the
// availability calendar folded to a summary strip, the rare controls behind a
// single More-options row, and a sticky footer whose figure MIRRORS the price
// box. Every check here is about the things that redesign must keep true:
// the sections stand in order, the strip tells the truth both ways (free and
// overlapping), the fold opens and resets, the footer's number can never
// disagree with the box it mirrors, and a fresh open always starts folded.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
  const json = (route, o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const mk = (id, over = {}) => Object.assign({
    id, prop_key: '21a', name: 'Booked Guest', email: 'g@gmail.com', phone: '',
    check_in: d(90), check_out: d(93), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, notes: '', payment: 'unpaid', deposit_paid: 0,
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
    agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30) + ' 12:00:00',
    damages_deposit: 50, created_at: d(-30) + ' 12:00:00',
  }, over);
  const rows = [mk(1)];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST') return json(route, { ok: true });
    if (url.includes('auth.php')) return json(route, { admin: true, admin_id: 1 });
    if (url.includes('bookings.php')) return json(route, { bookings: rows });
    if (url.includes('rates.php')) return json(route, { properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json(route, { ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);

  // ---------- 1. the sectioned form ----------
  console.log('1. sections');
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => ({
    secs: Array.from(document.querySelectorAll('#edit-modal .modal-sec')).map((s) => s.textContent.trim()),
    xUp: (() => { const x = document.querySelector('#edit-modal .modal-x'); const r = x ? x.getBoundingClientRect() : { width: 0, height: 0 }; return r.width >= 24 && r.height >= 24; })(),
    nameLabel: (document.querySelector('label[for="modal-name"]') || {}).textContent || '',
  }));
  ok(s1.secs.join('|') === 'Guest|Stay|Money|Notes', `four sections in order (${s1.secs.join('|')})`);
  ok(s1.xUp, 'the ✕ close is in the header at ≥24px');
  ok(s1.nameLabel === 'Name', `the name label stopped repeating the section (${s1.nameLabel})`);

  // ---------- 2. the availability strip tells the truth both ways ----------
  console.log('2. availability strip');
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(30), co: d(33) });
  await page.waitForTimeout(200);
  const s2 = await page.evaluate(() => ({
    txt: (document.querySelector('.mav-strip-txt') || {}).textContent || '',
    clashDot: !!document.querySelector('.mav-strip-dot.is-clash'),
    dot: !!document.querySelector('.mav-strip-dot'),
    gridUp: !!document.querySelector('#modal-availability .mav-grid'),
  }));
  ok(/^Free /.test(s2.txt) && s2.dot && !s2.clashDot, `free dates → green summary (${s2.txt.slice(0, 40)})`);
  ok(/next booking starts/.test(s2.txt), 'and it names when the next booking starts');
  ok(!s2.gridUp, 'the grid stays folded until asked for');
  await page.click('.mav-toggle');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !!document.querySelector('#modal-availability .mav-grid')), 'Calendar opens the six-week grid');
  await page.click('.mav-toggle');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.querySelector('#modal-availability .mav-grid')), 'and closes it again');
  // Overlapping dates: the strip flips to the clash face and the warning renders.
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(91), co: d(94) });
  await page.waitForTimeout(200);
  const s2b = await page.evaluate(() => ({
    txt: (document.querySelector('.mav-strip-txt') || {}).textContent || '',
    clashDot: !!document.querySelector('.mav-strip-dot.is-clash'),
    warn: (document.querySelector('.mav-clash') || {}).textContent || '',
  }));
  ok(/^Overlaps Booked Guest/.test(s2b.txt) && s2b.clashDot, `overlapping dates → red summary naming the blocker (${s2b.txt.slice(0, 40)})`);
  ok(/confirm at save/.test(s2b.warn), 'and the confirm-at-save warning renders with it');

  // ---------- 3. the money controls display all the time ----------
  // The fold was tried and REMOVED at the owner's ask ("display these items
  // all the time") — no summary row, nothing behind a disclosure. Times live
  // in Stay; deposit/override/plan under Money, always painted.
  console.log('3. always-visible controls');
  const s3 = await page.evaluate(() => ({
    fold: !!document.querySelector('#edit-modal details'),
    visible: ['modal-checkin-time', 'modal-damages-deposit', 'modal-price-override', 'modal-plan-seg']
      .every((id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; }),
    depLabel: (document.querySelector('label[for="modal-damages-deposit"]') || {}).textContent || '',
    hints: document.querySelectorAll('#modal-deposit-group .modal-hint, #modal-override-group .modal-hint, #modal-plan-group .modal-hint').length,
  }));
  ok(!s3.fold, 'no disclosure fold anywhere in the modal');
  ok(s3.visible, 'times, deposit, override and the plan toggle all paint without a tap');
  ok(s3.depLabel === 'Refundable damages deposit (£)' && s3.hints >= 3,
    `the shouted labels stay short label + quiet hint (${s3.hints} hints)`);
  // The plan is a Standard | Custom TOGGLE: Standard states the LIVE site
  // terms in a sentence and hides the fields; Custom reveals them; flipping
  // back WIPES what was typed.
  const t1 = await page.evaluate(() => ({
    stdOn: document.getElementById('modal-plan-std-btn').classList.contains('is-on'),
    pressed: document.getElementById('modal-plan-std-btn').getAttribute('aria-pressed') === 'true',
    fieldsHidden: document.getElementById('modal-plan-custom').style.display === 'none',
    line: (document.getElementById('modal-plan-std-line') || {}).textContent || '',
  }));
  ok(t1.stdOn && t1.pressed && t1.fieldsHidden, 'the plan opens on Standard, fields folded');
  ok(/25% deposit/.test(t1.line) && /30 days/.test(t1.line), `the Standard line quotes the live site terms (${t1.line.slice(0, 50)})`);
  await page.click('#modal-plan-custom-btn');
  const t2 = await page.evaluate(() => ({
    on: document.getElementById('modal-plan-custom-btn').classList.contains('is-on'),
    fieldsUp: document.getElementById('modal-plan-custom').style.display !== 'none',
  }));
  ok(t2.on && t2.fieldsUp, 'Custom reveals the fields');
  await page.evaluate(() => { document.getElementById('modal-plan-pct').value = '40'; });
  await page.click('#modal-plan-std-btn');
  const t3 = await page.evaluate(() => ({
    hidden: document.getElementById('modal-plan-custom').style.display === 'none',
    wiped: document.getElementById('modal-plan-pct').value === '',
  }));
  ok(t3.hidden && t3.wiped, 'flipping back to Standard WIPES the typed plan — it can never ship silently');
  // iOS draws an EMPTY date input SHORTER than its siblings (no text to size
  // the line box) — owner's screenshot: Balance due by against Deposit %.
  // Chromium cannot reproduce the collapse, so this asserts the pinning RULE
  // via CSSOM (the reduced-motion precedent: a computed read passes with the
  // rule deleted); the WebKit layout leg sees the real paint.
  const datePin = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.selectorText && r.selectorText.includes('input[type="date"].input-glass') && r.style && r.style.minHeight) return r.style.minHeight;
      }
    }
    return '';
  });
  ok(/calc\(/.test(datePin), `the empty-date height pin stands in the stylesheet (${datePin})`);

  // ---------- 4. the sticky footer mirrors the price box ----------
  console.log('4. sticky footer');
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(30), co: d(33) });
  await page.waitForTimeout(200);
  const s4 = await page.evaluate(() => {
    const boxAmt = (document.querySelector('#modal-price-box .price-row.total .price-amount') || {}).textContent || '';
    const footFig = (document.getElementById('modal-foot-fig') || {}).textContent || '';
    const box = document.querySelector('#edit-modal .modal-box');
    box.scrollTop = 0; // the top of the form — where the sticky claim matters
    const foot = document.querySelector('.modal-foot');
    const fr = foot.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const save = document.getElementById('modal-save-btn').getBoundingClientRect();
    return { boxAmt, footFig, onScreen: fr.bottom <= br.bottom + 1 && fr.top < window.innerHeight, saveH: save.height };
  });
  ok(s4.boxAmt !== '' && s4.footFig === s4.boxAmt, `the footer MIRRORS the box's total (${s4.footFig})`);
  ok(s4.onScreen, 'the footer is on screen with the form scrolled to the top (sticky)');
  ok(s4.saveH >= 44, `Save meets the touch floor (${Math.round(s4.saveH)}px)`);
  // THE FIGURE NEVER CLIPS (the bhub-sticky rule). Two halves, both from the
  // owner's live screenshot: the foot must start at the box's CONTENT edge
  // (the old -35px bleed overhung the phone's 22px padding and cut "£440.00"
  // to "£6"), and a hostile-length figure squeezes SAVE, never itself.
  const s4b = await page.evaluate(() => {
    const box = document.querySelector('#edit-modal .modal-box');
    const foot = document.querySelector('.modal-foot');
    const padL = parseFloat(getComputedStyle(box).paddingLeft);
    const inEdge = foot.getBoundingClientRect().left >= box.getBoundingClientRect().left + padL - 1;
    const fig = document.getElementById('modal-foot-fig');
    fig.textContent = '£123,456.00'; // hostile figure (the §14 injection discipline)
    const fr = fig.getBoundingClientRect();
    const noClip = Math.ceil(fr.width) >= fig.scrollWidth - 1 && fr.right <= document.getElementById('modal-save-btn').getBoundingClientRect().left + 1;
    fig.textContent = '£440.00';
    return { inEdge, noClip };
  });
  ok(s4b.inEdge, 'the foot starts at the content edge — no bleed past the phone padding');
  ok(s4b.noClip, 'a hostile-length figure squeezes Save, never itself');
  // ONE visible name for the notes field: the section cap carries the words,
  // the label goes .sr-only (announced, not doubled on screen).
  const s4c = await page.evaluate(() => {
    const lbl = document.querySelector('label[for="modal-notes"]');
    const r = lbl.getBoundingClientRect();
    return { hidden: r.width <= 1 && r.height <= 1, named: lbl.textContent.trim().length > 0 };
  });
  ok(s4c.hidden && s4c.named, 'the notes label is announced but not doubled under the Notes cap');
  // Invalid dates → the mirror goes honest, never stale.
  await page.evaluate(() => {
    document.getElementById('modal-checkin').value = '';
    document.getElementById('modal-checkout').value = '';
    updateModalPrice();
  });
  ok(await page.evaluate(() => (document.getElementById('modal-foot-fig') || {}).textContent === '—'),
    'no computable total → the footer shows a dash, not the last number');

  // ---------- 5. a fresh open resets ----------
  console.log('5. fresh-open reset');
  await page.evaluate(() => {
    mavToggle();
    closeModal();
  });
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(250);
  const s5 = await page.evaluate(() => !document.querySelector('#modal-availability .mav-grid'));
  ok(s5, 'reopening starts with the availability calendar folded to its strip');
  // The ✕ goes through the dispatcher and actually closes.
  await page.click('#edit-modal .modal-x');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.getElementById('edit-modal').classList.contains('open')),
    'the header ✕ closes the modal');

  // ---------- 6. desktop uses the width ----------
  console.log('6. desktop two-column');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(300);
  const s6 = await page.evaluate(() => {
    const cols = document.querySelector('#edit-modal .modal-cols');
    const tracks = getComputedStyle(cols).gridTemplateColumns.split(' ').length;
    const w = document.querySelector('#edit-modal .modal-box').getBoundingClientRect().width;
    return { tracks, w };
  });
  ok(s6.tracks === 2 && s6.w > 700, `Guest and Stay sit side by side in a wide box (${s6.tracks} tracks, ${Math.round(s6.w)}px)`);

  // ---------- 7. custom-property mode stands the mirror down ----------
  console.log('7. custom-property mode');
  await page.evaluate(() => {
    document.getElementById('modal-property').value = '__new__';
    applyModalPropertyMode();
  });
  const s7 = await page.evaluate(() => ({
    totalHidden: getComputedStyle(document.getElementById('modal-foot-total')).display === 'none',
    saveLabel: document.getElementById('modal-save-btn').textContent,
  }));
  ok(s7.totalHidden && /Next/.test(s7.saveLabel), `new-property flow hides the total and relabels Save (${s7.saveLabel})`);
  await page.evaluate(() => closeModal());

  await done(fails);
})().catch((e) => { console.error(e); process.exit(1); });
