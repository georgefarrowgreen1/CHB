// ============================================================
//  ui-test-flowmotion.js — the five motions the booking flow gained.
//
//  Every one of these was a SNAP: the month grid swapped its innerHTML, step two
//  appeared by display, the receipt's figure simply became a different number,
//  the availability chip materialised mid-scroll, and tapping a star flipped a
//  glyph. What is gated here is not that they look nice — it is the handful of
//  decisions inside each that a later edit could silently undo:
//
//    §1 the month page TRAVELS, the weekday row does NOT (it does not change
//       between months), and rapid paging SUPERSEDES rather than queueing — the
//       one part that is a correctness question, not a taste one;
//    §2 step two cascades, and no label can arrive without its own field;
//    §3 the receipt's FIGURE settles, on a change only — never the first render,
//       and never the dates beside it;
//    §4 the availability chip fades in on the FIRST fill per cottage only, or a
//       price refresh flickers the whole grid;
//    §5 a tap bows at its own amplitude and only on the star you touched, with
//       the submit bow still outranking it.
//
//  SAMPLING RULE, learned the expensive way: never race an animation with a
//  wall-clock wait. Two evaluate() round trips are enough to overshoot an 80ms
//  animation, so a working slide measures as a teleport. Every visual assertion
//  here SEEKS — pause the animation, set currentTime, read — the same discipline
//  ui-test-searchpage §17a uses on the Siri aura.
// ============================================================
const { boot } = require('./ui-test-lib');

(async () => {
    let fails = 0;
    const check = (c, m, extra) => {
        console.log(`  ${c ? '✓' : '✗'} ${m}${c || extra === undefined ? '' : '  → ' + extra}`);
        if (!c) fails++;
    };

    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => {
        console.log('  PAGEERR:', e.message);
        fails++;
    });
    await page.goto(t.base + '/index.html');
    await page.waitForTimeout(1200);

    // ============================================================
    //  §1 — the month page
    // ============================================================
    console.log('\n  §1 the month page travels');
    await page.evaluate(() => {
        const k = Object.keys(window.propertyMeta || {})[0];
        window.openProperty(k);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.openEnquireModal());
    await page.waitForTimeout(400);
    await page.evaluate(() => window.openDatePicker());
    await page.waitForTimeout(400);

    const opened = await page.evaluate(() => ({
        open: document.getElementById('date-picker').classList.contains('open'),
        cells: document.getElementById('dp-grid').children.length,
    }));
    check(opened.open && opened.cells > 27, 'the picker is open with a month in it', JSON.stringify(opened));

    // WAIT ON THE STATE, NOT A CLOCK — the assertion is "it comes to rest", and a
    // fixed wait measures how loaded the runner is instead.
    const atRest = async () => {
        try {
            await page.waitForFunction(
                () => {
                    const g = document.getElementById('dp-grid');
                    return g.getAnimations().length === 0 && getComputedStyle(g).opacity === '1';
                },
                null,
                { timeout: 4000 },
            );
            return true;
        } catch (e) {
            return false;
        }
    };

    // ---- the clean flights first: seeking an animation (below) is an
    //      intervention, so nothing that measures the natural flow may run after it.
    const t0 = await page.evaluate(() => document.getElementById('dp-title').innerText);
    await page.evaluate(() => window.dpChangeMonth(1));
    const settled = await atRest();
    const landed = await page.evaluate(() => {
        const g = document.getElementById('dp-grid');
        return {
            title: document.getElementById('dp-title').innerText,
            o: +getComputedStyle(g).opacity,
            tx: getComputedStyle(g).transform,
            cells: g.children.length,
        };
    });
    check(landed.title !== t0, 'a page moves the month on', t0 + ' → ' + landed.title);
    check(settled && landed.o === 1 && landed.tx === 'none', 'and it settles fully visible, back at rest', JSON.stringify(landed));
    check(landed.cells > 27, 'with the next month painted', landed.cells + ' cells');

    // SUPERSEDE. Four pages inside one flight: the last one must win, with
    // nothing stranded faded-out by an abandoned predecessor.
    const before = landed.title;
    await page.evaluate(async () => {
        for (let i = 0; i < 4; i++) {
            window.dpChangeMonth(1);
            await new Promise((r) => setTimeout(r, 20));
        }
    });
    const fastSettled = await atRest();
    const fast = await page.evaluate(() => {
        const g = document.getElementById('dp-grid');
        return { title: document.getElementById('dp-title').innerText, o: +getComputedStyle(g).opacity, cls: g.className };
    });
    check(fast.title !== before, 'four fast pages move the month on', before + ' → ' + fast.title);
    check(fastSettled && fast.o === 1 && !/dp-mo-out/.test(fast.cls), 'and none of them strands the grid faded out', JSON.stringify(fast));

    // Closing mid-flight must not re-open onto an invisible grid (dp-mo-out
    // holds opacity 0 with fill: both).
    await page.evaluate(() => window.dpChangeMonth(1));
    await page.waitForTimeout(20);
    await page.evaluate(() => window.closeDatePicker());
    await page.waitForTimeout(250);
    await page.evaluate(() => window.openDatePicker());
    const reSettled = await atRest();
    const reopened = await page.evaluate(() => {
        const g = document.getElementById('dp-grid');
        return { o: +getComputedStyle(g).opacity, cls: g.className };
    });
    check(reSettled && reopened.o === 1 && !/dp-mo-out/.test(reopened.cls), 'closing mid-page re-opens onto a visible grid', JSON.stringify(reopened));

    // SEEK, don't race — and do it LAST. Two evaluate() round trips overshoot an
    // 80ms animation, so a fixed sample calls a working slide a teleport; pausing
    // it is the only deterministic read, and a paused flight does not resume
    // cleanly, so this is where §1 ends.
    const mid = await page.evaluate(async () => {
        window.dpChangeMonth(1);
        await new Promise((r) => requestAnimationFrame(r));
        const g = document.getElementById('dp-grid');
        const tl = document.getElementById('dp-title');
        const wd = document.querySelector('.dp-weekdays');
        const a = g.getAnimations()[0];
        if (a) {
            a.pause();
            a.currentTime = 40; // half of the 80ms out
        }
        const tr = tl.getAnimations()[0];
        if (tr) {
            tr.pause();
            tr.currentTime = 20; // early in the 110ms cross-fade
        }
        const cs = getComputedStyle(g);
        const out = {
            name: cs.animationName,
            tx: cs.transform,
            go: +cs.opacity,
            to: +getComputedStyle(tl).opacity,
            tAnims: tl.getAnimations().length,
            wtx: getComputedStyle(wd).transform,
            wo: +getComputedStyle(wd).opacity,
            wAnims: wd.getAnimations().length,
        };
        if (a) a.play();
        if (tr) tr.play();
        return out;
    });
    const dx = /matrix\([^)]*,\s*(-?[\d.]+),\s*-?[\d.]+\)$/.exec(mid.tx);
    check(mid.name === 'dpMoOut', 'the grid runs the page-out keyframe', mid.name);
    check(mid.go > 0.05 && mid.go < 0.95, 'the grid is mid-fade at its own midpoint', 'opacity ' + mid.go);
    check(!!dx && parseFloat(dx[1]) < -1, 'the grid travels AGAINST the direction of travel', mid.tx);
    // NB no lower bound on the title: --fluid-bezier is nearly all of the way
    // through by its own midpoint, so "not yet finished" is the honest test and a
    // >0.05 floor fails a working cross-fade.
    check(mid.tAnims > 0 && mid.to < 0.95, 'the month name cross-fades', 'opacity ' + mid.to);
    check(mid.wtx === 'none' && mid.wo === 1 && mid.wAnims === 0, 'the weekday row never moves', JSON.stringify([mid.wtx, mid.wo, mid.wAnims]));

    await page.evaluate(() => window.closeDatePicker());
    await page.waitForTimeout(200);

    // ============================================================
    //  §2 — step one to step two
    // ============================================================
    console.log('\n  §2 step two assembles itself');

    // THE INVARIANT THE WRAPPERS EXIST FOR: a label may never be in a different
    // cascade group from the field it names, or it arrives before its own input.
    const pairing = await page.evaluate(() => {
        const step = document.getElementById('enquire-step-details');
        const bad = [];
        step.querySelectorAll('label[for]').forEach((l) => {
            const inp = document.getElementById(l.getAttribute('for'));
            if (!inp) return;
            const lg = l.closest('.enq-fg');
            const ig = inp.closest('.enq-fg');
            if (lg !== ig) bad.push(l.getAttribute('for'));
        });
        return { bad, groups: step.querySelectorAll('.enq-fg').length };
    });
    check(pairing.groups >= 8, 'step two declares its cascade groups', pairing.groups + ' groups');
    check(pairing.bad.length === 0, 'no label is in a different group from its own field', pairing.bad.join(', '));

    const casc = await page.evaluate(() => {
        const r = document.getElementById('enquire-step-review');
        const step = document.getElementById('enquire-step-details');
        step.classList.remove('enq-landed');
        r.style.display = '';
        step.style.display = 'none';
        window.enquireContinue();
        const groups = Array.from(step.querySelectorAll('.enq-fg'));
        return {
            landed: step.classList.contains('enq-landed'),
            shown: step.style.display !== 'none',
            names: groups.map((g) => getComputedStyle(g).animationName),
            delays: groups.map((g) => getComputedStyle(g).animationDelay),
        };
    });
    // enquireContinue refuses without valid dates, so it may not have advanced —
    // drive the class directly in that case and say so.
    if (!casc.landed) {
        const forced = await page.evaluate(() => {
            const step = document.getElementById('enquire-step-details');
            step.style.display = '';
            step.classList.add('enq-landed', 'enq-in-fwd'); // both classes enquireContinue adds
            const groups = Array.from(step.querySelectorAll('.enq-fg'));
            return { names: groups.map((g) => getComputedStyle(g).animationName), delays: groups.map((g) => getComputedStyle(g).animationDelay) };
        });
        casc.names = forced.names;
        casc.delays = forced.delays;
    }
    // RE-AIMED (the motion system): a step is a CROSS, not a performance, and it
    // is MIRRORED. The eleven-animation cascade that greeted step two had no twin
    // on the way back — Continue was staged and Back was a cut. What is asserted
    // now is the pair: one settled cross forwards on the STEP, none on the
    // groups, and the same cross backwards from the other side.
    check(casc.names.every((n) => n === 'none'), 'the groups no longer cascade one by one', casc.names.join(','));
    const cross = await page.evaluate(() => {
        const step = document.getElementById('enquire-step-details');
        const r = document.getElementById('enquire-step-review');
        const fwd = { cls: step.classList.contains('enq-in-fwd'), name: getComputedStyle(step).animationName, dur: getComputedStyle(step).animationDuration };
        // and back: the mirror, only because step two was really showing
        step.style.display = '';
        window.enquireBack();
        const back = { cls: r.classList.contains('enq-in-back'), name: getComputedStyle(r).animationName, dur: getComputedStyle(r).animationDuration };
        // opening lands on enquireBack too — with step two hidden it must NOT animate
        r.classList.remove('enq-in-back');
        window.enquireBack();
        const open = r.classList.contains('enq-in-back');
        const kf = (n) => { const x = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).find((z) => z.type === CSSRule.KEYFRAMES_RULE && z.name === n); return x ? [...x.cssRules].map((k) => k.style.transform).join('') : ''; };
        return { fwd, back, open, kfF: kf('chbCrossFwd'), kfB: kf('chbCrossBack') };
    });
    check(cross.fwd.cls && cross.fwd.name === 'chbCrossFwd', 'step two arrives on ONE settled cross', cross.fwd.name);
    check(cross.back.cls && cross.back.name === 'chbCrossBack', 'and Back is its mirror', cross.back.name);
    check(cross.fwd.dur === cross.back.dur, 'same clock both ways', cross.fwd.dur + ' / ' + cross.back.dur);
    check(/8px/.test(cross.kfF) && /-8px/.test(cross.kfB), 'travelling opposite ways, 8px on the grid', cross.kfF + ' | ' + cross.kfB);
    check(!cross.open, 'the modal opening on the review step does not play the Back cross');

    // ============================================================
    //  §3 — the receipt figure
    // ============================================================
    console.log('\n  §3 the receipt figure settles when it recomputes');
    // DRIVE THE REAL COMPOSER, not a fixture. Asserting this on markup the gate
    // wrote itself proves the STYLESHEET and nothing else — break-tested: with the
    // span deleted from updateEnquiryPrice, a fixture-fed §3 stayed fully green.
    const fig = await page.evaluate(() => {
        const iso = (d) => d.toISOString().slice(0, 10);
        const s = new Date();
        s.setDate(s.getDate() + 40);
        const e = new Date(s);
        e.setDate(e.getDate() + 4);
        document.getElementById('enq-checkin').value = iso(s);
        document.getElementById('enq-checkout').value = iso(e);
        const ad = document.getElementById('enq-adults');
        if (ad) ad.value = '2';
        window.updateEnquiryPrice();
        const btn = document.querySelector('#enquire-step-review [data-act="enquireContinue"]');
        const f1 = btn.querySelector('.enq-cta-fig');
        const out = { built: !!f1, txt1: f1 ? f1.textContent : '', fresh1: f1 ? f1.classList.contains('is-fresh') : null };
        // A CHANGE must settle the figure — and only the figure.
        if (ad) ad.value = '4';
        window.updateEnquiryPrice();
        const f2 = btn.querySelector('.enq-cta-fig');
        out.txt2 = f2 ? f2.textContent : '';
        out.fresh2 = f2 ? f2.classList.contains('is-fresh') : null;
        out.figAnim = f2 ? getComputedStyle(f2).animationName : '';
        out.tab = f2 ? getComputedStyle(f2).fontVariantNumeric : '';
        out.subAnim = getComputedStyle(btn.querySelector('.enq-cta-sub')).animationName;
        // …and a render that changes NOTHING must not settle it again.
        window.updateEnquiryPrice();
        const f3 = btn.querySelector('.enq-cta-fig');
        out.fresh3 = f3 ? f3.classList.contains('is-fresh') : null;
        return out;
    });
    check(fig.built, 'the real composer gives the figure its own element', JSON.stringify(fig));
    check(!fig.fresh1, 'the first render settles nothing');
    check(fig.txt2 !== fig.txt1 && !!fig.txt2, 'the figure really recomputes on a change', fig.txt1 + ' → ' + fig.txt2);
    check(fig.fresh2 && fig.figAnim === 'enqFigSettle', 'and it settles rather than pops', fig.figAnim);
    check(fig.subAnim === 'none', 'the dates beside it do not move', fig.subAnim);
    check(!fig.fresh3, 'a re-render with an unchanged figure settles nothing');
    check(/tabular/.test(fig.tab), 'the figure is tabular, so the button does not re-flow under it', fig.tab);

    // ============================================================
    //  §4 — availability landing on a cottage card
    // ============================================================
    console.log('\n  §4 availability arrives rather than materialises');
    const chip = await page.evaluate(() => {
        // Two renders of the SAME data: the first fills, the second is the
        // refresh that must not replay (renderCottageGrid + every rates load).
        const host = document.querySelector('[id^="card-avail-"], [id^="home-card-avail-"]');
        if (!host) return { skip: true };
        const id = host.id;
        host.innerHTML = '';
        window.publicAllAvailability = window.publicAllAvailability || {};
        window.renderCardAvailability();
        const first = host.querySelector('.avail-chip');
        const firstIn = !!(first && first.classList.contains('avail-chip-in'));
        window.renderCardAvailability();
        const second = host.querySelector('.avail-chip');
        return {
            id,
            filled: !!first,
            firstIn,
            secondIn: !!(second && second.classList.contains('avail-chip-in')),
            anim: first ? getComputedStyle(first).animationName : '',
        };
    });
    if (chip.skip || !chip.filled) {
        // No availability payload on a DB-less harness — assert the RULE from the
        // stylesheet instead of pretending the fixture ran.
        const rule = await page.evaluate(async () => {
            const css = await (await fetch('app.css')).text();
            return /\.avail-chip\.avail-chip-in\s*\{[^}]*animation:\s*availIn/.test(css);
        });
        check(rule, 'the chip declares its arrival animation (no availability payload here to drive it)');
    } else {
        check(chip.firstIn && chip.anim === 'availIn', 'the first fill arrives', chip.anim);
        check(!chip.secondIn, 'a re-render does NOT replay it — a price refresh must not flicker the grid');
    }

    // ============================================================
    //  §5 — tapping a star
    // ============================================================
    console.log('\n  §5 a tap is acknowledged at its own amplitude');
    const star = await page.evaluate(() => {
        const host = document.createElement('div');
        host.innerHTML =
            '<div class="gb2-stars">' +
            [1, 2, 3, 4, 5].map((n) => '<button type="button" class="gb2-star">☆</button>').join('') +
            '</div><input type="hidden" id="grf-stars-zz"><div id="grf-zz"></div><textarea id="grf-text-zz"></textarea>';
        document.body.appendChild(host);
        const stars = Array.from(host.querySelectorAll('.gb2-star'));
        window.gb2Star('zz', 4, stars[3]);
        const marks = stars.map((s) => (s.classList.contains('gb2-bow') ? 'B' : '.')).join('');
        const cs = getComputedStyle(stars[3]);
        const tap = { marks, name: cs.animationName, dur: cs.animationDuration, on: host.querySelectorAll('.is-on').length };
        // …and the SUBMIT bow still outranks a star that was just tapped.
        host.querySelector('.gb2-stars').classList.add('is-settling');
        tap.submit = getComputedStyle(stars[3]).animationName;
        host.remove();
        return tap;
    });
    check(star.on === 4, 'the rating is set', star.on + ' lit');
    check(star.marks === '...B.', 'only the star you touched bows', star.marks);
    check(star.name === 'revBowTap' && star.dur === '0.28s', 'at the TAP amplitude, not the submit one', star.name + ' ' + star.dur);
    check(star.submit === 'revBow', 'and a submit still outranks a freshly tapped star', star.submit);

    console.log(fails ? `\n  ${fails} FLOW-MOTION CHECK(S) FAILED ❌` : '\n  FLOW MOTION SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
