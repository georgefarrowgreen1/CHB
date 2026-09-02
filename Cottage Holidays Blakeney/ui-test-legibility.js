// WORDS THE OWNER CAN ACTUALLY READ — three repairs found by driving twenty
// admin screens and measuring what the other gates structurally cannot see
// (layout-test measures overflow past the viewport, a11y-test measures
// contrast, targets and names; none of them measure COLLISION or TRUNCATION).
//
//  §1 THE TIMELINE'S MONTH LABELS never overlap. `.tl-day b` is absolute +
//     nowrap inside a 32–38px column, so "Aug 2026" (59px) runs across its
//     neighbours. tlStartOffset() is -2 from TODAY, so on the 1st and 2nd of a
//     month the i===0 label and the month-start label were a column apart and
//     painted on top of each other — a MONTHLY recurrence, which is why the
//     clock is pinned below rather than left to the run date.
//  §2 NO SUMMARY SUB IS CUT OFF on a phone. `.bhub-fold-sub` is nowrap +
//     ellipsis and the right rail takes the figure, so the sentence was being
//     cut mid-word — measured, up to 51% of the words lost at 360px.
//  §3 A SETTINGS ROW'S DESCRIPTION does not drop a lone word.
//
// 360px is the width that matters for §2 and §3: it is the narrowest phone in
// real use and the one where the rail runs out first. A gate written at 390
// alone would pass over the case that bites.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

// Two labels overlap when the right edge of one passes the left edge of the
// next. Read off the PAINTED boxes, because the defect is a paint collision —
// the DOM is perfectly happy either way.
const TL_OVERLAP = () => {
  const labs = [...document.querySelectorAll('#cal-body .tl-day b')].filter((e) => e.getClientRects().length);
  const boxes = labs
    .map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: r.x, r: r.right }; })
    .sort((a, b) => a.x - b.x);
  let worst = 0, pair = '';
  for (let i = 1; i < boxes.length; i++) {
    const o = boxes[i - 1].r - boxes[i].x;
    if (o > worst) { worst = o; pair = boxes[i - 1].t + ' / ' + boxes[i].t; }
  }
  return { n: labs.length, worst: Math.round(worst), pair, first: boxes[0] ? boxes[0].t : '' };
};

// A nowrap+ellipsis element is truncated when its content is wider than its box.
const CUT_SUBS = () => {
  const out = [];
  for (const el of document.querySelectorAll('.bhub-fold-sub')) {
    if (!el.getClientRects().length) continue;
    if (getComputedStyle(el).whiteSpace !== 'nowrap') continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const full = (el.textContent || '').trim();
    out.push({ txt: full.slice(0, 46), lost: Math.round((1 - el.clientWidth / el.scrollWidth) * 100), w: Math.round(el.getBoundingClientRect().width) });
  }
  return out;
};

// An orphan is a wrapped block whose LAST line is a lone short word. Measured
// with a Range over the contents — the element box tells you nothing about
// where the lines actually fell.
const ORPHANS = (sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.getClientRects().length) continue;
    const r = document.createRange(); r.selectNodeContents(el);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0);
    if (rects.length < 2) continue;
    const box = el.getBoundingClientRect(), last = rects[rects.length - 1];
    if (last.width < box.width * 0.30) out.push({ txt: (el.textContent || '').trim().slice(0, 46), last: Math.round(last.width), box: Math.round(box.width) });
  }
  return out;
};

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 360, height: 900 } });

  const PROPS = [
    { prop_key: '21a', name: '21A Westgate Street', slug: '21a', couple_rate: 130, extra_adult_rate: 25, child_rate: 15, booking_fee: 50, transaction_pct: 1.5, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 150, extra_adult_rate: 25, child_rate: 15, booking_fee: 50, transaction_pct: 1.5, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 6, sort_order: 2 },
  ];
  // An OVERDUE booking and an unpaid one, so the Money landing renders its
  // exception row AND its five answers — the subs only exist when the rows do.
  const BK = [
    { id: 1, prop_key: '21a', name: 'Sarah Pemberton', email: 'sarah@example.com', check_in: d(3), check_out: d(7), adults: 2, children: 0, deposit_paid: 0, payment: 'unpaid', payment_method: 'Card', hold_status: 'none', notes: '' },
    { id: 2, prop_key: 'jollyboat', name: 'Tom Ashby', email: 'tom@example.com', check_in: d(9), check_out: d(12), adults: 2, children: 0, deposit_paid: 900, payment: 'paid', payment_method: 'Card', hold_status: 'none', notes: '' },
    { id: 4, prop_key: '21a', name: 'Ines Duarte', email: 'i@example.com', check_in: d(-2), check_out: d(2), adults: 2, children: 1, deposit_paid: 300, payment: 'part', payment_method: 'Card', hold_status: 'none', notes: '' },
  ];
  await page.route(/\.php/, (r) => {
    const u = r.request().url();
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (u.includes('admin-bootstrap')) return j({ ok: true, cron: { stale: false, everRan: true, ageHours: 3 }, feeds: [] });
    if (u.includes('rates.php')) return j({ properties: PROPS, seasons: {}, occupancy: {} });
    if (u.includes('accounts.php')) return j({ ok: true, total: 18204.11, card_fees: 210.4, kept_deposits: 0, payments: [],
      deposit_liability: { net: 150, items: [{ name: 'Sarah Pemberton', net: 75, check_in: d(3), check_out: d(7) }],
        payouts: { known: 4, inBank: 1852.62, lookback: 90, items: { inBank: [{ name: 'Tom Ashby', kind: 'balance', movable: 900 }], unknown: [] } } } });
    if (u.includes('bookings.php') && b.action === 'recent_payments') return j({ ok: true, payments: [{ name: 'Tom Ashby', kind: 'balance', amount: '900.00', created_at: d(-1) + ' 10:00:00' }] });
    return j({ ok: true, bookings: BK, enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: PROPS });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await loadData(); });
  await page.waitForTimeout(800);

  // ------------------------------------------------------- §1 the timeline
  console.log('\n§1 The timeline\u2019s month labels never collide');
  // THE CLOCK IS PINNED, and that is what makes this gate real: tlStartOffset()
  // is a constant -2 from TODAY, so the labels are only neighbours when today is
  // the 1st or 2nd of a month. Left on the real clock this would fire one run in
  // thirty — a gate that does not fire. setFixedTime, never clock.install: the
  // app's own timers have to keep running.
  const reCal = async () => {
    await page.evaluate(() => { const h = document.getElementById('cal-body'); if (h) h.__tlDrew = false; nav('view-backoffice'); renderCalendar(); });
    await page.waitForFunction(() => document.querySelectorAll('#cal-body .tl-day b').length > 0, { timeout: 12000 });
    await page.waitForTimeout(250);
  };
  const yr = new Date().getFullYear();
  for (const [day, label] of [[1, 'the 1st'], [2, 'the 2nd — the worst case'], [15, 'mid-month']]) {
    await page.clock.setFixedTime(new Date(yr, 8, day, 10, 0, 0));
    for (const w of [360, 390, 900, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      await reCal();
      const t = await page.evaluate(TL_OVERLAP);
      ok(t.n >= 1, `${label} @${w}px: the header carries ${t.n} month label(s)`);
      ok(t.worst <= 0, `${label} @${w}px: none overlap (worst ${t.worst}px${t.pair ? ' \u2014 ' + t.pair : ''})`);
    }
  }

  // THE YEAR IS NOT SIMPLY DELETED — it is dropped only where it would collide.
  // Both halves are asserted, so this can neither erode back into a collision
  // nor swell into "the timeline never says which year".
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.setFixedTime(new Date(yr, 8, 15, 10, 0, 0));
  await reCal();
  const yearWhenRoom = await page.evaluate(() => (document.querySelector('#cal-body .tl-day b') || {}).textContent || '');
  ok(/\d{4}/.test(yearWhenRoom), `mid-month the year still rides the first label (\u201c${yearWhenRoom.trim()}\u201d)`);
  await page.clock.setFixedTime(new Date(yr, 8, 2, 10, 0, 0));
  await reCal();
  const yearWhenCrowded = await page.evaluate(() => (document.querySelector('#cal-body .tl-day b') || {}).textContent || '');
  ok(!/\d{4}/.test(yearWhenCrowded), `\u2026and drops ONLY when the month-start is on top of it (\u201c${yearWhenCrowded.trim()}\u201d)`);
  await page.clock.setFixedTime(new Date());
  await reCal();

  // ------------------------------------------------- §2 nothing is cut off
  console.log('\n§2 No summary sub is cut off on a phone');
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    for (const [name, go] of [['Manage', 'openArea("manage")'], ['Money', 'openAccounts()']]) {
      await page.evaluate(new Function('return (async () => { await ' + go + '; })()'));
      await page.waitForFunction(() => document.querySelectorAll('.bhub-fold-sub').length > 0, { timeout: 12000 });
      await page.waitForTimeout(500);
      const n = await page.evaluate(() => document.querySelectorAll('.bhub-fold-sub').length);
      const cut = await page.evaluate(CUT_SUBS);
      ok(n >= 3, `${w}px ${name}: ${n} summary subs on screen`);
      ok(cut.length === 0, `${w}px ${name}: none truncated${cut.length ? ' — ' + cut.map((c) => `“${c.txt}” ${c.lost}% lost in ${c.w}px`).join('; ') : ''}`);
    }
  }
  // A sub still has to SAY something — shortening the copy until it fits is
  // only a fix while the words survive it.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.evaluate(async () => { await openArea('manage'); });
  await page.waitForTimeout(700);
  const shortest = await page.evaluate(() =>
    Math.min(...[...document.querySelectorAll('.bhub-fold-sub')]
      .filter((e) => e.getClientRects().length)
      .map((e) => (e.textContent || '').trim().length)));
  ok(shortest >= 10, `every sub is still a phrase, not a stub (shortest ${shortest} chars)`);

  // ------------------------------------------------------- §3 the orphans
  console.log('\n§3 A settings row’s description does not drop a lone word');
  const pretty = await page.evaluate(() => {
    const e = document.querySelector('.settings-row-sub');
    return e ? getComputedStyle(e).textWrap || getComputedStyle(e).textWrapStyle : '';
  });
  ok(/pretty/.test(pretty), `.settings-row-sub carries text-wrap: pretty (${pretty})`);
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await openArea('manage'); });
    await page.waitForFunction(() => document.querySelectorAll('.settings-row-sub').length > 5, { timeout: 12000 });
    await page.waitForTimeout(400);
    const withFix = (await page.evaluate(ORPHANS, '.settings-row-sub')).length;
    const total = await page.evaluate(() => document.querySelectorAll('.settings-row-sub').length);
    // Measure the SAME page without the declaration rather than pinning a
    // number: a fixed threshold rots the moment a row's copy changes, and the
    // claim being made is about the declaration's effect, not about a count.
    await page.addStyleTag({ content: '.settings-row-sub { text-wrap: wrap !important; }' });
    await page.waitForTimeout(300);
    const without = (await page.evaluate(ORPHANS, '.settings-row-sub')).length;
    await page.evaluate(() => { const t = [...document.querySelectorAll('style')].pop(); if (t) t.remove(); });
    await page.waitForTimeout(200);
    ok(withFix < without, `${w}px: ${without} orphans of ${total} without the rule, ${withFix} with it`);
    // NB not zero, and deliberately not asserted as zero: `pretty` protects the
    // last line, it does not rebalance the block the way `balance` does.
    ok(withFix <= without - 2, `${w}px: \u2026and the win is more than noise (${without - withFix} fewer)`);
  }

  console.log(`\n${fails ? fails + ' FAILED' : 'All legibility checks passed'}`);
  await done(fails);
})();
