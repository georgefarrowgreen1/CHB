// UI/UX consistency sweep of Manage back-office sections. Non-destructive probe.
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8415;
const dir = __dirname;
const SHOTS = '/tmp/claude-0/-home-user-CHB/e820a22c-cfa5-5535-94d0-f1835c6df202/scratchpad/manage-sweep';
const d = (o) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + o); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
  await page.addInitScript(() => { if (window.top === window && navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const base = { ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, value: null, reviews: [], photos: [], threads: [], logs: {}, events: [], expenses: [], payments: [], years: [2026], subscribers: [], entries: [], guests: [], results: [], blocks: [], ranges: [], misses: [] };
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({}, base, o)) });
    const f = url.split('/').pop().split('?')[0];
    if (f === 'rates.php') return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }] });
    if (f === 'activity.php' || f === 'activity-log.php') return json({ ok: true, entries: [
      { id: 1, action: 'booking.add', summary: 'Booking created — Walk-in Guest', actor: 'owner', level: 'info', at: d(0) + ' 09:12:00', created_at: d(0) + ' 09:12:00' },
      { id: 2, action: 'client.error', summary: 'TypeError: x is not a function', actor: 'system', level: 'warn', at: d(-1) + ' 18:30:00', created_at: d(-1) + ' 18:30:00' },
      { id: 3, action: 'payment.request', summary: 'Balance requested — £340.00', actor: 'owner', level: 'info', at: d(-2) + ' 10:00:00', created_at: d(-2) + ' 10:00:00' },
    ] });
    if (f === 'diagnostics.php') return json({ ok: true, checks: [
      { id: 'db', label: 'Database', ok: true, detail: 'Connected' },
      { id: 'mail', label: 'Email', ok: false, detail: 'SMTP not configured' },
    ], cron: { last_run: d(0) + ' 06:00:00', ok: true }, backups: [] });
    if (f === 'cron-status.php') return json({ ok: true, last_run: d(0) + ' 06:00:00', crons: [] });
    if (f === 'content.php') {
      if (url.includes('search-misses') || (route.request().postData() || '').includes('search-misses')) return json({ value: JSON.stringify([{ q: 'wifi code for jollyboat', count: 3, at: Date.now() - 3600e3 }, { q: 'boiler service date', count: 2, at: Date.now() - 7200e3 }]) });
      return json({});
    }
    return json({});
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);

  // seed teach-loop local data so search-learning renders content
  await page.evaluate(() => {
    try { localStorage.setItem('chbMissList', JSON.stringify([{ q: 'wifi code for jollyboat', count: 3, at: Date.now() - 3600e3 }])); } catch (e) {}
    try { localStorage.setItem('chbNluLearned', JSON.stringify({ 'money owed to me': 'balance' })); } catch (e) {}
  });

  const sections = [
    { id: 'apis', open: async () => { await page.evaluate(() => { nav('view-settings'); settingsOpen('apis'); }); }, sel: '#sec-apis' },
    { id: 'search-learning', open: async () => { await page.evaluate(() => { nav('view-settings'); settingsOpen('search-learning'); }); }, sel: '#sec-search-learning' },
    { id: 'diagnostics', open: async () => { await page.evaluate(() => { nav('view-settings'); settingsOpen('diagnostics'); }); }, sel: '#sec-diagnostics' },
    { id: 'activity-log', open: async () => { await page.evaluate(() => { nav('view-activity-log'); }); }, sel: '#view-activity-log' },
    { id: 'manage-index', open: async () => { await page.evaluate(() => { nav('view-settings'); settingsShowIndex(); }); }, sel: '#settings-index' },
  ];

  const inspect = async (sel) => page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    const out = { exists: !!panel, hOverflow: document.documentElement.scrollWidth > window.innerWidth, wide: [], badButtons: [], badInputs: [], inlineHex: [], smallTaps: [], emptyBodies: [], text: '' };
    if (!panel) return out;
    out.text = (panel.innerText || '').slice(0, 1500);
    const vw = window.innerWidth;
    panel.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && out.wide.length < 8) out.wide.push({ tag: el.tagName, cls: el.className && el.className.baseVal !== undefined ? '' : String(el.className).slice(0, 80), w: Math.round(r.width) });
    });
    const okBtn = ['btn-glass', 'btn-sm', 'btn-edit', 'btn-decline', 'settings-row', 'feed-del', 'btn-accent', 'seg-btn', 'chip'];
    panel.querySelectorAll('button, [role="button"], a.btn').forEach((b) => {
      const cls = String(b.className || '');
      const vis = b.offsetParent !== null;
      if (!vis) return;
      if (!okBtn.some((k) => cls.includes(k)) && out.badButtons.length < 10) out.badButtons.push({ cls: cls.slice(0, 100), txt: (b.innerText || '').trim().slice(0, 50), h: b.offsetHeight });
      if (b.offsetHeight > 0 && b.offsetHeight < 36 && out.smallTaps.length < 12) out.smallTaps.push({ cls: cls.slice(0, 80), txt: (b.innerText || '').trim().slice(0, 40), h: b.offsetHeight, w: b.offsetWidth });
    });
    panel.querySelectorAll('input, select, textarea').forEach((i) => {
      if (i.offsetParent === null || i.type === 'checkbox' || i.type === 'radio' || i.type === 'file' || i.type === 'hidden' || i.type === 'range') return;
      const cls = String(i.className || '');
      if (!cls.includes('input-glass') && !cls.includes('toggle') && out.badInputs.length < 10) out.badInputs.push({ tag: i.tagName, type: i.type || '', cls: cls.slice(0, 100) });
    });
    panel.querySelectorAll('[style]').forEach((el) => {
      const s = el.getAttribute('style') || '';
      const m = s.match(/#[0-9a-fA-F]{3,8}\b/);
      if (m && out.inlineHex.length < 10) out.inlineHex.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), hex: m[0], style: s.slice(0, 120) });
    });
    // empty visible sub-panels
    panel.querySelectorAll('.glass-panel, .settings-sec, .diag-card, .sl-panel').forEach((p) => {
      if (p.offsetParent !== null && (p.innerText || '').trim() === '' && out.emptyBodies.length < 5) out.emptyBodies.push({ cls: String(p.className).slice(0, 80) });
    });
    return out;
  }, sel);

  const contrastCheck = async (sel) => page.evaluate((sel) => {
    // spot-check visible text nodes' computed color vs nearest opaque bg
    function lum(c) { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; const [r, g, b] = m.map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
    function bgOf(el) { let e = el; while (e && e !== document.documentElement) { const bg = getComputedStyle(e).backgroundColor; const m = bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/); if (m && (m[4] === undefined || parseFloat(m[4]) > 0.6)) return bg; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; }
    const panel = document.querySelector(sel); if (!panel) return [];
    const bad = [];
    const els = panel.querySelectorAll('span, div, p, label, small, h1, h2, h3, h4, td, th, li, a, button, dt, dd');
    for (const el of els) {
      if (bad.length >= 8) break;
      if (el.children.length > 0) continue;
      const t = (el.innerText || '').trim(); if (!t || t.length < 2) continue;
      if (el.offsetParent === null) continue;
      const cs = getComputedStyle(el);
      const cl = lum(cs.color); const bl = lum(bgOf(el));
      if (cl === null || bl === null) continue;
      const ratio = (Math.max(cl, bl) + 0.05) / (Math.min(cl, bl) + 0.05);
      const px = parseFloat(cs.fontSize);
      const need = px >= 18.66 || (px >= 14 && parseInt(cs.fontWeight, 10) >= 700) ? 3 : 4.5;
      if (ratio < need - 1.0) bad.push({ txt: t.slice(0, 40), color: cs.color, bg: bgOf(el), ratio: Math.round(ratio * 100) / 100, px });
    }
    return bad;
  }, sel);

  const results = {};
  const runPass = async (width, height, theme, tag) => {
    await page.setViewportSize({ width, height });
    await page.evaluate((theme) => { if (theme === 'light') document.body.classList.add('light-mode'); else document.body.classList.remove('light-mode'); }, theme);
    await page.waitForTimeout(200);
    for (const s of sections) {
      await s.open();
      await page.waitForTimeout(700);
      // let any Loading… settle
      await page.waitForTimeout(1400);
      const shot = `${SHOTS}/${s.id}-${width}-${theme}.png`;
      await page.screenshot({ path: shot, fullPage: width === 390 });
      const info = await inspect(s.sel);
      info.contrast = theme === 'light' ? await contrastCheck(s.sel) : [];
      results[`${s.id}|${tag}`] = info;
    }
  };

  await runPass(390, 844, 'dark', '390-dark');
  await runPass(390, 844, 'light', '390-light');
  await runPass(1280, 900, 'dark', '1280-dark');

  console.log(JSON.stringify(results, null, 1));
  await browser.close();
  server.kill();
  process.exit(0);
})().catch((e) => { console.error('SWEEP FAIL', e); process.exit(1); });
