// The cottage page's "Ask us anything" box, end to end in a real browser:
//  1. a question matching the cottage's FAQ content answers instantly
//  2. an unmatched question offers "message a person"
//  3. that fallback opens the chat and SENDS the exact question (bypassing
//     the matcher, so it reaches the owner untouched)
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8289;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const sent = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('messages.php') && route.request().method() === 'POST') {
      try { sent.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
      return json({ ok: true, thread_id: 1, messages: [] });
    }
    if (url.includes('content.php') && route.request().method() !== 'POST') return json({ ok: true, content: { 'faqs-21a': [{ q: 'Can we bring our dog?', a: 'Yes — one well-behaved dog is welcome at 21A Westgate.' }] } });
    return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, value: null, properties: [], seasons: {}, occupancy: {} });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => { siteContent['faqs-21a'] = [{ q: 'Can we bring our dog?', a: 'Yes — one well-behaved dog is welcome at 21A Westgate.' }]; openProperty('21a'); });
  await page.waitForTimeout(400);

  // 1) Matched question answers instantly from the cottage's own content.
  await page.evaluate(() => { document.getElementById('ask-input').value = 'can we bring a dog with us'; askBoxSubmit(); });
  let a = await page.evaluate(() => (document.getElementById('ask-answer') || {}).textContent || '');
  ok(/one well-behaved dog is welcome/.test(a), `FAQ question answers instantly (${a.trim().slice(0, 60)})`);
  ok(/Message a person/.test(a), 'answer still offers a person');

  // 2) Unmatched question → honest fallback.
  await page.evaluate(() => { document.getElementById('ask-input').value = 'do you have a resident unicorn'; askBoxSubmit(); });
  a = await page.evaluate(() => (document.getElementById('ask-answer') || {}).textContent || '');
  ok(/a person does/.test(a) && /Message us/.test(a), `unmatched question falls back honestly (${a.trim().slice(0, 60)})`);

  // 3) The fallback opens chat and SENDS the exact question to the owner.
  await page.evaluate(() => { document.querySelector('#ask-answer [data-act="askBoxToChat"]').click(); });
  await page.waitForTimeout(600);
  const chat = await page.evaluate(() => ({
    open: (document.getElementById('chat-widget') || { classList: { contains: () => false } }).classList.contains('open'),
  }));
  ok(chat.open, 'fallback opens the chat widget');
  ok(sent.some((m) => /resident unicorn/.test(JSON.stringify(m))), `the exact question was sent to a person (${sent.length} sends)`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} ASK-BOX CHECK(S) FAILED ❌` : '\n  ASK-BOX SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
