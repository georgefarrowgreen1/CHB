// ============================================================
//  guard.js — what a draft must pass before it is allowed anywhere near
//  the site. THE most important file in this app.
//
//  The site enforces that a night item cannot send, charge or publish. What
//  the site cannot enforce is whether the WORDS are safe, and there is one
//  class of wrong words that matters more than all the others: a figure or an
//  availability answer the model made up. A drafted reply that quotes the
//  wrong price is worse than no draft at all, because the owner's eye slides
//  over a plausible number.
//
//  So the rule this app is built around: THE BRIEF STATES THE FACTS, THE MODEL
//  ARRANGES THE WORDS. The site hands over its own quote and its own
//  availability answer (nightshift.php's `brief`), the prompt tells the model
//  to use them verbatim, and then this module CHECKS — because a prompt is a
//  request and a check is a rule.
//
//  A draft that fails is not posted, not repaired, and not silently dropped:
//  the night log names it and says which rule it broke. Repairing it would be
//  the app inventing text of its own, which is the thing being guarded against.
//
//  Every function here is pure. test/core-test.js drives all of them.
// ============================================================
'use strict';

// Any money-shaped run of characters: £ then digits, with optional thousands
// separators and pence. Deliberately greedy about what counts as money — a
// false positive costs one draft, a false negative costs a wrong price in a
// guest's inbox.
// Money, in the three unambiguous forms. It was £ ONLY — so a draft that wrote
// "GBP 892.50" or "892.50 pounds" carried a figure the guard never looked at.
//
// A BARE DECIMAL IS DELIBERATELY NOT MATCHED. "440.00" with no marker would
// close the last gap, and it would also refuse a perfectly good reply that
// mentions "10.30am" or "3.00" — dropping good drafts often enough to make the
// job useless. The forms below cannot mean anything but money.
const MONEY_RE = /£\s?\d[\d,]*(?:\.\d{1,2})?|\bGBP\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:pounds|quid)\b/gi;

// Phrases that assert availability. The model may only say these when the
// brief said the dates are free; when the brief did not know, silence is the
// only correct answer and a claim either way is a refusal.
//
// THE FREE PATTERN NEEDS A SUBJECT, and the test suite is why. The first
// version was `\b(is|are|still)\s+(free|available|open)\b`, which refused a
// perfectly good reply about TAKEN dates because it contained "…glad to look at
// what else is open for you" — a vague offer, not a claim, and exactly the
// sentence the prompt asks for in that case. So a claim now has to be ABOUT
// something: the dates, the week, it, or the cottage ("free for the week of…").
// "open" left the list entirely — it is the word that reads as an offer.
const FREE_CLAIM_RE = /\b(?:those|that|the|your|it|its|it's|we)\b[^.!?;]{0,40}?\b(?:is|are|have)\s+(?:still\s+)?(?:free|available)\b|\b(?:free|available)\s+for\s+(?:the\s+)?(?:week|dates?|nights?|\d)/i;
// …and the taken pattern has to tolerate the way people write it: "has already
// BEEN taken" is the commonest phrasing and the first version missed it.
const TAKEN_CLAIM_RE = /\b(?:not\s+available|unavailable|already\s+(?:been\s+)?(?:booked|taken|gone|let)|just\s+(?:been\s+)?(?:taken|gone|booked)|no\s+longer\s+(?:free|available))\b/i;

// Things a reply must never contain because they belong to the app, not to a
// machine writing prose: a link (it cannot know a valid one), an attachment
// promise, or any of the words that mean an action has already happened.
const LINK_RE = /https?:\/\/|\bwww\./i;
const GREETING_RE = /^\s*(?:hi|hey|hello|dear|good\s+(?:morning|afternoon|evening))\b/i;
const DONE_RE = /\b(?:I(?:'ve| have)\s+(?:now\s+)?(?:booked|charged|refunded|cancelled|taken\s+payment)|your\s+card\s+has\s+been\s+charged|payment\s+(?:has\s+been\s+)?taken)\b/i;

// Every distinct money string in a piece of text, normalised so "£ 892.50",
// "£892.50" and "£892.5" compare equal.
function moneyIn(text) {
    const out = [];
    const seen = Object.create(null);
    const s = String(text || '');
    let m;
    MONEY_RE.lastIndex = 0;
    while ((m = MONEY_RE.exec(s)) !== null) {
        const norm = normaliseMoney(m[0]);
        if (norm && !seen[norm]) {
            seen[norm] = 1;
            out.push(norm);
        }
    }
    return out;
}

// "£1,234.5" → "1234.50". Returns '' for anything that will not parse.
function normaliseMoney(str) {
    const n = parseFloat(String(str || '').replace(/gbp|pounds|quid/gi, '').replace(/[£,\s]/g, ''));
    if (!isFinite(n)) {
        return '';
    }
    return n.toFixed(2);
}

// THE CHECK. Returns { ok, problems[] } — problems are sentences, because
// they end up in the night log where the owner reads them.
//
//   draft — what the model produced
//   facts — the brief's own row: { quote, deposit, dates_free, first, cottage }
function checkDraft(draft, facts) {
    const text = String(draft || '');
    const f = facts || {};
    const problems = [];

    if (text.trim().length < 40) {
        problems.push('too short to be a reply');
    }
    if (text.length > 4000) {
        problems.push('far longer than a reply should be');
    }

    // ── MONEY. Only the figures the site handed over may appear. ──
    const allowed = Object.create(null);
    [f.quote, f.deposit].forEach(function (v) {
        const n = normaliseMoney(v);
        if (n) {
            allowed[n] = 1;
        }
    });
    const used = moneyIn(text);
    const invented = used.filter(function (n) { return !allowed[n]; });
    if (invented.length) {
        problems.push('quotes a figure the site did not give it: £' + invented.join(', £'));
    }

    // ── AVAILABILITY. Only what the brief actually knew. ──
    const claimsFree = FREE_CLAIM_RE.test(text);
    const claimsTaken = TAKEN_CLAIM_RE.test(text);
    if (f.dates_free === true && claimsTaken) {
        problems.push('says the dates are taken when the site says they are free');
    }
    if (f.dates_free === false && claimsFree) {
        problems.push('says the dates are free when the site says they are taken');
    }
    if (f.dates_free !== true && f.dates_free !== false && (claimsFree || claimsTaken)) {
        problems.push('makes a claim about availability that the site could not confirm');
    }

    // ── THINGS THAT ARE THE APP'S TO SAY, NOT A MODEL'S. ──
    if (LINK_RE.test(text)) {
        problems.push('contains a link — the app adds those, not the writing');
    }
    if (DONE_RE.test(text)) {
        problems.push('claims something has already been done');
    }

    // ── THE GREETING. The site's own reply template opens with "Hello <name>,"
    // of its own, so a draft that greets as well ships two greetings — which
    // really happened once and reached guests. ──
    // NOT gated on knowing the name. It was `if (f.first && ...)`, so an enquiry
    // that arrived without a first name switched this check OFF — while the
    // site's template still opens with its own "Hello ," regardless. The one
    // case where the guard was disabled is the case where the template's
    // greeting is at its most awkward.
    if (GREETING_RE.test(text)) {
        problems.push('opens with a greeting — the email template adds one');
    }

    return { ok: problems.length === 0, problems: problems };
}

// The prompt. Here rather than in the job so the CONTRACT and the CHECK sit in
// one file and cannot drift: every rule stated to the model below has a
// matching test in checkDraft above, and that pairing is the whole point.
function buildPrompt(f, host) {
    const lines = [];
    lines.push('You are writing on behalf of ' + (host || 'the owner') + ', who lets three holiday cottages in Blakeney, Norfolk.');
    lines.push('Write the BODY of a reply to the enquiry below. Four to six sentences. Warm, plain, unfussy British English. No markdown.');
    lines.push('');
    lines.push('RULES YOU MUST NOT BREAK:');
    lines.push('1. Do NOT open with a greeting. The email template adds "Hello ' + (f.first || 'there') + '," above your words.');
    lines.push('2. Do NOT invent, calculate or alter any figure. The only money you may write is exactly what is listed under FACTS.');
    lines.push('3. Do NOT say anything about whether the dates are available unless FACTS states it.');
    lines.push('4. Do NOT include links, and do NOT say anything has been booked, charged or arranged.');
    lines.push('5. Answer what they actually asked, using the cottage answers under FACTS. If an answer is not there, say you will check rather than guessing.');
    lines.push('6. Do NOT sign off with a name — the template adds it.');
    lines.push('');
    lines.push('FACTS (the only things you may assert):');
    lines.push('- Cottage: ' + (f.cottage || 'the cottage'));
    if (f.check_in && f.check_out) {
        lines.push('- Dates asked for: ' + f.check_in + ' to ' + f.check_out + (f.nights ? ' (' + f.nights + ' nights)' : ''));
    }
    if (f.dates_free === true) {
        lines.push('- Those dates ARE free.');
    } else if (f.dates_free === false) {
        lines.push('- Those dates are NOT free — they have been taken. Say so kindly and offer to look at other dates. Do not name alternatives.');
    } else {
        lines.push('- Availability is unknown. Say nothing at all about whether the dates are free.');
    }
    if (f.quote) {
        lines.push('- Total for the stay: ' + f.quote + '. Write it exactly like that or not at all.');
    } else {
        lines.push('- No price is available. Do not mention money.');
    }
    if (f.deposit) {
        lines.push('- Refundable damages deposit: ' + f.deposit + ', returned after the stay. Mention only if relevant.');
    }
    if (f.party) {
        lines.push('- Party: ' + f.party);
    }
    (f.facts || []).forEach(function (qa) {
        lines.push('- ' + qa.q + ' → ' + qa.a);
    });
    lines.push('');
    lines.push('THEIR ENQUIRY:');
    lines.push(String(f.message || '(no message)'));
    return lines.join('\n');
}

// A party in words, for the prompt and for the item's sub-line.
function partyWords(adults, children) {
    const a = Number(adults) || 0;
    const c = Number(children) || 0;
    const bits = [];
    if (a) bits.push(a + ' adult' + (a === 1 ? '' : 's'));
    if (c) bits.push(c + ' child' + (c === 1 ? '' : 'ren'));
    return bits.join(', ');
}

// ── THE GENERAL CHECK, for the jobs that write NOTES rather than replies ──
// (the week, the prices, an answer). Same spine as checkDraft — length, a
// money whitelist, no links, no done-claims, no greeting — WITHOUT the
// availability rules: those are about an enquiry's dates_free, and a week
// note saying "Jollyboat is free 12–15 Sep" is restating the site's own gap
// list, while an FAQ answer saying "parking is available" is not about the
// calendar at all. Every fact these jobs see came from the site, so money is
// the thing left to whitelist.
function checkGeneral(draft, opts) {
    const text = String(draft || '');
    const o = opts || {};
    const problems = [];
    const min = o.minLen || 40;
    const max = o.maxLen || 4000;
    if (text.trim().length < min) {
        problems.push('too short to be worth reading');
    }
    if (text.length > max) {
        problems.push('far longer than it should be');
    }
    const allowed = Object.create(null);
    (o.money || []).forEach(function (v) {
        const n = normaliseMoney(v);
        if (n) { allowed[n] = 1; }
    });
    const invented = moneyIn(text).filter(function (n) { return !allowed[n]; });
    if (invented.length) {
        problems.push('quotes a figure the site did not give it: £' + invented.join(', £'));
    }
    if (LINK_RE.test(text)) {
        problems.push('contains a link — the app adds those, not the writing');
    }
    if (DONE_RE.test(text)) {
        problems.push('claims something has already been done');
    }
    if (GREETING_RE.test(text)) {
        problems.push('opens with a greeting — a note does not greet');
    }
    return { ok: problems.length === 0, problems: problems };
}

// "Fri 12 Sep", from ISO. Display only, like spokenRange in jobs.js.
function spokenDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) { return String(iso || ''); }
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
}

// Every £ figure a payload hands over, for the whitelist — walked rather than
// listed per job, so a new formatted field cannot be forgotten by the guard.
function moneyInFacts(obj) {
    const out = [];
    (function walk(v) {
        if (typeof v === 'string') {
            moneyIn(v).forEach(function (n) { out.push(n); });
        } else if (Array.isArray(v)) {
            v.forEach(walk);
        } else if (v && typeof v === 'object') {
            Object.keys(v).forEach(function (k) { walk(v[k]); });
        }
    }(obj));
    return out;
}

// ── THE WEEK NOTE'S PROMPT. Contract beside check, as always. ──
function buildWeekPrompt(w, host) {
    const lines = [];
    lines.push('You are writing a short Monday-morning note for ' + (host || 'the owner')
        + ', who lets three holiday cottages in Blakeney, Norfolk. It appears on their own dashboard; no guest sees it.');
    lines.push('Five to eight sentences, plain British English, no markdown, no lists. Read the facts and say what the week holds and what needs doing before it.');
    lines.push('');
    lines.push('RULES YOU MUST NOT BREAK:');
    lines.push('1. Do NOT open with a greeting and do NOT sign off.');
    lines.push('2. The only money you may write is a figure listed below, exactly as written.');
    lines.push('3. Do NOT include links, and do NOT say anything has been booked, charged, sent or arranged.');
    lines.push('4. Only the facts below. If there is little on, say it is a quiet week rather than padding.');
    lines.push('');
    lines.push('FACTS (the only things you may assert):');
    (w.arrivals || []).forEach(function (a) {
        lines.push('- Arriving: ' + a.first + ' at ' + a.cottage + ' on ' + spokenDay(a.date)
            + (a.nights ? ' for ' + a.nights + ' nights' : '')
            + (a.party ? ' (' + a.party + ')' : '')
            + (a.due ? ' — ' + a.due + ' still to collect' : ' — paid up'));
    });
    (w.departures || []).forEach(function (d) {
        lines.push('- Leaving: ' + d.first + ' from ' + d.cottage + ' on ' + spokenDay(d.date));
    });
    (w.gaps || []).forEach(function (g) {
        lines.push('- Free: ' + g.cottage + ' has ' + g.nights + ' free nights ' + spokenDay(g.from) + ' to ' + spokenDay(g.to));
    });
    if (!((w.arrivals || []).length || (w.departures || []).length)) {
        lines.push('- Nothing arrives or leaves this week.');
    }
    return lines.join('\n');
}

// ── THE PRICE NOTE'S PROMPT ──
function buildPricePrompt(gaps, host) {
    const lines = [];
    lines.push('You are writing a short pricing note for ' + (host || 'the owner')
        + ', who lets three holiday cottages in Blakeney, Norfolk. It appears on their own dashboard; no guest sees it.');
    lines.push('One short paragraph per gap below: say the case for offering it at the suggested price, or for leaving it alone. Plain British English, no markdown.');
    lines.push('');
    lines.push('RULES YOU MUST NOT BREAK:');
    lines.push('1. Do NOT open with a greeting and do NOT sign off.');
    lines.push('2. The only money you may write is a figure listed below, exactly as written. Never calculate a new one.');
    lines.push('3. Do NOT include links, and do NOT say any price has been changed — these are suggestions for the owner to weigh.');
    lines.push('');
    lines.push('FACTS (the only things you may assert):');
    (gaps || []).forEach(function (g) {
        lines.push('- ' + g.cottage + ': ' + g.nights + ' free nights, ' + spokenDay(g.from) + ' to ' + spokenDay(g.to)
            + '. Current rate ' + g.rate + ' a night; the site suggests offering ' + g.offer + ' a night.');
    });
    return lines.join('\n');
}

// ── THE ANSWER'S PROMPT ──
function buildAnswerPrompt(q, host) {
    const lines = [];
    lines.push('Guests of ' + (host || 'the owner') + '\'s holiday cottages in Blakeney keep asking a question the website could not answer. Draft the ANSWER that will be added to ' + (q.cottage || 'the cottage') + '\'s page — a guest will read it.');
    lines.push('Two to four sentences, warm plain British English, no markdown.');
    lines.push('');
    lines.push('RULES YOU MUST NOT BREAK:');
    lines.push('1. Answer ONLY from the published answers below. If they do not contain the answer, write exactly what you would need the owner to confirm, phrased as a note to the owner — never guess a fact about the cottage.');
    lines.push('2. Do NOT write any money, any link, or any greeting.');
    lines.push('3. Do NOT say anything about dates or availability.');
    lines.push('');
    lines.push('THE QUESTION (asked ' + (q.asked || 1) + ' time' + ((q.asked || 1) === 1 ? '' : 's') + '): ' + q.q);
    lines.push('');
    lines.push((q.facts || []).length ? 'PUBLISHED ANSWERS for ' + (q.cottage || 'the cottage') + ':' : 'There are NO published answers to draw on.');
    (q.facts || []).forEach(function (f) {
        lines.push('- ' + f.q + ' → ' + f.a);
    });
    return lines.join('\n');
}

module.exports = {
    checkDraft, checkGeneral, buildPrompt, buildWeekPrompt, buildPricePrompt, buildAnswerPrompt,
    moneyIn, moneyInFacts, normaliseMoney, partyWords, spokenDay,
    MONEY_RE, FREE_CLAIM_RE, TAKEN_CLAIM_RE,
};
