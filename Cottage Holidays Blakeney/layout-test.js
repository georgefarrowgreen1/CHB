#!/usr/bin/env node
// ============================================================
//  layout-test.js — design-regression gate (dev/CI only, never deployed).
//
//  Pixel-diffing against committed baselines is flaky across machines (fonts,
//  antialiasing), so this gate asserts LAYOUT INVARIANTS instead — the things
//  that are true of every non-broken responsive page, checked deterministically
//  at phone / tablet / desktop widths on the key public views:
//    • no horizontal page overflow (the classic "text overhangs on mobile")
//    • no visible element extends past the right edge of the viewport
//    • the view's key content actually rendered and is visibly sized
//  It also saves a screenshot per view×width to layout-shots/ — uploaded as a
//  CI artifact so a human can eyeball the design without pulling the branch.
//
//  Run locally:  node layout-test.js   (same setup as e2e-test.js)
// ============================================================
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8253;
const dir = __dirname;
const SHOTS = path.join(dir, 'layout-shots');

const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
  { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 110, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 1, max_total: 3, sort_order: 3 },
];
const experiences = [
  { id: 1, title: 'Seal trips from Morston Quay', body: 'Boats run daily from the quay — book ahead in summer.', image: '', link: '', status: 'published', sort_order: 1 },
  { id: 2, title: 'Blakeney Point walk', body: 'A long shingle walk with the colony at the end.', image: '', link: '', status: 'published', sort_order: 2 },
];

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((res) => { http.get(url, (r) => res(r.statusCode === 200)).on('error', () => res(false)); });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('php -S did not become ready');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  const problems = [];
  const pass = (m) => console.log('  ✓ ' + m);
  const fail = (m) => { problems.push(m); console.log('  ✗ ' + m); };
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/index.html`);
    const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});

    for (const vp of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
      });
      await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
        if (url.includes('experiences.php')) return json({ experiences });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences, content: {}, blocks: [], ranges: [] });
      });
      page.on('pageerror', (e) => problems.push(`pageerror @${vp.name}: ` + e.message));

      await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);
      // Freeze animations/transitions so measurements are stable.
      await page.addStyleTag({ content: '*,*:before,*:after{animation:none!important;transition:none!important}' });

      const views = [
        { key: 'home', open: null, mustSee: ['#hero', '#home-cottages-grid .card'] },
        { key: 'cottage', open: "openProperty('21a')", mustSee: ['#prop-title', '#prop-avail-cal'] },
        { key: 'experiences', open: "nav('view-experiences')", mustSee: ['#exp-grid'] },
      ];
      for (const v of views) {
        if (v.open) {
          await page.evaluate((code) => eval(code), v.open);
          await page.waitForTimeout(700);
        }
        const r = await page.evaluate((mustSee) => {
          const out = { overflow: 0, offenders: [], missing: [], zero: [] };
          const de = document.documentElement;
          out.pageOverflow = de.scrollWidth - window.innerWidth;
          // An element is a genuine overhang bug only if it is PARTIALLY visible
          // (off-canvas slide-in UI like the mobile menu starts fully past the
          // edge), extends past the right edge, is NOT inside a clipped or
          // horizontally-scrollable container (decorative blobs / parallax
          // overscan / photo strips are clipped or scrollable by design), and
          // carries real content (text, link, button, input or image).
          const isClippedOrScrollable = (el) => {
            let a = el.parentElement;
            while (a && a !== document.body) {
              const o = getComputedStyle(a).overflowX;
              if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true;
              a = a.parentElement;
            }
            return false;
          };
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            if (b.right <= window.innerWidth + 2) continue;
            if (b.left >= window.innerWidth - 2) continue; // fully off-canvas = intentional
            const hasContent =
              /^(A|BUTTON|INPUT|SELECT|TEXTAREA|IMG)$/.test(el.tagName) ||
              (el.childElementCount === 0 && (el.textContent || '').trim() !== '');
            if (!hasContent) continue;
            if (isClippedOrScrollable(el)) continue;
            out.overflow++;
            if (out.offenders.length < 5) {
              out.offenders.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' right=' + Math.round(b.right));
            }
          }
          for (const sel of mustSee) {
            const el = document.querySelector(sel);
            if (!el) { out.missing.push(sel); continue; }
            const b = el.getBoundingClientRect();
            if (b.width < 10 || b.height < 10) out.zero.push(sel);
          }
          return out;
        }, v.mustSee);

        const label = `${v.key} @ ${vp.name} (${vp.width}px)`;
        r.pageOverflow <= 2 ? pass(`${label}: no horizontal page overflow`) : fail(`${label}: page overflows by ${r.pageOverflow}px`);
        r.overflow === 0 ? pass(`${label}: no element past the right edge`) : fail(`${label}: ${r.overflow} element(s) overflow — ${r.offenders.join(', ')}`);
        r.missing.length === 0 ? pass(`${label}: key content present`) : fail(`${label}: missing ${r.missing.join(', ')}`);
        r.zero.length === 0 ? pass(`${label}: key content visibly sized`) : fail(`${label}: zero-sized ${r.zero.join(', ')}`);

        await page.screenshot({ path: path.join(SHOTS, `${v.key}-${vp.name}.png`), fullPage: vp.name !== 'phone' }).catch(() => {});
      }
      await page.close();
    }
    await browser.close();
  } catch (e) {
    fail('harness error: ' + e.message);
  } finally {
    server.kill();
  }
  console.log('\n== Summary ==');
  if (problems.length) {
    console.log(`  ${problems.length} LAYOUT CHECK(S) FAILED ❌`);
    process.exit(1);
  }
  console.log('  LAYOUT CHECKS PASSED ✅  (screenshots in layout-shots/)');
})();
