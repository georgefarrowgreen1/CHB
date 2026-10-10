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
//     cut mid-word — measured, up to 51% of the words lost at 360px. AND NO
//     `.acr-cap` CAPTION WRAPS: that tier is 11px tracked uppercase, which only
//     works on a NOUN, and nine cottage-page captions were whole sentences
//     wearing it (the worst painted three lines above an empty well). Asserted
//     as one painted line, with a floor so "shorten it" cannot become a stub.
//  §3 THE MANAGE ROWS ARE ONE LINE EACH. It used to measure the orphaned last
//     word in each row's description; the one-look pass took the descriptions
//     off, so it asserts what replaced them: no description, one-line labels.
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
        // `unknown` carries a 40-DAY-OLD charge on purpose: it is what makes the
        // Money landing render its "Square hasn't said" exception, whose sub the
        // fixture had never once produced — so the gate had not seen the one sub
        // on that page that was actually being cut ("…it should be by…" at 390).
        payouts: { known: 4, inBank: 1852.62, lookback: 90, items: {
          inBank: [{ name: 'Tom Ashby', kind: 'balance', movable: 900 }],
          unknown: [{ name: 'Ines Duarte', kind: 'deposit', movable: 491.25, paid_on: d(-40) }],
        } } } });
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

  // THE WINDOW'S FIRST COLUMN CARRIES NO MONTH LABEL, and a month label and a changeover
  // mark never share a column. The caption above the grid names the month under the left
  // edge, so the first-column label ("Oct 2026", 59px in a 32px column) said it twice and
  // spilled into the next day, where a changeover ↺ painted through it ("Oct↺2026").
  // Pinned to the 4th, the day the owner screenshotted it, plus the 1st (the one case where
  // a label and a changeover can still want the same column) and mid-month.
  const FIXTURE = (day) => {
    // changeovers on the pinned day's own neighbours: someone leaves and someone arrives.
    const iso = (n) => { const x = new Date(new Date().getFullYear(), 8, n); return todayDashed().slice(0, 0) + x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const mk = (id, ci, co) => ({ id, dbId: id, propKey: 'jollyboat', name: 'Fx ' + id, checkIn: iso(ci), checkOut: iso(co), adults: 2, children: 0, payment: 'paid', depositPaid: 1 });
    const days = [day - 1, day, 1].filter((v, i, a) => a.indexOf(v) === i);
    const out = []; let id = 9000;
    days.forEach((n) => { out.push(mk(id++, n - 2, n)); out.push(mk(id++, n, n + 2)); });
    dbBookings['jollyboat'] = out;
  };
  for (const [day, label] of [[4, 'the 4th (your screenshot)'], [1, 'the 1st'], [15, 'mid-month']]) {
    // 14:15, the time on the screenshot: the playhead sits 59% across the day, which is where
    // it crosses the digit (at 10:00 it is over the weekday letter and the check proves nothing).
    await page.clock.setFixedTime(new Date(yr, 8, day, 14, 15, 0));
    await page.setViewportSize({ width: 390, height: 900 });
    await reCal();
    await page.evaluate(FIXTURE, day);
    await page.evaluate(() => renderCalendar());
    await page.waitForTimeout(250);
    await page.evaluate(() => tlPlaceNowLine());
    const r = await page.evaluate(() => {
      const first = document.querySelector('#cal-body .tl-headrow .tl-day');
      const days = [...document.querySelectorAll('#cal-body .tl-headrow .tl-day')];
      const box = (e) => e.getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      let labelChg = 0;
      const sharedColumn = days.filter((d) => d.querySelector('b') && d.querySelector('.tl-chg')).length;
      const labs = days.flatMap((d) => [...d.querySelectorAll('b')]), chgs = days.flatMap((d) => [...d.querySelectorAll('.tl-chg')]);
      labs.forEach((l) => chgs.forEach((c) => { if (hit(box(l), box(c))) labelChg++; }));
      const num = document.querySelector('#cal-body .tl-headrow .tl-day.is-today .tl-num');
      const line = document.querySelector('#cal-body .tl-nowline');
      const lineVsNum = num && line && hit(box(num), box(line)) ? 1 : 0;
      const wide = labs.filter((l) => l.getBoundingClientRect().width > l.parentElement.getBoundingClientRect().width).length;
      return { firstHasLabel: !!first.querySelector('b'), labelChg, sharedColumn, lineVsNum, hasNum: !!num, hasLine: !!line, wide, chg: chgs.length, pips: document.querySelectorAll('#cal-body .tl-occ').length };
    });
    ok(!r.firstHasLabel, `${label}: the window's first column carries no month label`);
    // The ↺ marks and the occupancy pips are GONE (the simpler Today) — asserted as an absence, with
    // the fixture really holding changeovers, so it cannot pass because there was nothing to draw.
    ok(r.chg === 0 && r.pips === 0, `${label}: the header draws no ↺ marks and no occupancy pips (${r.chg} / ${r.pips})`);
    ok(r.wide === 0, `${label}: no month label is wider than its own column`);
    ok(r.hasNum && r.hasLine, `${label}: today's number and the playhead both paint`);
    ok(r.lineVsNum === 0, `${label}: the playhead does not strike through today's day number`);
  }
  await page.clock.setFixedTime(new Date());
  await page.evaluate(() => { dbBookings['jollyboat'] = []; });
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
      // The one-look Manage and the one Payments page carry fewer fold rows than
      // when this was written (two each in the fixture); the floor follows, so the
      // truncation check below still reads real subs.
      ok(n >= 2, `${w}px ${name}: ${n} summary subs on screen`);
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

  // A CAPTION IS A NOUN, NOT A SENTENCE — the same rule one tier up. `.acr-cap`
  // is 11px TRACKED UPPERCASE, which only works on two or three words: measured
  // before this check, nine of the cottage page's captions were 41–80-character
  // sentences and the worst painted 320×53 — three shouted lines above an empty
  // well. The explanation moved to `.acr-capsub` under it, in sentence case.
  // Asserted as ONE PAINTED LINE (a Range over the ink, not the box), so the
  // copy cannot re-grow, plus a floor so "shorten it" cannot become a stub.
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    await page.evaluate(async () => {
      await openArea('manage');
      settingsOpen('accom');
      settingsOpenAccom('21a');
      ['photos', 'web', 'faq', 'welcome', 'arrival', 'local', 'safety', 'opsnotes', 'location'].forEach((sec) => settingsOpenAccomSec('21a', sec));
    });
    await page.waitForTimeout(600);
    const caps = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.acr-cap')) {
        if (!el.getClientRects().length) continue;
        const r = document.createRange(); r.selectNodeContents(el);
        const lines = [...r.getClientRects()].filter((x) => x.width > 1).length;
        out.push({ t: (el.textContent || '').trim(), lines });
      }
      return out;
    });
    const multi = caps.filter((c) => c.lines > 1);
    ok(caps.length >= 6, `${w}px cottage sections: ${caps.length} captions painted (vacuity guard)`);
    ok(multi.length === 0, `${w}px: every caption is one line${multi.length ? ' — ' + multi.map((c) => `“${c.t}” ${c.lines} lines`).join('; ') : ''}`);
    ok(caps.every((c) => c.t.length >= 3), 'and none of them is a stub');
    if (w === 390) {
      const subs = await page.evaluate(() => [...document.querySelectorAll('.acr-capsub')].filter((e) => e.getClientRects().length).map((e) => (e.textContent || '').trim().length));
      // The one-look pass took the explanations off the cottage editors: a
      // caption names its well, and the controls inside say the rest.
      ok(subs.length === 0, `no explanation line under the captions (${subs.length} painted)`);
    }
  }

  // ------------------------------------------------------- §3 the orphans
  console.log('\n§3 The Manage rows are one line each');
  const pretty = await page.evaluate(() => {
    const e = document.querySelector('.settings-row-sub');
    return e ? getComputedStyle(e).textWrap || getComputedStyle(e).textWrapStyle : '';
  });
  ok(/pretty/.test(pretty), `.settings-row-sub carries text-wrap: pretty (${pretty})`);
  // The one-look pass took the descriptions off the Manage rows (a row says
  // where it goes), so there is no description left to orphan a word in — the
  // account row's sub (its name) is the one survivor and keeps the rule. What
  // must hold now is the outcome: every row label is ONE line at phone width.
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await openArea('manage'); });
    await page.waitForFunction(() => document.querySelectorAll('#settings-index .settings-row').length > 5, { timeout: 12000 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      // The cottage rows keep their price ("from £130 a night") and a problem row
      // under Needs a look keeps its reason — both are data, not explanation.
      const rows = [...document.querySelectorAll('#settings-index .settings-row')].filter((x) => x.getClientRects().length && !x.closest('#cottages-overview') && !x.classList.contains('mg-prob'));
      const subs = rows.filter((x) => { const sb = x.querySelector('.settings-row-sub'); return sb && sb.id !== 'oa-index-sub' && sb.getClientRects().length && sb.textContent.trim(); }).length;
      const multi = rows.filter((x) => {
        const l = x.querySelector('.settings-row-label');
        if (!l) return false;
        const rg = document.createRange(); rg.selectNodeContents(l);
        return new Set([...rg.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top))).size > 1;
      }).map((x) => (x.querySelector('.settings-row-label') || x).textContent.trim());
      return { n: rows.length, subs, multi };
    });
    ok(r.n > 10 && r.subs === 0, `${w}px: ${r.n} Manage rows, none with a description beneath (${r.subs})`);
    ok(r.multi.length === 0, `${w}px: every row label is one line${r.multi.length ? ' — ' + r.multi.join('; ') : ''}`);
  }

  console.log(`\n${fails ? fails + ' FAILED' : 'All legibility checks passed'}`);
  await done(fails);
})();
