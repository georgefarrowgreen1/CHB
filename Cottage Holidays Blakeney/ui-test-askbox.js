// The cottage page's "Ask us anything" box, end to end in a real browser:
//  1. a question matching the cottage's FAQ content answers instantly
//  2. an unmatched question offers "message a person"
//  3. that fallback opens the chat and SENDS the exact question (bypassing
//     the matcher, so it reaches the owner untouched)
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 900, height: 900 } });
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
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
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

  console.log(fails ? `\n  ${fails} ASK-BOX CHECK(S) FAILED ❌` : '\n  ASK-BOX SUITE PASSED ✅');
  await done(fails);
})();
