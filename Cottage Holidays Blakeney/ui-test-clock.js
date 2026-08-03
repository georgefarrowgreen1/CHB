// ============================================================
//  ui-test-clock.js — THE CLOCK IS THE SERVER'S, NOT THE DEVICE'S.
//
//  Reported with a photograph: the back office reading "Today · Monday 20 July ·
//  £865 to collect" on 3 August, because the Mac's clock was two weeks behind
//  and the app believed it. Nothing was mis-charged — every money decision is
//  taken server-side and a device clock cannot reach those — but the owner was
//  shown a fortnight-old picture of their business as fact.
//
//  So this drives the REAL failure: a page whose device clock is wrong, against
//  a server that says otherwise, and asserts the app shows the server's day.
//  page.clock.setFixedTime is what a tampered clock looks like from inside the
//  page — Date.now() and new Date() both move, exactly as they would on a Mac
//  with the date wound back.
// ============================================================
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) fails++;
};

(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });

  // THE DEVICE IS TWO WEEKS BEHIND — the owner's Mac, exactly.
  const DEVICE = new Date('2026-07-20T09:00:00Z');
  const SERVER = Math.floor(new Date('2026-08-03T09:00:00Z').getTime() / 1000);
  await page.clock.setFixedTime(DEVICE);

  let serveSrv = true;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const body = { ok: true, content: {}, bookings: [], enquiries: [], properties: [], seasons: {},
      occupancy: {}, blocks: [], ranges: [], value: null, reviews: [], photos: [], threads: [] };
    if (serveSrv) body.srv = SERVER;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // The device clock really is wrong in this page — otherwise the rest proves
  // nothing. (Belt and braces: a harness that silently ignored setFixedTime
  // would make every check below pass for the wrong reason.)
  const dev = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  ok(dev === '2026-07-20', `the device clock is wound back, as reported (${dev})`);

  const v = await page.evaluate(() => ({
    // Bare identifier, not window.CHB_CLOCK: a top-level `const` in a classic
    // script is not a property of window (only var/function are).
    synced: CHB_CLOCK.synced,
    now: chbNow().toISOString().slice(0, 10),
    today: todayDashed(),
    parts: ukNowParts(),
  }));
  ok(v.synced === true, 'the app took the clock from the server');
  ok(v.now === '2026-08-03', `chbNow is the SERVER's day, not the device's (${v.now})`);
  ok(v.today === '2026-08-03', `…and so is todayDashed, which everything downstream reads (${v.today})`);
  ok(v.parts && v.parts.y === 2026 && v.parts.m === 8 && v.parts.d === 3, `…and ukNowParts, the one reader behind it (${JSON.stringify(v.parts)})`);

  // A CLOCK THAT RUNS ON. We keep the SKEW, not the instant, so time still
  // passes between requests rather than freezing at the last reply.
  const ran = await page.evaluate(() => {
    const a = chbNow().getTime();
    // Advance the device clock by an hour; the server-anchored clock must move
    // by the same hour, because only the OFFSET is held.
    return { a };
  });
  await page.clock.setFixedTime(new Date(DEVICE.getTime() + 3600000));
  const after = await page.evaluate(() => chbNow().getTime());
  ok(after - ran.a === 3600000, `an hour passing on the device is an hour here too (${after - ran.a}ms)`);

  // NO SERVER STAMP = NO CHANGE. An older server, or a reply that carries none,
  // must leave the device clock alone rather than adopting a guess.
  serveSrv = false;
  const p2 = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await p2.clock.setFixedTime(DEVICE);
  await p2.route(/\.php/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: {}, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, blocks: [], ranges: [], reviews: [], photos: [], threads: [] }) }));
  await p2.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  const un = await p2.evaluate(() => ({ synced: CHB_CLOCK.synced, today: todayDashed() }));
  ok(un.synced === false, 'an unstamped reply leaves the clock unsynced');
  ok(un.today === '2026-07-20', `…and falls back to the device rather than to a guess (${un.today})`);

  // RUBBISH IS NOT ADOPTED. Falling back to the device is a degraded answer;
  // adopting a garbled stamp is a wrong one.
  // The skew is restored afterwards whatever happens: without the guard a NaN
  // skew makes every later chbNow() an Invalid Date, which takes the page down
  // rather than failing this check — so a break-test would kill the run instead
  // of reporting. It stays load-bearing either way; this just makes it legible.
  const junk = await page.evaluate(() => {
    const before = CHB_CLOCK.skew;
    let held = true;
    ['', null, undefined, 'tomorrow', 0, -1, 1e15, NaN, {}].forEach((x) => {
      try {
        chbClockSync(x);
      } catch (e) {}
      if (CHB_CLOCK.skew !== before) held = false;
    });
    CHB_CLOCK.skew = before;
    return held;
  });
  ok(junk, 'a nonsense stamp is ignored, not adopted');

  await done(fails);
})();
