// FIVE BACK-OFFICE MOTIONS, in a real browser. Measured starting point: app.css
// carries 99 animations and admin.css 38, and of every row type in the app only
// .ny-row had an entrance — the owner's side of the product barely moved.
//
//  §1 THE FOLD moves, and `hidden` stays the one synchronous switch: a closed
//     fold is 0px and out of the tab order, an opening one is mid-flight one
//     frame later and settled at full height after, a closing one is still
//     visible while it closes and gone the moment it has. Reduced motion snaps.
//  §2 THE ANSWER ARRIVING — on the one Payments page only what is NEW moves: a
//     movement that arrived since the last load slides in and a figure that
//     changed settles, while the synchronous first paint and the first load stay
//     still. (The old landing's staggered moLand went with that landing.)
//  §3 A FIGURE THAT CHANGED SAYS SO — the owed capsule SETTLES on a change and
//     stays still on a repaint that changed nothing; the dock badge POPS.
//  §4 THE TIMELINE draws in ONCE per visit, staggered, and never again.
//  §5 THE FILTER SWITCH slides the rows in from the side switched to (a search
//     rises) on a subject change, never on a refresh ("Today moves").
//
// SAMPLING RULE, learned the hard way in ui-test-searchpage §17a and again in
// ui-test-flowmotion: SEEK, never race. Where a keyframe's shape is the claim,
// pause the animation and set currentTime — and do the seek LAST, because a
// paused CSS animation does not resume into a clean flight.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = require('./ui-test-lib').d; // the harness's day (keeps the page's clock near midnight)

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
  // §2 needs money.php to land AFTER the sync paint — that is the whole point of
  // the motion — so it is deliberately delayed.
  let acctDelay = 250;
  // money.php's movements, newest first; §2 adds one to see only the NEW row arrive.
  const moneyActivity = [{ id: 'p901', at: Math.floor(Date.now() / 1000) - 86400, kind: 'in', what: 'Balance', booking_id: 2, name: 'Tom Ashby', prop: 'jollyboat', amount: 900, deposit: 0, fee: 12.6, method: 'card', status: 'done', payout: null }];
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
    if (url.includes('money.php')) {
      await new Promise((r) => setTimeout(r, acctDelay));
      return json({ ok: true, at: Math.floor(Date.now() / 1000), position: { with_square: 0, in_bank: 0, ready: 0, held: 0, unreported_count: 0, failed: [] }, bank_items: [], way_items: [], moved_map: {}, landed_map: {}, books: null, years: [], activity: moneyActivity.slice() });
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

  // SEEK, NEVER RACE. The mid-flight sample used to be "toggle, then read the
  // next frame", which under the runner's full concurrent load lands late — 209
  // of a 226px fold, i.e. 92% open, and the check called a working unfold a
  // teleport. Toggle, then PAUSE the transition and set its currentTime to a
  // quarter of the way in; the reading is then a phase, not a clock.
  const mid = await page.evaluate(() => {
    bhubFoldToggle('guest');
    const f = document.getElementById('bhub-fold-guest');
    const anims = f.getAnimations();
    for (const a of anims) { a.pause(); const d = (a.effect && a.effect.getTiming().duration) || 0; a.currentTime = (typeof d === 'number' ? d : 0) * 0.25; }
    const cs = getComputedStyle(f);
    return { h: f.getBoundingClientRect().height, hidden: f.hidden, vis: cs.visibility, rows: cs.gridTemplateRows, n: anims.length };
  });
  ok(mid && mid.n >= 1, `the fold really animates — ${mid && mid.n} transition(s) to seek (vacuity guard)`);
  await page.evaluate(() => { document.getElementById('bhub-fold-guest').getAnimations().forEach((a) => a.play()); });
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
  // NB the booking page's entrance (.bhub-enter, fill: both) leaves a FINISHED animation on the
  // fold group for ever, so "nothing in flight" means nothing that is not finished.
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
    return f && f.getAnimations({ subtree: true }).filter((x) => x.playState !== 'finished').length === 0 && f.getBoundingClientRect().height > 60;
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
  // RE-AIMED for the one Payments page: the old landing's four slow answers (and
  // moLand, the settle they wore when they landed) are gone. The page paints at once
  // from the bookings it holds and money.php fills the rest; what moves now is
  // ONLY what is new or changed. A movement row that arrived since the last load
  // slides in (pmRowIn), a figure that changed settles (pmSettle), and the first
  // paint and the first load stay still — the screen arriving is not an answer moving.
  console.log('\n§2 The answer arriving');
  acctDelay = 1500; // the sync paint has to be READABLE before money.php answers
  await page.evaluate(() => openAccounts());
  await page.waitForFunction(() => !!document.querySelector('#pm-list [data-fig="owe"]'), null, { timeout: 15000 });
  // The sync paint: the figure the bookings already answer is there, the movements
  // say they are loading, and NOTHING on the page is animating.
  const preFill = await page.evaluate(() => {
    const lp = document.getElementById('pm-list');
    const anims = [...lp.querySelectorAll('*')].reduce((n, el) => n + el.getAnimations().filter((a) => a.animationName).length, 0);
    return { owe: (lp.querySelector('[data-fig="owe"]') || {}).textContent || '', loading: /Loading…/.test(lp.textContent), anims };
  });
  ok(/£\d/.test(preFill.owe) && preFill.loading, `the sync paint states what is owed (${preFill.owe}) and says the movements are loading`);
  ok(preFill.anims === 0, `and nothing moves on it (${preFill.anims} animation(s)) — the placeholder is not an arrival`);

  await page.waitForFunction(() => document.querySelectorAll('#pm-list .pm-mrow[aria-label^="Tom Ashby"]').length > 0, null, { timeout: 8000 });
  const firstLoad = await page.evaluate(() => {
    const lp = document.getElementById('pm-list');
    return { fresh: lp.querySelectorAll('.pm-mrow.is-new').length, changed: lp.querySelectorAll('.is-changed').length };
  });
  ok(firstLoad.fresh === 0 && firstLoad.changed === 0, `the first load lands still: no row slides in, no figure settles (${firstLoad.fresh} / ${firstLoad.changed})`);

  // A movement that ARRIVED since the last load (a save's own refetch) slides in.
  acctDelay = 0;
  moneyActivity.unshift({ id: 'p902', at: Math.floor(Date.now() / 1000) - 60, kind: 'in', what: 'Deposit', booking_id: 1, name: 'Sarah Pemberton', prop: '21a', amount: 75, deposit: 0, fee: null, method: 'Bank transfer', status: 'done' });
  // The load, the paint and the read in ONE evaluate: pmLoad renders before it resolves,
  // and a separate round trip could land after the 0.6s arrival has finished.
  const rowIn = await page.evaluate(async () => {
    await pmLoad(true);
    const rows = [...document.querySelectorAll('#pm-list .pm-mrow.is-new')];
    const r = rows[0];
    if (!r) return null;
    const label = r.getAttribute('aria-label') || '';
    const a = r.getAnimations().find((x) => x.animationName === 'pmRowIn');
    if (!a) return { n: rows.length, label, name: '' };
    a.pause(); a.currentTime = 0;                 // the LAST read of this node
    const cs = getComputedStyle(r);
    return { n: rows.length, label, name: a.animationName, op: cs.opacity, tr: cs.translate };
  });
  ok(rowIn && rowIn.n === 1 && /^Sarah Pemberton/.test(rowIn.label), `only the movement that is new carries the arrival (${rowIn && rowIn.n} row: ${rowIn && rowIn.label.slice(0, 40)})`);
  ok(rowIn && rowIn.name === 'pmRowIn' && Number(rowIn.op) < 0.05 && /-8px/.test(rowIn.tr || ''), `it slides in from 8px above, from nothing (opacity ${rowIn && rowIn.op}, translate ${rowIn && rowIn.tr})`);

  // A FIGURE THAT CHANGED settles; one that did not stays still.
  const settle = await page.evaluate(() => {
    const first = dbBookings['21a'][0];
    dbBookings['21a'].push(Object.assign({}, first, { id: 'b-pm-2', dbId: 9903, name: 'Second Owes', depositPaid: 0, payment: 'unpaid', paymentMethod: 'Card' }));
    pmRenderList();
    const f = document.querySelector('#pm-list [data-fig="owe"]');
    const a = f && f.getAnimations().find((x) => x.animationName === 'pmSettle');
    let mid = null;
    if (a) { a.pause(); a.currentTime = 180; mid = getComputedStyle(f).translate; } // 30% of 0.6s, the keyframe's one stop
    const after = f ? f.textContent : '';
    pmRenderList();                              // a repaint that changed nothing
    const g = document.querySelector('#pm-list [data-fig="owe"]');
    return { cls: f ? f.className : '', name: a ? a.animationName : '', mid, after, again: g ? g.getAnimations().length + (g.classList.contains('is-changed') ? 1 : 0) : -1 };
  });
  ok(settle.name === 'pmSettle' && /is-changed/.test(settle.cls), `the owed figure that changed settles (now ${settle.after})`);
  ok(/-3px/.test(settle.mid || ''), `a SETTLE: 3px and back, no scale (${settle.mid}) — the figure was already on screen`);
  ok(settle.again === 0, 'and a repaint with the same figures stays still');
  await page.evaluate(() => { dbBookings['21a'] = dbBookings['21a'].filter((b) => b.dbId !== 9903); pmRenderList(); });

  // ------------------------------------------------------ §3 figures change
  console.log('\n§3 A figure that changed says so');
  await page.evaluate(() => openBookings());
  await page.waitForFunction(() => {
    const v = document.querySelector('#bookings-owed .head-pill');
    return v && /£\d/.test((v.textContent || '').trim());
  }, { timeout: 15000 });
  const firstPaint = await page.evaluate(() => {
    const v = document.querySelector('#bookings-owed .head-pill');
    return { txt: (v.textContent || '').trim(), anims: v.getAnimations().length };
  });
  ok(/£\d/.test(firstPaint.txt), `the owed line carries the figure (${firstPaint.txt})`);
  ok(firstPaint.anims === 0, 'the FIRST paint does not settle — the screen arriving is not a figure moving');

  // A repaint that changes nothing must stay still.
  await page.evaluate(() => renderBookings());
  await page.waitForTimeout(30);
  ok(await page.evaluate(() => document.querySelector('#bookings-owed .head-pill').getAnimations().length === 0),
    'a repaint with the same figure stays still');

  // The COUNT changes: a second booking arrives owing. (A part-payment that leaves the same
  // guest owing changes no count, so nothing moves — a settle on a figure that did not visibly
  // change is motion saying nothing.)
  const settled = await page.evaluate(() => {
    const first = dbBookings['jollyboat'][0] || dbBookings['21a'][0];
    dbBookings['jollyboat'].push(Object.assign({}, first, { id: 'b-owes-2', dbId: 9902, name: 'Late Arrival', depositPaid: 0, payment: 'unpaid', checkIn: first.checkIn, checkOut: first.checkOut, paymentMethod: 'Card' }));
    renderBookings();
    const v = document.querySelector('#bookings-owed .head-pill');
    return { txt: (v.textContent || '').trim(), anims: v.getAnimations().map((a) => a.animationName) };
  });
  ok(settled.anims.includes('bkFigSettle'), `a second booking owes and the figure settles (now "${settled.txt}")`);
  // It SETTLES, it does not pop: the capsule was already on screen.
  const settleFrom = await page.evaluate(() => {
    const v = document.querySelector('#bookings-owed .head-pill');
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
  // RE-AIMED for "Today moves" (owner-asked, supersedes "a FADE, never a cascade"):
  // Upcoming|Past is a travelling pill, and on a change of SUBJECT the rows slide in
  // from the side the switch moved to (Past lies to the right), or rise for a
  // search. What has not changed is the reason the old rule existed: renderBookings
  // runs on every data refresh, so a refresh must replay NOTHING.
  console.log('\n§5 The filter switch');
  await page.evaluate(() => bookingsSetFilter('upcoming'));
  await page.waitForTimeout(50);
  const rowMotion = () => [...document.querySelectorAll('#bookings-list .bk-row')].reduce((n, r) => n + r.getAnimations().length + (/\bbk-in-/.test(r.className) ? 1 : 0), 0);
  const swapNone = await page.evaluate((fn) => {
    renderBookings();                          // a plain data refresh
    return document.getElementById('bookings-list').getAnimations().length + eval('(' + fn + ')')();
  }, rowMotion.toString());
  ok(swapNone === 0, 'a data refresh that leaves you on the same list moves nothing');

  const swap = await page.evaluate(() => {
    bookingsSetFilter('past');
    const rows = [...document.querySelectorAll('#bookings-list .bk-row')];
    const r = rows[0];
    const a = r && r.getAnimations().find((x) => x.animationName === 'bkInR');
    let from = null;
    if (a) { a.pause(); a.currentTime = 0; from = getComputedStyle(r).transform; }
    return { rows: rows.length, cls: rows.map((x) => (x.className.match(/\bbk-in-\w/) || [''])[0]), from };
  });
  ok(swap.rows >= 1, `the list really changed subject (${swap.rows} past booking(s))`);
  ok(swap.cls.length && swap.cls.every((c) => c === 'bk-in-r'), `switching to Past slides the rows in from the right, the side the switch moved to (${swap.cls.join(' ')})`);
  ok(swap.from && /matrix\(1, 0, 0, 1, 18, 0\)/.test(swap.from), `…from 18px over (${swap.from})`);
  const refreshAfter = await page.evaluate((fn) => { renderBookings(); return eval('(' + fn + ')')(); }, rowMotion.toString());
  ok(refreshAfter === 0, 'and a data refresh straight after replays nothing — the rows that arrive are plain rows');
  const back = await page.evaluate(() => { bookingsSetFilter('upcoming'); return [...document.querySelectorAll('#bookings-list .bk-row')].map((x) => (x.className.match(/\bbk-in-\w/) || [''])[0]); });
  ok(back.length && back.every((c) => c === 'bk-in-l'), `back to Upcoming, they come in from the left (${back.join(' ')})`);

  const swapSearch = await page.evaluate(() => {
    bookingsSetFilter('past');
    bookingsSetSearch('ines');
    return [...document.querySelectorAll('#bookings-list .bk-row')].map((x) => (x.className.match(/\bbk-in-\w/) || [''])[0]);
  });
  ok(swapSearch.length >= 1 && swapSearch.every((c) => c === 'bk-in-u'), `a search is a subject change too, and its results rise (${swapSearch.join(' ')})`);

  console.log(`\n${fails ? fails + ' FAILED' : 'All back-office motion checks passed'}`);
  await done(fails);
})();
