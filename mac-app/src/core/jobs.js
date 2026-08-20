// ============================================================
//  jobs.js — the work itself.
//
//  One job is implemented: DRAFT ENQUIRY REPLIES. That is deliberate and it is
//  the plan's own order — it is the highest-value job and the honest test of
//  whether any of this earns its keep, so it ships first and alone. The others
//  are declared below with `built: false` so the window can show the shape of
//  the thing without pretending.
//
//  A job's contract is narrow on purpose:
//     run(ctx) → { items: [...], log: [...] }
//  It may read the brief, ask the engine for prose, and return DRAFTS. It may
//  not send, charge, publish or write anything. Everything it returns goes
//  through the site's own validation and lands in a queue the owner reads.
//
//  Every draft passes guard.checkDraft before it is returned. A draft that
//  fails is DROPPED with its reason in the log — never repaired, because
//  repairing it would mean this app writing text of its own.
// ============================================================
'use strict';
const guard = require('./guard');
const { makeRef } = require('./site');

// The registry the Jobs screen renders. `built` is the honest flag; a job that
// is not built cannot be switched on.
const JOBS = [
    {
        id: 'reply',
        name: 'Draft enquiry replies',
        what: 'Reads the enquiries waiting on the site and writes a reply for each, for you to read and send.',
        kind: 'reply',
        schedule: 'nightly',
        built: true,
    },
    {
        id: 'answer',
        name: 'Answer the questions guests keep asking',
        what: 'Turns the questions the site could not answer into answers written from that cottage’s own content.',
        kind: 'answer',
        schedule: 'weekly-sun',
        built: true,
    },
    {
        id: 'week',
        name: 'Read the week',
        what: 'Reads the week ahead — arrivals, departures, gaps, money still to collect — and writes the Monday-morning note.',
        kind: 'note',
        schedule: 'weekly-mon',
        built: true,
    },
    {
        id: 'price',
        name: 'Price the fortnight',
        what: 'Weighs the gaps the site found, at the site’s own suggested prices — the case for each, for you to decide.',
        kind: 'price',
        schedule: 'weekly-mon',
        built: true,
    },
    {
        id: 'teach',
        name: 'Teach the search box',
        what: 'Reads the week’s dead-end searches and works out which of the site’s own questions each one meant — suggestions for you to confirm, never taught by itself.',
        kind: 'teach',
        schedule: 'weekly-sun',
        built: true,
    },
    {
        id: 'voice',
        name: 'Transcribe a walk-round',
        what: 'Turns a voice memo into maintenance items and a shopping list. Needs a speech model, not a chat one — not built.',
        kind: 'note',
        schedule: 'ondemand',
        built: false,
    },
];

function jobById(id) {
    for (let i = 0; i < JOBS.length; i++) {
        if (JOBS[i].id === id) {
            return JOBS[i];
        }
    }
    return null;
}

// The title and sub-line the owner sees on the card. Kept here beside the
// drafting so the words and the work stay together, and short enough that the
// site's own caps are never the thing that truncates them.
function replyTitle(f) {
    return 'Reply to ' + (f.name || 'an enquiry');
}
function replySub(f) {
    const bits = [];
    if (f.cottage) bits.push(f.cottage);
    if (f.check_in) bits.push(spokenRange(f.check_in, f.check_out));
    const party = guard.partyWords(f.adults, f.children);
    if (party) bits.push(party);
    return bits.join(' · ');
}
// "12–19 Oct" / "28 Dec – 3 Jan". Display only; the site owns every real date.
function spokenRange(a, b) {
    const A = parseIso(a);
    const B = parseIso(b);
    if (!A || !B) {
        return '';
    }
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (A.m === B.m) {
        return A.d + '–' + B.d + ' ' + M[A.m];
    }
    return A.d + ' ' + M[A.m] + ' – ' + B.d + ' ' + M[B.m];
}
function parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) {
        return null;
    }
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}

// ── THE REPLY JOB ────────────────────────────────────────────────────────
// ctx: { site, engine, model, host, now, enquiries, onProgress }
async function runReplyJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const enquiries = Array.isArray(c.enquiries) ? c.enquiries : [];
    const day = require('./site').today(c.now);
    const say = function (line, level) {
        log.push({ at: stamp(), say: line, level: level || 'info' });
    };

    // The site names what it WITHHELD — enquiries whose draft the owner
    // already used or binned. Without this line a shorter brief reads as
    // enquiries going missing, and a binned draft's silence looks like a bug.
    const stood = saneNum(c.stoodDown, 0);
    if (!enquiries.length) {
        say(stood > 0
            ? 'nothing to draft — ' + stood + ' stood down (you already dealt with their drafts)'
            : 'nothing waiting — nothing to do');
        return { items: items, log: log };
    }
    say(enquiries.length + ' enquir' + (enquiries.length === 1 ? 'y' : 'ies') + ' waiting'
        + (stood > 0 ? ' · ' + stood + ' stood down — you already dealt with their drafts' : ''));

    const cleaned = saneRows(enquiries, saneEnquiry);
    droppedLine(say, cleaned.dropped);
    for (let i = 0; i < cleaned.rows.length; i++) {
        const f = cleaned.rows[i];
        const who = (f.first || f.name || 'someone');

        // WHAT IS NOT WORTH DRAFTING. Skipping is a first-class outcome and it
        // is logged with its reason — a job that only reports its wins teaches
        // the owner to trust the ones it should have flagged.
        if (!String(f.message || '').trim()) {
            say(who + ' · skipped: no message to answer', 'skip');
            continue;
        }
        // (There was a second skip here for "dates gone and nothing asked". It
        // tested for an EMPTY message, which the branch above has already
        // continued on — so it could never run, and its log line could never
        // appear. Removed rather than guessed at.)

        const facts = Object.assign({}, f, { party: guard.partyWords(f.adults, f.children) });
        const prompt = guard.buildPrompt(facts, c.host, c.voice);
        if (c.onProgress) {
            try { c.onProgress({ i: i, of: cleaned.rows.length, who: who }); } catch (e) { /* display only */ }
        }
        const r = await c.engine.write(prompt, c.model);
        if (!r.ok) {
            say(who + ' · ' + r.say, 'fail');
            continue;
        }

        // THE GUARD. A draft that breaks a rule is dropped, named and not sent
        // anywhere. This is the line the whole app is built to hold.
        const v = guard.checkDraft(r.text, facts);
        if (!v.ok) {
            say(who + ' · refused own draft: ' + v.problems.join('; '), 'fail');
            continue;
        }

        items.push({
            ref: makeRef('reply', f.id, day),
            kind: 'reply',
            title: replyTitle(f),
            sub: replySub(f),
            body: r.text,
            source: sourceLine(f),
            // The screen the owner lands on when they tap Open it. The site
            // validates this against what its own router can open.
            target: f.id ? 'enquiry-' + f.id : '',
        });
        say(who + ' · ' + (f.cottage || '') + ' · drafted in ' + Math.round(r.ms / 100) / 10 + 's'
            + (r.tokensPerSec ? ' · ' + r.tokensPerSec + ' tok/s' : ''), 'hit');
    }
    return { items: items, log: log };
}

// What it was written FROM, in the owner's words. It appears above the draft on
// the card, and it is how approving takes ten seconds instead of two minutes.
function sourceLine(f) {
    const bits = ['their enquiry'];
    if (f.dates_free === true || f.dates_free === false) {
        bits.push('the site’s own calendar');
    }
    if (f.quote) {
        bits.push('the site’s own price');
    }
    if ((f.facts || []).length) {
        bits.push('the ' + (f.cottage || 'cottage') + ' answers');
    }
    return bits.join(', ');
}

// THE REAL CLOCK, not the start time plus a line count.
//
// It was `now + n seconds`, which made the stamps a function of how many lines
// had been written rather than of when anything happened: a run that took
// twenty minutes stamped every line inside the same minute, directly beside a
// "drafted in 4.1s" that contradicted it. `now` is still the record's own
// `started` stamp, which is the one a test pins; these are wall-clock.
function stamp() {
    const d = new Date();
    const p = function (v) { return String(v).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
}

// ── THE WIRE IS NOT TRUSTED ──────────────────────────────────────────────
// site.js checks the CONTAINERS (an array where an array belongs); these
// check the FIELDS, because a field that is not the string the contract
// promises reaches the model — and the owner's Ready-for-you card — as
// "undefined" or "[object Object]": the cottage-name bug's own class, seen
// from this side of the wire ("Array is a lovely cottage" shipped because a
// cast silenced a type error into a plausible word). The site now carries
// the same guard (night_str in nightshift-lib.php); this half survives a
// stale site, a mangled body, or the next bug over there.
// A string stays (trimmed), a finite number becomes one, all else is ''.
function sane(v) {
    if (typeof v === 'string') { return v.trim(); }
    if (typeof v === 'number' && isFinite(v)) { return String(v); }
    return '';
}
function saneNum(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
}
function saneQa(list) {
    return (Array.isArray(list) ? list : []).map(function (f) {
        return { q: sane(f && f.q), a: sane(f && f.a) };
    }).filter(function (f) { return f.q && f.a; });
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
// One shape each. A row that loses its LOAD-BEARING field — a date to speak,
// a question to answer, a figure to quote — returns null and is DROPPED: a
// dated note about an undated arrival is wrong, not incomplete. The drop is
// COUNTED so the run can say so out loud.
function saneArrival(a) {
    const date = sane(a && a.date);
    if (!ISO_DAY.test(date)) { return null; }
    return { first: sane(a.first), cottage: sane(a.cottage), date: date,
        nights: saneNum(a.nights, 0), adults: saneNum(a.adults, 0),
        children: saneNum(a.children, 0), due: sane(a.due) };
}
function saneDeparture(d) {
    const date = sane(d && d.date);
    if (!ISO_DAY.test(date)) { return null; }
    return { first: sane(d.first), cottage: sane(d.cottage), date: date };
}
function saneGap(g) {
    const from = sane(g && g.from);
    const to = sane(g && g.to);
    const rate = sane(g && g.rate);
    const offer = sane(g && g.offer);
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || !rate || !offer) { return null; }
    return { cottage: sane(g.cottage), from: from, to: to,
        nights: saneNum(g.nights, 0), rate: rate, offer: offer };
}
function saneQuestion(q) {
    const text = sane(q && q.q);
    if (!text) { return null; }
    return { q: text, asked: saneNum(q.asked, 1) > 0 ? saneNum(q.asked, 1) : 1,
        prop: sane(q.prop), cottage: sane(q.cottage), facts: saneQa(q.facts) };
}
function saneChat(c2) {
    const t = c2 && typeof c2 === 'object' ? c2 : null;
    if (!t) { return null; }
    const msgs = (Array.isArray(t.msgs) ? t.msgs : []).map(function (m) {
        return { who: (m && m.who) === 'you' ? 'you' : 'guest', text: sane(m && m.text) };
    }).filter(function (m) { return m.text; });
    if (!msgs.length) { return null; } // a conversation with no words drafts nothing
    return { first: sane(t.first), msgs: msgs.slice(-6) };
}

function saneEnquiry(e) {
    const id = saneNum(e && e.id, 0);
    if (id <= 0) { return null; } // no id → no ref → nothing exactly-once can hold
    return { id: id, name: sane(e.name), first: sane(e.first), cottage: sane(e.cottage),
        prop: sane(e.prop), received: sane(e.received),
        check_in: sane(e.check_in), check_out: sane(e.check_out),
        adults: saneNum(e.adults, 0), children: saneNum(e.children, 0),
        message: sane(e.message),
        // true/false/null ONLY — anything else must read as "could not tell",
        // never as a yes (the dates_free rule, held on this side too).
        dates_free: e.dates_free === true ? true : (e.dates_free === false ? false : null),
        nights: saneNum(e.nights, 0) || null,
        quote: sane(e.quote), deposit: sane(e.deposit), facts: saneQa(e.facts) };
}
function saneRows(list, fn) {
    const src = Array.isArray(list) ? list : [];
    const rows = src.map(fn).filter(Boolean);
    return { rows: rows, dropped: src.length - rows.length };
}
// The one sentence for a dropped row, wherever it happens.
function droppedLine(say, n) {
    if (n > 0) {
        say('the site handed over ' + n + ' row' + (n === 1 ? '' : 's') + ' this app could not read — skipped', 'fail');
    }
}


// ── THE WEEK JOB. One note, Monday mornings. ────────────────────────────
// ctx: { engine, model, host, now, week, gaps, onProgress }
async function runWeekJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    // ABSENT is "this site does not hand it over" — an older website. Honest
    // and loud, because a weekly job silently doing nothing is the quiet-Mac
    // failure all over again.
    if (!c.week || typeof c.week !== 'object') {
        say('the site did not hand over the week — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    const wa = saneRows(c.week.arrivals, saneArrival);
    const wd = saneRows(c.week.departures, saneDeparture);
    const wg = saneRows(c.gaps, saneGap);
    droppedLine(say, wa.dropped + wd.dropped + wg.dropped);
    const w = { from: sane(c.week.from), to: sane(c.week.to),
        arrivals: wa.rows, departures: wd.rows, gaps: wg.rows };
    w.arrivals.forEach(function (a) { a.party = guard.partyWords(a.adults, a.children); });
    const day = require('./site').today(c.now);
    const r = await c.engine.write(guard.buildWeekPrompt(w, c.host), c.model);
    if (!r.ok) {
        say('the week note · ' + r.say, 'fail');
        return { items: items, log: log };
    }
    // Every figure the site handed over is fair game and nothing else is.
    const v = guard.checkGeneral(r.text, { money: guard.moneyInFacts(w) });
    if (!v.ok) {
        say('refused own week note: ' + v.problems.join('; '), 'fail');
        return { items: items, log: log };
    }
    const nA = (w.arrivals || []).length;
    const nD = (w.departures || []).length;
    items.push({
        ref: makeRef('note', 'week', day),
        kind: 'note',
        title: 'The week ahead',
        sub: nA + ' arrival' + (nA === 1 ? '' : 's') + ' · ' + nD + ' departure' + (nD === 1 ? '' : 's')
            + (w.gaps.length ? ' · ' + w.gaps.length + ' gap' + (w.gaps.length === 1 ? '' : 's') : ''),
        body: r.text,
        source: 'the site’s own calendar and ledger',
        target: 'view-backoffice',
    });
    say('the week note · drafted in ' + Math.round(r.ms / 100) / 10 + 's', 'hit');
    return { items: items, log: log };
}

// ── THE PRICE JOB. The case for each gap, at the site's own figures. ─────
// ctx: { engine, model, host, now, gaps, onProgress }
async function runPriceJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    if (!Array.isArray(c.gaps)) {
        say('the site did not hand over its gaps — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    const pg = saneRows(c.gaps, saneGap);
    droppedLine(say, pg.dropped);
    if (!pg.rows.length) {
        // A quiet fortnight is a SUCCESS, the same rule as a quiet night —
        // unless every row was dropped as unreadable, which droppedLine has
        // already reported as the failure it is.
        if (!pg.dropped) {
            say('no gaps worth selling — nothing to weigh');
        }
        return { items: items, log: log };
    }
    const gaps = pg.rows;
    const day = require('./site').today(c.now);
    const r = await c.engine.write(guard.buildPricePrompt(gaps, c.host), c.model);
    if (!r.ok) {
        say('the price note · ' + r.say, 'fail');
        return { items: items, log: log };
    }
    const v = guard.checkGeneral(r.text, { money: guard.moneyInFacts(gaps) });
    if (!v.ok) {
        say('refused own price note: ' + v.problems.join('; '), 'fail');
        return { items: items, log: log };
    }
    items.push({
        ref: makeRef('price', 'fortnight', day),
        kind: 'price',
        title: gaps.length === 1 ? 'A gap worth a look' : gaps.length + ' gaps worth a look',
        sub: gaps.map(function (g) { return g.cottage; }).filter(function (v2, i, a) { return a.indexOf(v2) === i; }).join(', '),
        body: r.text,
        source: 'the site’s own calendar and its own rates',
        target: 'settings:pricing',
    });
    say('the price note · ' + gaps.length + ' gap' + (gaps.length === 1 ? '' : 's') + ' weighed in ' + Math.round(r.ms / 100) / 10 + 's', 'hit');
    return { items: items, log: log };
}

// ── THE ANSWER JOB. One drafted FAQ answer per question guests kept asking. ─
// ctx: { engine, model, host, now, questions, onProgress }
async function runAnswerJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    if (!Array.isArray(c.questions)) {
        say('the site did not hand over the guest questions — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    const qs = saneRows(c.questions, saneQuestion);
    droppedLine(say, qs.dropped);
    if (!qs.rows.length) {
        if (!qs.dropped) {
            say('no unanswered guest questions — nothing to do');
        }
        return { items: items, log: log };
    }
    const day = require('./site').today(c.now);
    for (let i = 0; i < qs.rows.length; i++) {
        const q = qs.rows[i];
        const r = await c.engine.write(guard.buildAnswerPrompt(q, c.host), c.model);
        if (!r.ok) {
            say('“' + shortQ(q.q) + '” · ' + r.say, 'fail');
            continue;
        }
        // NO money whitelist here at all: an FAQ answer has no business
        // quoting a figure, so every one is an invention by definition.
        const v = guard.checkGeneral(r.text, { money: [] });
        if (!v.ok) {
            say('refused own answer: ' + v.problems.join('; '), 'fail');
            continue;
        }
        items.push({
            // HASHED, not sliced: makeRef keeps 24 alphanumerics of a wordy id,
            // and two questions sharing their first words ("do you allow dogs
            // in the garden" / "…in the cottage") would collide into ONE ref —
            // the site's exactly-once rule would then silently drop the second
            // answer as a duplicate of the first.
            ref: makeRef('answer', qHash(q.q), day),
            kind: 'answer',
            title: 'An answer for “' + shortQ(q.q) + '”',
            sub: (q.cottage || 'the cottages') + ' · asked ' + (q.asked || 1) + ' time' + ((q.asked || 1) === 1 ? '' : 's'),
            body: r.text,
            source: 'guests’ own questions and the cottage’s published answers',
            // The screen where one tap turns a question into a live FAQ.
            target: 'settings:search-learning',
        });
        say('“' + shortQ(q.q) + '” · answered in ' + Math.round(r.ms / 100) / 10 + 's', 'hit');
    }
    return { items: items, log: log };
}

// ── THE TEACH JOB (search × Mac, rung 4). The week's dead-end searches, ──
// each PLACED on the site's own canonical menu — the intent chooser again,
// at the night's tempo. The item is a SUGGESTION for the owner to confirm on
// Today; nothing here teaches the model, and a phrasing that maps to nothing
// is left alone (a wrong lesson is worse than a missing one). The ref is
// deliberately DAYLESS: one suggestion per phrasing EVER — a used or binned
// row keeps its ref, so the site's exactly-once rule stops the same
// suggestion reappearing night after night.
async function runTeachJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    const t = c.teach;
    if (!t || !Array.isArray(t.misses)) {
        say('the site did not hand over the dead-end searches — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    const opts = (Array.isArray(t.options) ? t.options : []).map(sane).filter(Boolean);
    if (!opts.length) {
        say('the site sent no menu of questions it can answer — nothing to map', 'fail');
        return { items: items, log: log };
    }
    const rows = t.misses
        .map(function (m) { return m && typeof m === 'object' ? { q: sane(m.q), n: saneNum(m.n, 1) } : null; })
        .filter(function (m) { return m && m.q; })
        .slice(0, 10);
    if (!rows.length) {
        say('no dead-end searches this week — nothing to do');
        return { items: items, log: log };
    }
    let none = 0;
    for (let i = 0; i < rows.length; i++) {
        const m = rows[i];
        const r = await c.engine.write(guard.buildIntentPrompt(m.q, opts), c.model);
        if (!r.ok) {
            say('\u201c' + shortQ(m.q) + '\u201d \u00b7 ' + r.say, 'fail');
            continue;
        }
        const picked = guard.checkIntent(r.text, opts);
        if (!picked || picked === 'none') {
            none++;
            continue;
        }
        items.push({
            ref: makeRef('teach', qHash(m.q), ''),
            kind: 'teach',
            // The pair rides title + sub in a FIXED shape the site's Teach-it
            // tap parses and re-validates against its own live menu — a row
            // that drifts from this shape simply loses the one-tap and keeps
            // the ordinary Open path. The title carries the FULL query (the
            // brief caps it at 120): shortQ's ellipsis here would teach a
            // truncated phrasing that never matches what anyone types.
            title: '\u201c' + m.q + '\u201d',
            sub: 'reads as \u201c' + picked + '\u201d',
            body: 'Searched ' + m.n + ' time' + (m.n === 1 ? '' : 's') + ' and nothing answered. Your Mac read it as \u201c' + picked
                + '\u201d \u2014 teach that phrasing and the search box answers it instantly from now on.',
            source: 'the week\u2019s dead-end searches',
            target: 'settings:search-learning',
        });
        say('\u201c' + shortQ(m.q) + '\u201d \u2192 \u201c' + picked + '\u201d', 'hit');
    }
    if (none) {
        say(none + ' didn\u2019t map to anything the site can answer \u2014 left alone', 'skip');
    }
    return { items: items, log: log };
}

// djb2 over the normalised question — deterministic per night per question,
// which is what the exactly-once ref needs, and nothing more.
function qHash(q) {
    const s = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return 'q' + h.toString(16);
}

function shortQ(q) {
    const s = String(q || '').trim();
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

// ── WHICH JOBS RUN TONIGHT. Pure, so the schedule is testable on a pinned ──
// date. `weekly-mon` means the run whose LOCAL day is Monday — the 02:00 run
// into Monday morning, so the note greets the week it describes.
function jobsDueTonight(jobs, cfg, now) {
    const day = (now instanceof Date ? now : new Date()).getDay();
    const due = [];
    const waiting = [];
    (jobs || JOBS).forEach(function (j) {
        const conf = (cfg && cfg.jobs && cfg.jobs[j.id]) || {};
        if (!j.built || !conf.on) {
            return;
        }
        const match = j.schedule === 'nightly'
            || (j.schedule === 'weekly-sun' && day === 0)
            || (j.schedule === 'weekly-mon' && day === 1);
        if (match) {
            due.push({ job: j, model: String(conf.model || '') });
        } else if (j.schedule === 'weekly-sun' || j.schedule === 'weekly-mon') {
            waiting.push({ job: j, until: j.schedule === 'weekly-sun' ? 'Sunday' : 'Monday' });
        }
    });
    return { due: due, waiting: waiting };
}


// ── THE ASK SWEEP — the daytime half. ────────────────────────────────────
// The owner is AT A SCREEN waiting, so everything here is the night's rules
// at a moment's tempo: fetch the open asks, draft each with the SAME prompt
// builders and the SAME guard the nightly jobs use, post the answers back.
// An empty sweep is the ordinary case and returns silently — this runs every
// twenty seconds, and a log line per quiet poll would bury the log.
//
// ctx: { site, engine, cfg, host? , now, ensureEngineFor }
// Returns { answered, failed, log[] } — log lines only for asks that existed.
async function runAskSweep(ctx) {
    const c = ctx || {};
    const log = [];
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    const got = await c.site.asks(c.waitS || 0);
    if (!got.ok) {
        // A refusal is only worth a line when it is NOT the quiet cases a
        // resident poller meets all day (site off, network blip) — those are
        // the caller's to summarise, not to log 4,000 times.
        return { answered: 0, failed: 0, log: log, refusal: got.refusal };
    }
    if (!got.asks.length) {
        return { answered: 0, failed: 0, log: log, warm: !!got.warm };
    }
    const jobs = (c.cfg && c.cfg.jobs) || {};
    let answered = 0;
    let failed = 0;
    let engineModel = '';
    for (let i = 0; i < got.asks.length; i++) {
        const a = got.asks[i] || {};
        const id = saneNum(a.id, 0);
        if (id <= 0) { continue; }
        // THE WEB CHAT — handled whole, before the model pick, because the
        // injected handler IS the local chat's core and owns its own engine
        // and model. `skip` means the owner is mid-send on the Mac itself:
        // the ask stays open and the next sweep (seconds away) takes it.
        if (a.kind === 'ownerchat') {
            const oc = a.ownerchat;
            if (!c.ownerChat || !oc || !Array.isArray(oc.turns) || !oc.turns.length) {
                say('a web-chat ask arrived but this build cannot serve it — skipped', 'fail');
                failed++;
                continue;
            }
            const r = await c.ownerChat(oc, function (partialJson) {
                // Fire-and-forget: a lost partial costs a beat of streaming,
                // never the answer.
                try {
                    const p = c.site.askPartial(id, partialJson);
                    if (p && p.catch) { p.catch(function () {}); }
                } catch (e) { /* the answer still lands */ }
            });
            if (r && r.skip) { continue; }
            if (!r || !r.ok) {
                say('the web chat · ' + ((r && r.say) || 'the reply failed'), 'fail');
                failed++;
                continue;
            }
            const sentW = await c.site.answerAsk(id, r.text, r.model || '');
            if (sentW.ok && sentW.expired) {
                say('the web chat · answered too late — the owner had moved on', 'skip');
                continue;
            }
            if (!sentW.ok) {
                say('the web chat · ' + sentW.refusal.say, 'fail');
                failed++;
                continue;
            }
            say('the web chat · answered while you were out', 'hit');
            answered++;
            continue;
        }
        // THE MODEL FOLLOWS THE KIND: a reply ask uses the reply job's model,
        // an answer ask the answer job's — the owner already chose which
        // model suits which work. Either falls back to the other, because an
        // ask with SOME model beats one refused for configuration.
        const kind = a.kind === 'answer' ? 'answer'
            : a.kind === 'chat' ? 'chat'
            : a.kind === 'intent' ? 'intent'
            : a.kind === 'digest' ? 'digest' : 'reply';
        // A chat reply is reply-shaped work, so it uses the reply job's model.
        // An INTENT mapping is a menu pick — a small-model job at under a
        // second — so it prefers the smallest installed model and leaves the
        // big one for prose. A DIGEST is prose over records, the answer
        // job's shape, so it takes that job's model.
        const modelKind = kind === 'chat' ? 'reply' : kind === 'intent' ? 'reply' : kind === 'digest' ? 'answer' : kind;
        const model = (kind === 'intent' && c.smallModel)
            ? c.smallModel
            : (jobs[modelKind] || {}).model
                || (jobs[modelKind === 'reply' ? 'answer' : 'reply'] || {}).model || '';
        if (!model) {
            say('an ask is waiting but no job has a model chosen — pick one on the Jobs screen', 'fail');
            failed++;
            continue;
        }
        if (engineModel !== model && c.ensureEngineFor) {
            const started = await c.ensureEngineFor(model);
            if (!started || !started.ok) {
                say((started && started.say) || 'the model server did not start', 'fail');
                failed++;
                continue;
            }
            engineModel = model;
        }
        let text = null;
        let who = '';
        if (kind === 'reply') {
            const f = saneEnquiry(a.enquiry);
            if (!f) {
                say('the site handed over an ask this app could not read — skipped', 'fail');
                failed++;
                continue;
            }
            f.party = guard.partyWords(f.adults, f.children);
            who = f.first || f.name || 'an enquiry';
            const r = await c.engine.write(guard.buildPrompt(f, got.host, got.voice), model);
            if (!r.ok) {
                say(who + ' · ' + r.say, 'fail');
                failed++;
                continue;
            }
            const v = guard.checkDraft(r.text, f);
            if (!v.ok) {
                say('refused own draft for ' + who + ': ' + v.problems.join('; '), 'fail');
                failed++;
                continue;
            }
            text = r.text;
        } else if (kind === 'intent') {
            // THE RECOVERY TIER'S MAC HALF. The model CHOOSES from the menu or
            // says none; junk downgrades to 'none' (named in the log) rather
            // than being posted — the site re-checks membership at the door
            // anyway, and a fast honest 'none' beats a timed-out wait.
            const iq = sane(a.intent && a.intent.q);
            const iopts = (a.intent && Array.isArray(a.intent.options) ? a.intent.options : [])
                .map(sane).filter(Boolean);
            if (!iq || !iopts.length) {
                say('the site handed over an ask this app could not read — skipped', 'fail');
                failed++;
                continue;
            }
            who = '\u201c' + shortQ(iq) + '\u201d';
            const r = await c.engine.write(guard.buildIntentPrompt(iq, iopts), model);
            if (!r.ok) {
                say(who + ' \u00b7 ' + r.say, 'fail');
                failed++;
                continue;
            }
            const picked = guard.checkIntent(r.text, iopts);
            if (!picked) {
                say(who + ' \u00b7 the model answered off the menu — sent none instead', 'skip');
            }
            text = picked || 'none';
        } else if (kind === 'digest') {
            // THE ANALYST'S MAC HALF: a summary built ONLY from the records
            // the site's own semantic index matched — checkDigest refuses a
            // figure or a proper noun the records never state, and the site's
            // door re-checks the money against what it stored.
            const dq = sane(a.digest && a.digest.q);
            const drows = (a.digest && Array.isArray(a.digest.rows) ? a.digest.rows : []).map(sane).filter(Boolean);
            if (!dq || !drows.length) {
                say('the site handed over an ask this app could not read — skipped', 'fail');
                failed++;
                continue;
            }
            who = '\u201c' + shortQ(dq) + '\u201d';
            const r = await c.engine.write(guard.buildDigestPrompt(dq, drows), model);
            if (!r.ok) {
                say(who + ' \u00b7 ' + r.say, 'fail');
                failed++;
                continue;
            }
            const v = guard.checkDigest(r.text, drows);
            if (!v.ok) {
                say('refused own summary: ' + v.problems.join('; '), 'fail');
                failed++;
                continue;
            }
            text = r.text;
        } else if (kind === 'chat') {
            const t = saneChat(a.chat);
            if (!t) {
                say('the site handed over an ask this app could not read — skipped', 'fail');
                failed++;
                continue;
            }
            who = t.first ? t.first + '\u2019s chat' : 'a chat';
            const r = await c.engine.write(guard.buildChatPrompt(t, got.host), model);
            if (!r.ok) {
                say(who + ' \u00b7 ' + r.say, 'fail');
                failed++;
                continue;
            }
            // A chat may greet (no template adds one) but may state NO money
            // and NO code-shaped number — the two things a chat reply can do
            // real damage with.
            const v = guard.checkGeneral(r.text, { money: [], allowGreeting: true, noCodes: true });
            if (!v.ok) {
                say('refused own chat reply: ' + v.problems.join('; '), 'fail');
                failed++;
                continue;
            }
            text = r.text;
        } else {
            const q = saneQuestion(a.question);
            if (!q) {
                say('the site handed over an ask this app could not read — skipped', 'fail');
                failed++;
                continue;
            }
            who = '\u201c' + shortQ(q.q) + '\u201d';
            const r = await c.engine.write(guard.buildAnswerPrompt(q, got.host), model);
            if (!r.ok) {
                say(who + ' · ' + r.say, 'fail');
                failed++;
                continue;
            }
            // No money whitelist AT ALL — an FAQ answer quoting a figure is an
            // invention by definition, the answer job's own rule.
            const v = guard.checkGeneral(r.text, { money: [] });
            if (!v.ok) {
                say('refused own answer: ' + v.problems.join('; '), 'fail');
                failed++;
                continue;
            }
            text = r.text;
        }
        const sent = await c.site.answerAsk(id, text, model);
        if (sent.ok && sent.expired) {
            say(who + ' · answered too late — the owner had moved on', 'skip');
            continue;
        }
        if (!sent.ok) {
            say(who + ' · ' + sent.refusal.say, 'fail');
            failed++;
            continue;
        }
        say(who + ' · answered while you waited', 'hit');
        answered++;
    }
    return { answered: answered, failed: failed, log: log };
}

module.exports = {
    JOBS, jobById, jobsDueTonight,
    runReplyJob, runWeekJob, runPriceJob, runAnswerJob, runTeachJob, runAskSweep,
    replyTitle, replySub, spokenRange, sourceLine,
};
