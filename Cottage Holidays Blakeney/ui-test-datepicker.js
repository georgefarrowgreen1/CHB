// THE GUEST DATE PICKER, in a real browser, against the exact August fixture the
// owner reported from their phone.
//
// The picker crosses a night out for TWO different reasons — it is BOOKED, or it is
// free but no stay can START there because the run to the next booking is shorter
// than the cottage's minimum (`tooShort`/`dpCheckinFits`). Only the first is what
// the legend under the grid describes, and the two behave differently the moment a
// check-in is chosen. That is where it went wrong:
//
//  (a) `tooShort` is computed `!pickingEnd`, so picking a check-in UN-CROSSED every
//      too-short night in the month — including ones BEFORE the check-in, which can
//      never be a checkout. They are re-offered by the "restart selection" branch,
//      whose test is `!booked` and ignores the minimum outright, so a guest could
//      restart on a night no stay can start on and book a 1-night stay under a
//      2-night minimum. (The server rejects it — after they have filled the form.)
//  (b) once BOTH ends are chosen `pingEnd` is false again, so `tooShort` comes back
//      and crosses out nights INSIDE the confirmed stay, and `booked` crosses out the
//      chosen checkout day itself. "Can a stay start here" is not a question about a
//      night you are already staying, and a turnover checkout is not a night at all.
//
// The fixture is derived from the screenshots, and the derivation is the point: the
// nights that STAYED crossed after a check-in was picked are the genuinely booked
// ones, and the three that un-crossed (6, 11, 18) sit alone against a booking with a
// 2-night minimum. Reproduced here so the two classes cannot be conflated again.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// August 2026 as reported. Booked NIGHTS are [start, end) — `end` is the turnover
// day, free for the next arrival.
//   booked: 1-3, 7-9, 12-14, 19-23, 28-30
//   free:   4,5,6  10,11  15,16,17,18  24,25,26,27  31
// With minNights 2 the lone nights before a booking (6, 11, 18, 27) can start no
// stay, so the check-in grid crosses them too — for a different reason.
const RANGES = [
  { start: '2026-08-01', end: '2026-08-04' },
  { start: '2026-08-07', end: '2026-08-10' },
  { start: '2026-08-12', end: '2026-08-15' },
  { start: '2026-08-19', end: '2026-08-24' },
  { start: '2026-08-28', end: '2026-08-31' },
];
const BOOKED = [1, 2, 3, 7, 8, 9, 12, 13, 14, 19, 20, 21, 22, 23, 28, 29, 30];
const TOO_SHORT = [6, 11, 18, 27];

(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    // openDatePicker() re-fetches availability and repaints when it lands, so the
    // fixture has to come through the ENDPOINT — seeding propertyAvailability by
    // hand is silently undone a moment later, which made the first version of this
    // suite measure an empty month and report bugs the app does not have.
    if (url.includes('availability.php')) return json({ ok: true, ranges: RANGES, props: { jollyboat: RANGES } });
    if (url.includes('rates.php')) return json({
      properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }],
      seasons: {}, occupancy: {},
    });
    return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], value: null });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Drive the REAL picker: seed the availability the app itself reads, set the
  // cottage's minimum to 2, and open it the way the enquiry form does.
  const openAt = async () => {
    await page.evaluate(() => {
      activeFrontProperty = 'jollyboat';
      propertyRates['jollyboat'] = Object.assign({}, propertyRates['jollyboat'] || {}, { minNights: 2 });
      document.getElementById('enq-checkin').value = '';
      document.getElementById('enq-checkout').value = '';
      openDatePicker();
    });
    // Let the availability fetch land BEFORE fixing the view, or its repaint
    // arrives after and the month under test is whichever one today falls in.
    await page.waitForTimeout(400);
    await page.evaluate(() => { dpState.view = new Date(2026, 7, 1); renderDatePicker(); });
    await page.waitForTimeout(120);
    // The fixture must actually be in play — an empty month passes half of this
    // suite by having nothing to cross out.
    const seeded = await page.evaluate(() => (propertyAvailability['jollyboat'] || []).length);
    ok(seeded === 5, `the month under test carries the reported bookings (${seeded} ranges)`);
  };

  // Read the grid back as {day: {crossed, clickable}} — the two things the guest
  // can actually perceive and act on.
  const grid = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#dp-grid .dp-day').forEach((el) => {
      const n = parseInt(el.textContent.trim(), 10);
      if (!n) return;
      out[n] = {
        crossed: el.classList.contains('dp-booked'),
        clickable: el.getAttribute('data-act') === 'dpPick',
        inRange: el.classList.contains('dp-in-range'),
        isEnd: el.classList.contains('dp-end'),
      };
    });
    return out;
  });
  const tap = async (day) => {
    await page.evaluate((d) => dpPick(`2026-08-${String(d).padStart(2, '0')}`), day);
    await page.waitForTimeout(120);
  };

  console.log('1. the check-in grid');
  await openAt();
  let g = await grid();
  ok(BOOKED.every((n) => g[n] && g[n].crossed && !g[n].clickable),
    `every booked night is crossed and unpickable (${BOOKED.length} nights)`);
  ok(TOO_SHORT.every((n) => g[n] && g[n].crossed && !g[n].clickable),
    `a lone night that cannot fit the 2-night minimum is crossed too (${TOO_SHORT.join(', ')})`);
  const FREE_START = [4, 5, 10, 15, 16, 17, 24, 25, 26, 31];
  ok(FREE_START.every((n) => g[n] && !g[n].crossed && g[n].clickable),
    `and every night a stay CAN start on is open (${FREE_START.join(', ')})`);

  console.log('2. picking a check-in must not re-open what is unavailable');
  await tap(24);
  g = await grid();
  // (a) The reported symptom: nights that cannot start a stay un-shaded.
  ok(TOO_SHORT.filter((n) => n < 24).every((n) => g[n].crossed),
    'a too-short night BEFORE the check-in stays crossed (6, 11, 18)');
  ok(BOOKED.filter((n) => n < 24).every((n) => g[n].crossed),
    '…as does every booked night before it');
  // (b) …and must not be pickable, because "restart selection" starts a NEW stay,
  // which is exactly the question the minimum answers.
  ok(TOO_SHORT.filter((n) => n < 24).every((n) => !g[n].clickable),
    '…and cannot be tapped to restart a stay the minimum forbids');

  console.log('3. a turnover day IS a valid checkout');
  // 28 is the next guest's arrival: nights 24-27 are free, so leaving on the 28th
  // takes nothing from anyone. It must be offered, and not crossed while offered.
  ok(g[28] && g[28].clickable && !g[28].crossed,
    'the first night of the next booking is offered as a checkout, uncrossed');
  ok(g[27] && g[27].clickable, 'as is the last free night (27)');
  ok(!g[29].clickable && !g[30].clickable, 'but a checkout PAST a booked night is refused (29, 30)');
  ok(!g[31].clickable, '…including one that would jump the whole booking (31)');

  console.log('4. a confirmed stay is not re-crossed');
  await tap(28);
  g = await grid();
  const stayed = await page.evaluate(() => document.getElementById('dp-hint').innerText);
  ok(/4 night/.test(stayed), `the range reads as 4 nights (${stayed})`);
  ok(!g[27].crossed, 'a night INSIDE the chosen stay is not crossed out (27)');
  ok(g[27].inRange, '…it is shown as part of the stay');
  ok(!g[28].crossed, 'and the chosen checkout day is not crossed out either (28)');
  ok(g[28].isEnd, '…it is shown as the end of the stay');
  // The nights nobody selected keep their marks — otherwise this "fix" would just
  // be blanking the grid.
  ok(BOOKED.filter((n) => n < 24).every((n) => g[n].crossed) && g[29].crossed && g[30].crossed,
    'every booked night outside the stay is still crossed');
  ok(TOO_SHORT.filter((n) => n < 24).every((n) => g[n].crossed),
    '…and so is every too-short night outside it');

  console.log('5. the legend describes what the marks mean');
  const legend = await page.evaluate(() => {
    const el = document.querySelector('.dp-legend, #date-picker .dp-note');
    return el ? el.innerText : '';
  });
  // A lone night beside a booking is crossed and is NOT booked, so the old
  // sentence was wrong about every one of them. It has to say unavailable without
  // naming a reason — the reason is per-cell, on the hover title.
  ok(/available/i.test(legend) && !/booked/i.test(legend),
    `it says unavailable and does not claim every crossed night is booked (${legend.trim()})`);

  console.log('6. a date that cannot be tapped LOOKS like it cannot be tapped');
  // The bug this section exists for: a checkout past a booked night is correctly
  // refused, and the refusal was invisible — full opacity, pointer cursor, no mark.
  // §3 asserted the refusal and passed while the guest saw an ordinary date that
  // did nothing. Measured before the fix: picking a check-in and turning the page
  // gave 30 dead cells in September, none distinguishable from a bookable one.
  await page.evaluate(() => { dpClear(); dpState.view = new Date(2026, 7, 1); renderDatePicker(); dpPick('2026-08-24'); });
  await page.waitForTimeout(150);
  const look = await page.evaluate(() => {
    const o = {};
    document.querySelectorAll('#dp-grid .dp-day').forEach((el) => {
      const n = parseInt(el.textContent.trim(), 10);
      if (!n) return;
      const cs = getComputedStyle(el);
      o[n] = {
        clickable: el.getAttribute('data-act') === 'dpPick',
        marked: el.classList.contains('dp-booked') || el.classList.contains('dp-out'),
        opacity: parseFloat(cs.opacity),
        cursor: cs.cursor,
        struck: cs.textDecorationLine.includes('line-through'),
        title: el.getAttribute('title') || '',
      };
    });
    return o;
  });
  const unmarked = Object.keys(look).filter((n) => !look[n].clickable && !look[n].marked);
  ok(unmarked.length === 0, `no date is refused without looking refused (${unmarked.join(', ') || 'none'})`);
  ok(look[31] && look[31].opacity < 0.6 && look[31].cursor === 'not-allowed',
    `an out-of-reach night is dimmed and not-allowed (opacity ${look[31] && look[31].opacity})`);
  // …but it must not read as BOOKED. 31 Aug is free and for sale — just not on a
  // stay starting the 24th, with a booking in between.
  ok(look[31] && !look[31].struck, '…and is NOT struck through, because it is not booked');
  ok(/booking before this date/.test(look[31].title), `…it says why (${look[31].title})`);
  ok(look[29] && look[29].struck, 'a genuinely booked night still reads as booked (29)');

  // The whole of the next month was the reported symptom.
  await page.evaluate(() => dpChangeMonth(1));
  await page.waitForTimeout(150);
  const sept = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#dp-grid .dp-day')].filter((e) => parseInt(e.textContent.trim(), 10));
    return {
      total: cells.length,
      bare: cells.filter((e) => e.getAttribute('data-act') !== 'dpPick'
        && !e.classList.contains('dp-booked') && !e.classList.contains('dp-out')).length,
    };
  });
  ok(sept.total > 0 && sept.bare === 0,
    `turning to the next month never shows a page of dead-but-normal dates (${sept.bare} of ${sept.total})`);

  // …and it must not ANSWER the pointer either. A shared hover rule lifts and
  // shadows every .dp-day, so a dead cell rose like a live control before doing
  // nothing. Measured by hovering for real, at a fine pointer. (Back to August
  // first — the check above left the picker on September.)
  await page.evaluate(() => dpChangeMonth(-1));
  await page.waitForTimeout(150);
  const liftOf = async (day) => {
    const el = page.locator(`#dp-grid .dp-day`).filter({ hasText: new RegExp(`^${day}$`) }).first();
    await el.hover();
    await page.waitForTimeout(160);
    return el.evaluate((n) => getComputedStyle(n).transform);
  };
  const deadLift = await liftOf(31);
  const liveLift = await liftOf(25);
  ok(deadLift === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(deadLift),
    `an unpickable day does not lift under the pointer (${deadLift})`);
  ok(liveLift !== deadLift, `…while a pickable one still does (${liveLift})`);

  console.log('7. the hint says how far the guest can go');
  const hint = await page.evaluate(() => document.getElementById('dp-hint').innerText);
  ok(/check-out/.test(hint) && /28 Aug 2026/.test(hint),
    `it names the latest possible checkout rather than leaving them to find it (${hint})`);

  console.log('8. a seeded range that DOES cross a booking keeps its marks');
  // The picker's own rules can never produce an overlapping range — but the hero
  // search lets any date through (dpMode 'search'), and those values seed this
  // picker. So "don't cross out the chosen stay" is conditional on the stay being
  // clear; otherwise the one screen that could show the guest WHICH nights are the
  // problem would hide exactly those.
  await page.evaluate(() => {
    document.getElementById('enq-checkin').value = '2026-08-17';
    document.getElementById('enq-checkout').value = '2026-08-21'; // spans booked 19, 20
    openDatePicker();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { dpState.view = new Date(2026, 7, 1); renderDatePicker(); });
  await page.waitForTimeout(120);
  g = await grid();
  ok(g[19].crossed && g[20].crossed, 'the booked nights inside an impossible range are still crossed (19, 20)');
  ok(g[18].crossed, '…and so is the too-short night it starts on (18)');

  console.log('9. the chat\'s live-calendar check applies the same rules');
  // It tested for a booking clash and nothing else, so a stay under the minimum was
  // answered "Good news — looks free" and offered an enquiry the rule then refused.
  // checkBookingRules is the helper the enquiry form and hero search already use.
  const chat = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<select id="t-prop"><option value="jollyboat">J</option></select>'
      + '<input id="t-ci" value="2026-08-24"><input id="t-co" value="2026-08-25">';
    document.body.appendChild(host);
    const said = [];
    const real = window.chatBot;
    window.chatBot = (m) => said.push(m);
    await chatAvailRun('t');                       // 1 night, calendar clear, minimum 2
    document.getElementById('t-co').value = '2026-08-26';
    await chatAvailRun('t');                       // 2 nights, both free
    window.chatBot = real;
    host.remove();
    return said.map((s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  });
  ok(/minimum stay of 2 nights/.test(chat[0] || ''), `a stay under the minimum is refused, with the reason (${(chat[0] || '').slice(0, 70)})`);
  ok(!/Good news/.test(chat[0] || ''), '…and is NOT announced as available');
  ok(/Good news/.test(chat[1] || ''), 'a stay that clears both rules still gets the good news');

  console.log(fails ? `\n  DATEPICKER SUITE FAILED ❌ (${fails})` : '\n  DATEPICKER SUITE PASSED ✅');
  await done(fails);
})();
