// ============================================================
//  site.js — the only thing in this app that talks to the outside world,
//  and it talks to exactly one place.
//
//  Every call goes to nightshift.php and nowhere else — an app that can only
//  reach one endpoint cannot accidentally reach a payment route. The calls:
//  `brief` reads the night's work, `ingest` posts it, `connect` trades a code
//  for a key, and the ask channel's pair — `asks` reads what the owner is
//  waiting on RIGHT NOW, `answerAsk` posts the words back.
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
    // AN ID THAT DOES NOT PARSE MUST NOT BECOME 0. It did — `parseInt(id) || 0`
    // — so every row with a missing or non-numeric id produced the SAME ref,
    // and the site's exactly-once rule then quietly kept the first and dropped
    // the rest as duplicates. Anything unparseable keeps its own characters.
    const raw = String(id == null ? '' : id);
    const n = /^\d+$/.test(raw) ? raw : raw.replace(/[^a-z0-9]/gi, '').slice(0, 24);
    return 'mac-' + day + '-' + k + '-' + (n || 'x');
}

// Today, as the site's own calendar day. The app runs at 02:00 local, and the
// site stamps in its own timezone, so a ref keyed on the local date is the
// right grain: two runs on the same night share it, tomorrow's does not.
function today(now) {
    const d = now instanceof Date ? now : new Date();
    const p = function (v) { return String(v).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// IS THIS AN ADDRESS WE MAY SEND A KEY TO?
//
// It took anything. Type http:// by mistake — or paste the wrong host — and
// the app posted its key, in the clear, to whoever was listening or whoever
// owned that host. The key is the thing that opens the site's queue, so the
// address it travels to is part of the security boundary and belongs in the
// same file as the calls that use it.
//
// localhost over http is allowed ON PURPOSE: a staging copy on the same
// machine cannot be intercepted by anyone who is not already on it, and
// refusing it would push people to test against production instead.
function urlProblem(raw) {
    const s = String(raw || '').trim();
    if (!s) { return 'No address set yet.'; }
    let u;
    try {
        u = new URL(s);
    } catch (e) {
        return 'That is not a web address.';
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
        return 'The address must start with https:// — the key travels with every request, and http sends it in the clear.';
    }
    return '';
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
            return { kind: 'auth', say: 'The site refused this app\'s key. Connect again in Connection.' };
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
            // CHECKED AT USE, not only at save. The settings file can be edited
            // by hand and was written by older builds that did not check.
            const bad = urlProblem(url);
            if (bad) { return { ok: false, refusal: { kind: 'setup', say: bad } }; }
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
                // The other jobs' facts. ABSENT (undefined) when the site is
                // older and does not hand them over — which each job reports
                // honestly, rather than reading an old site as a quiet week.
                // How many waiting enquiries the site WITHHELD because the
                // owner already used or binned their draft — said in the log,
                // or a shorter brief reads as enquiries going missing.
                stoodDown: parseInt(r.json.stood_down, 10) || 0,
                week: (r.json.week && typeof r.json.week === 'object') ? r.json.week : undefined,
                gaps: Array.isArray(r.json.gaps) ? r.json.gaps : undefined,
                questions: Array.isArray(r.json.questions) ? r.json.questions : undefined,
            };
        },
        // Post a night's work. Returns { ok, stored, skipped[] } or a refusal.
        async ingest(items) {
            if (!url || !secret) {
                return { ok: false, refusal: { kind: 'setup', say: 'No site address or secret set yet.' } };
            }
            const badUrl = urlProblem(url);
            if (badUrl) { return { ok: false, refusal: { kind: 'setup', say: badUrl } }; }
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
                return { ok: false, uncertain: true, refusal: { kind: 'net', say: "Posted, but the site's answer was lost. The reference makes a retry safe." } };
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
        // THE ASK CHANNEL: what is the owner waiting on right now?
        // Returns { ok, host, asks[] } or { ok:false, refusal }. An empty
        // list is the ordinary answer — this is polled every few seconds.
        async asks() {
            if (!url || !secret) {
                return { ok: false, refusal: { kind: 'setup', say: 'No site address or secret set yet.' } };
            }
            const bad = urlProblem(url);
            if (bad) { return { ok: false, refusal: { kind: 'setup', say: bad } }; }
            let r;
            try {
                r = await send(url, { action: 'asks', secret: secret });
            } catch (e) {
                return { ok: false, refusal: { kind: 'net', say: 'Could not reach the site: ' + (e && e.message ? e.message : 'no answer') } };
            }
            if (!r.ok || !r.json || !r.json.ok) {
                return { ok: false, refusal: refusal(r) };
            }
            return {
                ok: true,
                host: String(r.json.host || ''),
                asks: Array.isArray(r.json.asks) ? r.json.asks : [],
            };
        },
        // Post one ask's answer. `replayed` and `expired` are both fine
        // outcomes for the machine: the first means a retry met its own
        // earlier success, the second that the owner stopped waiting.
        async answerAsk(id, text, model) {
            if (!url || !secret) {
                return { ok: false, refusal: { kind: 'setup', say: 'No site address or secret set yet.' } };
            }
            let r;
            try {
                r = await send(url, { action: 'answer', secret: secret, id: id, text: String(text || ''), model: String(model || '') });
            } catch (e) {
                return { ok: false, refusal: { kind: 'net', say: 'Could not reach the site to answer.' } };
            }
            if (r.status === 410) {
                return { ok: true, expired: true };
            }
            if (!r.ok || !r.json || !r.json.ok) {
                return { ok: false, refusal: refusal(r) };
            }
            return { ok: true, replayed: !!r.json.replayed };
        },

        // CONNECT WITH A CODE. The one call made BEFORE this app holds anything:
        // it hands over eight characters the owner read off the website and gets
        // back a key of its own. The code is single-use and short-lived at the
        // far end, so a failure here is final — there is no retrying it.
        // `label` is what this Mac will be called in the website's paired list.
        // Sent HERE and only here: the code record the site minted cannot know
        // which machine would use it, so without this every device paired as
        // "A Mac" and two of them were indistinguishable.
        async connect(code, label) {
            const bad = urlProblem(url);
            if (bad) { return { ok: false, say: bad }; }
            let r;
            try {
                r = await send(url, {
                    action: 'connect',
                    code: String(code || ''),
                    label: String(label || ''),
                });
            } catch (e) {
                return { ok: false, say: 'Could not reach the site to connect.' };
            }
            if (!r.ok || !r.json || !r.json.ok || !r.json.key) {
                // The site's own sentence, because it knows which of expired,
                // used, wrong or none this was — and they want different things
                // done about them.
                const say = (r.json && r.json.error) || 'The site refused that code.';
                return { ok: false, say: String(say) };
            }
            return { ok: true, key: String(r.json.key), host: String(r.json.host || '') };
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

module.exports = { makeSite, makeRef, today, post, urlProblem };
