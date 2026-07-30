// ui-test-resume.js — two promises this app now makes:
//
//  1. WHERE YOU WERE survives a reload. There is no router, so a refresh used to drop
//     the owner back on Today however deep into a task they were — and the app reloads
//     ITSELF when a new build ships (startVersionWatch) and on the stale-cache
//     self-heal, so losing your place happens most when you did not ask for it.
//
//  2. NOTHING IS SENT TWICE. Two layers, and this drives the client one: a button whose
//     handler is still running cannot be pressed again. §5 guards the counterpart — that
//     apiPost never answers one request with another already in flight, a guard that was
//     shipped, proved unsafe for reads, and withdrawn (see there).
//
// A real browser is the only place either can be checked: the first needs an actual
// page reload with sessionStorage surviving it, the second needs real clicks against a
// slow endpoint.
const { boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });

  // How many times each write action reached the server, and a switch to make one of
  // them slow so a double-tap has a window to land in.
  const posts = [];
  let slowMs = 0;
  const booking = {
    id: 1, prop_key: '21a', name: 'Sarah Pemberton', email: 's@x.co', phone: '', address: '1 Lane',
    postcode: 'NR25 7AB', check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, payment_method: 'Card', payment_date: d(-2),
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '',
  };
  await page.route(/\.php/, async (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      // A sentinel endpoint that really FAILS — the generic handler below answers
      // everything with ok:true, which made the rejection case impossible to reach.
      if (url.includes('__boom.php')) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      }
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      // A LIVE admin session, so the page's own boot signs in and reaches
      // maybeRestoreView() in the real order (auth → setAuthUI → restore). Calling the
      // function by hand proved the function; this proves the FEATURE.
      if (b.__url === 'auth.php' && b.action === 'admin_status') return json({ admin: true });
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      if (b.__url === 'bookings.php') {
        if (b.action === 'history') return json({ ok: true, events: [] });
        if (b.action === 'email_logs') return json({ logs: {} });
        if (b.action === 'deposit_returns') return json({ returns: {} });
      }
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], returns: {} });
    }
    // admin-bootstrap.php answers FIRST and loadData accepts its payload when the
    // shape is valid — so a generic `bookings: []` here silently emptied the store and
    // the hub bounced to Today with the booking apparently missing.
    if (url.includes('admin-bootstrap.php')) return json({ ok: true, cron: null, feeds: [], payoutTrouble: null, rates: null, bookings: { bookings: [booking] }, enquiries: { enquiries: [] }, blocks: { ok: true, blocks: [] } });
    if (url.includes('bookings.php')) return json({ bookings: [booking] });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    if (url.includes('accounts.php')) return json({ years: [2026] });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [] });
  });

  // The boot signs itself in from the stubbed admin_status, loads the bundle and calls
  // maybeRestoreView() by itself — so "after a reload" means exactly that, with nothing
  // driven by hand. This just waits for that chain to finish.
  const settle = async () => {
    await page.waitForTimeout(2600);
    await page.evaluate(() => loadData()).catch(() => {});
    await page.waitForTimeout(600);
  };
  const activeView = () => page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await settle();

  // ---- 1. a plain screen survives a reload -------------------------------
  console.log('1. the screen survives a reload');
  await page.evaluate(() => openInbox());
  await page.waitForTimeout(700);
  ok((await activeView()) === 'view-inbox', `on the Inbox to start (${await activeView()})`);
  const remembered = await page.evaluate(() => sessionStorage.getItem('chb-nav'));
  ok(/view-inbox|inbox/.test(remembered || ''), `the screen was remembered (${remembered})`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await settle();
  await page.waitForTimeout(900);
  ok((await activeView()) === 'view-inbox', `…and the reload came back to it, not to Today (${await activeView()})`);

  // ---- 2. a RECORD survives, not just its screen -------------------------
  // A hub without its booking is a blank screen, so the id has to be remembered too.
  console.log('2. the record survives too');
  // NARROW on purpose: at >=1200px the hub DOCKS into Today's side pane by design, so
  // the standalone view-booking-hub is the phone/tablet path — and that is where losing
  // your place hurts, since no pane is left showing the record.
  await page.setViewportSize({ width: 900, height: 900 });
  // Opened with the CLIENT id, the way showDetails does from a row click…
  await page.evaluate(() => openBookingHub('b1'));
  await page.waitForTimeout(800);
  ok((await activeView()) === 'view-booking-hub', `on the booking hub (${await activeView()})`);
  // …and remembered by its NUMERIC db id, the same vocabulary a notification URL uses,
  // so one target format serves both paths.
  ok(/"booking-1"/.test(await page.evaluate(() => sessionStorage.getItem('chb-nav') || '')), `the BOOKING is remembered by db id (${await page.evaluate(() => sessionStorage.getItem('chb-nav'))})`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await settle();
  await page.waitForTimeout(1100);
  const after = await page.evaluate(() => ({
    v: (document.querySelector('.page-view.active') || {}).id,
    txt: (document.getElementById('view-booking-hub') || {}).textContent || '',
  }));
  ok(after.v === 'view-booking-hub', `the reload returned to the hub (${after.v})`);
  ok(/Sarah Pemberton/.test(after.txt), 'and the hub is filled in — the record came back with it');

  await page.setViewportSize({ width: 1280, height: 950 });

  // The reason section 1 and 3 were silently broken at desktop width: renderBookings
  // auto-selects the first booking so Today never shows an empty pane, and that dock
  // NAVIGATED — dragging the owner to Today the moment the bookings finished loading,
  // over a restored screen and over a tapped ?open= notification alike. Docking is
  // right; moving them is not.
  const autoDock = await page.evaluate(async () => {
    nav('view-inbox');
    __hubBookingId = null;
    renderBookings();
    await new Promise((r) => setTimeout(r, 400));
    return {
      v: (document.querySelector('.page-view.active') || {}).id,
      docked: __hubBookingId,
    };
  });
  ok(autoDock.v === 'view-inbox', `the auto-dock does not drag you off the screen you are on (${autoDock.v})`);
  ok(!!autoDock.docked, `…while still docking the record, so Today is never empty (${autoDock.docked})`);

  // ---- 3. a SECTION survives ---------------------------------------------
  // An owner deep in Manage should come back to the section, not the index of links.
  console.log('3. a settings section survives');
  await page.evaluate(() => { openArea(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => settingsOpen('diagnostics'));
  await page.waitForTimeout(600);
  ok(/settings:diagnostics/.test(await page.evaluate(() => sessionStorage.getItem('chb-nav') || '')), 'the section is remembered, not just Manage');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await settle();
  await page.waitForTimeout(1000);
  const sec = await page.evaluate(() => ({
    v: (document.querySelector('.page-view.active') || {}).id,
    open: !!document.querySelector('#sec-diagnostics'),
    vis: (() => { const e = document.getElementById('sec-diagnostics'); return !!e && getComputedStyle(e).display !== 'none'; })(),
  }));
  ok(sec.v === 'view-settings' && sec.vis, `the reload reopened the section itself (${sec.v}, visible=${sec.vis})`);

  // ---- 4. the refusals --------------------------------------------------
  // Restoring the wrong thing is worse than not restoring: a guest must never be
  // walked into the back office, and a stale target must not outlive its welcome.
  console.log('4. what it refuses to restore');
  const guestBlocked = await page.evaluate(async () => {
    isAuthenticated = false;
    document.body.classList.remove('owner-mode');
    return await maybeRestoreView({ t: 'booking-1', at: Date.now() });
  });
  ok(guestBlocked === false, 'an owner screen is not restored for a signed-out visitor');
  const stale = await page.evaluate(async () => {
    isAuthenticated = true; document.body.classList.add('owner-mode');
    sessionStorage.setItem('chb-nav', JSON.stringify({ t: 'view-inbox', at: Date.now() - 5 * 3600e3 }));
    const r = await maybeRestoreView({ t: 'view-inbox', at: Date.now() - 5 * 3600e3 });
    return { r, left: sessionStorage.getItem('chb-nav') };
  });
  ok(stale.r === false, 'a target older than the window is not restored');
  ok(stale.left === null, '…and is forgotten, so it cannot be retried');
  const explicit = await page.evaluate(async () => {
    history.replaceState(null, '', location.pathname + '?open=booking-1');
    const r = await maybeRestoreView({ t: 'view-inbox', at: Date.now() });
    history.replaceState(null, '', location.pathname);
    return r;
  });
  ok(explicit === false, 'an explicit ?open= destination wins over the remembered one');
  const goneRecord = await page.evaluate(async () => {
    return await maybeRestoreView({ t: 'view-nope-does-not-exist', at: Date.now() });
  });
  ok(goneRecord === false, 'a view that no longer exists is not navigated to');
  // Signing out clears it outright.
  await page.evaluate(() => { sessionStorage.setItem('chb-nav', JSON.stringify({ t: 'booking-1', at: Date.now() })); forceAdminLogout(); });
  ok((await page.evaluate(() => sessionStorage.getItem('chb-nav'))) === null, 'signing out forgets the screen entirely');

  // ---- 5. apiPost NEVER answers one request with another -------------------
  // This section used to assert the opposite: that an identical POST already in flight
  // returned the SAME promise, so a double-tap sent once. That guard was withdrawn.
  // apiPost is the app's only POST channel and carries READS as well as writes, and two
  // identical reads cannot be told apart by endpoint + body — so a read issued after a
  // state change could be answered by one issued before it, which is exactly the
  // "you already sent that" lie the guard existed to prevent, pointing the other way.
  // Measured as a real regression: ui-test-poorsignal lost a store it is meant to keep,
  // about one run in three. The double-send guarantee is §6 (the control locks itself)
  // plus the server-side window, which is the only layer a reload cannot get past.
  console.log('5. every POST is its own request');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await settle();
  slowMs = 600;
  posts.length = 0;
  const overlapping = await page.evaluate(async () => {
    // The same READ twice, overlapping — the shape that made the withdrawn guard unsafe.
    const a = apiPost('bookings.php', { action: 'email_logs' });
    const b = apiPost('bookings.php', { action: 'email_logs' });
    await Promise.all([a, b]);
    return a === b;
  });
  ok(overlapping === false, 'two overlapping identical reads are two requests, not one shared promise');
  ok(posts.filter((p) => p.action === 'email_logs').length === 2,
    `…and both actually reach the server (${posts.filter((p) => p.action === 'email_logs').length} of 2)`);

  // Writes that differ must obviously both go, or saving two things would lose one.
  posts.length = 0;
  await page.evaluate(async () => {
    await Promise.all([
      apiPost('bookings.php', { action: 'set_notes', id: 1, notes: 'one' }),
      apiPost('bookings.php', { action: 'set_notes', id: 2, notes: 'two' }),
    ]);
  });
  ok(posts.filter((p) => p.action === 'set_notes').length === 2, 'two different writes both go');

  // And a repeat after the first has settled goes, or a failed save could never be
  // retried.
  posts.length = 0;
  slowMs = 0;
  await page.evaluate(async () => {
    await apiPost('bookings.php', { action: 'set_notes', id: 9, notes: 'again' });
    await apiPost('bookings.php', { action: 'set_notes', id: 9, notes: 'again' });
  });
  ok(posts.filter((p) => p.action === 'set_notes').length === 2, 'the same write again later is not blocked');

  // A FAILING write must not raise an unhandled rejection — the withdrawn guard freed its
  // in-flight key with .finally(), which returns a DERIVED promise that re-throws, and
  // nothing handled that one, so every failed write reported a page error. Four guest
  // suites started failing on it, which is how it was caught. Kept as a standing check on
  // the rejection path.
  const rejected = await page.evaluate(async () => {
    const seen = [];
    const onUnhandled = (e) => { seen.push(String((e.reason && e.reason.message) || e.reason)); e.preventDefault(); };
    window.addEventListener('unhandledrejection', onUnhandled);
    let caught = '';
    try {
      await apiPost('__boom.php', { action: 'nope' });
    } catch (e) {
      caught = e && e.message ? 'caught' : 'caught-empty';
    }
    await new Promise((r) => setTimeout(r, 250));
    window.removeEventListener('unhandledrejection', onUnhandled);
    return { caught, unhandled: seen.length };
  });
  ok(rejected.caught === 'caught', 'a failing write still rejects to its caller');
  ok(rejected.unhandled === 0, `…and raises no unhandled rejection (${rejected.unhandled})`);

  // ---- 6. a button that is still working cannot be pressed again ----------
  console.log('6. the button locks itself while it works');
  slowMs = 700;
  const btnState = await page.evaluate(async () => {
    // A real delegated control, exercised the way a finger does.
    const btn = document.createElement('button');
    btn.id = 'resume-probe';
    btn.setAttribute('data-act', 'chbResumeProbe');
    btn.textContent = 'Send';
    document.body.appendChild(btn);
    window.__probeRuns = 0;
    window.chbResumeProbe = () => { window.__probeRuns++; return apiPost('bookings.php', { action: 'probe_send', n: window.__probeRuns }); };
    btn.click();
    const during = { disabled: btn.disabled, busy: btn.getAttribute('aria-busy') };
    btn.click(); // the impatient second tap
    btn.click();
    await new Promise((r) => setTimeout(r, 1400));
    return { during, runs: window.__probeRuns, after: btn.disabled };
  });
  ok(btnState.during.disabled === true, 'the button disables itself the moment its handler starts');
  ok(btnState.during.busy === 'true', '…and says it is busy, not that it is unavailable');
  ok(btnState.runs === 1, `further taps do nothing while it works (handler ran ${btnState.runs}×)`);
  ok(btnState.after === false, 'and it comes back when the work finishes');

  // A synchronous handler must be left alone — disabling it would be permanent for
  // anything that does not return a promise to wait on.
  const syncBtn = await page.evaluate(async () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-act', 'chbResumeSync');
    document.body.appendChild(btn);
    window.chbResumeSync = () => 'done';
    btn.click();
    await new Promise((r) => setTimeout(r, 100));
    return btn.disabled;
  });
  ok(syncBtn === false, 'a synchronous handler leaves its button alone');
  // NB that one is NOT sensitive to the `typeof r.then` guard: without it the call
  // throws on a non-promise, the catch re-enables, and the button reads enabled again
  // by the time we look. What the guard around it really protects is the ELEMENT type —
  // disabling a checkbox or a select mid-change would break the control it belongs to,
  // and nothing would re-enable it until the handler resolved.
  const boxState = await page.evaluate(async () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('data-act', 'chbResumeBox');
    document.body.appendChild(box);
    window.chbResumeBox = () => apiPost('bookings.php', { action: 'probe_box' });
    box.click();
    await new Promise((r) => setTimeout(r, 120));
    return { disabled: box.disabled, busy: box.getAttribute('aria-busy') };
  });
  ok(boxState.disabled === false && boxState.busy === null, 'a non-button control is never disabled — only buttons self-lock');

  console.log(fails ? `RESUME TEST FAILED ❌ (${fails})` : 'RESUME TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
