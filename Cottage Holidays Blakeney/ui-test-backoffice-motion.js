// FIVE BACK-OFFICE MOTIONS, in a real browser. Measured starting point: app.css
// carries 99 animations and admin.css 38, and of every row type in the app only
// .ny-row had an entrance — the owner's side of the product barely moved.
//
//  §1 THE FOLD moves, and `hidden` stays the one synchronous switch: a closed
//     fold is 0px and out of the tab order, an opening one is mid-flight one
//     frame later and settled at full height after, a closing one is still
//     visible while it closes and gone the moment it has. Reduced motion snaps.
//  §2 THE ANSWER ARRIVING — the Money landing's slow answers animate when they
//     land, staggered, and the synchronous first paint does not.
//  §3 A FIGURE THAT CHANGED SAYS SO — the owed capsule SETTLES on a change and
//     stays still on a repaint that changed nothing; the dock badge POPS.
//  §4 THE TIMELINE draws in ONCE per visit, staggered, and never again.
//  §5 THE FILTER SWITCH cross-fades on a subject change, never on a refresh.
//
// SAMPLING RULE, learned the hard way in ui-test-searchpage §17a and again in
// ui-test-flowmotion: SEEK, never race. Where a keyframe's shape is the claim,
// pause the animation and set currentTime — and do the seek LAST, because a
// paused CSS animation does not resume into a clean flight.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });

  // Two upcoming stays (one owing, one paid) and a past one, so the bookings
  // filters have something distinct to switch between; one iCal block so the
  // timeline has a bar that is not a booking.
  const BK = [
    { id: 1, prop_key: '21a', name: 'Sarah Pemberton', email: 'sarah@example.com', check_in: d(3), check_out: d(7), adults: 2, children: 0, deposit_paid: 0, payment: 'unpaid', payment_method: 'Card', hold_status: 'none', notes: '' },
    { id: 2, prop_key: 'jollyboat', name: 'Tom Ashby', email: 'tom@example.com', check_in: d(9), check_out: d(12), adults: 2, children: 0, deposit_paid: 900, payment: 'paid', payment_method: 'Card', hold_status: 'none', notes: '' },
    { id: 3, prop_key: '21a', name: 'Ines Duarte', email: 'ines@example.com', check_in: d(-20), check_out: d(-16), adults: 2, children: 0, deposit_paid: 700, payment: 'paid', payment_method: 'Card', hold_status: 'none', notes: '' },
  ];
  // §2 needs the accounts fetch to land AFTER the sync paint — that is the whole
  // point of the motion — so it is deliberately delayed.
  let acctDelay = 250;
  await page.route(/\.php/, async (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (url.includes('admin-bootstrap.php')) return json({ ok: true, cron: { stale: false, everRan: true, ageHours: 2 }, feeds: [] });
    if (url.includes('accounts.php')) {
      await new Promise((r) => setTimeout(r, acctDelay));
      return json({
        ok: true, total: 18204.11, card_fees: 210.4, kept_deposits: 0, payments: [],
        deposit_liability: {
          net: 150, items: [{ name: 'Sarah Pemberton', net: 75, check_in: d(3), check_out: d(7) }, { name: 'Tom Ashby', net: 75, check_in: d(9), check_out: d(12) }],
          payouts: { known: 4, inBank: 1852.62, lookback: 90, items: { inBank: [{ name: 'Tom Ashby', kind: 'balance', movable: 900 }], unknown: [] } },
        },
      });
    }
    if (url.includes('bookings.php') && b.action === 'recent_payments') {
      await new Promise((r) => setTimeout(r, acctDelay));
      return json({ ok: true, payments: [{ name: 'Tom Ashby', kind: 'balance', amount: '900.00', created_at: d(-1) + ' 10:00:00' }] });
    }
    if (url.includes('rates.php')) return json({ properties: [
      { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 150, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    return json({
      ok: true, bookings: BK, enquiries: [], threads: [], events: [], logs: {}, content: {},
      blocks: [{ id: 90, prop_key: 'jollyboat', check_in: d(2), check_out: d(5), source: 'airbnb' }],
      ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [],
    });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(800);
  await page.evaluate(async () => { await loadData(); });
  await page.waitForTimeout(600);

  // ------------------------------------------------------------------ §1 fold
  console.log('\n§1 The disclosure fold moves — and `hidden` still means what it did');
  await page.evaluate(() => openBookingHub(1));
  // Wait on STATE, never a clock: under CI's concurrent load the hub can take
  // well past a fixed timeout to paint, and a fold that is not there yet reads
  // exactly like a fold that does not move.
  await page.waitForFunction(() => {
    const f = document.getElementById('bhub-fold-guest');
    return !!(f && f.querySelector('.bhub-kv'));
  }, { timeout: 15000 });

  const foldBox = () => page.evaluate(() => {
    const f = document.getElementById('bhub-fold-guest');
    if (!f) return null;
    const cs = getComputedStyle(f);
    return { h: f.getBoundingClientRect().height, hidden: f.hidden, vis: cs.visibility, rows: cs.gridTemplateRows };
  });

  let st = await foldBox();
  ok(!!st, 'the hub renders a Guest details fold');
  ok(st && st.hidden === true && st.h < 1, `closed: hidden true and 0px high (${st && Math.round(st.h)})`);
  ok(st && st.vis === 'hidden', 'closed: visibility hidden — out of the tab order and the a11y tree');
  // The single-child rule the 0fr grid depends on: a second child would sit at
  // its own auto height with the first one shut.
  ok(await page.evaluate(() => document.getElementById('bhub-fold-guest').children.length === 1),
    'the fold holds exactly ONE element child (the 0fr grid collapses only the first track)');

  await page.evaluate(() => bhubFoldToggle('guest'));
  const mid = await foldBox();
  ok(mid && mid.hidden === false, 'opening: `hidden` is false synchronously — every f.hidden read in the app still holds');
  ok(mid && mid.vis === 'visible', 'opening: visible at once, with no delay on the way in');
  await page.waitForFunction(() => {
    const f = document.getElementById('bhub-fold-guest');
    return f.getBoundingClientRect().height > 60 && f.getAnimations().every((a) => a.playState !== 'running');
  }, { timeout: 8000 });
  const open = await foldBox();
  ok(open && open.h > 60, `open: settled at full height (${open && Math.round(open.h)}px)`);
  ok(mid && open && mid.h < open.h * 0.85, `it MOVED — ${Math.round(mid.h)}px one frame in against ${Math.round(open.h)}px settled`);

  const chev = await page.evaluate(() => {
    const c = document.querySelector('[data-grp="guest"] .bhub-chev');
    return { t: getComputedStyle(c).transform, dur: getComputedStyle(c).transitionDuration };
  });
  ok(/matrix/.test(chev.t) && chev.t !== 'none', 'the chevron turned with it');
  ok(chev.dur === '0.32s', `and turns over the fold's own 0.32s, not its old 0.18s (${chev.dur})`);

  await page.evaluate(() => bhubFoldToggle('guest'));
  const closing = await foldBox();
  ok(closing && closing.hidden === true, 'closing: `hidden` is true synchronously — the gates that read it are unchanged');
  ok(closing && closing.vis === 'visible', 'closing: still VISIBLE while it closes (visibility is delayed on the way out)');
  await page.waitForFunction(() => document.getElementById('bhub-fold-guest').getBoundingClientRect().height < 1, { timeout: 8000 });
  const shut = await foldBox();
  ok(shut && shut.h < 1, `closed again: back to 0px, no hairline left behind (${shut && shut.h.toFixed(1)})`);
  ok(shut && shut.vis === 'hidden', 'closed again: visibility hidden, so it leaves the tab order');

  // THE FOLD'S COLUMN NEVER OUTGROWS THE FOLD. A grid item's automatic minimum
  // size is its MIN-CONTENT size, so without `min-width: 0` a long unbreakable
  // child sizes the column to itself: measured on the declined drawer, the row
  // came out 515px wide inside a 390px viewport and stopped wrapping. `min-height`
  // alone releases only the block axis, which is the half the 0fr collapse needs
  // — this is the other half, and it is invisible until some fold holds wide
  // content, so the fixture is deliberately hostile.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(200);
  await page.evaluate(() => bhubFoldToggle('guest'));
  await page.waitForFunction(() => document.getElementById('bhub-fold-guest').getBoundingClientRect().height > 60, { timeout: 8000 });
  const wide = await page.evaluate(() => {
    const f = document.getElementById('bhub-fold-guest');
    const inner = f.firstElementChild;
    const probe = document.createElement('div');
    probe.id = 'wide-probe';
    probe.textContent = 'aVeryLongUnbreakableTokenThatNothingCanWrap0123456789ABCDEFGH';
    inner.appendChild(probe);
    return { fold: Math.round(f.getBoundingClientRect().width), inner: Math.round(inner.getBoundingClientRect().width) };
  });
  ok(wide.inner <= wide.fold, `an unbreakable child does not widen the fold's column (${wide.inner} inside ${wide.fold})`);
  await page.evaluate(() => { const p = document.getElementById('wide-probe'); if (p) p.remove(); });
  await page.evaluate(() => bhubFoldToggle('guest'));
  await page.waitForFunction(() => document.getElementById('bhub-fold-guest').getBoundingClientRect().height < 1, { timeout: 8000 });
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.waitForTimeout(200);

  // THE FOCUS RING SURVIVES THE CLIP, measured on PIXELS. The wrapper's edge is
  // flush with the fold's last row, so a plain `overflow: hidden` cuts the ring
  // off the last control in every open fold — `overflow: clip` with 4px of bleed
  // is what lets it paint. A computed read of `overflow` would pass with the
  // clip-margin deleted, and the ring is exactly the kind of thing the property
  // does not tell you about, so this samples the paint.
  await page.evaluate(() => bhubFoldToggle('guest'));
  // Sample by STATE, never a clock: the fold's 320ms unfold is a transition the
  // fold reports through getAnimations() until it is done, and a fixed 500ms on
  // a loaded runner sampled the strip while the wrapper's edge was still moving
  // — 0 red px on CI for a ring that paints (measured, once). Wait for no
  // animation in flight and the fold open, then a settled frame.
  await page.waitForFunction(() => {
    const f = document.getElementById('bhub-fold-guest');
    return f && f.getAnimations({ subtree: true }).length === 0 && f.getBoundingClientRect().height > 60;
  }, { timeout: 8000 });
  await page.waitForTimeout(120);
  // The probe is a ZERO-HEIGHT element flush with the wrapper's bottom edge, so
  // its whole ring lies BELOW that edge — inside the fold's own 14px padding,
  // which is what the clip margin has to let through.
  const ringAt = await page.evaluate(() => {
    const inner = document.getElementById('bhub-fold-guest').firstElementChild;
    const b = document.createElement('button');
    b.id = 'ring-probe';
    b.style.cssText = 'display:block;width:60px;height:0;margin:0;padding:0;border:0;background:transparent;outline:3px solid #ff0000;outline-offset:2px';
    inner.appendChild(b);
    const grp = document.querySelector('[data-grp="guest"]');
    const gb = grp.getBoundingClientRect(), ib = inner.getBoundingClientRect();
    // Strip 2–5px under the wrapper's edge, expressed inside the GROUP's own box
    // (a page-coordinate clip lands off screen — the hub sits far down the page).
    return { y: Math.round(ib.bottom - gb.top + 2), x: Math.round(ib.left - gb.left + 10), w: 40, h: 3 };
  });
  const shot = (await page.locator('[data-grp="guest"]').screenshot()).toString('base64');
  const red = await page.evaluate(async ([b64, at]) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(at.x, at.y, at.w, at.h).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 180 && px[i + 1] < 90 && px[i + 2] < 90) n++;
    return n;
  }, [shot, ringAt]);
  ok(red > 0, `the focus ring on the fold's LAST control paints past the wrapper's edge (${red} red px)`);
  await page.evaluate(() => { const p = document.getElementById('ring-probe'); if (p) p.remove(); });
  await page.evaluate(() => bhubFoldToggle('guest'));
  await page.waitForFunction(() => document.getElementById('bhub-fold-guest').getBoundingClientRect().height < 1, { timeout: 8000 });

  // Reduced motion SNAPS — and it goes back to display:none, so nothing about
  // the layout tree changes for anyone who has asked for stillness.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('bhub-fold-guest')).display === 'none'),
    'reduced motion: a closed fold is display:none again');
  // The transition is asserted through the CSSOM, not a computed read: Chromium's
  // reduced-motion emulation forces every transition-duration to ~1e-05s whatever
  // the author CSS says, so a computed read passes just as happily with the rule
  // deleted (the ui-test-coach lesson).
  ok(await page.evaluate(() => {
    let found = false;
    const walk = (rules) => {
      for (const r of rules) {
        if (r.selectorText && /\.bhub-fold\b/.test(r.selectorText) && /transition/.test(r.style.cssText || '')
          && /none/.test(r.style.transition || '')) found = true;
        // Read selectorText FIRST: modern Chromium gives every style rule a
        // (usually empty) cssRules list for nesting, so recursing on truthiness
        // skips every plain rule in the document.
        if (!r.selectorText && r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (e) {} }
    return found;
  }), 'reduced motion: the stylesheet really carries transition:none for the fold');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // --------------------------------------------------------- §2 the answer
  console.log('\n§2 The answer arriving');
  acctDelay = 1500; // the sync paint has to be READABLE before the answers land
  await page.evaluate(() => openAccounts());
  await page.waitForFunction(() => !!document.getElementById('mo-move-fig'), { timeout: 15000 });
  // The sync paint: the placeholder is there and NOTHING is animating.
  const preFill = await page.evaluate(() => {
    const f = document.getElementById('mo-move-fig');
    return f ? { txt: f.textContent.trim(), anims: f.getAnimations().length } : null;
  });
  ok(preFill && /working it out/i.test(preFill.txt), 'the sync paint says "working it out…"');
  ok(preFill && preFill.anims === 0, 'and it does not animate — the placeholder is not an arrival');

  await page.waitForFunction(() => {
    const f = document.getElementById('mo-move-fig');
    return f && !/working it out/i.test(f.textContent);
  }, { timeout: 5000 });
  const landed = await page.evaluate(() => {
    const g = (id) => { const e = document.getElementById(id); return e ? { cls: e.className, del: getComputedStyle(e).animationDelay, name: getComputedStyle(e).animationName } : null; };
    return { move: g('mo-move-fig'), back: g('mo-back-fig'), books: g('mo-books-fig') };
  });
  ok(landed.move && /mo-landed/.test(landed.move.cls) && landed.move.name === 'moLand',
    'the figure that landed carries the settle');
  ok(landed.move && landed.move.del === '0s' && landed.back && landed.back.del === '0.09s',
    `staggered by ROW, not by which fetch came back first (${landed.move && landed.move.del} / ${landed.back && landed.back.del})`);
  ok(landed.books && landed.books.del === '0.18s', `and the third answer follows at 0.18s (${landed.books && landed.books.del})`);
  // The keyframe's shape — seek to the start (this is the LAST read of this node).
  const moFrom = await page.evaluate(() => {
    const e = document.getElementById('mo-back-fig');
    const a = e.getAnimations()[0]; if (!a) return null;
    a.pause(); a.currentTime = 0;
    const cs = getComputedStyle(e);
    return { op: cs.opacity, t: cs.transform };
  });
  ok(moFrom && Number(moFrom.op) < 0.05, `it starts invisible (opacity ${moFrom && moFrom.op}) — `
    + '`backwards` holds it there through its own delay rather than flashing the answer first');
  ok(moFrom && /matrix\(1, 0, 0, 1, 0, 4\)/.test(moFrom.t), `and 4px low (${moFrom && moFrom.t})`);

  // ------------------------------------------------------ §3 figures change
  console.log('\n§3 A figure that changed says so');
  await page.evaluate(() => openBookings());
  await page.waitForFunction(() => {
    const v = document.getElementById('bookings-verdict');
    return v && /to collect|paid up/i.test(v.textContent || '');
  }, { timeout: 15000 });
  const firstPaint = await page.evaluate(() => {
    const v = document.getElementById('bookings-verdict');
    return { txt: (v.textContent || '').trim(), anims: v.getAnimations().length };
  });
  ok(/to collect/.test(firstPaint.txt), `the caption carries the owed capsule (${firstPaint.txt})`);
  ok(firstPaint.anims === 0, 'the FIRST paint does not settle — the screen arriving is not a figure moving');

  // A repaint that changes nothing must stay still.
  await page.evaluate(() => renderBookings());
  await page.waitForTimeout(30);
  ok(await page.evaluate(() => document.getElementById('bookings-verdict').getAnimations().length === 0),
    'a repaint with the same figure stays still');

  // A payment lands.
  const settled = await page.evaluate(() => {
    dbBookings['21a'].forEach((b) => { if (b.id === 'b1') { b.depositPaid = 400; } });
    Object.keys(dbBookings).forEach((k) => dbBookings[k].forEach((b) => { if (b.name === 'Sarah Pemberton') b.depositPaid = 400; }));
    renderBookings();
    const v = document.getElementById('bookings-verdict');
    return { txt: (v.textContent || '').trim(), anims: v.getAnimations().map((a) => a.animationName) };
  });
  ok(settled.anims.includes('bkFigSettle'), `a payment lands and the figure settles (now "${settled.txt}")`);
  // It SETTLES, it does not pop: the capsule was already on screen.
  const settleFrom = await page.evaluate(() => {
    const v = document.getElementById('bookings-verdict');
    const a = v.getAnimations()[0]; if (!a) return null;
    a.pause(); a.currentTime = 0;
    const cs = getComputedStyle(v);
    return { op: cs.opacity, t: cs.transform };
  });
  ok(settleFrom && /matrix\(1, 0, 0, 1, 0, 3\)/.test(settleFrom.t),
    'a SETTLE (3px, no scale), not payPop — the figure was already there, so a pop would read as "this appeared"');

  // The badge POPS, because a badge genuinely appears. Measured BELOW 1200px:
  // the rail takes over above it and hides the dock outright, and a CSS
  // animation does not run on a display:none element — so at 1280 this check
  // would pass in both directions while proving nothing.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => {
    const el = document.getElementById('dock-badge-inbox');
    return !!(el && el.closest('.admin-dock') && getComputedStyle(el.closest('.admin-dock')).display !== 'none');
  }), 'the dock is painted at this width, so the badge can actually animate');
  const badge = await page.evaluate(() => {
    const el = document.getElementById('dock-badge-inbox');
    if (!el) return null;
    enquiries.length = 0;
    refreshInboxBadge();                       // first write — records, never pops
    const first = el.getAnimations().length;
    enquiries.push({ id: 1, propKey: '21a', name: 'A guest', message: 'hello', received: '2026-01-01', status: 'new' });
    refreshInboxBadge();                       // 0 -> 1: a badge appeared
    const after = el.getAnimations().map((a) => a.animationName);
    refreshInboxBadge();                       // same number again
    return { first, after, again: el.getAnimations().length };
  });
  ok(badge && badge.first === 0, 'the badge does not pop on its first write');
  ok(badge && badge.after.includes('dockBadgePop'), 'it pops when the count changes');
  ok(badge && badge.again <= 1, 'and a refresh with the same count does not re-fire it');
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.waitForTimeout(150);

  // -------------------------------------------------------- §4 the timeline
  console.log('\n§4 The timeline draws in — once per visit');
  await page.evaluate(() => nav('view-backoffice'));
  await page.waitForTimeout(400);
  const tl1 = await page.evaluate(() => {
    const host = document.getElementById('cal-body');
    host.__tlDrew = false;                     // as if this were the first paint
    renderCalendar();
    const bars = [...document.querySelectorAll('#cal-body .tl-bar')];
    return {
      n: bars.length,
      drawn: bars.filter((b) => b.classList.contains('tl-draw')).length,
      delays: bars.map((b) => b.style.getPropertyValue('--tl-draw-d')),
    };
  });
  ok(tl1.n >= 2, `the calendar has bars to draw (${tl1.n})`);
  ok(tl1.drawn === tl1.n, 'every bar draws on the first paint');
  ok(new Set(tl1.delays).size > 1, `staggered (${tl1.delays.join(' ')})`);
  // Re-trigger and seek in ONE evaluate: with a 0.44s flight and up to 540ms of
  // stagger, a separate round trip can arrive after the animation has finished,
  // and getAnimations() then returns nothing — which reads as "it never drew".
  const tlFrom = await page.evaluate(() => {
    const b = document.querySelector('#cal-body .tl-bar');
    b.classList.remove('tl-draw');
    void b.offsetWidth;
    b.classList.add('tl-draw');
    const a = b.getAnimations()[0]; if (!a) return null;
    a.pause(); a.currentTime = 0;
    return getComputedStyle(b).transform;
  });
  ok(tlFrom && /matrix\(0\.0?2,/.test(tlFrom), `each grows from its check-in edge — scaleX(.02) (${tlFrom})`);

  const tl2 = await page.evaluate(() => {
    renderCalendar();                          // a data refresh, same visit
    const bars = [...document.querySelectorAll('#cal-body .tl-bar')];
    return { n: bars.length, drawn: bars.filter((b) => b.classList.contains('tl-draw')).length };
  });
  ok(tl2.n >= 2 && tl2.drawn === 0,
    'and NEVER again this visit — renderCalendar runs on every data refresh, so a per-render entrance would wear out by lunchtime');

  // ----------------------------------------------------------- §5 the filter
  console.log('\n§5 The filter switch');
  await page.evaluate(() => bookingsSetFilter('upcoming'));
  await page.waitForTimeout(50);
  const swapNone = await page.evaluate(() => {
    renderBookings();                          // a plain data refresh
    return document.getElementById('bookings-list').getAnimations().length;
  });
  ok(swapNone === 0, 'a data refresh that leaves you on the same list does not flicker it');

  const swap = await page.evaluate(() => {
    bookingsSetFilter('past');
    const l = document.getElementById('bookings-list');
    return { anims: l.getAnimations().map((a) => a.animationName), rows: l.querySelectorAll('.bk-row').length };
  });
  ok(swap.anims.includes('bkListSwap'), 'switching the filter cross-fades the body');
  ok(swap.rows >= 1, `and the list really changed subject (${swap.rows} past booking(s))`);
  // A FADE, not a cascade — no row carries an entrance of its own.
  const rowAnims = await page.evaluate(() =>
    [...document.querySelectorAll('#bookings-list .bk-row')].reduce((n, r) => n + r.getAnimations().length, 0));
  ok(rowAnims === 0,
    'the ROWS do not animate — deliberately a fade, because renderBookings runs on every data refresh and a cascade would replay dozens of times a session');

  const swapSearch = await page.evaluate(() => {
    bookingsSetSearch('ines');
    return document.getElementById('bookings-list').getAnimations().length;
  });
  ok(swapSearch >= 1, 'a search is a subject change too');

  console.log(`\n${fails ? fails + ' FAILED' : 'All back-office motion checks passed'}`);
  await done(fails);
})();
