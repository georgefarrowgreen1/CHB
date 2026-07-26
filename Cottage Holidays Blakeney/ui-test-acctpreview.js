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
  // The bar is the ONLY label now, so the customer's NAME must lead and survive
  // in full — it used to sit behind a "Customer account · " prefix and ellipsise
  // away on a phone.
  const hdr = await page.evaluate(() => {
    const t = document.querySelector('.acct-preview-title');
    return {
      title: t.textContent.trim(),
      truncated: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1,
      note: (document.querySelector('.acct-preview-note') || {}).textContent || '',
    };
  });
  ok(hdr.title === 'Cara Nunn', `the header title is the customer's name (${hdr.title})`);
  ok(!hdr.truncated, 'the customer name is not truncated');
  ok(/read-only/i.test(hdr.note), 'the muted line still states read-only');
  // The overlay bar above the iframe already says read-only + names the customer,
  // so the EMBEDDED frame must NOT render its own inner banner (that was the
  // duplicate "read-only preview box"). And repeated blocked writes must not
  // stack a column of identical toasts.
  await page.waitForTimeout(800);
  const frame = page.frames().find((f) => /acctpreview=77/.test(f.url()));
  ok(!!frame, 'the sandboxed preview frame loaded');
  if (frame) {
    const inner = await frame.evaluate(() => ({ embedded: window.parent !== window, banner: !!document.getElementById('preview-banner') }));
    ok(inner.embedded, 'the preview frame is embedded (parent !== self)');
    ok(!inner.banner, 'the embedded frame suppresses its own inner banner (one read-only box, not two)');
    const throttled = await frame.evaluate(() => { let n = 0; const orig = window.toast; window.toast = () => { n++; }; __previewToastAt = 0; previewBlockedToast(); previewBlockedToast(); previewBlockedToast(); window.toast = orig; return n; });
    ok(throttled === 1, `repeated blocked writes show at most one read-only toast (${throttled})`);
  }
  const closed = await page.evaluate(() => { closeAccountPreview(); return { gone: !document.getElementById('acct-preview-overlay'), unlocked: !document.body.classList.contains('acct-preview-open') }; });
  ok(closed.gone && closed.unlocked, 'closeAccountPreview tears the container down');
  await page.close();

  // ---- C) HOW IT'S SHOWN on a notched phone ----
  // On an iPhone the overlay's flat 24px padding put the shell's top edge at 34px
  // against a 59px inset, so the bar — the customer's name and the Close button —
  // sat UNDER the status bar / Dynamic Island. And the decorative phone-shaped
  // frame cost more than it said: 342x776 inside a 390x844 phone, spending 48px of
  // width on chrome so the customer's account got 66% of the screen.
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await route(page, { admin: true });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  // env() always reports 0 in a desktop browser, so a notch is invisible to CI
  // unless we set the tokens the app reads it into (see app.css :root --safe-*).
  const SAFE_T = 59, SAFE_B = 34;
  await page.addStyleTag({ content: `:root{--safe-t:${SAFE_T}px;--safe-b:${SAFE_B}px;}` });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => openAccountPreview(77, 'Cara Nunn'));
  await page.waitForTimeout(1400);
  const ph = await page.evaluate(() => {
    const ov = document.getElementById('acct-preview-overlay');
    const shell = ov.querySelector('.acct-preview-shell');
    const bar = ov.querySelector('.acct-preview-bar');
    const wrap = ov.querySelector('.acct-preview-frame-wrap');
    const r = (el) => { const b = el.getBoundingClientRect(); return { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) }; };
    const bg = getComputedStyle(shell).backgroundColor;
    const alpha = (bg.match(/[\d.]+/g) || [])[3];
    return { vw: innerWidth, vh: innerHeight, shell: r(shell), bar: r(bar), wrap: r(wrap), shellBg: bg, shellAlpha: alpha == null ? 1 : +alpha };
  });
  ok(ph.bar.t >= SAFE_T, `the bar clears the notch — top ${ph.bar.t}px vs a ${SAFE_T}px inset`);
  ok(ph.wrap.b <= ph.vh - SAFE_B + 1, `and the frame clears the home indicator — bottom ${ph.wrap.b} of ${ph.vh - SAFE_B}`);
  ok(ph.shell.w >= ph.vw - 2, `on a phone it is a full-screen sheet, not a phone-inside-a-phone (${ph.shell.w} of ${ph.vw}px wide)`);
  // Opaque: the shell frames a whole other app, so the back office must not ghost
  // through it (the admin dock used to show behind the customer's name).
  ok(ph.shellAlpha >= 0.99, `the shell is opaque so the back office can't show through (${ph.shellBg})`);
  // The note is supporting text; the name is the identity. One line on a phone,
  // or the bar doubles in height.
  const oneLine = await page.evaluate(() => {
    const n = document.querySelector('.acct-preview-note');
    return { h: Math.round(n.getBoundingClientRect().height), lh: Math.round(parseFloat(getComputedStyle(n).lineHeight) || 0) };
  });
  ok(oneLine.lh === 0 || oneLine.h <= oneLine.lh + 2, `the muted note stays on one line (${oneLine.h}px vs line-height ${oneLine.lh})`);
  // The frame's edges are the overlay's, not the device's, and the overlay already
  // inset itself — so inside the frame the safe-area tokens must read ZERO. (iOS
  // hands env() down into a same-origin iframe; without this every token-based rule
  // in there insets a second time.)
  const inFrame = page.frames().find((f) => /acctpreview=77/.test(f.url()));
  if (inFrame) {
    // Reading the tokens as-is proves nothing: Chromium keeps env() at 0 inside an
    // iframe, so they read 0 whether or not we neutralise them. FORCE non-zero
    // insets onto the frame's :root — that is what iOS effectively does — and then
    // the body-level override is the only thing that can bring them back to 0.
    const z = await inFrame.evaluate(() => {
      const st = document.createElement('style');
      st.textContent = ':root{--safe-t:59px;--safe-b:34px;}';
      document.head.appendChild(st);
      const cs = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return {
        embedded: document.body.classList.contains('acct-preview-embedded'),
        t: cs.getPropertyValue('--safe-t').trim(), b: cs.getPropertyValue('--safe-b').trim(),
        rootT: root.getPropertyValue('--safe-t').trim(),
      };
    });
    ok(z.embedded, 'the embedded frame knows it is embedded');
    ok(z.rootT === '59px', `(the iOS simulation took — :root reads ${z.rootT})`);
    ok(/^0(px)?$/.test(z.t) && /^0(px)?$/.test(z.b), `and it neutralises them anyway (body t=${z.t} b=${z.b})`);
  } else {
    ok(false, 'the preview frame was not found for the safe-area check');
  }
  await page.close();

  console.log(fails ? `\n  ${fails} ACCT-PREVIEW CHECK(S) FAILED ❌` : '\n  ACCT-PREVIEW SUITE PASSED ✅');
  await done(fails);
})();
