// ============================================================
//  ui-test-adminviews.js — the back-office MARKUP split (admin-views.html).
//
//  The whole point of the split is that a guest never pays for the back office:
//  index.html ships EMPTY <main id="view-..."> shells and the bodies arrive only
//  when an owner signs in, as the first step of loadAdminBundle(). That promise
//  is invisible to every other suite — re-inline the markup, or fetch it on
//  public boot, and everything still "works" while the ~17KB gz win silently
//  evaporates. So assert it directly:
//
//    A) a guest browse never requests admin-views.html, and no admin markup is
//       in the DOM;
//    B) loading the admin bundle fetches it ONCE and populates every shell;
//    C) a second ensureAdminViews() is a no-op (never double-injects);
//    D) a failed fetch reports an error and leaves the owner able to RETRY
//       (a cached rejection would strand them on empty screens).
// ============================================================
const { bootBrowser } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// The seven admin screens whose bodies moved out of index.html.
const VIEWS = ['view-backoffice', 'view-inbox', 'view-accounts', 'view-settings', 'view-booking-hub', 'view-enquiry-hub', 'view-search'];

const stubApi = (page, { admin }) => page.route(/\.php/, (r) => {
    const url = r.request().url();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) {
        let b = {};
        try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
        if (b.action === 'admin_status') return json({ ok: true, admin });
        if (b.action === 'guest_status') return json({ ok: true, guest: null });
        return json({ ok: true });
    }
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], events: [], enquiries: [], threads: [], reviews: [], photos: [], mine: {}, value: null, properties: [] });
});

const newPage = async (browser, opts = {}) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // opts.tolerate: section D deliberately breaks the fetch, and a facade stub
    // reaching for the bundle rethrows ON PURPOSE so the site's error capture logs
    // it ("Needs attention"). That surfaces as a page error — the designed
    // behaviour, not a regression — so the induced message is allowed there only.
    page.on('pageerror', (e) => {
        if (opts.tolerate && opts.tolerate.test(e.message || '')) return;
        console.log('  PAGEERR:', e.message);
        fails++;
    });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    const views = [];
    page.on('request', (r) => { if (r.url().includes('admin-views.html')) views.push(r.url()); });
    await stubApi(page, { admin: !!opts.admin });
    return { page, views };
};

(async () => {
  const { browser, base, done } = await bootBrowser();

  // ---- A) a GUEST must not pay for the back office ----
  {
    const { page, views } = await newPage(browser, { admin: false });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const g = await page.evaluate((ids) => ({
      shellsPresent: ids.filter((id) => !!document.getElementById(id)).length,
      shellsEmpty: ids.filter((id) => { const el = document.getElementById(id); return el && !el.firstElementChild; }).length,
      // A few ids that only exist inside the admin bodies.
      adminMarkup: ['settings-index', 'accounts-index', 'cmdk-input', 'bookings-list'].filter((id) => !!document.getElementById(id)),
    }), VIEWS);
    ok(g.shellsPresent === VIEWS.length, `index.html still carries all ${VIEWS.length} view shells (${g.shellsPresent})`);
    ok(g.shellsEmpty === VIEWS.length, `every admin shell is EMPTY for a guest (${g.shellsEmpty}/${VIEWS.length})`);
    ok(g.adminMarkup.length === 0, `no admin markup in a guest's DOM (found: ${g.adminMarkup.join(', ') || 'none'})`);
    ok(views.length === 0, `a guest never requests admin-views.html (${views.length} requests)`);
    await page.close();
  }

  // ---- B) + C) owner sign-in populates the screens, exactly once ----
  {
    const { page, views } = await newPage(browser, { admin: true });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
    await page.waitForTimeout(300);
    const o = await page.evaluate((ids) => ({
      populated: ids.filter((id) => { const el = document.getElementById(id); return el && el.firstElementChild; }).length,
      keyNodes: ['settings-index', 'accounts-index', 'cmdk-input'].filter((id) => !!document.getElementById(id)).length,
      adminLoaded: !!window.__ADMIN_LOADED,
    }), VIEWS);
    ok(o.adminLoaded, 'the admin bundle finished loading');
    ok(o.populated === VIEWS.length, `every admin shell is populated after sign-in (${o.populated}/${VIEWS.length})`);
    ok(o.keyNodes === 3, `the moved markup is live (${o.keyNodes}/3 key nodes)`);
    ok(views.length === 1, `admin-views.html fetched exactly once (${views.length})`);
    ok(/[?&]v=\d+/.test(views[0] || ''), `it is version-pinned (${(views[0] || '').split('/').pop()})`);

    // C) idempotent: a second call must not duplicate the markup.
    const dup = await page.evaluate(async () => {
      const before = document.getElementById('view-settings').children.length;
      await window.ensureAdminViews();
      return { before, after: document.getElementById('view-settings').children.length };
    });
    ok(dup.before === dup.after && dup.after > 0, `ensureAdminViews is idempotent (${dup.before} → ${dup.after} children)`);
    ok(views.length === 1, 'the repeat call re-used the cached promise (no second fetch)');
    await page.close();
  }

  // ---- D) a failed fetch must be reported AND retryable ----
  {
    const { page } = await newPage(browser, { admin: true, tolerate: /admin screens/i });
    await page.route('**/admin-views.html*', (r) => r.abort());
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    const first = await page.evaluate(async () => {
      try { await window.loadAdminBundle(); return 'RESOLVED'; } catch (e) { return 'REJECTED: ' + e.message; }
    });
    ok(/^REJECTED/.test(first), `a dropped admin-views.html rejects rather than silently emptying the back office (${first.slice(0, 46)})`);
    ok(/admin screens/i.test(first), 'the error names the admin screens, so the owner sees a real message');
    // Now let it through: the owner's next tap must succeed (no cached rejection).
    await page.unroute('**/admin-views.html*');
    const retry = await page.evaluate(async () => {
      try {
        await window.loadAdminBundle();
        return !!document.getElementById('settings-index') && !!window.__ADMIN_LOADED;
      } catch (e) { return 'still failing: ' + e.message; }
    });
    ok(retry === true, `the retry after a failure succeeds (${retry})`);
    await page.close();
  }

  console.log(fails ? `\n  ${fails} ADMIN-VIEWS CHECK(S) FAILED ❌` : '\n  ADMIN-VIEWS SUITE PASSED ✅');
  await done(fails);
})();
