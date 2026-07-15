// DEEP SEARCH INTEGRATION — the four ways the Assist Bar is woven further in:
//  1. bars in Payments (#abar-accounts) + Manage (#abar-manage): index filter
//     + inline money answers — so all FOUR back-office workspaces carry the brain
//  2. answers ACT in place: a booking answer's quick-actions render on the bar
//     row (Request payment / Email …) and run without a hop to the hub
//  3. a record-scoped bar ON the booking/enquiry hub: "email them" / "their
//     balance" resolve to the open record (via __cmdkEntity)
//  4. guest typeahead in Add Booking: past guests suggested; a pick fills the form
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8271;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 430, height: 920 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate() + 0).padStart(2, '0')}`; };
  const mk = (id, ci, co, pay) => ({ id, prop_key: 'jollyboat', name: 'Bob Carter', email: 'bob@x.co', phone: '0770', check_in: ci, check_out: co, adults: 2, children: 0, payment: pay || 'deposit', agreed_total: 440, agreed_on: d(-10), hold_status: 'none', notes: '' });
  // One upcoming Bob (owes) + one past Bob (paid) → a repeat guest for the typeahead.
  const bookings = [mk(1, d(4), d(7), 'deposit'), mk(2, d(-40), d(-37), 'paid')];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().method() === 'POST';
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('bookings.php') && !post) return json({ bookings });
    if (url.includes('rates.php') && !post) return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(700);
  const type = async (id, q) => { await page.evaluate(([i, v]) => { const el = document.getElementById(i + '-input'); el.value = v; abarRoute(i, v); }, [id, q]); await page.waitForTimeout(300); };

  // 1) All four new bars inject; every back-office workspace now has one.
  const reg = await page.evaluate(() => ({
    acc: !!document.getElementById('abar-accounts-input'), man: !!document.getElementById('abar-manage-input'),
    bh: !!document.getElementById('abar-bookinghub-input'), eh: !!document.getElementById('abar-enquiryhub-input') }));
  ok(reg.acc && reg.man && reg.bh && reg.eh, `bars injected in Payments/Manage/hubs (acc=${reg.acc} man=${reg.man} bh=${reg.bh} eh=${reg.eh})`);

  // 1a) Payments bar filters its index and answers money questions inline.
  await page.evaluate(() => nav('view-accounts')); await page.waitForTimeout(400);
  await type('abar-accounts', 'income');
  const accF = await page.evaluate(() => { const rows = [...document.querySelectorAll('#view-accounts .settings-row')]; return { total: rows.length, dim: rows.filter((r) => r.classList.contains('cmdk-dim')).length, count: document.getElementById('abar-accounts-count').textContent }; });
  ok(accF.total >= 4 && accF.dim >= 1 && /match/.test(accF.count), `Payments bar filters the index (${accF.dim}/${accF.total} dimmed · ${accF.count})`);
  await page.evaluate(() => abarClear('abar-accounts'));
  await type('abar-accounts', 'who owes me money');
  const accA = await page.evaluate(() => [...document.querySelectorAll('#abar-accounts-panel .abar-row')].map((r) => r.textContent).join(' '));
  ok(/owe|Bob|balance/i.test(accA), `Payments bar answers money questions inline (${accA.slice(0, 40)})`);
  await page.evaluate(() => abarClear('abar-accounts'));

  // 1b) Manage bar filters its settings index.
  await page.evaluate(() => nav('view-settings')); await page.waitForTimeout(400);
  await type('abar-manage', 'cottage');
  const manF = await page.evaluate(() => { const rows = [...document.querySelectorAll('#settings-index .settings-row')]; return { total: rows.length, lit: rows.filter((r) => !r.classList.contains('cmdk-dim')).length, count: document.getElementById('abar-manage-count').textContent }; });
  ok(manF.total >= 4 && manF.lit >= 1 && manF.lit < manF.total && /match/.test(manF.count), `Manage bar filters the settings index (${manF.lit}/${manF.total} lit · ${manF.count})`);
  await page.evaluate(() => abarClear('abar-manage'));

  // 2) ACT IN PLACE — a booking answer's quick-actions render on the bar row.
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(300);
  await type('abar-today', 'who owes me money');
  const qa = await page.evaluate(() => ({ n: document.querySelectorAll('#abar-today-panel .abar-qa .cmdk-qa-row').length, labels: [...document.querySelectorAll('#abar-today-panel .abar-qa .cmdk-qa-lbl')].map((e) => e.textContent).join(' | '), wired: typeof abarAct === 'function' }));
  ok(qa.n > 0 && /pay|book|email/i.test(qa.labels), `act-in-place: quick-actions on the answer (${qa.n}: ${qa.labels.slice(0, 60)})`);
  ok(qa.wired, 'act-in-place: abarAct is wired to run an inline action');
  await page.evaluate(() => abarClear('abar-today')); await page.waitForTimeout(150);

  // 3) HUB BAR — record-scoped. Reset conversational memory so the ONLY resolver
  //    for "email them" is the OPEN record (proving the hub scoping, not carry).
  //    loadData stamps store ids as 'b<row.id>', so open by the store's own id.
  const bkId = await page.evaluate(() => (dbBookings.jollyboat && dbBookings.jollyboat[0] ? dbBookings.jollyboat[0].id : null));
  await page.evaluate(() => { __cmdkConvCtx = null; __cmdkEntity = null; });
  await page.evaluate((id) => openBookingHub(id), bkId); await page.waitForTimeout(500);
  const onHub = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(onHub === 'view-booking-hub', `booking hub open (${onHub})`);
  await type('abar-bookinghub', 'email them');
  const scoped = await page.evaluate(() => ({ ent: typeof __cmdkEntity === 'object' && __cmdkEntity ? String(__cmdkEntity.id) : null, rows: [...document.querySelectorAll('#abar-bookinghub-panel .abar-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).join(' ') }));
  ok(scoped.ent === String(bkId) && /Bob/i.test(scoped.rows), `hub bar scopes "email them" to the open record via __cmdkEntity (ent=${scoped.ent})`);
  ok(/This booking|Email/i.test(scoped.rows), `hub bar surfaces the record + its actions (${(scoped.rows || '').slice(0, 44)})`);
  // "their balance" answers about THIS booking's money.
  await type('abar-bookinghub', 'their balance');
  const bal = await page.evaluate(() => (document.querySelector('#abar-bookinghub-panel .abar-row .cmdk-row-label') || {}).textContent || '');
  ok(/Bob|owes|paid/i.test(bal), `hub bar answers "their balance" for the record (${bal.slice(0, 40)})`);
  await page.evaluate(() => abarClear('abar-bookinghub'));

  // 4) GUEST TYPEAHEAD in Add Booking — past guest suggested; pick fills the form.
  await page.evaluate(() => openAddBooking()); await page.waitForTimeout(300);
  await page.evaluate(() => { const el = document.getElementById('modal-name'); el.value = 'bob'; modalNameSuggest('bob'); }); await page.waitForTimeout(200);
  const sug = await page.evaluate(() => { const b = document.getElementById('modal-name-suggest'); return { shown: b.style.display !== 'none', rows: b.querySelectorAll('.modal-suggest-row').length, first: (b.querySelector('.modal-suggest-nm') || {}).textContent }; });
  ok(sug.shown && sug.rows >= 1 && /Bob/i.test(sug.first || ''), `typeahead suggests the past guest (${sug.rows} row(s): ${sug.first})`);
  await page.evaluate(() => modalNamePick(0)); await page.waitForTimeout(150);
  const picked = await page.evaluate(() => ({ name: document.getElementById('modal-name').value, email: document.getElementById('modal-email').value, closed: document.getElementById('modal-name-suggest').style.display === 'none' }));
  ok(picked.name === 'Bob Carter' && picked.email === 'bob@x.co' && picked.closed, `pick fills name + email and closes (${picked.name} / ${picked.email})`);
  // A short/blank query keeps the dropdown closed.
  await page.evaluate(() => modalNameSuggest('b'));
  const closed = await page.evaluate(() => document.getElementById('modal-name-suggest').style.display === 'none');
  ok(closed, 'typeahead stays closed under 2 chars');

  // 5) No horizontal overflow with the new bars present (phone width).
  await page.evaluate(() => { try { closeModal(); } catch (e) {} nav('view-accounts'); }); await page.waitForTimeout(300);
  const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(spill <= 0, `no horizontal overflow at 430px (spill=${spill})`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} FAIL(S) ❌` : '\n  ASSIST BAR (DEEP INTEGRATION) SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
