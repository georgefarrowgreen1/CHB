// ============================================================
//  site.js — the only thing in this app that talks to the outside world,
//  and it talks to exactly one place.
//
//  Two calls, both to nightshift.php: `brief` reads what is waiting, `ingest`
//  posts what was written. There is no third call, and that is worth keeping
//  true — an app that can only reach one endpoint cannot accidentally reach a
//  payment route.
//
//  The REF is generated here and it is the exactly-once mechanism: the site
//  stores a ref once and answers a retry with "already had it". So a ref must
//  be deterministic for the same work on the same night — a random one would
//  post the same draft twice after a dropped reply.
//
//  Node's built-in fetch, so no dependencies.
// ============================================================
'use strict';

const TIMEOUT_MS = 20000;

// A ref that identifies THIS piece of work on THIS night. Deterministic on
// purpose: if the POST succeeds and the reply is lost, tomorrow's retry —
// or a retry thirty seconds later — carries the same ref and the site stores
// nothing twice. Shape is constrained to what the site accepts.
function makeRef(kind, id, dayIso) {
    const day = String(dayIso || '').slice(0, 10).replace(/[^0-9-]/g, '');
    const k = String(kind || 'note').replace(/[^a-z]/gi, '').slice(0, 12) || 'note';
    const n = String(parseInt(id, 10) || 0);
    return 'mac-' + day + '-' + k + '-' + n;
}

// Today, as the site's own calendar day. The app runs at 02:00 local, and the
// site stamps in its own timezone, so a ref keyed on the local date is the
// right grain: two runs on the same night share it, tomorrow's does not.
function today(now) {
    const d = now instanceof Date ? now : new Date();
    const p = function (v) { return String(v).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function post(url, body, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, timeoutMs || TIMEOUT_MS);
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal,
        });
    } finally {
        clearTimeout(t);
    }
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch (e) {
        json = null;
    }
    return { status: res.status, ok: res.ok, json: json, raw: text.slice(0, 400) };
}

// Make a Site bound to one address and one secret. `fetchImpl` exists so the
// test suite can drive every branch — including the refusals — with no network
// and no site.
function makeSite(opts) {
    const o = opts || {};
    const url = String(o.url || '');
    const secret = String(o.secret || '');
    const send = o.post || post;

    // A refusal the app can act on, rather than an exception with a status in it.
    function refusal(r) {
        const code = (r.json && r.json.code) || '';
        const err = (r.json && r.json.error) || ('the site answered ' + r.status);
        if (r.status === 401) {
            return { kind: 'auth', say: 'The site refused the secret. Check it in Connection.' };
        }
        if (code === 'night_off') {
            return { kind: 'off', say: 'Overnight work is switched off on the site. Nothing was read or stored.' };
        }
        if (code === 'night_no_table') {
            return { kind: 'setup', say: 'The site has not run its migrations yet.' };
        }
        if (r.status === 429) {
            return { kind: 'rate', say: 'The site is rate-limiting this app. It will try again tomorrow.' };
        }
        return { kind: 'error', say: String(err) };
    }

    return {
        url: url,
        // What is waiting. Returns { ok, host, enquiries[] } or { ok:false, refusal }.
        async brief() {
            if (!url || !secret) {
                return { ok: false, refusal: { kind: 'setup', say: 'No site address or secret set yet.' } };
            }
            let r;
            try {
                r = await send(url, { action: 'brief', secret: secret });
            } catch (e) {
                return { ok: false, refusal: { kind: 'net', say: 'Could not reach the site: ' + (e && e.message ? e.message : 'no answer') } };
            }
            if (!r.ok || !r.json || !r.json.ok) {
                return { ok: false, refusal: refusal(r) };
            }
            return {
                ok: true,
                host: String(r.json.host || ''),
                enquiries: Array.isArray(r.json.enquiries) ? r.json.enquiries : [],
            };
        },
        // Post a night's work. Returns { ok, stored, skipped[] } or a refusal.
        async ingest(items) {
            if (!url || !secret) {
                return { ok: false, refusal: { kind: 'setup', say: 'No site address or secret set yet.' } };
            }
            if (!Array.isArray(items) || !items.length) {
                return { ok: true, stored: 0, skipped: [] };
            }
            let r;
            try {
                r = await send(url, { action: 'ingest', secret: secret, items: items });
            } catch (e) {
                // AN UNCERTAIN POST IS NOT A FAILED POST. The reply was lost, but
                // the items may well be stored — which is exactly what the
                // deterministic ref is for. Reported as uncertain so the log says
                // so and tomorrow's identical ref settles it.
                return { ok: false, uncertain: true, refusal: { kind: 'net', say: 'Posted, but the site&rsquo;s answer was lost. The reference makes a retry safe.' } };
            }
            if (!r.ok || !r.json || !r.json.ok) {
                return { ok: false, refusal: refusal(r) };
            }
            return {
                ok: true,
                stored: parseInt(r.json.stored, 10) || 0,
                skipped: Array.isArray(r.json.skipped) ? r.json.skipped : [],
            };
        },
        // Is the far end there, switched on, and does it accept the secret?
        // Used by the Connection screen's Test now, and it reports the DISTINCT
        // states rather than a boolean, because "off" and "wrong secret" want
        // different things done about them.
        async test() {
            const b = await this.brief();
            if (b.ok) {
                return { state: 'on', say: 'Reachable, switched on, ' + b.enquiries.length + ' enquir' + (b.enquiries.length === 1 ? 'y' : 'ies') + ' waiting.' };
            }
            const k = b.refusal.kind;
            return { state: k === 'off' ? 'off' : k === 'auth' ? 'auth' : k === 'net' ? 'unreachable' : 'error', say: b.refusal.say };
        },
    };
}

module.exports = { makeSite, makeRef, today, post };
