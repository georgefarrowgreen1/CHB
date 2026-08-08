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
// What the availability endpoint serves. A test that needs a DIFFERENT calendar has
// to swap this, not propertyAvailability: every opener re-fetches and overwrites the
// store, so a hand-seeded array is silently undone a moment later (the trap the route
// comment below records — it cost a whole draft of §12).
let AVAIL = RANGES;
// A SECOND cottage, booked on a DELIBERATELY DISJOINT week, so "which cottage is the
// calendar shading?" has an answer that cannot be produced by accident (§14). 15-17
// Aug are free at Jollyboat and taken here; 1-3 the other way round.
const PIMPERNEL = [{ start: '2026-08-15', end: '2026-08-18' }];
const PER_PROP = { jollyboat: RANGES, pimpernel: PIMPERNEL };
const BOOKED = [1, 2, 3, 7, 8, 9, 12, 13, 14, 19, 20, 21, 22, 23, 28, 29, 30];
const TOO_SHORT = [6, 11, 18, 27];
// THE FIXTURE MONTH HAS TO STAY IN THE FUTURE, so the clock is pinned to a July
// morning before it. Every date above is a hardcoded August 2026 — fine while it
// was a year out, and wrong the day the wall clock reached it: `isPast` forces
// `booked` false and paints a past night `dp-disabled` instead, so on 02 Aug 2026
// this suite reported four failures for a picker doing exactly the right thing
// (the 1st was past, therefore not "booked"). That is CLAUDE.md's own rule — a
// test that reads the clock is only verified on the day it runs — so pin it
// rather than roll the fixture forward, which would only move the expiry date.
// setFixedTime, NOT clock.install(): the app's own setTimeouts must still fire.
const PINNED = new Date('2026-07-15T09:00:00Z');

(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await page.clock.setFixedTime(PINNED);
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    // openDatePicker() re-fetches availability and repaints when it lands, so the
    // fixture has to come through the ENDPOINT — seeding propertyAvailability by
    // hand is silently undone a moment later, which made the first version of this
    // suite measure an empty month and report bugs the app does not have.
    // PER COTTAGE, because §14 asks WHICH cottage the picker is shading. `props` stays
    // jollyboat-only on purpose: loadAvailabilityAll assigns only the keys it finds
    // there, so the flex-search and card-chip sections keep the fleet they were
    // written against and only an explicit ?prop= can reach the second fixture.
    if (url.includes('availability.php')) {
      const m = /[?&]prop=([^&]+)/.exec(url);
      const key = m ? decodeURIComponent(m[1]) : '';
      return json({ ok: true, ranges: (key && PER_PROP[key]) || AVAIL, props: { jollyboat: AVAIL } });
    }
    if (url.includes('rates.php')) return json({
      properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, transaction_pct: 0, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }],
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

  // The same opener for a month with NOTHING booked (§16's arithmetic half), which
  // cannot assert the 5-range fixture because it deliberately has none.
  const openAtEmpty = async () => {
    await page.evaluate(() => {
      activeFrontProperty = 'jollyboat';
      document.getElementById('enq-checkin').value = '';
      document.getElementById('enq-checkout').value = '';
      openDatePicker();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => { dpState.view = new Date(2026, 7, 1); renderDatePicker(); });
    await page.waitForTimeout(120);
    const seeded = await page.evaluate(() => (propertyAvailability['jollyboat'] || []).length);
    ok(seeded === 0, `the arithmetic month has nothing booked (${seeded} ranges)`);
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
        // dp-disabled belongs here as much as the other two — it is the PAST mark
        // (opacity 0.3, not-allowed, line-through), and a sweep that asserts a
        // general property must count every way the picker says no. It was left
        // out because no fixture had ever put a past day on this grid.
        marked: el.classList.contains('dp-booked') || el.classList.contains('dp-out')
          || el.classList.contains('dp-disabled'),
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

  // The same question turned BACKWARDS, which is the only state that exercises
  // dp-disabled — and the state the pinned clock would otherwise put out of reach.
  // June is entirely in the past from the pinned July: every cell is refused, so
  // every cell must say so. Deliberately asserts the count is non-zero as well,
  // or a month that rendered nothing would pass by having nothing to fail.
  // dpState.view is set DIRECTLY, not by paging: §15(e) now stops a guest walking
  // back past the current month at all, so dpChangeMonth(-1) refuses to leave July.
  // What is under test here is how a past CELL renders, not how it was reached.
  await page.evaluate(() => { dpState.view = new Date(2026, 5, 1); renderDatePicker(); });
  await page.waitForTimeout(150);
  const june = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#dp-grid .dp-day')].filter((e) => parseInt(e.textContent.trim(), 10));
    return {
      total: cells.length,
      bare: cells.filter((e) => e.getAttribute('data-act') !== 'dpPick'
        && !e.classList.contains('dp-booked') && !e.classList.contains('dp-out')
        && !e.classList.contains('dp-disabled')).length,
      dimmed: cells.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.6).length,
    };
  });
  ok(june.total === 30 && june.bare === 0 && june.dimmed === 30,
    `a month wholly in the past reads as past, every cell (${june.dimmed}/${june.total} dimmed, ${june.bare} bare)`);
  // Back to September, where this block found it — the next check turns one page
  // BACK to reach August and would otherwise land somewhere else entirely.
  await page.evaluate(() => { dpState.view = new Date(2026, 8, 1); renderDatePicker(); });
  await page.waitForTimeout(150);

  // …and it must not ANSWER the pointer either. A shared hover rule lifts and
  // shadows every .dp-day, so a dead cell rose like a live control before doing
  // nothing. Measured by hovering for real, at a fine pointer. (Back to August
  // first — the check above left the picker on September.)
  await page.evaluate(() => dpChangeMonth(-1));
  await page.waitForTimeout(150);
  // Addressed by data-day, not by exact TEXT: a sellable night now carries its price in
  // the same cell (§16), so the cell's text is "26£175" and an anchored /^26$/ matches
  // nothing. data-day is the stable hook.
  const liftOf = async (day) => {
    const el = page.locator(`#dp-grid .dp-day[data-day="2026-08-${String(day).padStart(2, '0')}"]`).first();
    await el.hover();
    await page.waitForTimeout(160);
    return el.evaluate((n) => getComputedStyle(n).transform);
  };
  const deadLift = await liftOf(31);
  // 26, not 25: with the check-in on 24 and a 2-night minimum, the 25th is a
  // ONE-night stay and the picker now refuses it (it used to be offered and then
  // rejected on the review step). 26 is the first legitimate checkout.
  const liveLift = await liftOf(26);
  ok(deadLift === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(deadLift),
    `an unpickable day does not lift under the pointer (${deadLift})`);
  ok(liveLift !== deadLift, `…while a pickable one still does (${liveLift})`);

  console.log('7. the hint says how far the guest can go');
  const hint = await page.evaluate(() => document.getElementById('dp-hint').innerText);
  ok(/check-out/.test(hint) && /28 Aug 2026/.test(hint),
    `it names the latest possible checkout rather than leaving them to find it (${hint})`);
  // …and once both ends are in, it counts the nights in words a person writes —
  // "night(s)" was a placeholder that shipped, on the one line confirming the stay
  // the guest is about to enquire about.
  const nightsHint = await page.evaluate(async () => {
    const read = () => document.getElementById('dp-hint').innerText;
    const out = {};
    dpPick('2026-08-24');
    dpPick('2026-08-25');
    out.one = read();
    dpPick('2026-08-24');
    dpPick('2026-08-26');
    out.two = read();
    return out;
  });
  // Not anchored to the END of the string any more: on the enquiry form the hint now
  // carries the stay total after the night count (§17), so `$` matched nothing. What is
  // under test is the PLURAL, so the assertion is the phrase, and the singular case
  // still proves the "s" is conditional rather than always present.
  ok(/·\s*1 night\b/.test(nightsHint.one) && !/1 nights/.test(nightsHint.one),
    `one night reads "1 night" (${nightsHint.one})`);
  ok(/·\s*2 nights\b/.test(nightsHint.two), `two read "2 nights" (${nightsHint.two})`);
  ok(!/night\(s\)/.test(nightsHint.one + nightsHint.two), 'and neither shows the "night(s)" placeholder');

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

  console.log('10. book by the night before — today is not for sale online');
  // The minimum-notice rule: the earliest guest check-in is TOMORROW. Today must
  // be withheld WITH ITS REASON (the dp-out lesson — a refusal the guest cannot
  // see is the calendar not working), and tomorrow must stay open, so the
  // boundary is asserted from both sides. The clock is pinned to 15 July, so the
  // month under test here is JULY, not the August fixture (which is all future).
  await openAt();
  await page.evaluate(() => { dpState.view = new Date(2026, 6, 1); renderDatePicker(); });
  await page.waitForTimeout(120);
  const notice = await page.evaluate(() => {
    const cells = {};
    document.querySelectorAll('#dp-grid .dp-day').forEach((el) => {
      const n = parseInt(el.textContent.trim(), 10);
      if (!n) return;
      cells[n] = {
        clickable: el.getAttribute('data-act') === 'dpPick',
        disabled: el.classList.contains('dp-disabled'),
        title: el.getAttribute('title') || '',
        aria: el.getAttribute('aria-label') || '',
      };
    });
    return { today: cells[15], tomorrow: cells[16], rule: checkBookingRules('jollyboat', todayDashed(), '2026-07-22') };
  });
  ok(notice.today && !notice.today.clickable && notice.today.disabled, 'today cannot be picked as a check-in');
  ok(/night before/.test(notice.today.title) && /notice/.test(notice.today.aria),
    `…and says why in its title and announced name (${notice.today.title.slice(0, 60)})`);
  ok(notice.tomorrow && notice.tomorrow.clickable, 'tomorrow — the earliest allowed — is still open');
  ok(/day’s notice/.test(notice.rule || ''), 'checkBookingRules refuses a same-day stay in words');
  // The chat's availability check speaks the same rule — it routes through
  // checkBookingRules, so a "tonight" ask is refused, never blessed "Good news".
  const chatToday = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<select id="t2-prop"><option value="jollyboat">J</option></select>'
      + '<input id="t2-ci" value="2026-07-15"><input id="t2-co" value="2026-07-17">';
    document.body.appendChild(host);
    const said = [];
    const real = window.chatBot;
    window.chatBot = (m) => said.push(m);
    await chatAvailRun('t2');
    window.chatBot = real;
    host.remove();
    return (said[0] || '').replace(/<[^>]*>/g, ' ');
  });
  ok(/day’s notice/.test(chatToday) && !/Good news/.test(chatToday),
    'the chat refuses a same-day stay with the notice rule');

  console.log('11. the picker refuses exactly what the form refuses');
  // The checkout branch tested only for booked nights, so a checkout that made the
  // stay shorter than the minimum — or longer than the maximum — was offered,
  // accepted, and then rejected by checkBookingRules on the review step, AFTER the
  // guest had chosen. Same for a check-in on a day the cottage takes no arrivals.
  // Each refusal must also name ITSELF: dp-out's "a booking falls before this date"
  // is a lie about a stay that is merely too short, and replacing an invisible
  // refusal with a misleading one is no fix.
  const cellsNow = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#dp-grid .dp-day').forEach((el) => {
      const n = parseInt(el.textContent.trim(), 10);
      if (!n) return;
      out[n] = {
        clickable: el.getAttribute('data-act') === 'dpPick',
        title: el.getAttribute('title') || '',
        aria: el.getAttribute('aria-label') || '',
      };
    });
    return out;
  });
  const rules = async (r) => {
    await page.evaluate((rr) => {
      Object.assign(propertyRates['jollyboat'], rr);
      dpState.start = null;
      dpState.end = null;
      renderDatePicker();
    }, r);
    await page.waitForTimeout(80);
  };

  // (a) MIN/MAX on the checkout branch. 24–27 are free with 28 booked, so 28 is a
  // legitimate turnover checkout — which is what makes it the honest maximum case.
  await openAt();
  await rules({ minNights: 2, maxNights: 3, arrivalDays: [] });
  await tap(24);
  let c = await cellsNow();
  ok(!c[25].clickable && /[Mm]inimum stay is 2 nights/.test(c[25].title),
    `a 1-night checkout is refused, naming the minimum (${c[25].title || '(no title)'})`);
  ok(/minimum stay is 2 nights/.test(c[25].aria), '…and the announced name says the same');
  ok(c[26].clickable && c[27].clickable, 'the 2- and 3-night checkouts are open');
  ok(!/booking falls before/.test(c[25].aria), 'and does not blame a booking that has nothing to do with it');
  // The maximum, on a FREE day so nothing else can be the reason: 24–27 are free
  // with 28 booked, so a 2-night maximum puts the boundary on the free 27.
  await rules({ minNights: 1, maxNights: 2, arrivalDays: [] });
  await tap(24);
  c = await cellsNow();
  ok(c[26].clickable, 'the checkout at the maximum is open');
  ok(!c[27].clickable && /[Mm]aximum stay is 2 nights/.test(c[27].title),
    `one night over it is refused, naming the maximum (${c[27].title || '(no title)'})`);
  ok(/maximum stay is 2 nights/.test(c[27].aria), '…and the announced name says the same');
  // 28 is the first night of the next booking — a legitimate TURNOVER checkout — so
  // over the maximum it must cite the length, not "Booked", which would send the
  // guest hunting for another date when what they must change is the stay.
  ok(!c[28].clickable && /[Mm]aximum stay/.test(c[28].title),
    `a turnover day over the maximum cites the length, not the booking (${c[28].title || '(no title)'})`);
  // Break-test the maximum: with none set, both come back.
  await rules({ minNights: 1, maxNights: 0 });
  await tap(24);
  c = await cellsNow();
  ok(c[27].clickable && c[28].clickable, 'with no maximum, both checkouts are open again');

  // (b) ARRIVAL DAYS on the check-in branch. Saturdays only: 1, 8, 15, 22, 29.
  await rules({ minNights: 2, maxNights: 0, arrivalDays: [6] });
  c = await cellsNow();
  ok(c[15].clickable, 'a free Saturday can start a stay');
  ok(!c[4].clickable && /No arrivals on this day/.test(c[4].title),
    `a free Tuesday cannot, and says why (${c[4].title || '(no title)'})`);
  ok(/does not take arrivals/.test(c[4].aria), '…in its announced name too');
  // The arrival rule is a question about a CHECK-IN. A departure day is not one, so
  // it must not be refused for falling on the wrong weekday.
  await tap(15);
  c = await cellsNow();
  ok(c[17].clickable, 'a Monday CHECKOUT is unaffected by the arrival-day rule');
  // …and a tap on/before the check-in RESTARTS, which is picking a check-in again —
  // so it is refused for the arrival rule and must say so, not blame a booking.
  ok(!c[4].clickable && /No arrivals on this day/.test(c[4].title),
    'restarting on a no-arrivals day is refused with the arrival reason');
  ok(!/booking before/.test(c[4].title), '…not "there\'s a booking before this date"');
  await rules({ minNights: 2, maxNights: 0, arrivalDays: [] });

  console.log('12. an empty flex month names its own reason');
  // "Try another month" is right for a booked-up month and wrong for the other two:
  // a month that has finished needs a LATER one, and a stay the cottage's own rules
  // refuse won't fit ANY month — so the rule itself is the answer.
  const flex = await page.evaluate(async () => {
    const read = () => ({
      title: (document.getElementById('hs-results-title') || {}).innerText || '',
      grid: (document.getElementById('hs-results-grid') || {}).innerText || '',
      waitlist: !!document.querySelector('#hs-results-grid [data-act="openWaitlistModal"]'),
    });
    const out = {};
    heroSearch.mode = 'flex';
    heroSearch.adults = 2;
    heroSearch.children = 0;
    // A 3-night search at a cottage with a 9-night minimum: every candidate day in
    // the month is refused by the RULE, nothing is taken.
    propertyRates['jollyboat'] = Object.assign({}, propertyRates['jollyboat'], { minNights: 9, maxNights: 0, arrivalDays: [] });
    heroSearch.nights = 3;
    heroSearch.month = '2026-08';
    await runFlexSearch();
    out.rule = read();
    // A month already gone: nothing to wait for, and a later month is the advice.
    propertyRates['jollyboat'].minNights = 2;
    heroSearch.month = '2026-01';
    await runFlexSearch();
    out.past = read();
    propertyRates['jollyboat'].minNights = 2;
    return out;
  });
  // Booked up: the original wording, still correct. Served through the ENDPOINT —
  // the fixture month leaves 31 Aug and an empty September, so without walling the
  // tail off a 6-night window really is free there and this case would be measuring
  // something else entirely.
  AVAIL = RANGES.concat([{ start: '2026-08-31', end: '2026-10-01' }]);
  flex.booked = await page.evaluate(async () => {
    heroSearch.nights = 6;
    heroSearch.month = '2026-08';
    await runFlexSearch();
    return {
      title: (document.getElementById('hs-results-title') || {}).innerText || '',
      grid: (document.getElementById('hs-results-grid') || {}).innerText || '',
      waitlist: !!document.querySelector('#hs-results-grid [data-act="openWaitlistModal"]'),
    };
  });
  AVAIL = RANGES;
  ok(/minimum stay of 9 nights/i.test(flex.rule.grid),
    `a stay the rules refuse names the rule (${flex.rule.grid.replace(/\s+/g, ' ').slice(0, 80)})`);
  ok(!/try another month/i.test(flex.rule.grid), '…and does not send them to a month that cannot help');
  ok(/already finished/i.test(flex.past.grid) && /later month/i.test(flex.past.grid),
    `a finished month asks for a LATER one (${flex.past.grid.replace(/\s+/g, ' ').slice(0, 70)})`);
  ok(/already finished/i.test(flex.past.title), '…and the heading says so rather than "no stays free"');
  ok(!flex.past.waitlist, '…with no waitlist offer, which could never fire for a past month');
  ok(/try another month/i.test(flex.booked.grid) && flex.booked.waitlist,
    'a booked-up month keeps "try another month" and its waitlist offer');

  console.log('13. a fully-booked cottage says so, rather than showing nothing');
  // An empty chip read identically to a cottage whose availability hadn't loaded,
  // so the guest could not tell "nothing free for two months" from "we don't know".
  const chip = await page.evaluate(() => {
    const out = {};
    const cell = () => (document.getElementById('home-card-avail-jollyboat') || document.getElementById('card-avail-jollyboat') || {}).innerHTML || '';
    const saved = publicAllAvailability;
    // Solid wall of bookings for the whole scan window.
    publicAllAvailability = { jollyboat: [{ start: todayDashed(), end: ukShiftDays(todayDashed(), 200) }] };
    renderCardAvailability();
    out.full = cell();
    publicAllAvailability = { jollyboat: [] };
    renderCardAvailability();
    out.free = cell();
    // Genuinely unknown: renderCardAvailability returns before touching anything,
    // so measure from an EMPTY cell — which is the real boot order (null, then
    // loaded), not from whatever the previous case painted.
    ['card-avail-jollyboat', 'home-card-avail-jollyboat'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    publicAllAvailability = null;
    renderCardAvailability();
    out.unknown = cell();
    publicAllAvailability = saved;
    return out;
  });
  ok(/No stays free in the next \d+ days/.test(chip.full),
    `fully booked states the fact and its window (${chip.full.replace(/<[^>]*>/g, '').slice(0, 60)})`);
  ok(/Available from tomorrow/.test(chip.free), 'a wide-open cottage still leads with the strongest claim');
  ok(chip.unknown === '', 'and an unloaded cottage stays silent — unknown is not a claim');

  console.log('14. every guest date field IS the built-in calendar');
  // Reported from a phone: the waitlist modal showed iOS's own date control. Two guest
  // surfaces were still on a native <input type="date"> — the waitlist join and the
  // chat availability check — and the native control cannot do the one thing these
  // screens are for: it offers every date as equally free, so the guest picks blind
  // and is told AFTERWARDS that the nights are taken. Both now raise the shared
  // picker through openFieldDatePicker, which is also why it grew a cottage override
  // (each of these surfaces has its OWN cottage select, so shading whatever page
  // happens to be behind the modal would shade the wrong calendar).
  await page.evaluate(() => {
    closeDatePicker();
    // A second cottage the waitlist's own select can actually offer. propertyList is
    // what liveCottageKeys reads once rates have loaded, so propertyMeta alone is not
    // enough — and the pair is restored at the end of this section.
    propertyMeta['pimpernel'] = Object.assign({}, propertyMeta['jollyboat'], { name: 'Pimpernel' });
    propertyRates['pimpernel'] = Object.assign({}, propertyRates['jollyboat'] || {}, { minNights: 2 });
    propertyList.push({ prop_key: 'pimpernel', name: 'Pimpernel', archived: 0, unlisted: 0 });
    activeFrontProperty = 'jollyboat';
  });

  // A NATIVE DATE FIELD IS THE DEFECT, so the scan is the ratchet: anything a guest can
  // reach must not be one. #edit-modal is the owner's Add/Edit Booking form, which
  // lives in index.html and is deliberately out of scope (it is not a guest surface).
  const natives = () => page.evaluate(() => Array.from(document.querySelectorAll('input[type="date"]'))
    .filter((el) => !el.closest('#edit-modal'))
    .map((el) => el.id || el.getAttribute('aria-label') || el.outerHTML.slice(0, 50)));
  ok((await natives()).length === 0, 'no guest surface ships a native date field at rest');

  await page.evaluate(() => openWaitlistModal({ prop: 'jollyboat' }));
  await page.waitForTimeout(150);
  const wlTrig = await page.evaluate(() => {
    const t = document.getElementById('wl-date-trigger');
    return { there: !!t, act: t && t.getAttribute('data-act'), label: t ? t.innerText.trim() : '' };
  });
  ok(wlTrig.there && wlTrig.act === 'openWaitlistDatePicker',
    'the waitlist join asks for dates with the shared trigger');
  ok(/optional/i.test(wlTrig.label),
    `…and its empty label still says the dates are optional ("${wlTrig.label}")`);

  await page.click('#wl-date-trigger');
  await page.waitForTimeout(450); // let loadAvailability land and repaint
  await page.evaluate(() => { dpState.view = new Date(2026, 7, 1); renderDatePicker(); });
  await page.waitForTimeout(120);
  const wlOpen = await page.evaluate(() => ({
    open: document.getElementById('date-picker').classList.contains('open'),
    mode: dpMode,
    key: dpPropKey(),
    admin: document.getElementById('date-picker').classList.contains('dp-admin'),
  }));
  ok(wlOpen.open && wlOpen.mode === 'fields', 'tapping it opens the built-in calendar in fields mode');
  ok(!wlOpen.admin, '…as a guest picker, not the owner\'s everything-goes variant');
  ok(wlOpen.key === 'jollyboat', '…shading the cottage the modal is about');

  // A WAITLIST IS FOR THE TAKEN NIGHTS, so booked ones stay pickable here (they render
  // crossed, which is how the guest sees which nights they are waiting on) — but the
  // night-before floor is checked BEFORE the per-mode branch, so today never is.
  let wg = await grid();
  ok(wg[19] && wg[19].crossed && wg[19].clickable,
    'a booked night is still crossed but PICKABLE — that is what a waitlist is for');
  // …and the legend has to agree with that, or the screen contradicts itself: the
  // static "Crossed-out dates aren't available" was false on every mode but the
  // enquiry form. Read the WORDS, since that is what the guest acts on.
  const legendText = () => page.evaluate(() => document.getElementById('dp-legend').innerText.trim());
  ok(/you can still pick them/i.test(await legendText()),
    `the legend says the crossed dates are pickable here ("${await legendText()}")`);
  // A too-short night is a CONSEQUENCE of a booking, and the waitlist premise is that
  // the booking may go — so 6/11/18/27 (free nights that can start no 2-night stay
  // only because the next night is taken) must not be marked unavailable here.
  ok(TOO_SHORT.every((n) => wg[n] && !wg[n].crossed),
    `a free night blocked only by the booking beside it is NOT crossed on a waitlist (${TOO_SHORT.join(', ')})`);
  const floor = await page.evaluate(() => {
    dpState.view = chbNow();
    renderDatePicker();
    const today = document.querySelector('#dp-grid .dp-day.dp-today');
    return { has: !!today, pickable: today ? today.getAttribute('data-act') === 'dpPick' : null };
  });
  ok(floor.has && floor.pickable === false,
    'and today is refused, so the night-before rule holds in fields mode too');

  // WHICH cottage — answered against a disjoint fixture, so the right answer cannot
  // come out of the wrong lookup. 15-17 Aug are FREE at Jollyboat and taken here.
  await page.evaluate(() => {
    closeDatePicker();
    document.getElementById('wl-prop').value = 'pimpernel';
    openWaitlistDatePicker();
  });
  await page.waitForTimeout(450);
  await page.evaluate(() => { dpState.view = new Date(2026, 7, 1); renderDatePicker(); });
  await page.waitForTimeout(120);
  wg = await grid();
  const pimpKey = await page.evaluate(() => dpPropKey());
  ok(pimpKey === 'pimpernel', 'changing the cottage changes the calendar it shades');
  ok([15, 16, 17].every((n) => wg[n] && wg[n].crossed),
    'the second cottage\'s own booked nights are the ones crossed (15-17 Aug)');
  ok([1, 2, 3].every((n) => wg[n] && !wg[n].crossed),
    '…and the FIRST cottage\'s bookings are not (1-3 Aug free here)');

  // The pick lands in the hidden inputs the form reads, and the trigger says so.
  await page.evaluate(() => { dpPick('2026-08-04'); dpPick('2026-08-07'); dpDone(); });
  await page.waitForTimeout(150);
  const wlPicked = await page.evaluate(() => ({
    ci: document.getElementById('wl-checkin').value,
    co: document.getElementById('wl-checkout').value,
    label: document.getElementById('wl-date-display').innerText.trim(),
    marked: document.getElementById('wl-date-trigger').classList.contains('has-dates'),
    closed: !document.getElementById('date-picker').classList.contains('open'),
    stillOpen: document.getElementById('waitlist-modal').classList.contains('open'),
    leaked: dpProp,
  }));
  ok(wlPicked.ci === '2026-08-04' && wlPicked.co === '2026-08-07',
    `Done writes the hidden inputs the form posts (${wlPicked.ci} → ${wlPicked.co})`);
  ok(/4 Aug/.test(wlPicked.label) && /7 Aug/.test(wlPicked.label) && wlPicked.marked,
    `…and the trigger reads them back ("${wlPicked.label}")`);
  ok(wlPicked.closed && wlPicked.stillOpen, 'the calendar closes and the modal beneath stays open');
  ok(wlPicked.leaked === null,
    'the cottage override is handed back, so the next surface is not shaded by this one');

  // ESCAPE ANSWERS THE THING ON TOP. topOpenDialog took the last .modal-overlay before
  // it ever looked at the picker, so Escape closed the modal UNDERNEATH while the
  // calendar stayed on screen — and Tab trapped focus in a form the guest could no
  // longer see. The picker is z 2100 against the overlay's 2000.
  await page.evaluate(() => openWaitlistDatePicker());
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const esc = await page.evaluate(() => ({
    dp: document.getElementById('date-picker').classList.contains('open'),
    modal: document.getElementById('waitlist-modal').classList.contains('open'),
  }));
  ok(!esc.dp && esc.modal, 'Escape closes the calendar, not the modal beneath it');
  await page.evaluate(() => closeWaitlistModal());

  // The enquiry form is the one mode that DOES refuse a crossed night, so it keeps the
  // original sentence — the legend follows the rule, it is not simply reworded.
  await openAt();
  ok(/aren.t available/i.test(await legendText()) && !/still pick/i.test(await legendText()),
    `…while the enquiry form, which really does refuse them, still says so ("${await legendText()}")`);
  const eg = await grid();
  ok(TOO_SHORT.every((n) => eg[n] && eg[n].crossed),
    'and a too-short night is still crossed there, where a real stay is being planned');
  await page.evaluate(() => closeDatePicker());

  // THE CHAT'S LIVE AVAILABILITY CHECK — the other native pair, and the one where the
  // native control was most misleading: this bubble exists to answer "are those nights
  // free", and it was asking for them on a control that shows nothing.
  // Open the chat and let loadChat's own render land FIRST — it rebuilds #chat-thread,
  // so a bubble appended in the same tick is detached a moment later.
  await page.evaluate(() => toggleChat());
  await page.waitForTimeout(400);
  const cav = await page.evaluate(() => {
    chatAvailStart();
    const uid = 'cav' + __chatAvailUid;
    const t = document.getElementById(uid + '-trigger');
    return {
      uid,
      trigger: !!t,
      act: t && t.getAttribute('data-act'),
      hidden: ['-ci', '-co'].every((s) => {
        const el = document.getElementById(uid + s);
        return el && el.type === 'hidden';
      }),
    };
  });
  ok(cav.trigger && cav.act === 'chatAvailDates',
    'the chat availability check asks for dates with the shared trigger');
  ok(cav.hidden, '…keeping the ids chatAvailRun already reads, now as hidden inputs');
  ok((await natives()).length === 0,
    'and still no native date field anywhere a guest can reach, chat bubble included');

  await page.click(`#${cav.uid}-trigger`);
  await page.waitForTimeout(450);
  const cavKey = await page.evaluate(() => ({ open: document.getElementById('date-picker').classList.contains('open'), key: dpPropKey(), mode: dpMode }));
  ok(cavKey.open && cavKey.mode === 'fields', 'tapping it opens the same built-in calendar');
  ok(cavKey.key === 'jollyboat', '…shading the cottage selected in that bubble');
  // End to end: the reader is untouched, so a real pick must satisfy it.
  const ran = await page.evaluate(async (uid) => {
    dpPick('2026-08-04');
    dpPick('2026-08-07');
    dpDone();
    const vals = {
      ci: document.getElementById(uid + '-ci').value,
      co: document.getElementById(uid + '-co').value,
      label: document.getElementById(uid + '-display').innerText.trim(),
    };
    await chatAvailRun(uid);
    const bots = Array.from(document.querySelectorAll('#chat-thread .chat-bot'));
    return Object.assign(vals, { last: bots.length ? bots[bots.length - 1].innerText : '' });
  }, cav.uid);
  ok(ran.ci === '2026-08-04' && ran.co === '2026-08-07',
    `the pick fills the ids chatAvailRun reads (${ran.ci} → ${ran.co})`);
  ok(/4 Aug/.test(ran.label), `…and the bubble's trigger reads them back ("${ran.label}")`);
  ok(!/choose a cottage and both dates/i.test(ran.last),
    'so "Check dates" answers instead of asking again for what was just picked');
  ok(/free for/i.test(ran.last) || /isn.t available/i.test(ran.last) || /minimum/i.test(ran.last),
    `…with a real answer about those nights ("${ran.last.replace(/\s+/g, ' ').slice(0, 70)}")`);

  await page.evaluate(() => {
    closeDatePicker();
    delete propertyMeta['pimpernel'];
    delete propertyRates['pimpernel'];
    const i = propertyList.findIndex((p) => p.prop_key === 'pimpernel');
    if (i >= 0) propertyList.splice(i, 1);
  });

  console.log('15. the picker tells the truth on EVERY channel, not just the visible one');
  // §14 fixed the LEGEND. Four things below it had not learned the same lesson, all
  // measured on the merged code before being fixed.
  await page.evaluate(() => {
    closeDatePicker();
    activeFrontProperty = 'jollyboat';
    openWaitlistModal({ prop: 'jollyboat' });
  });
  await page.waitForTimeout(150);
  await page.click('#wl-date-trigger');
  await page.waitForTimeout(450);
  await page.evaluate(() => { dpState.view = new Date(2026, 7, 1); renderDatePicker(); });
  await page.waitForTimeout(120);

  // (a) A CROSSED CELL THAT IS SELECTABLE MUST NOT BE ANNOUNCED AS UNAVAILABLE. It was
  // a role="button" labelled "07/08/2026 — booked" with no title at all, on the one
  // surface whose whole purpose is picking those nights.
  const dayCell = (day) => page.evaluate((d) => {
    const el = document.querySelector(`#dp-grid .dp-day[data-day="2026-08-${String(d).padStart(2, '0')}"]`);
    return el && { label: el.getAttribute('aria-label'), title: el.getAttribute('title'), role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex'), act: el.getAttribute('data-act'), crossed: el.classList.contains('dp-booked') };
  }, day);
  const booked = await dayCell(7);
  ok(booked && booked.crossed && booked.act === 'dpPick', 'a booked night on the waitlist is crossed and pickable');
  ok(/still pick it/i.test(booked.label || ''),
    `…and says so to a screen reader, not just "booked" ("${booked.label}")`);
  ok(/still pick it/i.test(booked.title || ''), `…and on hover too ("${booked.title}")`);

  // (b) ONE TAB STOP, THEN ARROWS. Every clickable day used to carry tabindex="0" — 35
  // stops inside the picker, up to 31 of them to cross a month.
  const seats = await page.evaluate(() => {
    const live = Array.from(document.querySelectorAll('#dp-grid .dp-day[data-act="dpPick"]'));
    return { live: live.length, stops: live.filter((el) => el.getAttribute('tabindex') === '0').length };
  });
  ok(seats.live > 10 && seats.stops === 1,
    `exactly one day carries the tab stop (${seats.stops} of ${seats.live} pickable)`);
  // Arrows move it, and Enter on the arrived-at cell picks THAT day — so the keyboard
  // path reaches a real selection, which is the only thing that matters here.
  await page.evaluate(() => {
    dpClear();
    const first = document.querySelector('#dp-grid .dp-day[data-day="2026-08-04"]');
    first.setAttribute('tabindex', '0');
    first.focus();
    __dpFocusDay = '2026-08-04';
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const moved = await page.evaluate(() => (document.activeElement.getAttribute ? document.activeElement.getAttribute('data-day') : null));
  ok(moved === '2026-08-05', `ArrowRight moves the day focus (landed on ${moved})`);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(80);
  const wk = await page.evaluate(() => (document.activeElement.getAttribute ? document.activeElement.getAttribute('data-day') : null));
  ok(wk === '2026-08-12', `ArrowDown moves a week (landed on ${wk})`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const picked = await page.evaluate(() => dpState.start);
  ok(picked === '2026-08-12', `Enter picks the day the arrows arrived at (${picked})`);
  ok(await page.evaluate(() => {
    const el = document.querySelector('#dp-grid .dp-day[data-day="2026-08-12"]');
    return !!el && document.activeElement === el;
  }), '…and the re-render keeps focus on it rather than dropping it to the body');

  // (c) THE HINT IS ANNOUNCED. It is the only progress report and it changed silently.
  const hintEl = await page.evaluate(() => {
    const el = document.getElementById('dp-hint');
    return { role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: el.innerText.trim() };
  });
  ok(hintEl.role === 'status' && hintEl.live === 'polite',
    `the hint is a live region (role=${hintEl.role} aria-live=${hintEl.live})`);
  ok(/check-out/i.test(hintEl.text), `…carrying what is left to do ("${hintEl.text}")`);

  // (d) BOTH OR NEITHER, and Done says so. A lone check-in is stored as an OPEN-DATED
  // wait by waitlist.php's notifier, so the guest would hear about every cancellation
  // while believing they were waiting for that one day.
  const lone = await page.evaluate(() => {
    dpDone();
    return {
      closed: !document.getElementById('date-picker').classList.contains('open'),
      hint: document.getElementById('dp-hint').innerText.trim(),
      ci: document.getElementById('wl-checkin').value,
    };
  });
  ok(!lone.closed && lone.ci === '', 'Done on a lone check-in does not close or write a half range');
  ok(/check-out date too/i.test(lone.hint) && /any dates/i.test(lone.hint),
    `…and names BOTH ways out ("${lone.hint}")`);
  const bothOk = await page.evaluate(() => {
    dpPick('2026-08-04');
    dpPick('2026-08-07');
    dpDone();
    return { ci: document.getElementById('wl-checkin').value, co: document.getElementById('wl-checkout').value, closed: !document.getElementById('date-picker').classList.contains('open') };
  });
  ok(bothOk.closed && bothOk.ci && bothOk.co, 'a complete range still closes and writes both');

  // …and the SUBMIT refuses a half range too, because a PREFILL can arrive half-filled
  // from the hero search and never touches the picker.
  const submitted = await page.evaluate(async () => {
    document.getElementById('wl-checkout').value = '';
    document.getElementById('wl-email').value = 'g@example.com';
    let posted = false;
    const real = window.apiPost;
    window.apiPost = () => { posted = true; return Promise.resolve({ ok: true }); };
    await submitWaitlist();
    window.apiPost = real;
    return { posted, msg: (document.getElementById('wl-msg') || {}).textContent || '' };
  });
  ok(!submitted.posted, 'a half range is never posted to the waitlist');
  ok(/both dates/i.test(submitted.msg), `…and the modal says why ("${submitted.msg}")`);

  // (e) THE PAST IS NOT ON OFFER. Paging was unbounded — measured, 14 taps reached June
  // 2025 with 0 pickable cells and ‹ still enabled.
  const past = await page.evaluate(() => {
    closeWaitlistModal();
    document.getElementById('enq-checkin').value = '';
    document.getElementById('enq-checkout').value = '';
    openDatePicker();
    for (let i = 0; i < 14; i++) dpChangeMonth(-1);
    const cells = Array.from(document.querySelectorAll('#dp-grid .dp-day'));
    return {
      title: document.getElementById('dp-title').innerText,
      pickable: cells.filter((el) => el.getAttribute('data-act')).length,
      prevDisabled: document.querySelector('.dp-nav-btn[data-arg="-1"]').disabled,
    };
  });
  ok(/July 2026/i.test(past.title),
    `14 taps back cannot leave the current month (showing ${past.title})`);
  ok(past.prevDisabled, '…and ‹ is disabled there, so it does not look broken');
  ok(past.pickable > 0, '…leaving a month with dates that can actually be picked');
  // Admin back-dates on purpose, so the floor must not apply to the owner.
  const adminPast = await page.evaluate(() => {
    closeDatePicker();
    dpMode = 'admin';
    dpState.view = new Date(2026, 6, 1);
    dpChangeMonth(-1);
    const t = document.getElementById('dp-title').innerText;
    dpMode = 'enquiry';
    return t;
  });
  ok(/June 2026/i.test(adminPast), `admin can still page into the past (${adminPast})`);
  await page.evaluate(() => closeDatePicker());

  console.log('16. a night that is for sale says what it costs');
  // The cottage page's read-only calendar has shown per-night prices for ages
  // (`.ac-price`) and the picker did not, so a guest choosing dates could not see that a
  // Tuesday is £130 and the Saturday £150 without leaving the modal. Same helper, same
  // cottage — dpNightPrice → nightlyRateFor — so the two calendars cannot quote different
  // money for one night.
  //
  // TWO fixtures, because one cannot exercise both halves. The ARITHMETIC needs an EMPTY
  // calendar (this month's real fixture books every free Saturday, so there is no
  // non-season weekend night left to price), and the REFUSALS need the real one. Driven
  // with a weekend uplift AND a season, because a flat rate would let a broken
  // derivation pass by printing one number everywhere.
  await page.evaluate(() => {
    closeDatePicker();
    propertyRates['jollyboat'] = Object.assign({}, propertyRates['jollyboat'], {
      minNights: 2, coupleRate: 130, weekendPct: 15, weekendDays: '5,6',
    });
    propertySeasons['jollyboat'] = [
      { start_date: '2026-08-15', end_date: '2026-08-31', couple_rate: 175, label: 'Peak' },
    ];
  });
  // PER_PROP, not AVAIL: openDatePicker fetches `?prop=jollyboat`, and the per-cottage
  // route added for §14 answers that from PER_PROP — so clearing AVAIL changes nothing
  // here (measured: still 5 ranges), which is what the vacuity check below catches.
  PER_PROP.jollyboat = [];
  await openAtEmpty();
  const money = await page.evaluate(() => {
    const at = (d) => document.querySelector(`#dp-grid .dp-day[data-day="2026-08-${d}"]`);
    const priceOf = (d) => { const c = at(d); const p = c && c.querySelector('.dp-price'); return p ? p.textContent.trim() : null; };
    const cells = [...document.querySelectorAll('#dp-grid .dp-day')];
    const card = document.querySelector('.datepicker-card').getBoundingClientRect();
    return {
      base: priceOf('04'), // Tuesday, base rate
      weekend: priceOf('01'), // Saturday, +15%
      season: priceOf('16'), // Sunday inside Peak
      seasonWeekend: priceOf('15'), // Saturday inside Peak — both uplifts compose
      priced: cells.filter((c) => c.querySelector('.dp-price')).length,
      overflowing: cells.filter((c) => { const r = c.getBoundingClientRect(); return r.right > card.right + 0.5 || r.bottom > card.bottom + 0.5; }).length,
      clipped: cells.filter((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1).length,
      tap: Math.round(at('04').getBoundingClientRect().height),
      px: parseFloat(getComputedStyle(at('04').querySelector('.dp-price')).fontSize),
      // STACKED, not beside. Without flex-direction: column the two sit side by side and
      // the flex row simply squeezes them — nothing overflows and nothing clips, so the
      // overflow check below does NOT gate the layout (break-tested). This does.
      stacked: (() => {
        const c = at('04');
        const n = c.querySelector('.dp-num').getBoundingClientRect();
        const p = c.querySelector('.dp-price').getBoundingClientRect();
        return p.top >= n.bottom - 0.5;
      })(),
    };
  });
  ok(money.base === '£130', `a plain night carries its nightly rate (${money.base})`);
  ok(money.weekend === '£150', `…the weekend uplift is in it (Sat 1 Aug = ${money.weekend})`);
  ok(money.season === '£175', `…a season rate replaces the base (Sun 16 Aug = ${money.season})`);
  ok(money.seasonWeekend === '£201',
    `…and the two compose, as priceBreakdown composes them (peak Sat = ${money.seasonWeekend})`);
  ok(money.priced === 31, `every night of an empty August is priced (${money.priced})`);
  ok(money.px >= 10, `the figure clears the 10px floor (${money.px}px)`);
  ok(money.overflowing === 0 && money.clipped === 0,
    `and no cell grows past the card or clips (${money.overflowing} over, ${money.clipped} clipped)`);
  ok(money.tap >= 24, `…with the tap target unchanged (${money.tap}px)`);
  ok(money.stacked, 'the price sits UNDER the day number, not beside it');

  // Now the REAL fixture, which is what has refused nights to be silent about.
  PER_PROP.jollyboat = RANGES;
  await openAt();
  const refused = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#dp-grid .dp-day')];
    const priced = (sel) => cells.filter((c) => c.classList.contains(sel) && c.querySelector('.dp-price')).length;
    return {
      onBooked: priced('dp-booked'),
      onPast: priced('dp-disabled'),
      onOut: priced('dp-out'),
      // 4,5,10,15,16,17,24,25,26,31 — the free nights a stay can START on, with 6/11/18/27
      // crossed by the 2-night minimum and the rest booked.
      priced: cells.filter((c) => c.querySelector('.dp-price')).length,
    };
  });
  ok(refused.onBooked === 0 && refused.onOut === 0 && refused.onPast === 0,
    `no price on a night the picker refuses (booked ${refused.onBooked}, out-of-reach ${refused.onOut}, past ${refused.onPast})`);
  ok(refused.priced === 10,
    `…and exactly the ten sellable nights carry one (${refused.priced})`);

  // THE CHOSEN CHECKOUT IS NOT A NIGHT THEY PAY FOR, so it must not be priced — the one
  // place a figure would state something untrue about the stay on screen.
  const legs = await page.evaluate(() => {
    dpClear();
    dpPick('2026-08-04');
    dpPick('2026-08-06');
    const at = (d) => document.querySelector(`#dp-grid .dp-day[data-day="2026-08-${d}"]`);
    const priceOf = (d) => { const c = at(d); const p = c && c.querySelector('.dp-price'); return p ? p.textContent.trim() : null; };
    // On a SELECTED cell the ground flips dark, so the price must take the selection's
    // own ink (2.39:1 measured with --text-muted). Compared to the day NUMBER beside it
    // rather than by arithmetic: if the number is legible there, so is the price.
    const start = at('04');
    return {
      checkin: priceOf('04'), mid: priceOf('05'), checkout: priceOf('06'),
      inkMatches: getComputedStyle(start.querySelector('.dp-price')).color ===
        getComputedStyle(start.querySelector('.dp-num')).color,
    };
  });
  ok(legs.checkin === '£130' && legs.mid === '£130',
    `the nights of the stay keep their prices (${legs.checkin} / ${legs.mid})`);
  ok(legs.checkout === null, 'the chosen CHECKOUT carries none — it is not a night paid for');
  ok(legs.inkMatches, '…and a selected cell prices in its own ink, not the muted one');

  // ADMIN IS OUT. The owner is moving a booking, not shopping — and every cell there is
  // pickable, so a price would appear on nights that are already sold.
  const adminMoney = await page.evaluate(() => {
    closeDatePicker();
    dpMode = 'admin';
    dpState.view = new Date(2026, 7, 1);
    document.getElementById('date-picker').classList.add('open');
    renderDatePicker();
    const n = document.querySelectorAll('#dp-grid .dp-price').length;
    dpMode = 'enquiry';
    closeDatePicker();
    return n;
  });
  ok(adminMoney === 0, `the owner's picker shows no prices (${adminMoney})`);

  // The waitlist CAN pick a booked night — but a sold night has no price to offer.
  await page.evaluate(() => { openWaitlistModal({ prop: 'jollyboat' }); openWaitlistDatePicker(); });
  await page.waitForTimeout(450);
  const wlMoney = await page.evaluate(() => {
    dpState.view = new Date(2026, 7, 1);
    renderDatePicker();
    const cells = [...document.querySelectorAll('#dp-grid .dp-day')];
    return {
      booked: cells.filter((c) => c.classList.contains('dp-booked') && c.querySelector('.dp-price')).length,
      free: cells.filter((c) => !c.classList.contains('dp-booked') && c.querySelector('.dp-price')).length,
    };
  });
  ok(wlMoney.booked === 0 && wlMoney.free > 5,
    `on the waitlist a sold night is pickable but unpriced (${wlMoney.booked} priced of the booked, ${wlMoney.free} free)`);
  await page.evaluate(() => { closeDatePicker(); closeWaitlistModal(); });

  console.log('17. the stay total, and the one screen it may appear on');
  // The picker can now say what the whole stay costs — but only where it can know, and
  // only through the function the screen behind it already quotes from. On the other
  // three modes the ONLY computable total is the sum of the nights, which omits extra
  // adults, children and the card fee: measured 22-86% under the real ask, so they get
  // none. Same fixture as §16 (weekend uplift + peak season + extras + card fee).
  await page.evaluate(() => {
    closeDatePicker();
    propertyRates['jollyboat'] = Object.assign({}, propertyRates['jollyboat'], {
      minNights: 2, coupleRate: 130, extraAdultRate: 25, childRate: 15,
      transactionPct: 3, damagesDeposit: 75, weekendPct: 15, weekendDays: '5,6',
    });
    propertySeasons['jollyboat'] = [];
  });
  PER_PROP.jollyboat = [];
  const totalFor = (a, k) => page.evaluate(([adults, children]) => {
    activeFrontProperty = 'jollyboat';
    document.getElementById('enq-adults').value = String(adults);
    document.getElementById('enq-children').value = String(children);
    document.getElementById('enq-checkin').value = '';
    document.getElementById('enq-checkout').value = '';
    openDatePicker();
    dpState.view = new Date(2026, 7, 1);
    dpPick('2026-08-04');
    dpPick('2026-08-07');
    const h = document.getElementById('dp-hint');
    const fig = h.querySelector('.dp-fig');
    return {
      text: h.innerText.replace(/\s+/g, ' ').trim(),
      money: (h.innerText.match(/£[\d,.]+/) || [])[0] || null,
      role: h.getAttribute('role'),
      live: h.getAttribute('aria-live'),
      // Emphasis is WEIGHT at the sentence's own size — the search hero's lesson.
      weight: fig && getComputedStyle(fig).fontWeight,
      sameSize: fig && getComputedStyle(fig).fontSize === getComputedStyle(h).fontSize,
    };
  }, [a, k]);

  const two = await totalFor(2, 0);
  ok(two.money === '£401.70', `a couple's three midweek nights price at the real total (${two.money})`);
  ok(/3 nights/.test(two.text) && /for 2 adults/.test(two.text),
    `…and the sentence names the nights and the party ("${two.text}")`);
  ok(two.role === 'status' && two.live === 'polite',
    'the figure lands in the hint, which is already the live region — so it is announced');
  ok(two.weight === '700' && two.sameSize,
    `…emphasised by weight at the sentence's own size (${two.weight}, same size ${two.sameSize})`);

  // THE PARTY IS IN IT. This is the whole reason the sum of the nights would not do:
  // four adults and two children pay £648.90 for the same three £130 nights.
  const six = await totalFor(4, 2);
  ok(six.money === '£648.90', `the party moves the figure (4 adults + 2 children = ${six.money})`);
  ok(/4 adults, 2 children/.test(six.text), `…and is named in full ("${six.text}")`);
  ok(six.money !== two.money, '…so the sum of the nights (£390 for both) could not have served');

  // THE FIGURE MUST MATCH THE SCREEN IT SITS ON. The enquiry price box and the book bar
  // already quote this stay; a deposit-inclusive headline here would be a third framing
  // of the same money, seconds before the guest reads the second one.
  const agree = await page.evaluate(() => {
    document.getElementById('enq-adults').value = '2';
    document.getElementById('enq-children').value = '0';
    document.getElementById('enq-checkin').value = '';
    document.getElementById('enq-checkout').value = '';
    openDatePicker();
    dpState.view = new Date(2026, 7, 1);
    dpPick('2026-08-04');
    dpPick('2026-08-07');
    const inPicker = (document.getElementById('dp-hint').innerText.match(/£[\d,.]+/) || [])[0];
    dpDone();
    try { updateEnquiryPrice(); } catch (e) {}
    const box = (document.getElementById('enq-price-box') || {}).innerText || '';
    const bar = (document.getElementById('prop-book-bar') || {}).innerText || '';
    return {
      inPicker,
      inBox: (box.match(/£[\d,.]+/) || [])[0],
      deposit: (box.match(/£[\d,.]+/g) || [])[1],
      inBar: (bar.match(/£[\d,.]+/) || [])[0],
    };
  });
  ok(agree.inPicker === agree.inBox && agree.inBox === agree.inBar,
    `one figure in all three places (picker ${agree.inPicker}, price box ${agree.inBox}, book bar ${agree.inBar})`);
  ok(agree.deposit === '£75.00',
    `…with the refundable deposit still on its OWN row, not folded in (${agree.deposit})`);

  // THE OTHER THREE MODES SAY NOTHING. Each would have to fall back to the sum of the
  // nights, and a figure 22-86% light is worse than no figure.
  const silent = await page.evaluate(() => {
    const money = () => (document.getElementById('dp-hint').innerText.match(/£/) ? 'has money' : '');
    const out = {};
    closeDatePicker();
    openHeroDatePicker(); dpState.view = new Date(2026, 7, 1);
    dpPick('2026-08-04'); dpPick('2026-08-07');
    out.search = money();
    closeDatePicker();
    openWaitlistModal({ prop: 'jollyboat' }); openWaitlistDatePicker();
    dpState.view = new Date(2026, 7, 1);
    dpPick('2026-08-04'); dpPick('2026-08-07');
    out.fields = money();
    closeDatePicker(); closeWaitlistModal();
    dpMode = 'admin';
    dpState.start = '2026-08-04'; dpState.end = '2026-08-07';
    dpState.view = new Date(2026, 7, 1);
    document.getElementById('date-picker').classList.add('open'); renderDatePicker();
    out.admin = money();
    dpMode = 'enquiry'; closeDatePicker();
    return out;
  });
  ok(silent.search === '' && silent.fields === '' && silent.admin === '',
    'the hero search, the waitlist/chat and admin show no total at all');

  // A STAY THE FORM WILL REFUSE IS NOT PRICED. The hero search seeds any dates, so a
  // seeded range can break the cottage's minimum — and pricing that is worse than mute.
  const illegal = await page.evaluate(() => {
    document.getElementById('enq-checkin').value = '2026-08-04';
    document.getElementById('enq-checkout').value = '2026-08-05'; // 1 night, minimum is 2
    openDatePicker();
    dpState.view = new Date(2026, 7, 1);
    renderDatePicker();
    return document.getElementById('dp-hint').innerText.replace(/\s+/g, ' ').trim();
  });
  ok(!/£/.test(illegal), `a seeded stay under the minimum carries no price ("${illegal}")`);
  await page.evaluate(() => closeDatePicker());
  PER_PROP.jollyboat = RANGES;

  console.log(fails ? `\n  DATEPICKER SUITE FAILED ❌ (${fails})` : '\n  DATEPICKER SUITE PASSED ✅');
  await done(fails);
})();
