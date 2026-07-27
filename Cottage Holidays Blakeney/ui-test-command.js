// ============================================================
//  ui-test-command.js — search ACTS, and remembers what it did.
//
//  Every quick-action used to begin closeCmdK(): search handed off to a modal and
//  vanished, so chasing three balances was three journeys. An action may now carry
//  an `inline` runner that does the work with the window still open and returns
//  { say, undo? }, which lands as a strip under its own row.
//
//  What this pins, and why each one is here rather than assumed:
//    * the window STAYS OPEN and the workspace underneath is untouched — the
//      entire point of the change;
//    * a success reports under the row, in a role=status live region, because
//      nothing navigates any more and there is no page change to notice;
//    * CANCELLING CLAIMS NOTHING. The inline runner returns null when the owner
//      backs out of the preview, and a strip saying "sent" after they pressed
//      Cancel would be a lie the UI told about money;
//    * a FAILURE says what went wrong and is not undoable;
//    * an action WITHOUT an inline runner is byte-for-byte unchanged — that
//      opt-in is the whole safety story of rolling this out one action at a time;
//    * undo is a STACK, so a second change does not erase the first.
//
//  The sender is stubbed on purpose. The email preview flow it wraps is covered
//  by ui-test-hub; this suite is about what cmdkAct does with an outcome.
// ============================================================
const { d, bootBrowser } = require('/home/user/CHB/Cottage Holidays Blakeney/ui-test-lib');
let fails = 0; const ok = (c,m) => { console.log(`  ${c?'✓':'✗'} ${m}`); if (!c) fails++; };
const stub = (page) => page.route(/\.php/, (r) => {
  const url = r.request().url();
  let b = {}; try { b = JSON.parse(r.request().postData()||'{}'); } catch(e){}
  const json = (o) => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(o) });
  if (url.includes('auth.php')) { if (b.action==='admin_status') return json({ok:true,admin:true});
    if (b.action==='guest_status') return json({ok:true,guest:null}); return json({ok:true}); }
  if (url.includes('rates.php')) return json({ properties:[{prop_key:'jollyboat',name:'Jollyboat',slug:'jollyboat',couple_rate:130,booking_fee:75,transaction_pct:3,max_adults:2,max_children:0,max_total:2,sort_order:1}], seasons:{}, occupancy:{} });
  if (url.includes('bookings.php')) return json({ bookings:[{id:1,prop_key:'jollyboat',name:'Richard Berry',email:'rb@x.co',check_in:d(6),check_out:d(10),adults:2,children:0,payment:'deposit',deposit_paid:200,agreed_total:640,agreed_nightly:620,agreed_txn_fee:20,agreed_nights:4}] });
  return json({ok:true,bookings:[],enquiries:[],threads:[],reviews:[],photos:[],experiences:[],content:{},blocks:[],ranges:[],results:[],corpus:[],logs:{},events:[],value:null});
});
(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport:{width:900,height:900} });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(()=>{}); });
  await stub(page);
  await page.goto(base + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(async () => { isAuthenticated=true; document.body.classList.add('owner-mode'); await loadAdminBundle(); await initBackOffice(); });
  await page.waitForTimeout(1500);

  const run = (outcome) => page.evaluate(async (mode) => {
    __chbUndo.length = 0;
    try { closeCmdK(); } catch(e){}
    openCmdK(); await new Promise(r=>setTimeout(r,1200));
    const i = document.getElementById('cmdk-input'); i.value='richard'; cmdkSearchCore('richard', false);
    await new Promise(r=>setTimeout(r,500));
    const idx = __cmdkResults.findIndex(x => Array.isArray(x.actions) && x.actions.length);
    __cmdkSel = idx; cmdkRender(); await new Promise(r=>setTimeout(r,200));
    // Swap in a sender with a known outcome. The real one is requestPayment,
    // exercised by the preview flow; here we only care what cmdkAct does with it.
    const k = __cmdkResults[idx].actions.length;
    __cmdkResults[idx].actions.push({
      key: 'probe', label: 'Probe', pending: 'Working…',
      run: () => {},
      inline: async () => {
        if (mode === 'throw') throw new Error('No email address on this booking');
        if (mode === 'cancel') return null;
        return { say: 'Balance request sent to Richard', undo: async () => {}, reload: false };
      },
    });
    await cmdkAct(idx, k);
    await new Promise(r=>setTimeout(r,250));
    const s = document.querySelector('#cmdk .cmdk-actmsg');
    return { open: document.getElementById('cmdk').classList.contains('open'),
             txt: s ? s.textContent.trim() : '(none)',
             cls: s ? s.className : '', role: s ? s.getAttribute('role') : null,
             undo: __chbUndo.length, view: (document.querySelector('.page-view.active')||{}).id };
  }, outcome);

  const okRes = await run('ok');
  ok(okRes.open, 'SEARCH STAYS OPEN through the action — the whole point');
  ok(/sent to Richard/.test(okRes.txt), `the outcome reports under the row (${okRes.txt})`);
  ok(/is-ok/.test(okRes.cls), 'as a success strip');
  ok(okRes.role === 'status', 'announced — nothing navigated, so there is no page change to notice');
  ok(okRes.undo === 1, `and it joins the undo stack (${okRes.undo})`);
  ok(okRes.view !== 'view-search', `the workspace underneath is untouched (${okRes.view})`);

  const cancelled = await run('cancel');
  ok(cancelled.txt === '(none)', 'backing out claims NOTHING — no strip');
  ok(cancelled.undo === 0, 'and nothing joins the undo stack');

  const failed = await run('throw');
  ok(/No email address/.test(failed.txt), `a failure says what went wrong (${failed.txt})`);
  ok(/is-err/.test(failed.cls), 'as an error strip, not a success one');
  ok(failed.undo === 0, 'and a failed action is not undoable');

  const legacy = await page.evaluate(() => {
    const i = __cmdkResults.findIndex(x => Array.isArray(x.actions) && x.actions.some(a=>a.key==='email'));
    const a = __cmdkResults[i].actions.find(a=>a.key==='email');
    return { hasInline: typeof a.inline === 'function', hasRun: typeof a.run === 'function' };
  });
  ok(!legacy.hasInline && legacy.hasRun, 'an action WITHOUT an inline runner is untouched — still a plain run()');

  const stack = await page.evaluate(() => {
    __chbUndo.length = 0;
    chbUndoPush('First change', async () => {});
    chbUndoPush('Second change', async () => {});
    const rows = cmdkIntent('undo') || [];
    return { n: __chbUndo.length, head: rows[0] && rows[0].label, second: rows[1] && rows[1].label };
  });
  ok(stack.n === 2, `the stack remembers two changes, not one (${stack.n})`);
  ok(/Second change/.test(stack.head||''), `undo offers the newest first (${stack.head})`);
  ok(/First change/.test(stack.second||''), `and lists the one behind it (${stack.second})`);

  console.log(fails ? `\n  ${fails} FAILED` : '\n  INLINE + UNDO OK');
  await done(fails);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
