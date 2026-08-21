// The AI chat page on a phone, as it really renders.
const { boot } = require('/home/user/CHB/Cottage Holidays Blakeney/ui-test-lib');
const OUT = '/home/user/CHB/scratch';
(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(900);
  // The morning greeting, with a real day behind it.
  await page.evaluate(() => {
    const t = (() => { const d = new Date(); const p = (v) => String(v).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
    window.chbDuties = () => [
      { label: 'Sarah Pemberton still owes £340.50', act: 'Chase', run: () => {} },
      { label: 'Jollyboat needs its key-safe code rotating', act: 'Open', run: () => {} },
    ];
    window.chbDayTuples = () => [
      { pk: 'jollyboat', ci: t, co: '2027-12-31', arrived: false, due: 340.5 },
      { pk: '21a', ci: '2020-01-01', co: t, arrived: true, due: 0 },
    ];
    window.siteContent = window.siteContent || {};
    window.siteContent['host-name'] = 'George';
  });
  await page.evaluate(() => {
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, convo: 4,
          convos: [{ convo: 4, n: 6, title: 'the boiler quote' }, { convo: 3, n: 2, title: 'Who owes me money?' }],
          memory: [], instr: '',
          handoff: { dev: 'mac', convo: 4, title: 'the boiler quote', draft: 'and what did colin quo', at: 999 },
          msgs: [],
          presence: { seen: Math.floor(Date.now() / 1000), listening: true } };
      }
      return { ok: true };
    };
    return openAiChat();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + '/phone-day.png' });
  await done(0);
})();
