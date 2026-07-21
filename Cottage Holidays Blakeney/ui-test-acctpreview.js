// Admin "view this customer's account" — read-only, sandboxed. Two halves:
//  A) THE PREVIEW FRAME (index.html?acctpreview=<id>): renders the target
//     customer's account (My Stays), shows the read-only banner naming them,
//     never applies owner chrome, and blocks every write (apiPost).
//  B) THE CONTAINER: openAccountPreview() mounts a sandboxed same-origin iframe
//     overlay pointed at that URL; closeAccountPreview() tears it down.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const CUSTOMER = { name: 'Cara Nunn', email: 'cara@example.co' };
const acctPayload = {
  ok: true,
  bookings: [{ id: 77, prop_key: 'jollyboat', name: 'Cara Nunn', email: 'cara@example.co', check_in: d(12), check_out: d(15), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 400, agreed_total: 400, pay_token: null, reg_url: '', reg_submitted: false }],
  enquiries: [], completed_stays: 0, guest: CUSTOMER,
};

(async () => {
  const { browser, base, done } = await bootBrowser();

  const route = (page, opts) => page.route(/\.php/, (r) => {
    const url = r.request().url();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('my-bookings.php')) return json(/acctpreview=/.test(url) ? acctPayload : { ok: true, bookings: [], enquiries: [], completed_stays: 0 });
    if (url.includes('auth.php')) { let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {} if (b.action === 'admin_status') return json({ ok: true, admin: !!(opts && opts.admin) }); if (b.action === 'guest_status') return json({ ok: true, guest: null }); return json({ ok: true }); }
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], events: [], enquiries: [], threads: [], reviews: [], photos: [], mine: {}, value: null, properties: [] });
  });

  // ---- A) The preview FRAME ----
  let page = await browser.newPage({ viewport: { width: 430, height: 1000 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await route(page, { admin: true }); // the frame carries the admin cookie
  await page.goto(`${base}/index.html?acctpreview=77`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const a = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    banner: !!document.getElementById('preview-banner'),
    bannerText: (document.getElementById('preview-banner') || {}).textContent || '',
    ownerMode: document.body.classList.contains('owner-mode'),
    listText: (document.getElementById('guest-bookings-list') || {}).textContent || '',
  }));
  ok(a.view === 'view-guest-bookings', `preview lands on the customer's My Stays (${a.view})`);
  ok(a.banner && /read-only/i.test(a.bannerText), 'the read-only preview banner shows');
  ok(/Cara/.test(a.bannerText), `the banner names the customer (${a.bannerText.trim().slice(0, 60)})`);
  ok(!a.ownerMode, 'owner chrome is NOT applied in the preview');
  ok(/Jollyboat/.test(a.listText), "the customer's booking renders in their account");
  // Read-only: every write goes through apiPost, which must reject in preview.
  const blocked = await page.evaluate(async () => { try { await apiPost('messages.php', { action: 'send', body: 'hi' }); return 'SENT'; } catch (e) { return 'BLOCKED'; } });
  ok(blocked === 'BLOCKED', 'writes are blocked in the read-only preview');
  const noToken = await page.evaluate(() => { const b = (guestBookingsCache || [])[0]; return b && !b.payToken; });
  ok(noToken, 'action tokens (pay/reg) are stripped from the preview payload');
  await page.close();

  // ---- B) The CONTAINER (admin overlay + sandboxed iframe) ----
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await route(page, { admin: true });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => {
    openAccountPreview(77, 'Cara Nunn');
    const ov = document.getElementById('acct-preview-overlay');
    const fr = ov && ov.querySelector('iframe.acct-preview-frame');
    return {
      overlay: !!ov,
      sandbox: fr ? fr.getAttribute('sandbox') : '',
      src: fr ? fr.getAttribute('src') : '',
      names: ov ? /Cara Nunn/.test(ov.textContent) : false,
      bodyLocked: document.body.classList.contains('acct-preview-open'),
    };
  });
  ok(b.overlay, 'openAccountPreview mounts the container overlay');
  ok(b.sandbox === 'allow-scripts allow-same-origin', `the iframe is sandboxed (${b.sandbox})`);
  ok(/index\.html\?acctpreview=77/.test(b.src), `the iframe points at the preview URL (${b.src})`);
  ok(b.names && b.bodyLocked, 'the overlay names the customer + locks the back-office scroll');
  const closed = await page.evaluate(() => { closeAccountPreview(); return { gone: !document.getElementById('acct-preview-overlay'), unlocked: !document.body.classList.contains('acct-preview-open') }; });
  ok(closed.gone && closed.unlocked, 'closeAccountPreview tears the container down');
  await page.close();

  console.log(fails ? `\n  ${fails} ACCT-PREVIEW CHECK(S) FAILED ❌` : '\n  ACCT-PREVIEW SUITE PASSED ✅');
  await done(fails);
})();
