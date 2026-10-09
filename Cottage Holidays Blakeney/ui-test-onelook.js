// ONE LOOK ACROSS MANAGE (the approved "One look for Manage" demo), driven in a
// real browser. What is worth driving here rather than reading off the CSS:
//
//   §1 every Manage page's buttons are one of THREE kinds, with no old look
//      class left — oneLookButtons is a choke point, so a page that escapes it
//      is the defect (the email_dark_hooks rule);
//   §2 the back link NAMES where it goes, on every route that sets one;
//   §3 the menu: no Status row (the pill is the way in), the rare tools fold
//      under "More tools", and the rows carry no sub-lines;
//   §4 adding is a ROW at the foot of the list it adds to, never a pill among
//      the actions;
//   §5 every field in the place editor has a label of its own;
//   §6 a window opened from Manage is a bottom sheet on a phone — and the same
//      window opened outside Manage is untouched (the scope is the point);
//   §7 one caption tier on Manage, the old tracked capitals left alone outside it;
//   §8 Payments and Key safes joined: tools as rows, one caption tier, a back link
//      that names Payments, an expense as one line in one card (its rows were
//      wearing the guest Things-to-do class, whose display:flex broke the grid);
//   §9 the Inbox joined: no sentence under the title, one chevron, the conversations
//      one list card under one search with chips, and two verdicts that no longer
//      claim more than they know (a read-but-unanswered chat, a mailbox that failed);
//  §10 the booking and enquiry pages joined: a back link naming its screen, cards on the
//      one radius, the one caption tier, sentence-case tags, Approve a filled pill.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const OLD = ['btn-sm', 'btn-edit', 'btn-delete', 'btn-glass', 'btn-accent', 'pay-btn', 'pay-btn2', 'mod-ok', 'mod-no', 'rv-act', 'rv-copy', 'ana-export', 'sp-again', 'mo-tool', 'sp-on', 'etpl-del', 'cal-all', 'rvi-add', 'sp-fix', 'ga-link', 'ga-photolink'];

async function open(browser, base, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); try { localStorage.setItem('chb-theme', 'dark'); } catch (e) {} });
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [
      { id: 7, status: 'published', title: 'Blakeney Point seal trips', category: 'Boat trips & wildlife', body: 'Seals.', image_url: '' },
      { id: 8, status: 'published', title: 'Cley Marshes', category: 'Walks & nature', body: 'Birds.', image_url: '' },
    ] });
    if (url.includes('rates.php')) return json({ properties: [
      { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 150, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, status: 'pending', prop: '21a', name: 'Margaret', text: 'Lovely.' }] });
    if (url.includes('ical-import.php')) return json({ ok: true, feeds: [], blocks: [] });
    if (url.includes('keysafe.php')) return json({ ok: true, safes: { '21a': { code: '4821', setAt: '2026-09-01T10:00:00Z', forBooking: 0, history: [], enabled: true }, 'jollyboat': { code: '', history: [], enabled: true } }, revealDays: 2 });
    if (route.request().method() === 'POST' && b.action === 'admin_status') return json({ ok: true, admin: true });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], waitlist: [], photos: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  await page.evaluate(async () => { await loadData(); await openArea(); });
  await page.waitForTimeout(800);
  return page;
}

(async () => {
  const t = await bootBrowser();
  const page = await open(t.browser, t.base, 390);

  console.log('§1 every Manage button is one of three kinds');
  const SECS = ['payments', 'reviews', 'replies', 'follow-ups', 'sms', 'experiences', 'newsletter', 'backups', 'apis', 'calendar', 'content', 'cancel', 'seasongrid'];
  const seen = { kinds: 0, old: [] };
  for (const sec of SECS) {
    await page.evaluate((s) => settingsOpen(s), sec);
    await page.waitForTimeout(350);
    const r = await page.evaluate((OLD) => {
      const v = document.getElementById('view-settings');
      const old = [...v.querySelectorAll('button, a.btn-sm')].filter((b) => OLD.some((c) => b.classList.contains(c))).map((b) => b.className + ' "' + b.textContent.trim().slice(0, 20) + '"');
      return { old, kinds: v.querySelectorAll('.u-btn1, .u-btn2, .u-btn3').length };
    }, OLD);
    seen.kinds += r.kinds;
    r.old.forEach((x) => seen.old.push(sec + ': ' + x));
  }
  ok(seen.kinds >= 30, `the pages' buttons carry one of the three kinds (${seen.kinds} across ${SECS.length} pages; vacuity guard)`);
  ok(seen.old.length === 0, `no button keeps an old look class${seen.old.length ? ' — ' + seen.old.slice(0, 4).join(' · ') : ''}`);
  const kinds = await page.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 30)); // the kinds land on the observer's microtask
    settingsOpen('replies');
    await tick();
    const del = [...document.querySelectorAll('#replies-body button')].find((b) => /^Delete$/.test(b.textContent.trim()));
    settingsOpen('backups');
    await tick();
    const up = [...document.querySelectorAll('#backups-body button')].find((b) => /^Back up now$/.test(b.textContent.trim()));
    const ver = [...document.querySelectorAll('#backups-body button')].find((b) => /^Verify latest$/.test(b.textContent.trim()));
    return { del: del && del.className, up: up && up.className, ver: ver && ver.className };
  });
  ok(/u-btn3/.test(kinds.del || '') && /u-btn1/.test(kinds.up || '') && /u-btn2/.test(kinds.ver || ''), `Delete is danger ink, Back up now the accent, Verify latest outlined (${kinds.del} / ${kinds.up} / ${kinds.ver})`);
  // The kind lands on a button a renderer adds LATER, not only on the first paint.
  const late = await page.evaluate(async () => {
    settingsOpen('backups');
    const b = document.createElement('button'); b.className = 'btn-sm btn-edit'; b.textContent = 'Save later'; document.getElementById('backups-body').appendChild(b);
    await new Promise((r) => setTimeout(r, 30));
    return b.className;
  });
  ok(late === 'u-btn1', `a button painted after the page opened is given its kind too (${late})`);

  console.log('§2 the back link names where it goes');
  const backs = await page.evaluate(async () => {
    const w = () => new Promise((r) => setTimeout(r, 250));
    const t = () => document.getElementById('settings-back').textContent.trim();
    const o = {};
    settingsOpen('payments'); await w(); o.payments = t();
    settingsOpen('reviews-import'); await w(); o.importBack = t();
    settingsOpenCancel('21a'); await w(); o.cancel21 = t();
    settingsOpen('pricing'); await w(); o.pricing = t(); o.pricingTitle = document.getElementById('settings-panel-title').textContent;
    prOpenCosts(); await w(); o.costs = t(); o.costsTitle = document.getElementById('settings-panel-title').textContent; o.costsCap = document.getElementById('settings-panel-cap').textContent;
    o.oneBack = document.querySelectorAll('#pricing-body .pr-up, #pricing-body .pr-ptitle').length === 0;
    settingsBack(); await w(); o.afterCosts = document.getElementById('settings-panel-title').textContent;
    return o;
  });
  ok(backs.payments === 'Manage', `a page off the menu goes back to "Manage" (${backs.payments})`);
  ok(backs.importBack === 'Reviews', `a sub-page names its parent (${backs.importBack})`);
  ok(backs.cancel21 === 'Cancellation policy', `a cottage's policy goes back to "Cancellation policy" (${backs.cancel21})`);
  ok(backs.pricingTitle === 'Price ideas' && backs.pricing === 'Manage', `the page is named as its menu row (${backs.pricingTitle})`);
  ok(backs.costs === 'Price ideas' && backs.costsTitle === 'Changeovers' && backs.oneBack && !backs.costsCap, `Changeovers has ONE header: "‹ Price ideas" over its own title, no ideas badge (${backs.costs} / ${backs.costsTitle})`);
  ok(backs.afterCosts === 'Price ideas', `…and its back link returns to Price ideas (${backs.afterCosts})`);

  console.log('§3 the menu');
  const menu = await page.evaluate(async () => {
    settingsShowIndex();
    const idx = document.getElementById('settings-index');
    const row = document.getElementById('mt-row');
    const fold = document.getElementById('mt-fold');
    const before = { hidden: fold.hidden, exp: row.getAttribute('aria-expanded') };
    row.click();
    await new Promise((r) => setTimeout(r, 50));
    const after = { hidden: fold.hidden, exp: row.getAttribute('aria-expanded'), inside: [...fold.querySelectorAll('.settings-row')].map((r) => r.dataset.arg || r.id).join(',') };
    row.click();
    return {
      status: !!idx.querySelector('[data-arg="diagnostics"]'),
      subs: [...idx.querySelectorAll(':scope > .settings-group .settings-row-sub')].filter((s) => !s.closest('.mg-cot') && s.id !== 'oa-index-sub').length,
      cotFig: idx.querySelectorAll('.mg-fig').length,
      before, after, closed: fold.hidden,
      names: ['seasongrid', 'pricing', 'guests'].map((a) => (idx.querySelector(`[data-arg="${a}"] .settings-row-label`) || {}).textContent),
    };
  });
  ok(!menu.status, 'no Status row: the pill beside the title is the way in');
  ok(menu.subs === 0 && menu.cotFig === 0, `a menu row says where it goes and nothing more (${menu.subs} sub-lines, ${menu.cotFig} booked figures)`);
  ok(menu.before.hidden && menu.before.exp === 'false' && !menu.after.hidden && menu.after.exp === 'true' && menu.closed, 'More tools opens and closes in place, saying so');
  ok(/backups/.test(menu.after.inside) && /apis/.test(menu.after.inside) && /search-learning/.test(menu.after.inside), `…holding Backups, Integrations and Search learning (${menu.after.inside})`);
  ok(menu.names.join('|') === 'Seasonal rates|Price ideas|Guest list', `three rows renamed for what the page is (${menu.names.join(' · ')})`);

  console.log('§4 adding is a row at the foot of its list');
  const adds = await page.evaluate(async () => {
    settingsOpen('replies');
    const rb = document.getElementById('replies-body');
    const lastIsAdd = rb.lastElementChild && rb.lastElementChild.matches('.u-addrow') && /Write a new reply/.test(rb.lastElementChild.textContent);
    settingsOpen('experiences');
    await new Promise((r) => setTimeout(r, 400));
    const list = document.getElementById('exp-admin-list');
    const expAdd = list && list.lastElementChild && list.lastElementChild.querySelector('.u-addrow[data-act="expAddNew"]');
    settingsOpenAccom('21a');
    __bhubOpenFolds.add('ac-21a-amenities');
    settingsOpenAccom('21a');
    const well = document.querySelector('#bhub-fold-ac-21a-amenities .acr-well');
    const kids = well ? [...well.children] : [];
    const ai = kids.findIndex((x) => x.matches('.u-addrow'));
    const si = kids.findIndex((x) => x.matches('.acw-acts'));
    const pillAdds = [...document.querySelectorAll('#view-settings button')].filter((b) => /^Add (a|an|another|something)\b/.test(b.textContent.trim()) && !b.matches('.u-addrow, .settings-row, .ga-row')).map((b) => b.textContent.trim());
    return { lastIsAdd, expAdd: !!expAdd, order: ai >= 0 && si > ai, pillAdds };
  });
  ok(adds.lastIsAdd, 'Saved replies: "Write a new reply" is the list card\'s last row');
  ok(adds.expAdd, 'Things to do: "Add something to do" closes the list');
  ok(adds.order, 'a cottage list: the add row sits under the list, above the Save actions');
  ok(adds.pillAdds.length === 0, `no "Add …" pill is left among a page's actions${adds.pillAdds.length ? ' — ' + adds.pillAdds.join(', ') : ''}`);

  console.log('§5 every field has a label');
  const fields = await page.evaluate(async () => {
    settingsOpen('experiences');
    await new Promise((r) => setTimeout(r, 400));
    expAddNew();
    const ed = document.querySelector('.exp-edit[data-id="0"]');
    const fs = [...ed.querySelectorAll('input:not([type=hidden]), select, textarea')];
    const unlabelled = fs.filter((f) => !ed.querySelector(`label[for="${f.id}"]`)).map((f) => f.id);
    const firstAct = ed.querySelector('.u-acts > button');
    return { n: fs.length, unlabelled, first: firstAct && firstAct.textContent.trim(), thumbW: Math.round(ed.querySelector('.exp-edit-thumb').getBoundingClientRect().width) };
  });
  ok(fields.n >= 8 && fields.unlabelled.length === 0, `the place editor's ${fields.n} fields each have their own label${fields.unlabelled.length ? ' — missing: ' + fields.unlabelled.join(', ') : ''}`);
  ok(fields.first === 'Save' && fields.thumbW === 64, `its actions lead with Save, and the photo keeps its square (${fields.first}, ${fields.thumbW}px)`);

  console.log('§6 windows: a bottom sheet in Manage, untouched outside it');
  const inManage = await page.evaluate(async () => {
    settingsOpen('payments');
    const p = glassConfirm('Delete this?', 'Delete', { danger: true });
    await new Promise((r) => setTimeout(r, 600));
    const box = document.querySelector('#glass-dialog .glass-dialog-box').getBoundingClientRect();
    const ok = document.getElementById('glass-dialog-ok');
    const out = { bottom: Math.round(innerHeight - box.bottom), width: Math.round(box.width), okRadius: parseFloat(getComputedStyle(ok).borderTopLeftRadius) };
    document.getElementById('glass-dialog-cancel').click();
    await p;
    await new Promise((r) => setTimeout(r, 450));
    return out;
  });
  ok(Math.abs(inManage.bottom) <= 1 && inManage.width >= 388 && inManage.okRadius > 100, `opened from Manage it sits on the bottom edge, full width, pill buttons (${inManage.bottom}px from the bottom, ${inManage.width}px)`);
  const outside = await page.evaluate(async () => {
    nav('view-backoffice');
    await new Promise((r) => setTimeout(r, 300));
    const p = glassConfirm('Delete this?', 'Delete', { danger: true });
    await new Promise((r) => setTimeout(r, 600));
    const box = document.querySelector('#glass-dialog .glass-dialog-box').getBoundingClientRect();
    const out = { bottom: Math.round(innerHeight - box.bottom) };
    document.getElementById('glass-dialog-cancel').click();
    await p;
    await new Promise((r) => setTimeout(r, 450));
    await openArea();
    return out;
  });
  ok(outside.bottom > 40, `the same window over Today keeps its own shape (${outside.bottom}px clear of the bottom)`);
  const qr = await page.evaluate(async () => {
    settingsOpen('reviews');
    await new Promise((r) => setTimeout(r, 300));
    reviewQrOpen('21a');
    await new Promise((r) => setTimeout(r, 500));
    const ov = document.getElementById('rv-qr-modal');
    const out = { btns: [...ov.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|'), noX: !ov.querySelector('.rvq-close'), copy: (ov.querySelector('#rvq-copy') || {}).getAttribute && ov.querySelector('#rvq-copy').getAttribute('data-act') };
    reviewQrClose();
    return out;
  });
  ok(qr.btns === 'Done|Copy link' && qr.noX && qr.copy === 'copyReviewLink', `the QR window ends in its answers, not a corner ✕ (${qr.btns})`);

  console.log('§7 one caption tier on Manage, nothing changed outside it');
  const caps = await page.evaluate(async () => {
    settingsOpen('follow-ups');
    const m = document.querySelector('#sec-follow-ups .acr-cap');
    const inside = { tt: getComputedStyle(m).textTransform, ls: getComputedStyle(m).letterSpacing };
    // The same class outside the back office's one look (a guest view) keeps the
    // look it had — the scope is the class on the admin views, never the page.
    const probe = document.createElement('div'); probe.className = 'acr-cap'; probe.textContent = 'Probe';
    document.getElementById('view-main').appendChild(probe);
    const outside = { tt: getComputedStyle(probe).textTransform };
    probe.remove();
    return { inside, outside };
  });
  ok(caps.inside.tt === 'none' && (caps.inside.ls === 'normal' || parseFloat(caps.inside.ls) === 0), `on Manage a caption is sentence case, untracked (${caps.inside.tt} / ${caps.inside.ls})`);
  ok(caps.outside.tt === 'uppercase', `outside the one look the same class keeps its own look (${caps.outside.tt})`);

  console.log('§8 Payments and Key safes wear the same parts');
  const pay = await page.evaluate(async () => {
    await openAccounts();
    await new Promise((r) => setTimeout(r, 600));
    const idx = document.getElementById('accounts-index');
    const tools = [...idx.querySelectorAll(':scope > .settings-group > .settings-row .settings-row-label')].map((r) => r.textContent.trim());
    const cap = [...document.querySelectorAll('#accounts-index .bhub-grpcap')].filter((c) => c.getClientRects().length).map((c) => getComputedStyle(c).textTransform);
    // Expenses: one card per tax year, a line per expense, and adding is the row at the foot.
    allExpenses.splice(0, allExpenses.length,
      { id: 1, date: '2026-10-02', category: 'Laundry', description: 'Linen hire for the changeover', amount: 42.5, prop_key: '21a', recurring: 0 },
      { id: 2, date: '2026-09-28', category: 'Cleaning', description: 'Changeover clean', amount: 85, prop_key: '', recurring: 1 });
    accountsOpen('expenses');
    renderExpenses();
    await new Promise((r) => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#expenses-body .xp-row')];
    const r0 = rows[0];
    const main = r0 && r0.querySelector('.xp-main').getBoundingClientRect();
    const amt = r0 && r0.querySelector('.feed-amt').getBoundingClientRect();
    const back = document.getElementById('accounts-back').textContent.trim();
    const add = document.querySelector('#expenses-body .xp-add .u-addrow');
    const kinds = [...document.querySelectorAll('#view-accounts button')].filter((b) => b.getClientRects().length && ['btn-sm', 'btn-edit', 'btn-glass', 'pay-btn', 'mo-tool'].some((c) => b.classList.contains(c))).length;
    await openKeysafe();
    await new Promise((r) => setTimeout(r, 400));
    const ks = document.querySelector('#view-keysafe .ks-list');
    return {
      tools, cap, back, rows: rows.length, oneLine: !!(main && amt && Math.abs((main.top + main.bottom) / 2 - (amt.top + amt.bottom) / 2) < 12),
      rowDisplay: r0 ? getComputedStyle(r0).display : '', add: !!add, kinds,
      ksRadius: ks ? getComputedStyle(ks).borderTopLeftRadius : '', ksShadow: ks ? getComputedStyle(ks).boxShadow : '',
    };
  });
  ok(pay.tools.join('|') === 'Payments & balances|Expenses', `the Payments tools are rows in a card, like the Manage index (${pay.tools.join(' · ')})`);
  ok(pay.cap.length >= 1 && pay.cap.every((t) => t === 'none'), `Payments' captions are the one tier, sentence case (${pay.cap.join(',')})`);
  ok(pay.back === 'Payments', `the drill-down back link names where it goes ("${pay.back}")`);
  ok(pay.rows === 2 && pay.rowDisplay === 'flex' && pay.oneLine, `an expense is one line: what it was, then its amount beside it (${pay.rows} rows, ${pay.rowDisplay})`);
  ok(pay.add, 'adding an expense is the row at the foot of the list');
  ok(pay.kinds === 0, `no Payments button keeps an old look class (${pay.kinds})`);
  ok(pay.ksRadius === '20px' && pay.ksShadow === 'none', `the key safes list is a card on the one radius, no shadow (${pay.ksRadius}, ${pay.ksShadow})`);

  console.log('§9 the Inbox wears the same parts');
  // The mailbox answers with an error, so the Email verdict's failed state is driven for real.
  await page.route(/mailbox\.php/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Connect failed' }) }));
  const ib = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await openInbox();
    await wait(400);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    // A conversation already READ but still waiting on a reply, beside one that was answered.
    __msgThreads = [
      { thread_id: 'a1', name: 'Priya Shah', email: 'p@example.com', last_body: 'Can we check in early?', last_at: now, last_role: 'guest', unread: 0, archived: 0, is_guest: 1 },
      { thread_id: 'b2', name: 'Mark Ellis', email: 'm@example.com', last_body: 'No dogs, sorry.', last_at: now, last_role: 'admin', unread: 0, archived: 0, is_guest: 0 },
    ];
    __msgShowArchived = false;
    document.getElementById('messages-list').dataset.loaded = '1';
    inboxFolder('messages');
    const opener = document.querySelector('#inbox-landing .bhub-fold-row[data-arg="messages"]');
    if (opener && (document.getElementById('iv-fold-messages') || {}).hidden) opener.click();
    renderMessagesList();
    inboxVerdicts();
    await wait(120);
    const list = document.getElementById('messages-list');
    const cards = list.querySelectorAll('.msg-threads');
    const rowsIn = cards[0] ? cards[0].querySelectorAll('.msg-thread-row').length : 0;
    const search = document.getElementById('msg-search').getBoundingClientRect();
    const ctl = list.querySelector('.msg-inbox-controls').getBoundingClientRect();
    const chips = [...list.querySelectorAll('.msg-chips button')].map((b) => b.textContent.trim());
    const head = document.getElementById('messages-head-actions').children.length;
    const verdict = document.getElementById('iv-sum-messages').textContent.trim();
    const chev = [...document.querySelectorAll('#inbox-landing .bhub-fold-row .bhub-chev')];
    const chevSvg = chev.filter((c) => c.querySelector('svg')).length;
    // The archive is a chip; an empty archive keeps a way back beside the heading.
    const arch = [...list.querySelectorAll('.msg-chips button')].find((b) => /^Archived$/.test(b.textContent.trim()));
    __msgShowArchived = true;
    __msgThreads = [];
    renderMessagesList();
    await wait(60);
    const back = document.getElementById('messages-head-actions').textContent.trim();
    __msgShowArchived = false;
    // Email: a mailbox that did not answer has not been checked.
    inboxFolder('email');
    await wait(900);
    const email = document.getElementById('iv-sum-email').textContent.trim();
    return {
      subline: !!document.getElementById('inbox-subline'), cards: cards.length, rowsIn,
      searchFull: Math.round(search.width) >= Math.round(ctl.width) - 1, chips, head, verdict,
      chev: chev.length, chevSvg, archPressed: arch ? arch.getAttribute('aria-pressed') : '', back, email,
    };
  });
  ok(!ib.subline, 'no sentence under the Inbox title');
  ok(ib.chev >= 3 && ib.chevSvg === ib.chev, `every folder row ends in the one chevron (${ib.chevSvg} of ${ib.chev} are the drawn chevron)`);
  ok(ib.cards === 1 && ib.rowsIn === 2, `the conversations are one list card (${ib.cards} card, ${ib.rowsIn} rows inside)`);
  ok(ib.searchFull, 'the search is the one field, on its own line');
  ok(ib.chips.join('|') === 'Needs reply · 1|Archived|Mark all read', `the filters are chips under it, the action last (${ib.chips.join(' · ')})`);
  ok(ib.head === 0, 'with conversations on screen the heading carries no second archive control');
  ok(ib.archPressed === 'false', `the archive chip says whether it is on (aria-pressed ${ib.archPressed})`);
  ok(/Active conversations/.test(ib.back), `an empty archive keeps the way back beside the heading ("${ib.back}")`);
  ok(/1 to answer/.test(ib.verdict), `a conversation read but not answered keeps the folder amber ("${ib.verdict}")`);
  ok(/couldn.t check/i.test(ib.email) && !/Nothing new/.test(ib.email), `a mailbox that did not answer is not "Nothing new" ("${ib.email}")`);
  const focus = await page.evaluate(async () => {
    openMessageThread('a1');
    await new Promise((r) => setTimeout(r, 500));
    const a = document.activeElement;
    const r = { id: a && a.id, box: !!(a && a.matches('#messages-modal .modal-box')) };
    try { closeMessagesModal(); } catch (e) {}
    return r;
  });
  ok(focus.box && focus.id !== 'msg-canned', `the thread sheet takes focus itself, not the quick-replies picker (${focus.id || (focus.box ? 'the sheet' : '?')})`);

  console.log('§10 the booking and enquiry pages wear the same parts');
  const hub = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const raw = { id: 91, prop_key: '21a', name: 'Priya Chandra', email: 'priya@example.com', phone: '07700 900000', address: '1 Lane', postcode: 'NR25 7AB',
      check_in: iso(40), check_out: iso(44), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0,
      agreed_total: 590, agreed_per_night: 135, agreed_nights: 4, agreed_nightly: 540, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0,
      agreed_on: iso(0), hold_status: 'none', deposit_pct_override: 30, reg_url: 'guest-details.php?t=x', reg_submitted: 0 };
    // Every screen change may reload the stores from the stub, so the fixture is laid down
    // again immediately before each open.
    const seed = () => { dbBookings['21a'] = [mapBookingFromApi(raw)]; };
    seed();
    const enq = { id: 92, prop_key: '21a', name: 'Grace Holloway', email: 'grace@example.com', phone: '',
      address: '2 Lane', postcode: 'NR25 7AB', check_in: iso(60), check_out: iso(63), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
      message: 'Is the cottage free?', created_at: iso(-1) + ' 09:00:00' };
    const back = () => ((document.querySelector('.page-view.active > .back-link') || {}).textContent || '').trim();
    // The back link names the screen it returns to.
    await openAccounts();
    await wait(300);
    seed();
    await openBookingHub(91);
    await wait(500);
    const fromPay = back();
    nav('view-backoffice');
    await wait(200);
    seed();
    await openBookingHub(91);
    await wait(500);
    const fromToday = back();
    const c = document.getElementById('booking-hub-content');
    const grp = [...c.querySelectorAll('.bhub-fold-grp')].find((g) => g.getClientRects().length);
    const cap = c.querySelector('.bhub-grpcap');
    const tag = c.querySelector('.bhub-plan-tag');
    const out = {
      fromPay, fromToday,
      radius: grp ? getComputedStyle(grp).borderTopLeftRadius : '',
      cap: cap ? cap.textContent.trim() + ' / ' + getComputedStyle(cap).textTransform : '',
      tag: tag ? tag.textContent.trim() + ' / ' + getComputedStyle(tag).textTransform : '',
    };
    enquiries.splice(0, enquiries.length, mapEnquiryFromApi(enq));
    await openEnquiryHub('e92');
    await wait(600);
    const okv = getComputedStyle(document.body).getPropertyValue('--ok').trim();
    const probe = document.createElement('span'); probe.style.color = okv; document.body.appendChild(probe);
    const okRgb = getComputedStyle(probe).color; probe.remove();
    const appr = document.querySelector('#enquiry-hub-content .bhub-next .btn-approve');
    const card = document.querySelector('#enquiry-hub-content .bhub-next');
    out.enqBack = back();
    out.approve = appr ? { bg: getComputedStyle(appr).backgroundColor, okRgb, h: Math.round(appr.getBoundingClientRect().height), full: appr.getBoundingClientRect().width >= card.getBoundingClientRect().width - 48 } : null;
    return out;
  });
  ok(hub.fromPay === 'Payments' && hub.fromToday === 'Today', `the booking page's back link names where it goes ("${hub.fromPay}", "${hub.fromToday}")`);
  ok(hub.enqBack === 'Inbox', `…and the enquiry page's ("${hub.enqBack}")`);
  ok(hub.radius === '20px', `its groups are cards on the one radius (${hub.radius})`);
  ok(/^Needs attention \/ none$/.test(hub.cap), `its caption is the one tier, sentence case (${hub.cap})`);
  ok(/^Custom \/ none$/.test(hub.tag), `a state tag is sentence case (${hub.tag})`);
  ok(hub.approve && hub.approve.bg === hub.approve.okRgb && hub.approve.h >= 48 && hub.approve.full,
    `on a phone Approve is the card's filled pill, in its own green (${JSON.stringify(hub.approve)})`);

  await page.close();
  await t.done(fails);
})().catch(async (e) => { console.error('FAILED:', e); process.exit(1); });
