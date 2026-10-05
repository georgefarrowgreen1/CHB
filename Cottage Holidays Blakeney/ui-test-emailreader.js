// READING AN EMAIL: THEIR NEW WORDS FIRST — driven in a real browser against a mocked mailbox.php.
//   §1 the reader shows only what they wrote; the quote / signature / whole email are one tap away
//   §2 "Replying to" names what our last email asked
//   §3 earlier emails are SORTED: facts surface (with the key words marked and the reason tagged),
//      routine ones fold into one line, and the owner can overrule either call
//   §4 an all-new email is shown whole, with nothing folded
//   §5 Reply quotes only their new words and puts the cursor above them
const { d, boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const OUTLOOK = "Hi George,\n\nThat sounds perfect — could we arrive a bit earlier on the Friday, around 1pm? We're driving up with the campervan.\n\nMarcus\n\nFrom: Cottage Holidays <info@chb.co.uk>\nSent: 17 August 2026 15:20\nTo: Marcus Hale\nSubject: Re: Your enquiry\n\nHello Marcus, check-in is from 3pm.\n\nGet Outlook for iOS";
const BODIES = {
  u3: OUTLOOK,
  u2: 'Lovely, thanks George.',
  u1: 'Hi, is Jollyboat free 4–8 Sep? 2 adults and a spaniel. Thanks, Marcus',
  u4: 'Hello,\n\nAre dogs welcome at Pimpernel? We have a small spaniel.\n\nThanks, Priya',
};

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
  const messages = [
    { uid: 'u3', from: 'marcus@example.com', fromRaw: 'Marcus Hale <marcus@example.com>', subject: 'Re: Your enquiry — Jollyboat', date: '2026-08-17 16:02:00', seen: false },
    { uid: 'u2', from: 'marcus@example.com', fromRaw: 'Marcus Hale <marcus@example.com>', subject: 'Re: Your enquiry — Jollyboat', date: '2026-08-13 10:00:00', seen: true },
    { uid: 'u1', from: 'marcus@example.com', fromRaw: 'Marcus Hale <marcus@example.com>', subject: 'Your enquiry — Jollyboat', date: '2026-08-12 09:00:00', seen: true },
    { uid: 'u4', from: 'priya@example.com', fromRaw: 'Priya Shah <priya@example.com>', subject: 'Dog-friendly?', date: '2026-08-16 09:14:00', seen: false },
  ];
  const sentRows = [{ id: 7, to_email: 'marcus@example.com', cc_email: null, subject: 'Re: Your enquiry', body: 'Hello Marcus, Jollyboat is free 4–8 Sep, £440 all in. Check-in is from 3pm — is that all right for you?', sent_at: '2026-08-12 12:00:00' }];
  const reads = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      if (url.includes('mailbox.php')) {
        if (b.action === 'list') return json({ ok: true, messages, total: messages.length, hasMore: false });
        if (b.action === 'sent') return json({ ok: true, messages: sentRows });
        if (b.action === 'read') {
          reads.push(b.uid);
          const m = messages.find((x) => x.uid === b.uid);
          return json({ ok: true, uid: b.uid, from: m.from, fromRaw: m.fromRaw, to: 'stay@chb.co.uk', date: m.date, subject: m.subject, body: BODIES[b.uid], attachments: [] });
        }
        return json({ ok: true });
      }
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: [] });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); try { localStorage.removeItem('chb-mbx-imp'); } catch (e) {} });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await window.openInbox(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.inboxFolder('email'));
  await page.waitForTimeout(900);
  await page.evaluate(async () => { try { __mbxSent = (await apiPost('mailbox.php', { action: 'sent' })).messages; } catch (e) {} });
  await page.evaluate(() => mailboxOpen('u3'));
  await page.waitForTimeout(1500);

  console.log('§1 their new words, and the rest one tap away');
  const r1 = await page.evaluate(() => ({
    body: (document.querySelector('.mbx-text') || {}).textContent || '',
    chips: [...document.querySelectorAll('.mbx-fchip')].map((c) => c.textContent.trim()),
    quotedHidden: (document.getElementById('mbx-fold-q') || {}).classList ? !document.getElementById('mbx-fold-q').classList.contains('open') : null,
  }));
  ok(/around 1pm/.test(r1.body) && !/From: Cottage Holidays/.test(r1.body) && !/check-in is from 3pm/.test(r1.body), 'the reader shows only what they wrote');
  ok(r1.chips.join('|') === 'Quoted message|Whole email', `the folds are named plainly (${r1.chips.join(' | ')})`);
  ok(r1.quotedHidden === true, 'and they start shut');
  await page.click('.mbx-fchip[data-fold="q"]');
  await page.waitForFunction(() => { const f = document.getElementById('mbx-fold-q'); return f.classList.contains('open') && f.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished').length === 0 && f.getBoundingClientRect().height > 20; }, { timeout: 8000 }).catch(() => {});
  const q = await page.evaluate(() => ({ open: document.getElementById('mbx-fold-q').classList.contains('open'), exp: document.querySelector('.mbx-fchip[data-fold="q"]').getAttribute('aria-expanded'), h: Math.round(document.getElementById('mbx-fold-q').getBoundingClientRect().height), txt: document.getElementById('mbx-fold-q').textContent }));
  ok(q.open && q.exp === 'true' && q.h > 20 && /check-in is from 3pm/.test(q.txt), `the quoted message opens (height ${q.h}px) and says what was quoted`);
  await page.click('.mbx-fchip[data-fold="o"]');
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => /From: Cottage Holidays/.test(document.getElementById('mbx-fold-o').textContent) && /Get Outlook/.test(document.getElementById('mbx-fold-o').textContent)), 'the whole email is there exactly as it arrived — nothing is lost');
  await page.click('.mbx-fchip[data-fold="q"]');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.getElementById('mbx-fold-q').classList.contains('open')), 'a second tap shuts it again');

  console.log('§2 what they are answering');
  const r2 = await page.evaluate(() => (document.querySelector('.mbx-replying') || {}).textContent || '');
  ok(/Replying to:/.test(r2) && /is that all right for you\?/.test(r2), `“Replying to” quotes our last question (${r2.slice(0, 80)})`);

  console.log('§3 earlier emails, sorted by whether they matter');
  const r3 = await page.evaluate(() => ({
    sections: document.querySelectorAll('#mbx-earlier-host .mbx-ctx-d').length,
    label: (document.querySelector('.mbx-earlier .mbx-ctx-lbl') || {}).textContent || '',
    rows: document.querySelectorAll('.mbx-earlier .mbx-erow').length,
    imp: document.querySelectorAll('.mbx-earlier .mbx-erow.is-imp').length,
    marks: [...document.querySelectorAll('.mbx-earlier .mbx-mark')].map((m) => m.textContent),
    firstImp: !!document.querySelector('.mbx-earlier .mbx-chain > .mbx-erow:first-child.is-imp'),
    last: ((document.querySelector('.mbx-earlier .mbx-chain > .mbx-erow:last-child') || {}).textContent || ''),
    override: !!document.querySelector('[data-act="mbxMarkImp"]'),
  }));
  ok(r3.sections === 1 && /Earlier in this conversation/.test(r3.label), `ONE earlier section, not three (${r3.sections}: ${r3.label.replace(/\s+/g, ' ')})`);
  ok(/3 emails · 2 worth a look/.test(r3.label.replace(/\s+/g, ' ')), 'its summary says how many are worth a look');
  ok(r3.rows === 3 && r3.imp === 2 && r3.firstImp, `three rows, the two with facts first (${r3.rows} / ${r3.imp})`);
  ok(r3.marks.some((m) => /£440/.test(m)) && r3.marks.some((m) => /Sep/.test(m)), `the key facts are marked (${r3.marks.join(', ')})`);
  ok(/Lovely, thanks George/.test(r3.last), 'the routine "Lovely, thanks" is a one-line row at the end');
  ok(!r3.override, 'no extra Important / Not important buttons');

  console.log('§5 Reply quotes only their new words, cursor on top');
  await page.click('.mbx-reply');
  await page.waitForTimeout(500);
  const r5 = await page.evaluate(() => { const t = document.getElementById('mbx-text'); return { v: t.value, sel: t.selectionStart, active: document.activeElement === t }; });
  ok(/^\n*On /.test(r5.v) && /> That sounds perfect/.test(r5.v) && !/From: Cottage Holidays/.test(r5.v) && !/> .*check-in is from 3pm/.test(r5.v), 'the quote is their new words only — not our old email under them');
  ok(r5.sel === 0 && r5.active, 'the cursor sits above the quote, where the answer belongs');

  console.log('§4 an all-new email is shown whole');
  await page.evaluate(() => mailboxCollapse());
  await page.evaluate(() => mailboxOpen('u4'));
  await page.waitForTimeout(1200);
  const r4 = await page.evaluate(() => ({ body: (document.querySelector('.mbx-text') || {}).textContent || '', chips: document.querySelectorAll('.mbx-fchips').length, worth: !!document.querySelector('.mbx-worth') }));
  ok(/Are dogs welcome/.test(r4.body) && /Priya/.test(r4.body) && r4.chips === 0, 'nothing is folded when there is nothing to fold');
  ok(!r4.worth, 'and a message with no earlier history shows no earlier section');

  console.log(fails ? `EMAIL READER TEST FAILED ❌ (${fails})` : 'EMAIL READER TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
