// MANAGE → TEXT MESSAGES, driven in a real browser, plus the guest-side gate
// that page controls.
//
// The settings used to be config.php constants, so switching SMS on meant
// editing a PHP file on the host — and because the enquiry form offered "Text me
// booking updates" regardless, a guest could tick a box nothing could act on and
// then watch their phone instead of the email carrying the payment link.
//
// Two properties are worth driving rather than unit-testing (test-sms.php covers
// the resolution rules): the AUTH TOKEN is write-only, so the page must never put
// it in a field and a blank submit must not wipe the stored one; and the guest
// checkbox must follow the server's answer in BOTH directions.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const PROP = {
  prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 45,
  child_rate: 30, booking_fee: 75, transaction_pct: 0, weekend_pct: 0, weekend_days: '5,6',
  lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 4, sort_order: 1,
};

// `status` is what diagnostics.php sms_status would answer; `sms` is the derived
// public boolean on the rates payload. They are served independently on purpose —
// a test that drove them from one variable could not catch the two disagreeing.
async function open(browser, base, { status, sms, owner }) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const rates = { properties: [PROP], seasons: {}, occupancy: {}, payment: { deposit_pct: 25, balance_days: 30 }, sms: !!sms };
    if (route.request().method() === 'POST') {
      let b = {};
      try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.action === 'sms_status') return json({ ok: true, sms: status });
      if (b.action === 'sms_test') return json({ ok: true, to: '+447700900123' });
      if (b.action === 'admin_status') return json({ ok: true, admin: true });
      return json({ ok: true, events: [], logs: {}, content: {} });
    }
    if (url.includes('bootstrap.php')) return json({ ok: true, rates, content: { content: {} }, reviews: { reviews: [] }, square: { enabled: false } });
    if (url.includes('rates.php')) return json(rates);
    return json({ ok: true, bookings: [], enquiries: [], blocks: [], content: {}, properties: [], seasons: {}, occupancy: {}, payments: [], years: [], value: null });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  if (owner) {
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(700);
  }
  return { page, posts };
}
// Drive the REAL route in: the Manage index row, clicked.
async function openSmsPage(page) {
  await page.evaluate(async () => { await openArea(); });
  await page.waitForTimeout(500);
  await page.click('button.settings-row[data-arg="sms"]');
  await page.waitForTimeout(600);
}
const READY = { on: true, ready: true, sid_set: true, sid_tail: 'abcd', token_set: true, from: '+447700900000', from_config: false };
const OFF = { on: false, ready: false, sid_set: false, sid_tail: '', token_set: false, from: '', from_config: false };

(async () => {
  const { browser, base, done } = await bootBrowser();

  console.log('1. the page exists and is reachable the way an owner reaches it');
  let { page, posts } = await open(browser, base, { status: READY, sms: true, owner: true });
  await openSmsPage(page);
  let v = await page.evaluate(() => {
    const sec = document.getElementById('sec-sms');
    return {
      shown: !!sec && getComputedStyle(sec).display !== 'none',
      state: (document.getElementById('sms-state') || {}).textContent || '',
      token: (document.getElementById('sms-token') || {}).value,
      tokenNote: (document.getElementById('sms-token-state') || {}).textContent || '',
      sidPlaceholder: (document.getElementById('sms-sid') || {}).placeholder || '',
      from: (document.getElementById('sms-from') || {}).value,
      on: (document.getElementById('sms-on') || {}).checked,
    };
  });
  ok(v.shown, 'clicking the Manage row opens Text messages');
  ok(/Texts are on/.test(v.state), `it leads with the live state (${v.state.slice(0, 60)})`);
  ok(v.on === true, 'the switch reflects the server, not the markup default');
  ok(v.from === '+447700900000', 'the sender number is shown so it can be corrected');
  ok(posts.some((p) => p.action === 'sms_status'), 'the state came from the server, not from siteContent');

  console.log('2. the auth token is WRITE-ONLY');
  // content.php refuses to decrypt it into any browser payload, so the page has
  // no value to show — and must not pretend otherwise.
  ok(v.token === '', 'the token field is empty even when a token is stored');
  ok(/A token is saved/.test(v.tokenNote), `…and the page says one is saved (${v.tokenNote.slice(0, 48)})`);
  ok(/••••\s*abcd/.test(v.sidPlaceholder), `the SID shows only its tail, to identify the account (${v.sidPlaceholder})`);

  console.log('3. saving with the token blank KEEPS the stored one');
  // The trap: a form that saves what is on screen would blank the secret every
  // time the owner corrected their phone number.
  posts.length = 0;
  await page.evaluate(() => { document.getElementById('sms-from').value = '+447700900999'; });
  await page.click('[data-act="saveSmsSettings"]');
  await page.waitForTimeout(700);
  const sets = posts.filter((p) => p.__url === 'content.php' && p.action === 'set');
  ok(sets.some((p) => p.key === 'sms-from' && p.value === '+447700900999'), 'the number is saved');
  ok(!sets.some((p) => p.key === 'apikey-twilio-token'), 'the token is NOT written when the field is blank');
  ok(sets.some((p) => p.key === 'sms-enabled'), 'the switch is saved');
  ok(posts.filter((p) => p.action === 'sms_status').length > 0, 'and the page re-reads the server rather than trusting what it sent');
  await page.close();

  console.log('4. it refuses to switch on without the details');
  ({ page, posts } = await open(browser, base, { status: OFF, sms: false, owner: true }));
  await openSmsPage(page);
  posts.length = 0;
  await page.evaluate(() => {
    document.getElementById('sms-on').checked = true;
    document.getElementById('sms-sid').value = '';
    document.getElementById('sms-from').value = '';
  });
  await page.click('[data-act="saveSmsSettings"]');
  await page.waitForTimeout(400);
  let msg = await page.evaluate(() => (document.getElementById('sms-msg') || {}).textContent || '');
  ok(/Account SID/.test(msg), `it names the missing detail (${msg})`);
  ok(!posts.some((p) => p.action === 'set'), '…and saves nothing — no half-on state to explain later');
  // A number without its country code cannot send.
  await page.evaluate(() => {
    document.getElementById('sms-sid').value = 'ACtest';
    document.getElementById('sms-token').value = 'tok';
    document.getElementById('sms-from').value = '07700900000';
  });
  await page.click('[data-act="saveSmsSettings"]');
  await page.waitForTimeout(400);
  msg = await page.evaluate(() => (document.getElementById('sms-msg') || {}).textContent || '');
  ok(/country code/.test(msg), `a local-format number is refused with the reason (${msg})`);
  await page.close();

  console.log('5. a config.php constant makes the page read-only, and says why');
  ({ page } = await open(browser, base, { status: Object.assign({}, READY, { from_config: true }), sms: true, owner: true }));
  await openSmsPage(page);
  v = await page.evaluate(() => ({
    state: (document.getElementById('sms-state') || {}).textContent || '',
    locked: ['sms-on', 'sms-sid', 'sms-from', 'sms-token'].every((id) => (document.getElementById(id) || {}).disabled === true),
  }));
  ok(/config\.php/.test(v.state), `the page says where the live settings come from (${v.state.slice(0, 70)})`);
  ok(v.locked, '…and every field is disabled, rather than inviting an edit that cannot apply');
  await page.close();

  console.log('6. the test send reaches the server with the typed number');
  ({ page, posts } = await open(browser, base, { status: READY, sms: true, owner: true }));
  await openSmsPage(page);
  posts.length = 0;
  await page.evaluate(() => { document.getElementById('sms-test-to').value = '07700 900123'; });
  await page.click('[data-act="sendSmsTest"]');
  await page.waitForTimeout(600);
  const test = posts.find((p) => p.action === 'sms_test');
  ok(!!test && test.to === '07700 900123', 'the number is sent as typed — the server normalises it');
  const tmsg = await page.evaluate(() => (document.getElementById('sms-test-msg') || {}).textContent || '');
  ok(/check your phone/i.test(tmsg), `…and the result is reported (${tmsg})`);
  await page.close();

  console.log('7. THE GUEST FORM FOLLOWS THE SERVER, BOTH WAYS');
  // The defect this whole page exists to close: the opt-in showed regardless.
  ({ page } = await open(browser, base, { status: OFF, sms: false }));
  let g = await page.evaluate(() => {
    const row = document.getElementById('enq-sms-row');
    return { shown: !!row && getComputedStyle(row).display !== 'none', exists: !!row };
  });
  ok(g.exists, 'the opt-in row is in the markup');
  ok(!g.shown, 'texts unavailable → the guest is NOT offered them');
  await page.close();

  ({ page } = await open(browser, base, { status: READY, sms: true }));
  g = await page.evaluate(() => {
    const row = document.getElementById('enq-sms-row');
    return { shown: !!row && getComputedStyle(row).display !== 'none' };
  });
  ok(g.shown, 'texts available → the guest IS offered them');
  await page.close();

  console.log('8. an unavailable opt-in never travels with an enquiry');
  // Hiding a TICKED box would leave the opt-in recorded against a booking nobody
  // can text — so availability clears it, not just conceals it.
  ({ page } = await open(browser, base, { status: OFF, sms: false }));
  const cleared = await page.evaluate(() => {
    const box = document.getElementById('enq-sms-optin');
    box.checked = true;          // as a stale tab or a restored form might leave it
    applySmsAvailability();
    return box.checked;
  });
  ok(cleared === false, 'a ticked box is cleared when texts are unavailable');
  await page.close();

  console.log(fails ? `\n  SMS SUITE FAILED ❌ (${fails})` : '\n  SMS SUITE PASSED ✅');
  await done(fails);
})();
