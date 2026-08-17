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
const MONEY_RE = /£\s?\d[\d,]*(?:\.\d{1,2})?/g;

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
    const n = parseFloat(String(str || '').replace(/[£,\s]/g, ''));
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
    if (f.first && new RegExp('^\\s*(?:hi|hello|dear|good\\s+(?:morning|afternoon|evening))\\b', 'i').test(text)) {
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

module.exports = {
    checkDraft, buildPrompt, moneyIn, normaliseMoney, partyWords,
    MONEY_RE, FREE_CLAIM_RE, TAKEN_CLAIM_RE,
};
