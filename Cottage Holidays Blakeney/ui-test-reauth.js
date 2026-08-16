// CONFIRM IT IS YOU — the step-up in front of every refund, on the owner's side.
// The RULE lives on the server and is gated in test-integration §24 (refused
// without a fresh confirmation, accepted with one, and never gated on the
// actions that move no money). What THIS suite owns is the affordance:
//   1. a refund that meets 'reauth_required' PROMPTS and then RETRIES — the
//      owner's tap is not lost, and the money moves once they confirm
//   2. declining the prompt sends nothing and says so — "not confirmed" must
//      never read as "done"
//   3. a wrong password does not retry the refund
//   4. keeping a deposit is never gated — no money leaves, so no prompt
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));

  const posts = [];
  let reauthed = false; // the server's window, modelled
  let pwOk = true;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.action === 'admin_reauth_password') {
        if (!pwOk) return json({ error: 'That password did not match.' }, 403);
        reauthed = true;
        return json({ ok: true });
      }
      // The money-out actions behave exactly as the server does.
      if (b.action === 'return_deposit' || b.action === 'refund') {
        if (!reauthed) return json({ error: 'Confirm it is you before returning a deposit.', code: 'reauth_required' }, 401);
        return json({ ok: true, returned: b.amount || 0, email: { ok: true } });
      }
      if (b.action === 'keep_deposit') return json({ ok: true });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [], experiences: [], events: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);

  // No passkey support in this browser context, so the prompt goes straight to
  // the password form — which is the path every owner without a passkey takes.
  const answerPassword = (pw) => page.evaluate((p) => {
    window.glassForm = async () => ({ pw: p });
    window.glassConfirm = async () => false; // "use a passkey?" → no, type it
    window.glassAlert = (m) => { (window.__alerts = window.__alerts || []).push(String(m)); };
  }, pw);

  console.log('1. a refund prompts, then retries');
  await answerPassword('it-pass-123');
  const r1 = await page.evaluate(async () => {
    const out = await chbWithReauth('returning £60.00', () =>
      apiPost('bookings.php', { action: 'return_deposit', id: 7, amount: 60 }));
    return out;
  });
  const tries = posts.filter((p) => p.action === 'return_deposit');
  ok(!!r1 && r1.ok === true, 'the refund succeeds after confirming');
  ok(tries.length === 2, `it was attempted, refused, then retried once (${tries.length} attempts)`);
  ok(posts.some((p) => p.action === 'admin_reauth_password'), 'the confirmation was posted between the two');
  ok(tries[1] && tries[1].amount === 60 && tries[1].id === 7,
    'the RETRY carries the same money and booking — the tap is not lost');

  console.log('2. a fresh window costs nothing');
  const before = posts.length;
  await page.evaluate(() => apiPost('bookings.php', { action: 'return_deposit', id: 8, amount: 20 }));
  const asked = posts.slice(before).filter((p) => p.action === 'admin_reauth_password').length;
  ok(asked === 0, 'a second refund inside the window asks for nothing');

  console.log('3. declining sends nothing, and says so');
  await page.evaluate(() => {
    window.glassForm = async () => null;   // cancelled the password box
    window.glassConfirm = async () => false;
  });
  reauthed = false; // the server's window has lapsed
  const before2 = posts.length;
  const r3 = await page.evaluate(async () => {
    try {
      await chbWithReauth('returning £60.00', () =>
        apiPost('bookings.php', { action: 'return_deposit', id: 9, amount: 60 }));
      return { threw: false, msg: '' };
    } catch (e) { return { threw: true, msg: e.message || '', code: e.code || '' }; }
  });
  const sent3 = posts.slice(before2).filter((p) => p.action === 'return_deposit').length;
  ok(r3.threw && /nothing was refunded/i.test(r3.msg),
    `declining says plainly that nothing moved (${r3.msg})`);
  ok(r3.code === 'reauth_cancelled', 'and it is distinguishable from a real failure');
  ok(sent3 === 1, `the refund was tried once and NOT retried (${sent3})`);

  console.log('4. a wrong password does not refund');
  pwOk = false;
  await answerPassword('wrong');
  const before3 = posts.length;
  const r4 = await page.evaluate(async () => {
    try {
      await chbWithReauth('returning £60.00', () =>
        apiPost('bookings.php', { action: 'return_deposit', id: 10, amount: 60 }));
      return { threw: false };
    } catch (e) { return { threw: true, code: e.code || '' }; }
  });
  const sent4 = posts.slice(before3).filter((p) => p.action === 'return_deposit').length;
  ok(r4.threw && sent4 === 1, `a wrong password leaves the refund unsent (${sent4} attempt)`);
  ok(await page.evaluate(() => (window.__alerts || []).some((m) => /did not match/i.test(m))),
    'and the owner is told why');

  console.log('5. what moves no money is never gated');
  pwOk = true;
  const before5 = posts.length;
  await page.evaluate(() => apiPost('bookings.php', { action: 'keep_deposit', id: 11 }));
  ok(posts.slice(before5).every((p) => p.action !== 'admin_reauth_password'),
    'keeping a deposit asks for no confirmation');
  ok(pageErrors.length === 0, `no page errors across the run (${pageErrors.slice(0, 2).join(' | ')})`);

  await done(fails);
  console.log(fails ? `\nREAUTH TEST FAILED (${fails}) ❌` : '\nREAUTH TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
