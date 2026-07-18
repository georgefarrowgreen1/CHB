// Guest "Your stay" pre-arrival hub, end to end in a real browser:
//  1. a signed-in guest with an upcoming stay gets a countdown hub with the
//     days-to-go badge, planning tiles, and the one thing left to sort
//  2. a balance-due stay shows "balance due" + a Pay balance CTA
//  3. a fully-paid, details-in guest sees "you're all set" and no CTA
//  4. "Tomorrow" wording at +1 day
//  5. only the SOONEST upcoming stay gets the hub (one, not per-booking)
//  6. a past-only guest, and a logged-out visitor, get no hub
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8298;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const mk = (pk, inD, outD, extra) => Object.assign({ prop_key: pk, check_in: inD, check_out: outD, adults: 2, children: 0, id: Math.floor(Math.random() * 1e6) }, extra || {});

  const openPage = async (guest, bookings) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('auth.php')) {
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (body.action === 'guest_status') return json({ ok: true, guest });
        return json({ ok: true, admin: false, guest: null });
      }
      if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: 0 });
      if (url.includes('rates.php')) return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
        { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 120, booking_fee: 50, max_adults: 2, max_children: 1, max_total: 3, sort_order: 2 },
      ], seasons: {}, occupancy: {} });
      return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
    });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
    if (guest) { await page.evaluate(() => openGuestArea()); }
    await page.waitForTimeout(700);
    return page;
  };

  const hub = (page) => page.evaluate(() => {
    const el = document.querySelector('.my-stay-hub-soon');
    if (!el) return null;
    return {
      n: (el.querySelector('.hub-count-n') || {}).textContent || '',
      u: (el.querySelector('.hub-count-u') || {}).textContent || '',
      title: (el.querySelector('.hub-title') || {}).textContent || '',
      sub: (el.querySelector('.hub-sub') || {}).textContent || '',
      tiles: el.querySelectorAll('.hub-tile').length,
      pay: /Pay balance/.test(el.textContent),
      count: document.querySelectorAll('.my-stay-hub-soon').length,
    };
  });

  // A locked agreed price so the balance is deterministic (independent of rate
  // synthesis) — exactly how a confirmed booking carries its price.
  const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };

  // 1+2) Balance due, 10 days out.
  let page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'unpaid', pay_token: 'tok1' }, priced))]);
  let h = await hub(page);
  ok(!!h, 'the pre-arrival countdown hub renders for an upcoming stay');
  ok(h && h.n === '10' && /days to go/.test(h.u), `countdown reads 10 days to go (${h && h.n} / ${h && h.u})`);
  ok(h && /Jollyboat/.test(h.title) && /10 days/.test(h.title), `hub names the cottage + countdown (${h && h.title.trim()})`);
  ok(h && h.tiles === 5, `hub carries the planning tiles (${h && h.tiles})`);
  ok(h && /balance/i.test(h.sub) && h.pay, 'balance-due stay shows the balance note + Pay CTA');
  await page.close();

  // 3) Fully paid + details submitted → "all set", no CTA.
  page = await openPage({ name: 'Paid Guest', email: 'p@x.co' }, [mk('jollyboat', d(6), d(9), { payment: 'paid', reg_submitted: true, reg_url: 'guest-details.php?b=1&token=z' })]);
  h = await hub(page);
  ok(h && /all set/i.test(h.sub) && !h.pay, `fully-paid, details-in guest reads "you're all set" with no CTA (${h && h.sub.trim().slice(-30)})`);
  await page.close();

  // 4) Tomorrow wording at +1 day.
  page = await openPage({ name: 'Soon Guest', email: 's@x.co' }, [mk('21a', d(1), d(3), { payment: 'unpaid', pay_token: 'tok2' })]);
  h = await hub(page);
  ok(h && h.n === '1' && /day to go/.test(h.u) && /Tomorrow/.test(h.title), `+1 day reads "Tomorrow" / 1 day to go (${h && h.title.trim()})`);
  await page.close();

  // 5) Two upcoming stays → exactly one hub, for the soonest.
  page = await openPage({ name: 'Two Stays', email: 't@x.co' }, [
    mk('jollyboat', d(5), d(8), Object.assign({ payment: 'unpaid', pay_token: 'a' }, priced)),
    mk('21a', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'b' }, priced)),
  ]);
  h = await hub(page);
  ok(h && h.count === 1 && h.n === '5', `only the soonest upcoming stay gets a hub (count ${h && h.count}, days ${h && h.n})`);
  await page.close();

  // 6) Past-only guest → no hub.
  page = await openPage({ name: 'Past Guest', email: 'past@x.co' }, [mk('jollyboat', d(-30), d(-27), { payment: 'paid' })]);
  h = await hub(page);
  ok(h === null, 'a past-only guest gets no pre-arrival hub');
  await page.close();

  // 7) Logged out → no hub.
  page = await openPage(null, []);
  h = await hub(page);
  ok(h === null, 'logged out → no pre-arrival hub');
  await page.close();

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} YOUR-STAY CHECK(S) FAILED ❌` : '\n  YOUR-STAY SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
