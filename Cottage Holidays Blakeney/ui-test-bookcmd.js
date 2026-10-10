// Booking commands, end to end in a real browser:
//  1. a move proposal's run() opens the EDIT sheet (#edit-modal .bks) prefilled
//     with the PROPOSED dates (record id set, its own old dates no clash, nothing saved)
//  2. a quote's run() opens the Add sheet prefilled with the quoted cottage + dates
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1280, height: 900 } });
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookings = [{ id: 1, prop_key: 'jollyboat', name: 'Bob Carter', email: 'b@x.co', phone: '', check_in: d(10), check_out: d(13), adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 500, hold_status: 'none' }];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') { try { posts.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {} }
    if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
    if (url.includes('rates.php') && route.request().method() !== 'POST') return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 20, child_rate: 10, transaction_pct: 0, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(400);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(300);

  // 1) Move proposal → the EDIT sheet prefilled with the proposed dates. The
  // sectioned form's "Edit or move" title went with it: the one sheet is titled
  // with the guest's name, in mode 'booking', and its button says Save.
  const postsBefore = posts.length;
  await page.evaluate(() => { const r = cmdkIntent('move bob back a week'); r[0].run(); });
  await page.waitForFunction(() => document.getElementById('edit-modal').classList.contains('open') && !!document.querySelector('#edit-modal .modal-box.bks'));
  let st = await page.evaluate(() => ({
    title: (document.getElementById('modal-title') || {}).textContent,
    mode: (document.getElementById('modal-mode') || {}).value,
    btn: ((document.getElementById('modal-save-btn') || {}).textContent || '').trim(),
    id: (document.getElementById('modal-record-id') || {}).value,
    ci: (document.getElementById('modal-checkin') || {}).value,
    co: (document.getElementById('modal-checkout') || {}).value,
    tiles: [(document.getElementById('bks-t-in-d') || {}).textContent, (document.getElementById('bks-t-out-d') || {}).textContent],
    verdict: ((document.getElementById('bks-verdict') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  const spoken = await page.evaluate((a) => a.map((x) => dpSpoken(x)), [d(17), d(20)]);
  ok(st.mode === 'booking' && st.title === 'Bob Carter' && st.btn === 'Save', `move opens the EDIT sheet for Bob (${st.title} · ${st.mode} · ${st.btn})`);
  ok(st.id === 'b1', `record id carried (${st.id})`);
  ok(st.ci === d(17) && st.co === d(20), `proposed dates prefilled (${st.ci} → ${st.co})`);
  ok(st.tiles.join('|') === spoken.join('|'), `…and the sheet's tiles show them (${st.tiles.join(' → ')})`);
  ok(/✓ Free/.test(st.verdict) && !/Overlaps/.test(st.verdict), `the sheet's verdict reads the proposed dates as free (${st.verdict})`);
  await page.evaluate(() => closeModal());
  // An EXTENSION overlaps the booking's own current nights — the sheet must not
  // read the guest as clashing with themselves.
  await page.evaluate(() => { const r = cmdkIntent('extend bob by 2 nights'); r[0].run(); });
  await page.waitForFunction((co) => document.getElementById('edit-modal').classList.contains('open') && document.getElementById('modal-checkout').value === co, d(15));
  const ext = await page.evaluate(() => ({
    ci: document.getElementById('modal-checkin').value,
    verdict: ((document.getElementById('bks-verdict') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  ok(ext.ci === d(10) && /^5 nights/.test(ext.verdict) && /✓ Free/.test(ext.verdict) && !/Overlaps Bob/.test(ext.verdict),
    `an extension opens 5 nights from the same arrival, never "Overlaps" its own stay (${ext.verdict})`);
  ok(!posts.slice(postsBefore).some((p) => p.action === 'update'), 'nothing is saved — a proposal only opens the sheet');
  await page.evaluate(() => closeModal());

  // 2) Quote → Add-Booking modal prefilled with cottage + dates.
  await page.evaluate((dates) => { const r = cmdkIntent(`how much for ${dates} at jollyboat`); r[0].run(); }, (() => { const a = new Date(); a.setDate(a.getDate() + 30); const b = new Date(); b.setDate(b.getDate() + 33); const f = (x) => x.getDate() + ' ' + x.toLocaleDateString('en-GB', { month: 'short' }).toLowerCase(); return `${f(a)} to ${f(b)}`; })());
  await page.waitForFunction(() => document.getElementById('edit-modal').classList.contains('open') && (document.getElementById('modal-mode') || {}).value === 'add');
  st = await page.evaluate(() => ({
    title: (document.getElementById('modal-title') || {}).innerText,
    mode: (document.getElementById('modal-mode') || {}).value,
    prop: (document.getElementById('modal-property') || {}).value,
    ci: (document.getElementById('modal-checkin') || {}).value,
    co: (document.getElementById('modal-checkout') || {}).value,
  }));
  ok(st.mode === 'add' && st.title === 'New booking', `quote opens the ADD sheet (${st.title} · ${st.mode})`);
  ok(st.prop === 'jollyboat' && st.ci === d(30) && st.co === d(33), `quoted cottage + dates prefilled (${st.prop} ${st.ci} → ${st.co})`);

  console.log(fails ? `\n  ${fails} BOOKCMD CHECK(S) FAILED ❌` : '\n  BOOKCMD SUITE PASSED ✅');
  await done(fails);
})();
