// Emits the sibling .dc.html artboards from ONE shared style block, so the
// design system cannot drift between frames. Values lifted from the app's own
// app.css :root + body.light-mode and admin.css component rules.
import { writeFileSync, readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./Main.dc.html', import.meta.url), 'utf8')
  .split('<style>')[1].split('</style>')[0];

const page = (body, extra = '') => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Montserrat:wght@400;500;600;700&display=swap">
  <style>${CSS}${extra}</style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

const RAIL = (on) => `  <div class="rail">
    <div class="brandrow">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 17l2.4-8.4 4 3.6L12 4l2.6 8.2 4-3.6L21 17z" fill="#c6885e" opacity="0.9"/><path d="M3 17h18" stroke="#c6885e" stroke-width="1.6" stroke-linecap="round"/></svg>
      <div>
        <div class="bname">Cottage Holidays</div>
        <div class="bsub">Blakeney</div>
      </div>
    </div>
    <div class="navs">
${[
  ['Today', '<rect x="3" y="4.6" width="18" height="16" rx="3"/><path d="M3 9.4h18M8 2.6v4M16 2.6v4"/>', '<span class="cnt hot">3</span>'],
  ['Inbox', '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 6.6l8 6 8-6"/>', '<span class="cnt">4</span>'],
  ['Money', '<circle cx="12" cy="12" r="9"/><path d="M14.4 8.6a3.2 3.2 0 0 0-4.6.5c-1 1.4-.4 3 .6 3.9M9 12.4h4.6M9.6 15.6h4.6"/>', '<span class="cnt">£1,190</span>'],
  ['Cottages', '<path d="M4 8.4V6.2a2 2 0 0 1 2-2h3.2l1.6 2.2H18a2 2 0 0 1 2 2v9.4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8.6 12.6h6.8"/>', ''],
  ['Key safes', '<circle cx="9" cy="12" r="4.2"/><path d="M13.2 12H21M18 12v3.2M15.4 12v2.4"/>', '<span class="cnt hot">1</span>'],
  ['Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 3.4v2.2M12 18.4v2.2M20.6 12h-2.2M5.6 12H3.4M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6M18.1 18.1l-1.6-1.6M7.5 7.5L5.9 5.9"/>', ''],
  ['Assistant', '<path d="M12 3.6l1.9 4.5 4.5 1.9-4.5 1.9L12 16.4l-1.9-4.5L5.6 10l4.5-1.9z"/><path d="M18.4 15.6l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>', ''],
].map(([label, path, cnt]) => `      <div class="nav${label === on ? ' on' : ''}">
        <svg class="ic" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
        <span>${label}</span>
        ${cnt}
      </div>`).join('\n')}
    </div>
    <div class="navsp"></div>
    <button class="askbtn" type="button">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
      <span>Ask anything…</span>
      <span class="kbd">⌘K</span>
    </button>
  </div>`;

const SPINE = `    <div class="spine">
      <div class="daysent">Morning George — Wren arrives today, Cara leaves.</div>
      <div class="dayops">1 arrival · 1 departure · 2 staying · £340.00 to collect</div>
      <div class="duties">
        <span class="duty bad"><span class="dot" style="background:var(--danger)"></span>Laura arrives tomorrow with no directions</span>
        <span class="duty warn"><span class="dot" style="background:var(--warn)"></span>Pimpernel key safe still on Dan&rsquo;s code</span>
        <span class="duty warn"><span class="dot" style="background:var(--warn)"></span>Sarah&rsquo;s balance — £520.00, due in 6 days</span>
      </div>
    </div>`;

const shell = (on, body) => `<div class="shell">
${RAIL(on)}
  <div class="main">
${SPINE}
    <div class="body">
${body}
    </div>
  </div>
</div>`;

/* ---------- extra CSS for the split layouts and the phone ---------- */
const SPLIT = `
    .split{display:flex;gap:22px;height:100%;}
    .listcol{flex:1 1 auto;min-width:0;}
    .pane{flex:0 0 380px;background:var(--glass);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:0 6px 18px rgba(30,54,72,0.05);overflow:hidden;align-self:flex-start;}
    .panehd{padding:16px 18px 14px;border-bottom:1px solid var(--hair);}
    .paneid{font-family:var(--serif);font-size:1.15rem;font-weight:600;}
    .panewhen{font-size:0.78rem;color:var(--muted);margin-top:4px;}
    .paneact{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--hair);}
    .btn{font-family:var(--sans);font-size:0.8rem;font-weight:600;padding:9px 16px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,0.6);color:var(--ink);}
    .btn.pri{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);}
    .kv{display:flex;justify-content:space-between;gap:12px;padding:9px 18px;font-size:0.82rem;}
    .kv + .kv{border-top:1px solid var(--hair);}
    .kvk{color:var(--muted);}
    .kvv{font-weight:600;text-align:right;}
    .row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;border-radius:var(--r-md);}
    .row.sel{background:rgba(255,255,255,0.92);box-shadow:0 2px 8px rgba(30,54,72,0.08);}
    .rowlbl{font-size:0.88rem;font-weight:600;min-width:0;}
    .rowsub{display:block;font-size:0.75rem;font-weight:400;color:var(--muted);margin-top:2px;}
    .seg{display:inline-flex;gap:2px;padding:3px;background:rgba(28,46,58,0.05);border-radius:999px;margin-bottom:14px;}
    .segb{font-size:0.78rem;font-weight:600;padding:6px 15px;border-radius:999px;color:var(--muted);}
    .segb.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(30,54,72,0.1);}
`;

/* =====================  INBOX  ===================== */
writeFileSync(new URL('./Inbox.dc.html', import.meta.url), page(shell('Inbox', `      <div class="split">
        <div class="listcol">
          <div class="seg"><span class="segb on">Enquiries&nbsp;·&nbsp;4</span><span class="segb">Messages&nbsp;·&nbsp;1</span><span class="segb">Email</span></div>
          <div class="cap attn">Waiting longest</div>
          <div class="grp">
            <div class="row sel"><span class="rowlbl">Priya Shah<span class="rowsub">Jollyboat · 10–13 Sep · 2 adults · 3 days ago</span></span><span class="stc bad">3 days</span></div>
          </div>
          <div class="cap">Waiting on you</div>
          <div class="grp">
            <div class="row"><span class="rowlbl">Marcus Bell<span class="rowsub">Pimpernel · 4–8 Oct · 4 guests · yesterday</span></span><span class="stc warn">Dates free</span></div>
            <div class="row"><span class="rowlbl">Ana Ferreira<span class="rowsub">21A Westgate · 12–15 Sep · 2 adults · today</span></span><span class="stc warn">Dates free</span></div>
            <div class="row"><span class="rowlbl">Joel Adeyemi<span class="rowsub">Jollyboat · 5–9 Sep · 2 adults · today</span></span><span class="stc bad">Just taken</span></div>
          </div>
        </div>

        <div class="pane">
          <div class="panehd">
            <div class="paneid">Priya Shah</div>
            <div class="panewhen">Jollyboat · Thu 10 → Sun 13 Sep · 3 nights · 2 adults</div>
          </div>
          <div style="padding:14px 18px 4px;">
            <div class="cap" style="margin-top:0;">Can you say yes?</div>
            <div style="background:color-mix(in srgb,var(--ok) 10%,transparent);border:1px solid color-mix(in srgb,var(--ok) 22%,transparent);border-radius:var(--r-md);padding:13px 15px;">
              <div style="font-weight:600;font-size:0.9rem;color:var(--ok-text);">Those dates are free</div>
              <div style="font-size:0.79rem;color:var(--muted);margin-top:4px;line-height:1.5;">Approving requests the deposit by card — <strong style="color:var(--ink);">£147.50</strong> of £468.00.</div>
            </div>
          </div>
          <div style="padding:12px 18px 6px;">
            <div class="cap">What she asked</div>
            <div style="font-size:0.84rem;line-height:1.6;color:var(--ink);">&ldquo;Hi — is there parking, and can we arrive late on the Thursday? We&rsquo;d be driving up from Bristol.&rdquo;</div>
          </div>
          <div class="kv"><span class="kvk">Quote</span><span class="kvv">£468.00 all in</span></div>
          <div class="kv"><span class="kvk">First payment</span><span class="kvv">£147.50</span></div>
          <div class="paneact">
            <button class="btn pri" type="button">Approve</button>
            <button class="btn" type="button">✨ Draft reply</button>
          </div>
        </div>
      </div>`), SPLIT));

/* =====================  RECORD (same pane, a booking)  ===================== */
writeFileSync(new URL('./Record.dc.html', import.meta.url), page(shell('Today', `      <div class="split">
        <div class="listcol">
          <div class="seg"><span class="segb on">All</span><span class="segb">Needs paying</span><span class="segb">Arriving</span><span class="segb">Past</span></div>
          <div class="cap">Upcoming</div>
          <div class="grp">
            <div class="row"><span class="rowlbl">Wren Hollis<span class="rowsub">Pimpernel · today → 25 Aug</span></span><span class="stc ok">Paid ✓</span></div>
            <div class="row sel"><span class="rowlbl">Sarah Pemberton<span class="rowsub">Jollyboat · 28 Aug → 31 Aug</span></span><span class="stc warn">£520.00 due</span></div>
            <div class="row"><span class="rowlbl">Laura Mtungwazi<span class="rowsub">Pimpernel · tomorrow → 26 Aug</span></span><span class="stc bad">No directions</span></div>
            <div class="row"><span class="rowlbl">Tom Ackroyd<span class="rowsub">21A Westgate · 2 Sep → 6 Sep</span></span><span class="stc ok">Paid ✓</span></div>
          </div>
        </div>

        <div class="pane">
          <div class="panehd">
            <div class="paneid">Sarah Pemberton</div>
            <div class="panewhen">Jollyboat · Fri 28 → Mon 31 Aug · 3 nights · 2 adults<br>in 15:00 / out 10:00</div>
          </div>
          <div style="padding:14px 18px 2px;">
            <div class="cap" style="margin-top:0;">Next</div>
            <div style="background:color-mix(in srgb,var(--warn) 11%,transparent);border:1px solid color-mix(in srgb,var(--warn) 22%,transparent);border-radius:var(--r-md);padding:13px 15px;">
              <div style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--warn-text);">Step 4 of 6 · Balance</div>
              <div style="font-size:0.88rem;font-weight:600;margin-top:5px;">Ask for the balance — £520.00</div>
              <div style="font-size:0.78rem;color:var(--muted);margin-top:4px;">Due by 21/09/2026 · £147.50 already in</div>
            </div>
          </div>
          <div style="padding:14px 18px 0;">
            <div class="cap">Money</div>
          </div>
          <div class="kv"><span class="kvk">Received so far</span><span class="kvv money">£147.50</span></div>
          <div class="kv"><span class="kvk">Still to pay</span><span class="kvv money">£520.00</span></div>
          <div class="kv"><span class="kvk">Refundable deposit</span><span class="kvv">£50.00 held</span></div>
          <div class="kv"><span class="kvk">Guest details</span><span class="kvv"><span class="stc ok">All recorded ✓</span></span></div>
          <div class="paneact">
            <button class="btn pri" type="button">Request payment</button>
            <button class="btn" type="button">Email</button>
            <button class="btn" type="button">⋯</button>
          </div>
        </div>
      </div>`), SPLIT));

/* =====================  MONEY  ===================== */
writeFileSync(new URL('./Money.dc.html', import.meta.url), page(shell('Money', `      <div class="col" style="max-width:820px;">
        <div style="font-size:0.9rem;color:var(--muted);margin:0 4px 14px;">Two guests owe you £1,190.00 · £294.75 is yours to move out · one deposit to give back.</div>

        <div class="cap attn">Needs attention</div>
        <div class="grp">
          <div class="frow">
            <span class="flbl">Dan Rowe is overdue
              <span class="fsub">Pimpernel · stay finished 12 Aug · chased twice</span>
            </span>
            <span class="fright"><span class="money" style="color:var(--danger-text);">£670.00</span><span class="chev">›</span></span>
          </div>
        </div>

        <div class="cap">The five answers</div>
        <div class="grp">
          <div class="frow">
            <span class="flbl">To collect
              <span class="fsub">2 guests · Sarah £520.00 due in 6 days, Dan overdue</span>
            </span>
            <span class="fright"><span class="money">£1,190.00</span><span class="chev">›</span></span>
          </div>
          <div class="frow">
            <span class="flbl">To move out
              <span class="fsub">Landed in your Square balance, minus what is ring-fenced</span>
            </span>
            <span class="fright"><span class="money">£294.75</span><span class="chev">›</span></span>
          </div>
          <div class="frow">
            <span class="flbl">To give back
              <span class="fsub">Cara&rsquo;s deposit — she leaves today</span>
            </span>
            <span class="fright"><span class="stc warn">1 ready</span><span class="money">£75.00</span><span class="chev">›</span></span>
          </div>
          <div class="frow">
            <span class="flbl">The books
              <span class="fsub">Tax year to date · direct bookings, card fees deducted</span>
            </span>
            <span class="fright"><span class="money">£18,420.00</span><span class="chev">›</span></span>
          </div>
          <div class="frow">
            <span class="flbl">Recent
              <span class="fsub">Last payment 2 hours ago — Wren Hollis, £468.00</span>
            </span>
            <span class="fright"><span class="stc ok">✓ All settled</span><span class="chev">›</span></span>
          </div>
        </div>

        <div class="cap">More</div>
        <div class="grp">
          <div class="frow"><span class="flbl">Trends &amp; history<span class="fsub">Month by month, cottage by cottage</span></span><span class="chev">›</span></div>
          <div class="frow"><span class="flbl">Expenses<span class="fsub">14 logged this tax year</span></span><span class="chev">›</span></div>
          <div class="frow"><span class="flbl">Pricing coach<span class="fsub">2 gaps worth an offer</span></span><span class="fright"><span class="stc warn">2 ideas</span><span class="chev">›</span></span></div>
        </div>
      </div>`)));

/* =====================  COTTAGES  ===================== */
writeFileSync(new URL('./Cottages.dc.html', import.meta.url), page(shell('Cottages', `      <div class="split">
        <div class="listcol" style="max-width:280px;">
          <div class="cap" style="margin-top:0;">Your cottages</div>
          <div class="grp">
            <div class="row"><span class="rowlbl"><span class="dot" style="background:var(--p-jolly);display:inline-block;margin-right:7px;"></span>Jollyboat<span class="rowsub" style="margin-left:14px;">£150/night · 8 photos</span></span></div>
            <div class="row sel"><span class="rowlbl"><span class="dot" style="background:var(--p-pimp);display:inline-block;margin-right:7px;"></span>Pimpernel<span class="rowsub" style="margin-left:14px;">£175/night · 11 photos</span></span></div>
            <div class="row"><span class="rowlbl"><span class="dot" style="background:var(--p-21a);display:inline-block;margin-right:7px;"></span>21A Westgate<span class="rowsub" style="margin-left:14px;">£120/night · 9 photos</span></span></div>
          </div>
          <div class="grp"><div class="row"><span class="rowlbl" style="color:var(--accent-text);">＋ Add a cottage</span></div></div>
        </div>

        <div style="flex:1 1 auto;min-width:0;">
          <div class="cap" style="margin-top:0;">Pimpernel</div>
          <div class="grp">
            <div class="frow"><span class="flbl">Rates &amp; fees<span class="fsub">Nightly prices, deposit &amp; fee</span></span><span class="fright"><span class="money">£175</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Photos<span class="fsub">Gallery images for this cottage</span></span><span class="fright"><span class="stc ok">11 photos</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Text &amp; details<span class="fsub">Title, description &amp; the words on the page</span></span><span class="chev">›</span></div>
            <div class="frow"><span class="flbl">Amenities<span class="fsub">What the cottage has — guests see this</span></span><span class="fright"><span class="stc ok">✓ 8 amenities</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">House rules<span class="fsub">What guests agree to — pets, smoking, quiet hours</span></span><span class="fright"><span class="stc ok">✓ 4 rules</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Times &amp; limits<span class="fsub">Check-in/out, minimum nights, arrival days</span></span><span class="fright"><span class="stc unk">in 16:00 / out 10:00</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Arrival info<span class="fsub">Email sent a few days before they arrive</span></span><span class="fright"><span class="stc ok">Written</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Key safe<span class="fsub">Priya arrives 10 Sep · code is still Dan&rsquo;s</span></span><span class="fright"><span class="stc warn">Rotate now</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Location<span class="fsub">Address &amp; where guests find the key</span></span><span class="fright"><span class="stc ok">Pin set</span><span class="chev">›</span></span></div>
            <div class="frow"><span class="flbl">Private notes<span class="fsub">Stopcock, boiler, cleaner — offline on your phone</span></span><span class="chev">›</span></div>
          </div>
        </div>
      </div>`), SPLIT));

/* =====================  PHONE  ===================== */
const PHONE = `
    .pshell{width:390px;height:844px;overflow:hidden;display:flex;flex-direction:column;background:var(--ground);}
    .phead{padding:14px 18px 12px;background:rgba(255,255,255,0.5);border-bottom:1px solid var(--line);}
    .pdaysent{font-family:var(--serif);font-size:1.06rem;font-weight:600;line-height:1.3;}
    .pops{font-size:0.75rem;color:var(--muted);margin-top:4px;}
    .pbody{flex:1 1 auto;overflow:hidden;padding:16px 16px 0;}
    .pdock{display:flex;justify-content:space-around;align-items:center;padding:11px 8px 26px;border-top:1px solid var(--line);background:rgba(255,255,255,0.62);}
    .pd{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:0.6rem;color:var(--muted);position:relative;}
    .pd.on{color:var(--accent-text);font-weight:600;}
    .pip{position:absolute;top:-2px;right:2px;width:7px;height:7px;border-radius:50%;background:var(--danger);}
`;
writeFileSync(new URL('./Phone.dc.html', import.meta.url), page(`<div class="pshell">
  <div class="phead">
    <div class="pdaysent">Morning George — Wren arrives today, Cara leaves.</div>
    <div class="pops">1 arrival · 1 departure · £340.00 to collect</div>
    <div class="duties" style="margin-top:11px;">
      <span class="duty bad" style="font-size:0.73rem;"><span class="dot" style="background:var(--danger)"></span>Laura arrives tomorrow — no directions</span>
      <span class="duty warn" style="font-size:0.73rem;"><span class="dot" style="background:var(--warn)"></span>Pimpernel key safe</span>
    </div>
  </div>
  <div class="pbody">
    <div class="cap" style="margin-top:0;">Today at the cottages</div>
    <div class="grp">
      <div class="frow" style="padding:12px 15px;"><span class="flbl" style="font-size:0.9rem;">Wren Hollis arrives<span class="fsub">Pimpernel · from 4pm</span></span><span class="stc ok">✓ Ready</span></div>
      <div class="frow" style="padding:12px 15px;"><span class="flbl" style="font-size:0.9rem;">Cara Nunn leaves<span class="fsub">Jollyboat · by 10am</span></span><span class="stc warn">£75 back</span></div>
      <div class="frow" style="padding:12px 15px;"><span class="flbl" style="font-size:0.9rem;">Two staying on<span class="fsub">21A until Mon · Jollyboat until Wed</span></span><span class="chev">›</span></div>
    </div>
    <div class="cap">Money</div>
    <div class="grp">
      <div class="frow" style="padding:12px 15px;"><span class="flbl" style="font-size:0.9rem;">To collect<span class="fsub">2 guests · one overdue</span></span><span class="fright"><span class="money">£1,190.00</span><span class="chev">›</span></span></div>
      <div class="frow" style="padding:12px 15px;"><span class="flbl" style="font-size:0.9rem;">To give back<span class="fsub">Cara&rsquo;s deposit, ready today</span></span><span class="fright"><span class="money">£75.00</span><span class="chev">›</span></span></div>
    </div>
  </div>
  <div class="pdock">
    <span class="pd on"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="4.6" width="18" height="16" rx="3"/><path d="M3 9.4h18M8 2.6v4M16 2.6v4"/></svg><span class="pip"></span>Today</span>
    <span class="pd"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 6.6l8 6 8-6"/></svg>Inbox</span>
    <span class="pd"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M14.4 8.6a3.2 3.2 0 0 0-4.6.5c-1 1.4-.4 3 .6 3.9M9 12.4h4.6M9.6 15.6h4.6"/></svg>Money</span>
    <span class="pd"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3.6l1.9 4.5 4.5 1.9-4.5 1.9L12 16.4l-1.9-4.5L5.6 10l4.5-1.9z"/></svg>Ask</span>
    <span class="pd"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3.4v2.2M12 18.4v2.2M20.6 12h-2.2M5.6 12H3.4"/></svg>More</span>
  </div>
</div>`, PHONE));

/* =====================  DIRECTION SKETCHES (low-fi)  ===================== */
const LOFI = `
    .sk{width:860px;height:600px;box-sizing:border-box;padding:26px 28px;background:#fbfaf7;font-family:var(--sans);}
    .skh{font-family:var(--serif);font-size:1.3rem;font-weight:600;}
    .skw{font-size:0.83rem;color:var(--muted);margin-top:6px;line-height:1.55;max-width:660px;}
    .skwire{margin-top:20px;border:1.5px dashed rgba(28,46,58,0.28);border-radius:var(--r-md);padding:16px;background:#fff;}
    .sb{background:rgba(28,46,58,0.07);border-radius:6px;height:11px;}
    .skrow{display:flex;align-items:center;gap:12px;padding:11px 12px;border-bottom:1px solid rgba(28,46,58,0.08);}
    .skpill{font-size:0.68rem;font-weight:600;padding:3px 10px;border-radius:999px;border:1.5px dashed rgba(28,46,58,0.3);color:var(--muted);white-space:nowrap;}
    .tradeoff{margin-top:16px;font-size:0.79rem;line-height:1.6;color:var(--muted);}
    .tradeoff b{color:var(--ink);}
`;
writeFileSync(new URL('./DirectionB.dc.html', import.meta.url), page(`<div class="sk">
  <div class="skh">Direction B — the day is the app</div>
  <div class="skw">No areas at all. One scrolling list of everything that wants you today, newest judgement first; Money, Inbox and Cottages become <em>filters</em> on that list rather than places you go. The most extreme reading of what this business actually is: one person, one day at a time.</div>
  <div class="skwire">
    <div style="display:flex;gap:8px;margin-bottom:14px;"><span class="skpill">Everything</span><span class="skpill">Money</span><span class="skpill">Guests</span><span class="skpill">Cottages</span><span class="skpill">Done</span></div>
    <div class="skrow"><span class="sb" style="width:9px;height:9px;border-radius:50%;background:rgba(190,60,60,0.5);"></span><span style="flex:1;"><span class="sb" style="width:62%;"></span><span class="sb" style="width:38%;margin-top:6px;height:8px;"></span></span><span class="skpill">Send it</span></div>
    <div class="skrow"><span class="sb" style="width:9px;height:9px;border-radius:50%;background:rgba(200,140,40,0.5);"></span><span style="flex:1;"><span class="sb" style="width:48%;"></span><span class="sb" style="width:56%;margin-top:6px;height:8px;"></span></span><span class="skpill">Rotate</span></div>
    <div class="skrow"><span class="sb" style="width:9px;height:9px;border-radius:50%;background:rgba(200,140,40,0.5);"></span><span style="flex:1;"><span class="sb" style="width:70%;"></span><span class="sb" style="width:30%;margin-top:6px;height:8px;"></span></span><span class="skpill">Ask</span></div>
    <div class="skrow" style="border-bottom:none;opacity:0.55;"><span class="sb" style="width:9px;height:9px;border-radius:50%;background:rgba(28,46,58,0.2);"></span><span style="flex:1;"><span class="sb" style="width:40%;"></span></span><span class="skpill">Opportunity</span></div>
  </div>
  <div class="tradeoff"><b>Why it might win:</b> nothing is ever more than one screen away, and there is no "which page was that on".<br><b>What it costs:</b> browsing dies. Looking up a stay in November, or last year's takings, has no home — everything becomes a search. Bad on the days when nothing needs you.</div>
</div>`, LOFI));

writeFileSync(new URL('./DirectionC.dc.html', import.meta.url), page(`<div class="sk">
  <div class="skh">Direction C — the assistant is the front door</div>
  <div class="skw">The ⌘K pop-out stops being an overlay and becomes the home screen: a field, the day beneath it, and answers in place. The existing screens stay exactly as they are — they are just what the assistant opens. The smallest amount of new UI of the three.</div>
  <div class="skwire" style="padding:22px 20px;">
    <div style="border:1.5px dashed rgba(28,46,58,0.3);border-radius:999px;padding:11px 16px;display:flex;align-items:center;gap:10px;"><span class="sb" style="width:13px;height:13px;border-radius:50%;"></span><span class="sb" style="width:180px;"></span></div>
    <div style="display:flex;gap:12px;margin-top:16px;">
      <div style="flex:1;border:1.5px dashed rgba(28,46,58,0.22);border-radius:10px;padding:12px;"><span class="sb" style="width:52%;height:8px;"></span><span class="sb" style="width:76%;margin-top:9px;"></span><span class="sb" style="width:60%;margin-top:6px;height:8px;"></span></div>
      <div style="flex:1;border:1.5px dashed rgba(28,46,58,0.22);border-radius:10px;padding:12px;"><span class="sb" style="width:44%;height:8px;"></span><span class="sb" style="width:68%;margin-top:9px;"></span><span class="sb" style="width:52%;margin-top:6px;height:8px;"></span></div>
      <div style="flex:1;border:1.5px dashed rgba(28,46,58,0.22);border-radius:10px;padding:12px;"><span class="sb" style="width:58%;height:8px;"></span><span class="sb" style="width:70%;margin-top:9px;"></span><span class="sb" style="width:40%;margin-top:6px;height:8px;"></span></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;"><span class="skpill">Today</span><span class="skpill">Who owes me</span><span class="skpill">Move money out</span><span class="skpill">Pimpernel</span></div>
  </div>
  <div class="tradeoff"><b>Why it might win:</b> the assistant is already the strongest thing in the back office, and this is nearly free — no screen gets rebuilt.<br><b>What it costs:</b> it bets the whole product on recall. A morning where you do not know what to type is a morning staring at an empty field, and every miss is now a front-door failure.</div>
</div>`, LOFI));

console.log('wrote Inbox, Record, Money, Cottages, Phone, DirectionB, DirectionC');

/* =====================  IN A BROWSER  =====================
   The same design, in the thing it actually runs in. The question a bare
   1440 frame cannot answer is what the left rail costs as the window
   narrows — so these are three real browser widths, not three tidy ones. */
const WEB = `
    .win{width:100%;box-sizing:border-box;background:#e6e2da;border-radius:11px;overflow:hidden;box-shadow:0 24px 70px rgba(30,54,72,0.2);}
    .cbar{height:42px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid rgba(28,46,58,0.09);}
    .lights{display:flex;gap:7px;flex:0 0 auto;}
    .lt{width:11px;height:11px;border-radius:50%;background:rgba(28,46,58,0.16);}
    .tabs{display:flex;gap:6px;flex:0 0 auto;}
    .tab{display:flex;align-items:center;gap:7px;height:27px;padding:0 13px;border-radius:8px 8px 0 0;background:#fff;font-size:0.72rem;font-weight:500;color:var(--ink);}
    .url{flex:1 1 auto;max-width:430px;height:27px;border-radius:999px;background:rgba(255,255,255,0.86);display:flex;align-items:center;gap:8px;padding:0 13px;font-size:0.71rem;color:var(--muted);}
    .rail.mini{width:62px;flex:0 0 62px;padding:20px 9px 14px;align-items:center;}
    .rail.mini .brandrow{padding:0 0 18px;justify-content:center;}
    .rail.mini .brandrow div,.rail.mini .nav span:not(.cnt),.rail.mini .askbtn span{display:none;}
    .rail.mini .navs{width:100%;align-items:center;}
    .rail.mini .nav{justify-content:center;padding:11px 0;width:100%;position:relative;}
    /* FOLDED, THE COUNT IS LOST — "£1,190" cannot live in a 62px rail, so it
       degrades to a pip. That is the honest cost of the fold, not a detail:
       the live state beside each area is the rail's whole advantage over a
       dock, and it is the first thing to go when the window narrows. */
    .rail.mini .cnt{position:absolute;top:7px;right:10px;margin:0;width:7px;height:7px;border-radius:50%;background:var(--muted);font-size:0;line-height:0;overflow:hidden;color:transparent;}
    .rail.mini .cnt.hot{background:var(--danger);}
    .rail.mini .askbtn{justify-content:center;padding:11px 0;}
    .caption{font-family:var(--sans);font-size:0.8rem;color:var(--muted);margin:0 0 12px;line-height:1.55;}
    .caption b{color:var(--ink);font-weight:600;}
    .wrap{padding:26px 26px 30px;background:#efece5;box-sizing:border-box;}
`;
const chrome = (inner) => `      <div class="cbar">
        <span class="lights"><span class="lt"></span><span class="lt"></span><span class="lt"></span></span>
        <span class="tabs"><span class="tab"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 17l2.4-8.4 4 3.6L12 4l2.6 8.2 4-3.6L21 17z" fill="#c6885e"/></svg>Back office</span></span>
        <span class="url"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.4 10.5V7.6a3.6 3.6 0 0 1 7.2 0v2.9"/></svg>cottageholidaysblakeney.co.uk</span>
      </div>
${inner}`;

const webShell = (mini, on, body) => `<div class="win">
${chrome(`      <div class="shell" style="min-height:0;">
${mini ? RAIL(on).replace('class="rail"', 'class="rail mini"') : RAIL(on)}
        <div class="main">
${SPINE}
          <div class="body">
${body}
          </div>
        </div>
      </div>`)}
</div>`;

const LIST_FULL = `            <div class="seg"><span class="segb on">All</span><span class="segb">Needs paying</span><span class="segb">Arriving</span><span class="segb">Past</span></div>
            <div class="cap">Upcoming</div>
            <div class="grp">
              <div class="row"><span class="rowlbl">Wren Hollis<span class="rowsub">Pimpernel · today → 25 Aug</span></span><span class="stc ok">Paid ✓</span></div>
              <div class="row sel"><span class="rowlbl">Sarah Pemberton<span class="rowsub">Jollyboat · 28 Aug → 31 Aug</span></span><span class="stc warn">£520.00 due</span></div>
              <div class="row"><span class="rowlbl">Laura Mtungwazi<span class="rowsub">Pimpernel · tomorrow → 26 Aug</span></span><span class="stc bad">No directions</span></div>
            </div>`;

const PANE = `            <div class="pane">
              <div class="panehd">
                <div class="paneid">Sarah Pemberton</div>
                <div class="panewhen">Jollyboat · Fri 28 → Mon 31 Aug · 3 nights</div>
              </div>
              <div style="padding:14px 18px 2px;">
                <div class="cap" style="margin-top:0;">Next</div>
                <div style="background:color-mix(in srgb,var(--warn) 11%,transparent);border:1px solid color-mix(in srgb,var(--warn) 22%,transparent);border-radius:var(--r-md);padding:13px 15px;">
                  <div style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--warn-text);">Step 4 of 6 · Balance</div>
                  <div style="font-size:0.88rem;font-weight:600;margin-top:5px;">Ask for the balance — £520.00</div>
                </div>
              </div>
              <div class="kv"><span class="kvk">Received so far</span><span class="kvv money">£147.50</span></div>
              <div class="kv"><span class="kvk">Still to pay</span><span class="kvv money">£520.00</span></div>
              <div class="paneact"><button class="btn pri" type="button">Request payment</button><button class="btn" type="button">Email</button></div>
            </div>`;

/* 1440 — a maximised laptop. Everything fits: rail, spine, list, pane. */
writeFileSync(new URL('./WebWide.dc.html', import.meta.url), page(`<div class="wrap" style="width:1500px;">
  <p class="caption"><b>1440px — a maximised 15&Prime; laptop.</b> Everything fits at once: the rail named, the day spine, the list and the record beside it. This is the width the bare artboards were drawn at.</p>
${webShell(false, 'Today', `            <div class="split">
              <div class="listcol">
${LIST_FULL}
              </div>
${PANE}
            </div>`)}
</div>`, SPLIT + WEB));

/* 1180 — a browser that is not maximised. The rail folds to icons. */
writeFileSync(new URL('./WebLaptop.dc.html', import.meta.url), page(`<div class="wrap" style="width:1240px;">
  <p class="caption"><b>1180px — a browser window that is not maximised, or a 13&Prime; laptop.</b> The rail folds to icons at 1200 and the record pane stays. Worth saying plainly: folded, the rail is a vertical dock — so at this width the proposal has reinvented the thing it replaced, minus the live counts, which shrink to pips.</p>
${webShell(true, 'Today', `            <div class="split">
              <div class="listcol">
${LIST_FULL}
              </div>
${PANE}
            </div>`)}
</div>`, SPLIT + WEB));

/* 960 — a half-screen window. The pane goes; the record opens as a page. */
writeFileSync(new URL('./WebNarrow.dc.html', import.meta.url), page(`<div class="wrap" style="width:1020px;">
  <p class="caption"><b>960px — half a screen, or a small laptop.</b> Below 1200 the pane cannot hold its 380px and stay readable, so it goes: the record opens as a full page, exactly as the app already behaves today. The spine and its duties survive every width — that is the part of the proposal that does not depend on room.</p>
${webShell(true, 'Today', `            <div>
${LIST_FULL}
              <p class="caption" style="margin:14px 4px 0;">Tapping a row opens the stay as its own page, with a back link — the ≤1200px behaviour the app already has.</p>
            </div>`)}
</div>`, SPLIT + WEB));

console.log('wrote WebWide, WebLaptop, WebNarrow');
