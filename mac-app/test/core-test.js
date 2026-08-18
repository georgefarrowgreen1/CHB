#!/usr/bin/env node
// ============================================================
//  core-test.js — every judgement in the app's core, with no Electron, no
//  model, no network and no Mac.
//
//      node test/core-test.js
//
//  This is the file that makes the app worth shipping unbuilt. I cannot compile
//  a .app in this container and I cannot run a local model here, so the deal is
//  that everything ABOVE the model is driven and verified, and what is left
//  unverified is small and named: the Electron window, and whether the model's
//  prose is any good.
//
//  The section that matters most is §3, the GUARD. Its job is to catch a model
//  that invents a price or an availability answer, and it is checked against
//  the exact shapes a real model produces when it goes wrong.
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const machine = require('../src/core/machine');
const guard = require('../src/core/guard');
const site = require('../src/core/site');
const engine = require('../src/core/engine');
const models = require('../src/core/models');
const config = require('../src/core/config');
const jobs = require('../src/core/jobs');
const night = require('../src/core/night');
const update = require('../src/core/update');
const updater = require('../src/core/updater');

let fails = 0;
let passes = 0;
function ok(label, cond, detail) {
    if (cond) {
        passes++;
        console.log('  ✓ ' + label);
    } else {
        fails++;
        console.log('  ✗ ' + label + (detail ? ' — ' + String(detail).slice(0, 160) : ''));
    }
}
function section(t) { console.log('\n' + t); }

// A Mac to reason about, so the verdicts are not at the mercy of the box this runs on.
const M16 = { isMac: true, arch: 'arm64', appleSilicon: true, ramGB: 16, macos: '15.6', model: 'Macmini9,1', cpu: 'Apple M2', cores: 8 };
const INTEL = { isMac: true, arch: 'x64', appleSilicon: false, ramGB: 16, macos: '14.7', model: 'Macmini8,1', cpu: 'Intel Core i7', cores: 12 };

// ── §1 THE MACHINE ───────────────────────────────────────────────────────
section('§1 the machine, and what it says will run');
const real = machine.readMachine();
ok('reading this machine never throws and reports an arch', typeof real.arch === 'string' && real.arch.length > 0);
ok('…and some RAM', real.ramGB > 0);
ok('a description is one readable line', machine.describe(M16).indexOf('16 GB') !== -1, machine.describe(M16));
ok('a 9 GB model on 16 GB runs well', machine.modelVerdict(M16, 9).fit === 'ok');
ok('…and says so in words', /Runs well/.test(machine.modelVerdict(M16, 9).why));
ok('a 12 GB model on 16 GB is slow, not refused', machine.modelVerdict(M16, 12).fit === 'slow');
ok('…and names the RAM it is tight on', /16 GB/.test(machine.modelVerdict(M16, 12).why));
ok('a 20 GB model on 16 GB will not fit', machine.modelVerdict(M16, 20).fit === 'no');
ok('a 47 GB model certainly will not', machine.modelVerdict(M16, 47).fit === 'no');
ok('an unknown size is UNKNOWN, never a cheerful yes', machine.modelVerdict(M16, 0).fit === 'unknown');
// The Intel promise from the design conversation, in code.
ok('the same 9 GB model FITS on an Intel Mac', INTEL && machine.modelVerdict(INTEL, 9).fit === 'ok');
ok('…and says the honest thing about why it will be slow', /CPU only/.test(machine.modelVerdict(INTEL, 9).why));
ok('an MLX-only model is refused on Intel', machine.modelVerdict(INTEL, 8, { mlxOnly: true }).fit === 'no');
ok('…for the right reason', /Apple silicon only/.test(machine.modelVerdict(INTEL, 8, { mlxOnly: true }).why));
ok('…and accepted on Apple silicon', machine.modelVerdict(M16, 8, { mlxOnly: true }).fit === 'ok');
ok('the soft line is below the hard one', machine.RAM_SOFT < machine.RAM_HARD);

// ── §2 THE ENGINES ───────────────────────────────────────────────────────
section('§2 two engines, one adapter');
const availAS = engine.available(M16);
const availIntel = engine.available(INTEL);
ok('three engines are offered', availAS.length === 3);
ok('all three are usable on Apple silicon', availAS.every(function (e) { return e.usable; }));
ok('MLX is NOT usable on Intel', availIntel.filter(function (e) { return e.id === 'mlx'; })[0].usable === false);
ok('…and it is still LISTED, with a reason', /Apple silicon only/.test(availIntel.filter(function (e) { return e.id === 'mlx'; })[0].why));
ok('llama.cpp is usable on both', availIntel.filter(function (e) { return e.id === 'llamacpp'; })[0].usable === true);
ok('Apple silicon prefers MLX once it is actually serving', engine.pickDefault(M16, { mlx: true, llamacpp: true }) === 'mlx');
ok('…but never when it is not', engine.pickDefault(M16, { mlx: false, llamacpp: true }) === 'llamacpp');
ok('Intel never picks MLX even when something answers on its port', engine.pickDefault(INTEL, { mlx: true, llamacpp: true }) === 'llamacpp');
ok('with nothing serving it still names a default rather than nothing', engine.pickDefault(INTEL, {}) === 'llamacpp');

// A fake engine endpoint. This is how the drafting path is driven with no model.
function fakeEngine(reply, opts) {
    const o = opts || {};
    return engine.makeEngine({
        id: o.id || 'llamacpp',
        get: async function () { return { ok: o.down ? false : true, status: o.down ? 500 : 200, json: { data: [] } }; },
        post: async function () {
            if (o.throw) {
                throw new Error('socket hang up');
            }
            if (o.httpFail) {
                return { ok: false, status: 500, json: { error: { message: 'no model loaded' } } };
            }
            return {
                ok: true, status: 200,
                json: { choices: [{ message: { content: reply } }], usage: { completion_tokens: o.tokens || 120 } },
            };
        },
    });
}

// ── §3 THE GUARD — the most important section in this suite ──────────────
section('§3 the guard: the brief states the facts, the model arranges the words');
const FACTS = {
    first: 'Rachel', name: 'Rachel Pemberton', cottage: 'Jollyboat',
    check_in: '2026-10-12', check_out: '2026-10-19', nights: 7,
    adults: 2, children: 0, dates_free: true,
    quote: '£892.50', deposit: '£75.00',
    message: 'Is Jollyboat free that week, and do you take dogs?',
    facts: [{ q: 'Do you take dogs?', a: 'We are afraid not.' }],
};
const GOOD = 'Thank you for getting in touch. Jollyboat is free for the week of 12 October — seven nights, £892.50 all in. We are afraid we cannot take dogs at any of the three cottages, so I would hate for you to book and find out at the door. There is a refundable £75.00 damages deposit which comes back after your stay. Do let me know if that suits and I will hold the dates for a couple of days.';
ok('a good draft passes', guard.checkDraft(GOOD, FACTS).ok, JSON.stringify(guard.checkDraft(GOOD, FACTS).problems));

// MONEY IT WAS NOT GIVEN. The failure that matters most.
const INVENTED = GOOD.replace('£892.50', '£845.00');
ok('a figure the site did not give is REFUSED', !guard.checkDraft(INVENTED, FACTS).ok);
ok('…and the reason names the figure', /845\.00/.test(guard.checkDraft(INVENTED, FACTS).problems.join(' ')));
const EXTRA = GOOD + ' There is also a £30.00 cleaning charge.';
ok('an extra charge it made up is refused', !guard.checkDraft(EXTRA, FACTS).ok);
ok('the SAME figure written differently is accepted', guard.checkDraft(GOOD.replace('£892.50', '£ 892.5'), FACTS).ok);
ok('a figure that is not the quoted one is refused, separators and all', guard.checkDraft(GOOD.replace('£892.50', '£892.50'), Object.assign({}, FACTS, { quote: '£1,892.50' })).ok === false);
ok('…and the correctly-separated one passes',
    guard.checkDraft(GOOD.replace('£892.50', '£1,892.50'), Object.assign({}, FACTS, { quote: '£1892.50' })).ok);
ok('with no quote at all, ANY figure is refused', !guard.checkDraft(GOOD, Object.assign({}, FACTS, { quote: '', deposit: '' })).ok);
ok('…and a draft with no money in it passes',
    guard.checkDraft('Thank you for getting in touch. Jollyboat is free for the week of 12 October and we would be glad to have you. We are afraid we cannot take dogs at any of the three cottages. Do let me know and I will hold the dates.', Object.assign({}, FACTS, { quote: '', deposit: '' })).ok);

// AVAILABILITY IT DID NOT KNOW.
const FREE_UNKNOWN = Object.assign({}, FACTS, { dates_free: null });
ok('a claim that the dates are free, when the site could not tell, is refused',
    !guard.checkDraft(GOOD, FREE_UNKNOWN).ok);
ok('…and the reason says so', /could not confirm/.test(guard.checkDraft(GOOD, FREE_UNKNOWN).problems.join(' ')));
const TAKEN = Object.assign({}, FACTS, { dates_free: false });
ok('saying free when the site says taken is refused', !guard.checkDraft(GOOD, TAKEN).ok);
const SORRY = 'Thank you for getting in touch. I am sorry to say that week has already been taken — it went earlier in the month. If you have any flexibility I would be glad to look at what else is open for you. Jollyboat is our smallest cottage and it does go quickly at that time of year. Do let me know what dates might work.';
ok('saying taken when the site says taken passes', guard.checkDraft(SORRY, TAKEN).ok, JSON.stringify(guard.checkDraft(SORRY, TAKEN).problems));
ok('saying taken when the site says FREE is refused', !guard.checkDraft(SORRY, FACTS).ok);
ok('with availability unknown, a draft that says nothing about it passes',
    guard.checkDraft('Thank you for getting in touch about Jollyboat. We are afraid we cannot take dogs at any of the three cottages, so I wanted to say so before you go any further. I will come back to you on the dates as soon as I have checked the diary properly. Do bear with me.', Object.assign({}, FREE_UNKNOWN, { quote: '', deposit: '' })).ok);

// THINGS THAT BELONG TO THE APP.
ok('a link is refused', !guard.checkDraft(GOOD + ' Book at https://example.com/pay', FACTS).ok);
ok('a www link is refused', !guard.checkDraft(GOOD + ' See www.example.com', FACTS).ok);
ok('claiming it already charged the card is refused', !guard.checkDraft(GOOD + ' Your card has been charged.', FACTS).ok);
ok('claiming it already booked is refused', !guard.checkDraft("I've booked that for you. " + GOOD, FACTS).ok);
ok('a greeting is refused — the template adds one', !guard.checkDraft('Hello Rachel, ' + GOOD, FACTS).ok);
ok('…as is "Hi"', !guard.checkDraft('Hi Rachel — ' + GOOD, FACTS).ok);
ok('…and "Dear"', !guard.checkDraft('Dear Rachel, ' + GOOD, FACTS).ok);
ok('a one-line answer is refused as too short', !guard.checkDraft('Yes, it is free.', FACTS).ok);
ok('an essay is refused as too long', !guard.checkDraft(GOOD + ' ' + 'x'.repeat(4200), FACTS).ok);
ok('empty is refused', !guard.checkDraft('', FACTS).ok);
ok('null is refused', !guard.checkDraft(null, FACTS).ok);
// Every problem must read as a sentence: it ends up in the night log.
const probs = guard.checkDraft('Hi Rachel, ' + INVENTED + ' See www.x.com', FACTS).problems;
ok('several problems are reported together, not just the first', probs.length >= 3, JSON.stringify(probs));
ok('…and every one is a sentence a person can read', probs.every(function (p) { return /^[a-z]/.test(p) && p.length > 10 && !/[{}<>]/.test(p); }), JSON.stringify(probs));

section('§3b money parsing, since everything above rests on it');
ok('one figure', JSON.stringify(guard.moneyIn('it is £892.50 all in')) === '["892.50"]');
ok('two distinct figures', guard.moneyIn('£892.50 and £75.00').length === 2);
ok('the same figure twice counts once', guard.moneyIn('£75 and £75.00').length === 1);
ok('a space after the sign', guard.moneyIn('£ 892.50').length === 1);
ok('thousands', JSON.stringify(guard.moneyIn('£1,892.50')) === '["1892.50"]');
ok('no pence', JSON.stringify(guard.moneyIn('£90')) === '["90.00"]');
ok('a bare number is not money', guard.moneyIn('7 nights for 2 adults').length === 0);
ok('a year is not money', guard.moneyIn('in 2026 we open again').length === 0);
ok('normalising is idempotent', guard.normaliseMoney('£1,234.5') === '1234.50');
ok('nonsense normalises to nothing', guard.normaliseMoney('lots') === '');

section('§3c the prompt, which must state every rule the guard enforces');
const prompt = guard.buildPrompt(FACTS, 'George');
ok('the prompt names the host', /George/.test(prompt));
ok('it forbids a greeting', /Do NOT open with a greeting/i.test(prompt));
ok('it forbids inventing a figure', /Do NOT invent, calculate or alter any figure/i.test(prompt));
ok('it forbids links', /Do NOT include links/i.test(prompt));
ok('it hands over the quote verbatim', prompt.indexOf('£892.50') !== -1);
ok('it states the dates ARE free when they are', /Those dates ARE free/.test(prompt));
ok('it states they are NOT when they are not', /are NOT free/.test(guard.buildPrompt(TAKEN, 'George')));
ok('it orders silence when availability is unknown', /Say nothing at all about whether the dates are free/.test(guard.buildPrompt(FREE_UNKNOWN, 'George')));
ok('with no price it forbids mentioning money', /Do not mention money/.test(guard.buildPrompt(Object.assign({}, FACTS, { quote: '', deposit: '' }), 'G')));
ok('the cottage answers are handed over', prompt.indexOf('Do you take dogs?') !== -1);
ok('the enquiry itself is handed over', prompt.indexOf('do you take dogs') !== -1);
ok('a party is described in words', guard.partyWords(2, 1) === '2 adults, 1 child');
ok('…pluralised properly', guard.partyWords(1, 2) === '1 adult, 2 children');
ok('…and empty when there is nothing to say', guard.partyWords(0, 0) === '');

// ── §4 THE SITE ──────────────────────────────────────────────────────────
section('§4 the site: two calls, and every refusal named');
function fakeSite(handler) {
    return site.makeSite({ url: 'https://x.test/nightshift.php', secret: 's3cret', post: handler });
}
(async function () {
    let s = fakeSite(async function () {
        return { ok: true, status: 200, json: { ok: true, host: 'George', enquiries: [{ id: 1 }] } };
    });
    let b = await s.brief();
    ok('a good brief comes back', b.ok && b.host === 'George' && b.enquiries.length === 1);

    s = fakeSite(async function () { return { ok: false, status: 401, json: { error: 'Not authorised.' } }; });
    b = await s.brief();
    ok('401 is reported as an AUTH problem, in words', !b.ok && b.refusal.kind === 'auth' && /secret/i.test(b.refusal.say));

    s = fakeSite(async function () { return { ok: false, status: 409, json: { code: 'night_off', error: 'off' } }; });
    b = await s.brief();
    ok('the switch being off is its OWN state, not an error', !b.ok && b.refusal.kind === 'off');
    ok('…and it says where to switch it on', /switched off/i.test(b.refusal.say));

    s = fakeSite(async function () { return { ok: false, status: 503, json: { code: 'night_no_table' } }; });
    b = await s.brief();
    ok('an un-migrated site is a SETUP problem', !b.ok && b.refusal.kind === 'setup');

    s = fakeSite(async function () { return { ok: false, status: 429, json: {} }; });
    b = await s.brief();
    ok('rate limiting says it will try tomorrow', !b.ok && b.refusal.kind === 'rate');

    s = fakeSite(async function () { throw new Error('ECONNREFUSED'); });
    b = await s.brief();
    ok('an unreachable site is a NET problem', !b.ok && b.refusal.kind === 'net');

    // An uncertain POST must not read as a failure — the ref makes a retry safe.
    s = fakeSite(async function (u, body) {
        if (body.action === 'ingest') { throw new Error('socket hang up'); }
        return { ok: true, status: 200, json: { ok: true, enquiries: [] } };
    });
    let g = await s.ingest([{ ref: 'r', kind: 'reply', title: 't', body: 'b' }]);
    ok('a lost reply to a post is UNCERTAIN, not failed', !g.ok && g.uncertain === true);
    ok('…and says why a retry is safe', /reference/i.test(g.refusal.say));

    s = fakeSite(async function () { return { ok: true, status: 200, json: { ok: true, stored: 2, skipped: [{ ref: 'x', why: 'too long' }] } }; });
    g = await s.ingest([{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }]);
    ok('a post reports what was stored and what was not', g.ok && g.stored === 2 && g.skipped.length === 1);
    g = await s.ingest([]);
    ok('posting nothing is a success that sends nothing', g.ok && g.stored === 0);

    const noSecret = site.makeSite({ url: 'https://x.test/n.php', secret: '' });
    b = await noSecret.brief();
    ok('with no secret it refuses BEFORE any request', !b.ok && b.refusal.kind === 'setup');

    // Test now reports the distinct states, because they want different things done.
    s = fakeSite(async function () { return { ok: true, status: 200, json: { ok: true, enquiries: [{}, {}] } }; });
    let t = await s.test();
    ok('Test now: on, and counts what is waiting', t.state === 'on' && /2 enquiries waiting/.test(t.say), t.say);
    s = fakeSite(async function () { return { ok: false, status: 409, json: { code: 'night_off' } }; });
    t = await s.test();
    ok('Test now: off is reported as off', t.state === 'off');
    s = fakeSite(async function () { return { ok: false, status: 401, json: {} }; });
    t = await s.test();
    ok('Test now: a bad secret is reported as such', t.state === 'auth');
    s = fakeSite(async function () { throw new Error('nope'); });
    t = await s.test();
    ok('Test now: unreachable is its own answer', t.state === 'unreachable');

    section('§4b the ref — the exactly-once mechanism');
    const r1 = site.makeRef('reply', 42, '2026-08-17');
    const r2 = site.makeRef('reply', 42, '2026-08-17');
    ok('the same work on the same night gives the SAME ref', r1 === r2, r1 + ' vs ' + r2);
    ok('a different enquiry gives a different ref', r1 !== site.makeRef('reply', 43, '2026-08-17'));
    ok('the next night gives a different ref', r1 !== site.makeRef('reply', 42, '2026-08-18'));
    ok('the ref is in the shape the site accepts', /^[A-Za-z0-9._:-]+$/.test(r1) && r1.length <= 64, r1);
    ok('a hostile kind cannot break the shape', /^[A-Za-z0-9._:-]+$/.test(site.makeRef('../x', 1, '2026-08-17')));
    ok('a hostile day cannot either', /^[A-Za-z0-9._:-]+$/.test(site.makeRef('reply', 1, '2026-08-17; DROP')));
    ok('today() is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(site.today(new Date(2026, 7, 17))));

    // ── §5 THE ENGINE ADAPTER ────────────────────────────────────────────
    section('§5 asking for prose, and every way that can go wrong');
    let e = fakeEngine(GOOD, { tokens: 150 });
    ok('a reachable engine says so', await e.reachable() === true);
    let w = await e.write('prompt', 'a-model');
    ok('a good answer comes back with its text', w.ok && w.text === GOOD);
    ok('…and a measured speed, not a quoted one', w.tokens === 150 && typeof w.tokensPerSec === 'number');
    e = fakeEngine('', { down: true });
    ok('a dead engine is not reachable', await e.reachable() === false);
    e = fakeEngine('', { httpFail: true });
    w = await e.write('p', 'm');
    ok('an HTTP failure is reported in words', !w.ok && /refused/i.test(w.say) && /no model loaded/.test(w.say), w.say);
    e = fakeEngine('', { throw: true });
    w = await e.write('p', 'm');
    ok('a hung socket is reported in words', !w.ok && /did not answer/i.test(w.say));
    e = fakeEngine('   \n  ');
    w = await e.write('p', 'm');
    ok('an empty answer is a failure, not an empty draft', !w.ok && /nothing/i.test(w.say));

    // ── §6 THE JOB ───────────────────────────────────────────────────────
    section('§6 the reply job, driven end to end with no model');
    const ENQ = Object.assign({ id: 42 }, FACTS);
    let out = await jobs.runReplyJob({
        engine: fakeEngine(GOOD), model: 'm', host: 'George',
        now: new Date(2026, 7, 17, 2, 14), enquiries: [ENQ],
    });
    ok('one enquiry becomes one item', out.items.length === 1);
    const it = out.items[0];
    ok('the item is a reply', it.kind === 'reply');
    ok('…titled for the guest', it.title === 'Reply to Rachel Pemberton');
    ok('…sub-lined with the cottage, the dates and the party', /Jollyboat/.test(it.sub) && /12–19 Oct/.test(it.sub) && /2 adults/.test(it.sub), it.sub);
    ok('…carrying the draft as its body', it.body === GOOD);
    ok('…naming what it was written from', /their enquiry/.test(it.source) && /own price/.test(it.source), it.source);
    ok('…and pointing at the enquiry on the site', it.target === 'enquiry-42');
    ok('the log says it drafted one', out.log.some(function (l) { return l.level === 'hit'; }));

    // THE GUARD IN THE JOB, not just in isolation.
    out = await jobs.runReplyJob({
        engine: fakeEngine(INVENTED), model: 'm', host: 'George', now: new Date(), enquiries: [ENQ],
    });
    ok('a draft that invents a figure is NEVER returned', out.items.length === 0);
    ok('…and the log says which rule it broke', out.log.some(function (l) { return l.level === 'fail' && /refused own draft/.test(l.say) && /845/.test(l.say); }),
        JSON.stringify(out.log));
    out = await jobs.runReplyJob({
        engine: fakeEngine('Hello Rachel, ' + GOOD), model: 'm', host: 'George', now: new Date(), enquiries: [ENQ],
    });
    ok('a draft that greets is never returned either', out.items.length === 0);

    out = await jobs.runReplyJob({
        engine: fakeEngine(GOOD), model: 'm', host: 'G', now: new Date(),
        enquiries: [Object.assign({}, ENQ, { message: '   ' })],
    });
    ok('an enquiry with no message is skipped', out.items.length === 0 && out.log.some(function (l) { return l.level === 'skip'; }));
    out = await jobs.runReplyJob({ engine: fakeEngine(GOOD), model: 'm', enquiries: [] });
    ok('a quiet night returns nothing and says so', out.items.length === 0 && /nothing waiting/.test(out.log[0].say));
    out = await jobs.runReplyJob({
        engine: fakeEngine('', { httpFail: true }), model: 'm', now: new Date(), enquiries: [ENQ],
    });
    ok('a model that fails is logged per enquiry, not thrown', out.items.length === 0 && out.log.some(function (l) { return l.level === 'fail'; }));
    // Two enquiries, one good and one that breaks a rule: the good one still ships.
    out = await jobs.runReplyJob({
        engine: {
            id: 'x', name: 'x', base: '', reachable: async function () { return true; },
            write: (function () {
                let n = 0;
                return async function () {
                    n++;
                    return { ok: true, text: n === 1 ? GOOD : INVENTED, ms: 100, tokens: 10, tokensPerSec: 10 };
                };
            })(),
        },
        model: 'm', now: new Date(), enquiries: [ENQ, Object.assign({}, ENQ, { id: 43 })],
    });
    ok('one bad draft does not lose the good one', out.items.length === 1 && out.items[0].target === 'enquiry-42');

    section('§6b the words on the card');
    ok('a same-month range reads 12–19 Oct', jobs.spokenRange('2026-10-12', '2026-10-19') === '12–19 Oct');
    ok('a cross-month range names both', jobs.spokenRange('2026-12-28', '2027-01-03') === '28 Dec – 3 Jan');
    ok('a nonsense date yields nothing rather than "NaN"', jobs.spokenRange('rubbish', '2026-01-01') === '');

    // ── §7 THE NIGHT ─────────────────────────────────────────────────────
    section('§7 the night, end to end');
    function runWith(opts) {
        const o = opts || {};
        const posted = [];
        const s = site.makeSite({
            url: 'https://x.test/n.php', secret: 's',
            post: async function (u, body) {
                if (body.action === 'brief') {
                    if (o.briefOff) { return { ok: false, status: 409, json: { code: 'night_off' } }; }
                    return { ok: true, status: 200, json: { ok: true, host: 'George', enquiries: o.enquiries || [ENQ] } };
                }
                posted.push(body);
                if (o.ingestLost) { throw new Error('hang up'); }
                return { ok: true, status: 200, json: { ok: true, stored: (body.items || []).length, skipped: o.skipped || [] } };
            },
        });
        return night.runNight({
            site: s,
            engine: o.engine || fakeEngine(GOOD),
            cfg: o.cfg || { jobs: { reply: { on: true, model: 'qwen', at: '02:00' } } },
            machine: M16,
            now: new Date(2026, 7, 17, 2, 14),
        }).then(function (rec) { return { rec: rec, posted: posted }; });
    }
    let r = await runWith({});
    ok('a good night posts what it drafted', r.rec.ok && r.rec.drafted === 1 && r.rec.posted === 1);
    ok('…and the log ends with a summary', r.rec.log[r.rec.log.length - 1].level === 'done');
    ok('…and the post carried an ingest, nothing else', r.posted.length === 1 && r.posted[0].action === 'ingest');
    r = await runWith({ cfg: { jobs: { reply: { on: false, model: 'q' } } } });
    ok('every job off means nothing is drafted and nothing posted', r.rec.ok && r.rec.drafted === 0 && r.posted.length === 0);
    ok('…and the log says why', r.rec.log.some(function (l) { return /switched off/.test(l.say); }));
    r = await runWith({ cfg: { jobs: { reply: { on: true, model: '' } } } });
    ok('no model chosen stops the run with a sentence', !r.rec.ok && r.rec.log.some(function (l) { return /pick one/.test(l.say); }));
    r = await runWith({ briefOff: true });
    ok('the site being switched off stops the run cleanly', !r.rec.ok && r.rec.stopped === 'off' && r.posted.length === 0);
    r = await runWith({ engine: fakeEngine(GOOD, { down: true }) });
    ok('a dead engine is ONE line, not one per enquiry', !r.rec.ok
        && r.rec.log.filter(function (l) { return l.level === 'fail'; }).length === 1
        && /not answering/.test(r.rec.log.filter(function (l) { return l.level === 'fail'; })[0].say));
    r = await runWith({ ingestLost: true });
    ok('a lost reply to the post leaves the night UNCERTAIN, not failed', r.rec.uncertain === true && r.rec.ok === true);
    r = await runWith({ enquiries: [] });
    ok('a quiet night is a success', r.rec.ok && r.rec.drafted === 0);
    r = await runWith({ skipped: [{ ref: 'x', why: 'the queue is full' }] });
    ok('anything the site would not take is named in the log', r.rec.log.some(function (l) { return /would not take/.test(l.say) && /queue is full/.test(l.say); }));

    section('§7b when it next runs');
    const at2am = night.nextRun('02:00', new Date(2026, 7, 17, 19, 18));
    ok('from teatime, the next 02:00 is tomorrow', at2am.getDate() === 18 && at2am.getHours() === 2);
    const at2amEarly = night.nextRun('02:00', new Date(2026, 7, 17, 1, 30));
    ok('from half past one, it is today', at2amEarly.getDate() === 17);
    ok('at exactly the hour it means tomorrow, never a double run',
        night.nextRun('02:00', new Date(2026, 7, 17, 2, 0, 0)).getDate() === 18);
    ok('a nonsense time falls back to 02:00 rather than throwing', night.nextRun('rubbish', new Date(2026, 7, 17, 19, 0)).getHours() === 2);
    ok('the countdown reads in hours and minutes',
        night.untilWords(new Date(2026, 7, 18, 2, 0), new Date(2026, 7, 17, 19, 18)) === 'in 6 hours 42 minutes',
        night.untilWords(new Date(2026, 7, 18, 2, 0), new Date(2026, 7, 17, 19, 18)));
    ok('under a minute it does not say "in 0 minutes"',
        night.untilWords(new Date(2026, 7, 17, 2, 0, 30), new Date(2026, 7, 17, 2, 0, 0)) === 'any moment now');
    ok('a time gone by reads "now"', night.untilWords(new Date(2026, 7, 17, 1, 0), new Date(2026, 7, 17, 2, 0)) === 'now');
    let list = [];
    for (let i = 0; i < 40; i++) {
        list = night.pushRecord(list, { started: 'n' + i });
    }
    ok('the log keeps 30 nights and no more', list.length === night.LOG_KEEP);
    ok('…newest first', list[0].started === 'n39');

    // ── §8 THE MODEL LIBRARY ─────────────────────────────────────────────
    section('§8 the model library');
    ok('a GGUF filename becomes a readable name', models.prettyName('Qwen2.5-14B-Instruct-Q4_K_M.gguf') === 'Qwen 2.5 14B Instruct',
        models.prettyName('Qwen2.5-14B-Instruct-Q4_K_M.gguf'));
    ok('…and its quantisation is read off it', models.quantOf('Qwen2.5-14B-Instruct-Q4_K_M.gguf') === 'Q4_K_M');
    ok('a repo name works the same way', models.prettyName('Meta-Llama-3.1-8B-Instruct-GGUF') === 'Meta Llama 3.1 8B Instruct',
        models.prettyName('Meta-Llama-3.1-8B-Instruct-GGUF'));
    ok('parameters are read from the name', models.paramsOf('bartowski/Qwen2.5-14B-Instruct-GGUF') === 14);
    ok('…including a fraction', models.paramsOf('org/Model-1.5B-Instruct') === 1.5);
    ok('…and nothing when there is none', models.paramsOf('org/some-model') === 0);
    ok('a "b" inside a word is not a parameter count', models.paramsOf('org/Model-3bit-quant') === 0, String(models.paramsOf('org/Model-3bit-quant')));

    const row = models.mapRepo({ modelId: 'bartowski/Qwen2.5-14B-Instruct-GGUF', downloads: 500 }, M16);
    ok('a repo maps to a row with a fit verdict', row && row.fit === 'ok' && row.owner === 'bartowski');
    ok('…and says its size is an estimate rather than pretending', row.sizeIsEstimate === true);
    const big = models.mapRepo({ modelId: 'bartowski/Qwen2.5-72B-Instruct-GGUF' }, M16);
    ok('a 72B model will not fit on 16 GB', big.fit === 'no');
    const mlxRow = models.mapRepo({ modelId: 'mlx-community/Qwen2.5-14B-Instruct-4bit' }, INTEL);
    ok('an MLX repo is refused on Intel', mlxRow.fit === 'no' && /Apple silicon only/.test(mlxRow.why));
    ok('…and is marked as the MLX format', mlxRow.format === 'mlx');
    ok('a nameless repo maps to nothing rather than a blank row', models.mapRepo({}, M16) === null);

    // Searching, with a fake Hugging Face.
    let sr = await models.search('qwen', M16, {
        fetch: async function () {
            return {
                ok: true, status: 200,
                json: async function () {
                    return [
                        { modelId: 'random/Qwen2.5-14B-clone-GGUF', downloads: 9000 },
                        { modelId: 'bartowski/Qwen2.5-14B-Instruct-GGUF', downloads: 50 },
                    ];
                },
            };
        },
    });
    ok('a search returns rows', sr.ok && sr.rows.length === 2);
    ok('…with the known-good uploader first, even on fewer downloads', sr.rows[0].owner === 'bartowski',
        sr.rows.map(function (x) { return x.owner; }).join(','));
    sr = await models.search('q', M16, { fetch: async function () { throw new Error('nope'); } });
    ok('a one-letter search asks nothing and returns nothing', sr.ok && sr.rows.length === 0);
    sr = await models.search('qwen', M16, { fetch: async function () { throw new Error('offline'); } });
    ok('an unreachable Hugging Face is reported in words', !sr.ok && /Could not reach/.test(sr.say));
    sr = await models.search('qwen', M16, { fetch: async function () { return { ok: false, status: 503 }; } });
    ok('…as is a bad answer from it', !sr.ok && /503/.test(sr.say));
    sr = await models.search('qwen', M16, { fetch: async function () { return { ok: true, json: async function () { return { nope: 1 }; } }; } });
    ok('…and an unexpected shape', !sr.ok && /unexpected/.test(sr.say));

    // The installed list is a directory listing, so it is tested against a real one.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-models-'));
    fs.writeFileSync(path.join(tmp, 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'not a model');
    fs.mkdirSync(path.join(tmp, 'Qwen2.5-14B-Instruct-4bit'));
    fs.writeFileSync(path.join(tmp, 'Qwen2.5-14B-Instruct-4bit', 'config.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'Qwen2.5-14B-Instruct-4bit', 'weights.safetensors'), Buffer.alloc(1024));
    const inst = models.installed(tmp);
    ok('a .gguf file is found', inst.some(function (m) { return m.format === 'gguf' && /Qwen 2\.5 14B/.test(m.name); }));
    ok('an MLX folder is found', inst.some(function (m) { return m.format === 'mlx'; }));
    ok('a text file is not a model', inst.length === 2, JSON.stringify(inst.map(function (m) { return m.id; })));
    ok('a missing folder is an empty library, not an error', models.installed(path.join(tmp, 'nope')).length === 0);
    fs.rmSync(tmp, { recursive: true, force: true });

    // ── §9 SETTINGS AND THE SECRET ───────────────────────────────────────
    section('§9 settings on disk, and the secret NOT on disk');
    const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cfg-'));
    let cfg = config.load(cdir);
    ok('a first run loads the defaults', cfg.siteUrl === '' && cfg.jobs.reply.on === false);
    ok('…with a models folder chosen for it', cfg.modelsDir.length > 0);
    cfg.siteUrl = 'https://x.test/nightshift.php';
    cfg.jobs.reply.on = true;
    cfg.jobs.reply.model = 'qwen.gguf';
    ok('saving works', config.save(cfg, cdir).ok);
    const back = config.load(cdir);
    ok('…and comes back', back.siteUrl === cfg.siteUrl && back.jobs.reply.on === true && back.jobs.reply.model === 'qwen.gguf');
    fs.writeFileSync(path.join(cdir, 'config.json'), '{ not json');
    ok('a corrupt settings file falls back to defaults rather than crashing', config.load(cdir).siteUrl === '');
    fs.writeFileSync(path.join(cdir, 'config.json'), JSON.stringify({ keepAwake: 'yes please', futureThing: 7 }));
    const odd = config.load(cdir);
    ok('a stored value of the wrong TYPE is ignored', odd.keepAwake === true);
    ok('…while an unknown key written by a newer version survives', odd.futureThing === 7);
    fs.rmSync(cdir, { recursive: true, force: true });

    let stored = null;
    const keychain = config.makeSecrets({
        platform: 'darwin',
        run: function (args) {
            if (args[0] === 'add-generic-password') { stored = args[args.indexOf('-w') + 1]; return ''; }
            if (args[0] === 'find-generic-password') {
                if (stored === null) { throw new Error('not found'); }
                return stored + '\n';
            }
            if (args[0] === 'delete-generic-password') { stored = null; return ''; }
            return '';
        },
    });
    ok('with nothing stored, the secret is empty rather than an error', keychain.get() === '');
    ok('…and the state says none is set', keychain.state().set === false);
    ok('storing one works', keychain.set('the-real-secret').ok);
    ok('…and reading it back gives the secret', keychain.get() === 'the-real-secret');
    ok('the state says one is set', keychain.state().set === true);
    ok('…and NEVER what it is', keychain.state().hint.indexOf('real') === -1 && /^•+$/.test(keychain.state().hint));
    ok('clearing works', keychain.clear().ok && keychain.get() === '');
    const refused = config.makeSecrets({
        platform: 'darwin',
        run: function (args) { if (args[0] === 'add-generic-password') { throw new Error('user denied'); } throw new Error('not found'); },
    });
    const res = refused.set('x');
    ok('a Keychain that refuses does NOT fall back to a file', !res.ok && /not saved anywhere/.test(res.say));
    const notMac = config.makeSecrets({ platform: 'linux' });
    ok('off a Mac there is no Keychain and it says so', notMac.available === false && !notMac.set('x').ok);


    // ── THE UPDATER ───────────────────────────────────────────────────────
    // The decisions, which are the half that can be wrong invisibly. Every
    // refusal is here, because the failure mode of an updater is installing
    // something it should not have.
    console.log('\n15) is there a newer version, and may we install it?');
    const rel = (over) => Object.assign({
        tag_name: 'hand-build-20260818-0842',
        assets: [{
            name: 'Cottage-Holidays-Blakeney.dmg',
            browser_download_url: 'https://github.com/x/y/releases/download/t/Cottage-Holidays-Blakeney.dmg',
            size: 178521944,
            digest: 'sha256:a604591483a2953136e667eec978319ebe6989fd413b94159b64829ccff32534',
        }],
    }, over || {});
    const A = 'Cottage-Holidays-Blakeney.dmg';

    ok('a dated build parses', !!update.parseVersion('hand-build-20260818-0842'));
    ok('a semver tag parses', !!update.parseVersion('hand-v1.2.0'));
    ok('nonsense does not', update.parseVersion('latest') === null);
    ok('a later build beats an earlier one',
        update.compareVersions('hand-build-20260818-0842', 'hand-build-20260817-2253') === 1);
    ok('the same build is the same', update.compareVersions('hand-build-20260818-0842', 'hand-build-20260818-0842') === 0);
    ok('an earlier build loses', update.compareVersions('hand-build-20260817-2253', 'hand-build-20260818-0842') === -1);
    ok('same day, later time wins', update.compareVersions('hand-build-20260818-0900', 'hand-build-20260818-0842') === 1);
    // A DATED BUILD OUTRANKS A SEMVER ONE. CI publishes dated tags, so treating
    // 1.0.0 as newer would offer a downgrade for ever.
    ok('a CI build outranks a semver tag', update.compareVersions('hand-build-20260818-0842', 'hand-v1.0.0') === 1);
    ok('an unreadable version compares to nothing', update.compareVersions('latest', 'hand-v1.0.0') === null);

    ok('the same version reports current',
        update.updateVerdict('hand-build-20260818-0842', rel(), A).state === 'current');
    ok('a newer one reports available',
        update.updateVerdict('hand-build-20260817-2253', rel(), A).state === 'available');
    ok('...carrying the url, size and checksum', (function () {
        const v = update.updateVerdict('hand-build-20260817-2253', rel(), A);
        return /^https:/.test(v.url) && v.size === 178521944 && /^[0-9a-f]{64}$/.test(v.sha256);
    })());
    // NO CHECKSUM, NO DOWNLOAD — the whole safety story, since nothing here is
    // code-signed. It is still OFFERED, as a link.
    ok('no checksum means manual, never available',
        update.updateVerdict('hand-build-20260817-2253', rel({ assets: [{ name: A, browser_download_url: 'https://x/y.dmg', size: 1, digest: '' }] }), A).state === 'manual');
    ok('a digest that is not sha256 is treated as absent',
        update.assetSha256({ digest: 'md5:abc' }) === '' && update.assetSha256({ digest: 'sha256:zz' }) === '');
    ok('a release without our asset is unknown, not available',
        update.updateVerdict('hand-build-20260817-2253', rel({ assets: [{ name: 'other.zip', browser_download_url: 'https://x', digest: 'sha256:' + 'a'.repeat(64) }] }), A).state === 'unknown');
    ok('an unreadable tag never reports an update',
        update.updateVerdict('hand-build-20260817-2253', rel({ tag_name: 'latest' }), A).state === 'unknown');
    ok('nothing at all is unknown, and says so', (function () {
        const v = update.updateVerdict('hand-v1.0.0', null, A);
        return v.state === 'unknown' && /couldn't check/i.test(v.say);
    })());
    // EVERY state says something. A verdict with an empty sentence renders as a
    // blank line where an explanation should be.
    ok('every state carries a sentence', (function () {
        const seen = {};
        [
            update.updateVerdict('hand-build-20260818-0842', rel(), A),                       // current
            update.updateVerdict('hand-build-20260817-2253', rel(), A),                       // available
            update.updateVerdict('hand-build-20260817-2253', rel({ assets: [{ name: A, browser_download_url: 'https://x/y.dmg', size: 1, digest: '' }] }), A), // manual
            update.updateVerdict('hand-v1.0.0', null, A),                                     // unknown
        ].forEach(function (v) { seen[v.state] = (v.say || '').length > 0; });
        return ['current', 'available', 'manual', 'unknown'].every(function (s) { return seen[s] === true; });
    })());

    // The IO half's refusals, driven with a fake fetch — no network.
    console.log('\n16) the updater refuses what it cannot trust');
    const feedOf = (body, okStatus) => async function () {
        return { ok: okStatus !== false, status: okStatus === false ? 500 : 200, json: async () => body };
    };
    const u1 = updater.makeUpdater({ fetch: feedOf(rel()), currentVersion: 'hand-build-20260817-2253' });
    const c1 = await u1.check();
    ok('a good feed yields available', c1.ok && c1.state === 'available', JSON.stringify(c1.state));
    const u2 = updater.makeUpdater({ fetch: feedOf(null, false), currentVersion: 'hand-v1.0.0' });
    const c2 = await u2.check();
    ok('a failing feed is unknown, never "up to date"', c2.state === 'unknown' && !/up to date/i.test(c2.say), c2.say);
    const u3 = updater.makeUpdater({ fetch: feedOf(rel()), currentVersion: 'x', feedUrl: 'http://insecure.test/f' });
    ok('a non-https feed is refused', (await u3.check()).state === 'unknown');
    const u4 = updater.makeUpdater({
        fetch: feedOf(rel({ assets: [{ name: A, browser_download_url: 'http://plain.test/a.dmg', size: 1, digest: 'sha256:' + 'a'.repeat(64) }] })),
        currentVersion: 'hand-build-20260817-2253',
    });
    ok('a non-https download address is refused', (await u4.check()).state === 'unknown');
    // download() must not be reachable for a verdict that never earned it.
    const d1 = await u1.download({ state: 'manual', url: 'https://x/y.dmg', sha256: '' });
    ok('download refuses a verdict with no checksum', !d1.ok && /checksum/i.test(d1.say));
    const d2 = await u1.download({ state: 'available', url: 'http://x/y.dmg', sha256: 'a'.repeat(64) });
    ok('download refuses a non-https file', !d2.ok);

    // THE POSITIVE CASE, and the one that matters most: a good file verifies
    // and lands; a tampered one is refused AND DELETED, because a bad download
    // left on disk is a bad download someone can open.
    const crypto = require('crypto');
    const payload = Buffer.from('a pretend disk image');
    const goodSum = crypto.createHash('sha256').update(payload).digest('hex');
    const bodyOf = (buf) => ({
        ok: true, status: 200,
        headers: { get: () => String(buf.length) },
        body: (async function* () { yield buf; })(),
    });
    const upTmp = fs.mkdtempSync(path.join(os.tmpdir(), "chb-upd-"));
    const uD = updater.makeUpdater({ fetch: async () => bodyOf(payload), currentVersion: 'x', tmpDir: upTmp });
    let sawProgress = false;
    const okDl = await uD.download({ state: 'available', url: 'https://x/y.dmg', sha256: goodSum, size: payload.length },
        function () { sawProgress = true; });
    ok('a matching file is accepted', okDl.ok && fs.existsSync(okDl.file), JSON.stringify(okDl.say || ''));
    ok('...and progress was reported while it downloaded', sawProgress);
    ok('...and nothing is left as a .part', !fs.existsSync(okDl.file + '.part'));

    const uB = updater.makeUpdater({ fetch: async () => bodyOf(Buffer.from('tampered')), currentVersion: 'x', tmpDir: upTmp });
    const badDl = await uB.download({ state: 'available', url: 'https://x/y.dmg', sha256: goodSum, size: 8 });
    ok('a file that fails its checksum is refused', !badDl.ok && /checksum/i.test(badDl.say), badDl.say);
    ok('...and is DELETED, not left where it could be opened',
        !fs.existsSync(path.join(upTmp, "Cottage-Holidays-Blakeney.dmg.part")));
    try { fs.rmSync(upTmp, { recursive: true, force: true }); } catch (e) {}

    console.log('\n== Summary ==');
    if (fails) {
        console.log('  ' + fails + ' of ' + (fails + passes) + ' CHECK(S) FAILED ❌\n');
        process.exit(1);
    }
    console.log('  ALL ' + passes + ' CHECKS PASSED ✅\n');
})().catch(function (e) {
    console.error('\nharness error:', e && e.stack ? e.stack : e);
    process.exit(1);
});
