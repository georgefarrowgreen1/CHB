// Pass 2: focused measurements — follow-ups edge geometry, dock clearance,
// chat-away card/select rendering in light mode, title duplication.
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8414;
const dir = __dirname;
const SHOTS = '/tmp/claude-0/-home-user-CHB/e820a22c-cfa5-5535-94d0-f1835c6df202/scratchpad/manage-sweep';

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({ executablePath: process.env.CHB_CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
  await page.addInitScript(() => { if (window.top === window && navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, bookings: [], enquiries: [], properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }],
      seasons: {}, occupancy: {}, content: {}, value: null, reviews: [], photos: [], threads: [], logs: {}, events: [],
      expenses: [], payments: [], years: [2026], subscribers: [], entries: [], guests: [], results: [],
      passkeys: [], primary: 'owner@example.com', extras: [], blocks: [], ranges: [],
    }) });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);

  // ---- follow-ups geometry at 390, light ----
  await page.evaluate(() => { document.body.classList.add('light-mode'); nav('view-settings'); settingsOpen('follow-ups'); });
  await page.waitForTimeout(600);
  const fu = await page.evaluate(() => {
    const sec = document.getElementById('sec-follow-ups');
    const cbs = [...sec.querySelectorAll('input[type=checkbox]')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.id, left: r.left, top: r.top, w: r.width, h: r.height }; });
    const labels = [...sec.querySelectorAll('label')].map((l) => { const r = l.getBoundingClientRect(); return { left: r.left, w: r.width, h: r.height }; });
    const secR = sec.getBoundingClientRect();
    const panel = document.getElementById('settings-panel').getBoundingClientRect();
    const view = document.getElementById('view-settings');
    const vs = getComputedStyle(view);
    return { cbs, labels, secLeft: secR.left, panelLeft: panel.left, viewPad: vs.paddingLeft + ' / ' + vs.paddingRight + ' / bottom ' + vs.paddingBottom, hasCard: !!sec.querySelector('.glass-panel, .accounts-stat') };
  });
  console.log('FOLLOW-UPS GEOMETRY:', JSON.stringify(fu, null, 1));
  await page.screenshot({ path: `${SHOTS}/follow-ups-390-light-viewport.png` });

  // ---- security: scroll to page bottom — does the 2FA toggle clear the dock? ----
  await page.evaluate(() => { settingsOpen('security'); });
  await page.waitForTimeout(700);
  const dockInfo = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    const cb = document.getElementById('admin-2fa-toggle');
    const label = cb && cb.closest('label');
    const r = label ? label.getBoundingClientRect() : null;
    const dock = document.querySelector('.admin-dock, .dock, #admin-dock, nav.bottom-dock, .guest-dock') || [...document.querySelectorAll('body > *')].find((e) => { const cs = getComputedStyle(e); return cs.position === 'fixed' && parseFloat(cs.bottom) < 60 && e.offsetHeight > 30 && e.offsetHeight < 120 && e.offsetWidth > 100; });
    const dr = dock ? dock.getBoundingClientRect() : null;
    return { labelRect: r && { top: r.top, bottom: r.bottom }, dock: dock && { cls: dock.className, id: dock.id, top: dr.top, bottom: dr.bottom, left: dr.left, right: dr.right }, innerH: window.innerHeight, overlap: r && dr ? r.bottom > dr.top && r.top < dr.bottom && dr.left < r.right : null };
  });
  console.log('SECURITY BOTTOM / DOCK:', JSON.stringify(dockInfo, null, 1));
  await page.screenshot({ path: `${SHOTS}/security-390-light-bottom.png` });

  // ---- chat-away in light: card fill + select computed styles + duplicated title ----
  await page.evaluate(() => { window.scrollTo(0, 0); settingsOpen('chat-away'); });
  await page.waitForTimeout(600);
  const ca = await page.evaluate(() => {
    const card = document.getElementById('chat-away-editor');
    const cs = getComputedStyle(card);
    const sels = [...card.querySelectorAll('select')].map((s) => { const c = getComputedStyle(s); const r = s.getBoundingClientRect(); return { bg: c.backgroundColor, color: c.color, radius: c.borderRadius, h: r.height }; });
    const ta = card.querySelector('textarea');
    const tacs = getComputedStyle(ta);
    const panelTitle = document.getElementById('settings-panel-title').textContent;
    const innerH3 = (card.querySelector('h3') || {}).textContent;
    return { cardBg: cs.backgroundColor, cardRadius: cs.borderRadius, sels, taBg: tacs.backgroundColor, taRadius: tacs.borderRadius, panelTitle, innerH3 };
  });
  console.log('CHAT-AWAY LIGHT:', JSON.stringify(ca, null, 1));

  // dark-mode card fill too
  const caDark = await page.evaluate(() => {
    document.body.classList.remove('light-mode');
    const cs = getComputedStyle(document.getElementById('chat-away-editor'));
    return { cardBg: cs.backgroundColor, cardRadius: cs.borderRadius };
  });
  console.log('CHAT-AWAY DARK CARD:', JSON.stringify(caDark));

  // ---- notify: email-recipients list row (primary) anatomy + host photo button row at 390 ----
  await page.evaluate(() => { document.body.classList.add('light-mode'); settingsOpen('notify'); });
  await page.waitForTimeout(900);
  const nt = await page.evaluate(() => {
    const box = document.getElementById('notify-emails-list');
    return { html: box ? box.innerHTML.slice(0, 600) : null };
  });
  console.log('NOTIFY EMAIL LIST:', JSON.stringify(nt, null, 1));

  await browser.close();
  server.kill();
})().catch((e) => { console.error(e); process.exit(1); });
