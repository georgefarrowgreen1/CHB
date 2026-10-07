// /status — the small interactions the public status page offers (the approved
// demo). Same-origin on purpose: the site's CSP carries no 'unsafe-inline' for
// scripts. Everything here is an enhancement; the page reads fully without it.
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // "Checked just now" → "Checked 3 min ago", so a page left open says how old it is.
    var ago = document.getElementById('sp-ago');
    if (ago) {
        var at = parseInt(ago.getAttribute('data-at'), 10) * 1000;
        var tick = function () {
            var m = Math.max(0, Math.round((Date.now() - at) / 60000));
            ago.textContent = m < 1 ? 'Checked just now' : m < 60 ? 'Checked ' + m + ' min ago' : 'Checked over an hour ago';
        };
        tick();
        setInterval(tick, 15000);
    }

    // Check again: say it is checking, then reload — the reload IS the check.
    var again = document.getElementById('sp-again');
    var hero = document.getElementById('sp-hero');
    if (again && hero) {
        again.addEventListener('click', function (e) {
            e.preventDefault();
            hero.classList.add('is-checking');
            var t = document.getElementById('sp-title');
            if (t) t.textContent = 'Checking…';
            if (ago) ago.textContent = 'Checking now';
            var lbl = again.querySelector('span');
            if (lbl) lbl.textContent = 'Checking';
            // Reload THIS address — the same check, whichever URL served it.
            setTimeout(function () { window.location.reload(); }, reduce ? 0 : 450);
        });
    }

    // The healthy percentage counts up from nothing.
    var pct = document.getElementById('sp-pct');
    if (pct && !reduce) {
        var to = parseFloat(pct.getAttribute('data-to')) || 0;
        var dec = String(pct.getAttribute('data-to')).indexOf('.') >= 0 ? 1 : 0;
        var start = 0;
        var step = function (ts) {
            if (!start) start = ts;
            var k = Math.min(1, (ts - start - 500) / 1200);
            if (k < 0) k = 0;
            var e = 1 - Math.pow(1 - k, 3);
            pct.textContent = (to * e).toFixed(dec);
            if (k < 1) requestAnimationFrame(step);
            else pct.textContent = pct.getAttribute('data-to');
        };
        pct.textContent = (0).toFixed(dec);
        requestAnimationFrame(step);
    }

    // Tap a day: it lifts, and the line underneath says what happened.
    var bars = document.getElementById('sp-bars');
    var day = document.getElementById('sp-day');
    if (bars && day) {
        bars.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.bar') : null;
            if (!b) return;
            bars.querySelectorAll('.bar[aria-pressed="true"]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
            b.setAttribute('aria-pressed', 'true');
            var st = b.classList.contains('warn') ? 'warn' : b.classList.contains('none') ? 'none' : 'ok';
            day.className = 'day ' + st;
            day.querySelector('b').textContent = b.getAttribute('data-date');
            day.querySelector('span span').textContent = b.getAttribute('data-word');
            void day.offsetWidth;
            day.classList.add('is-new');
        });
    }
})();
