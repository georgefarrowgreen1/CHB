/* ============================================================
   guest-app.js — app-style guest shell behaviour.

   Loaded as a SEPARATE file (the only external script) to keep the
   single-page index.html from growing. It runs AFTER index.html's
   inline script, so it relies on that script's top-level functions
   (nav, openGuestArea, guestAccountTab) which become window globals.
   Every call is guarded, so a missing global is a safe no-op.

   The shell is gated to guests on a phone-sized viewport OR when the
   site is installed; admins are excluded purely by CSS
   (body.guest-app:not(.owner-mode)). Bump ?v= in index.html and the
   CACHE name in sw.js whenever this file changes.
   ============================================================ */
(function () {
    'use strict';

    // Each tab maps to one or more page-views (for the active highlight) and a
    // go() that reuses the page's existing navigation — no new router.
    var TABS = [
        { key: 'home', label: 'Home', views: ['view-main'],
          icon: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
          go: function () { if (window.nav) window.nav('view-main'); } },
        { key: 'cottages', label: 'Cottages', views: ['view-cottages', 'view-21a'],
          icon: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 14h18"/><path d="M7 10V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/>',
          go: function () { if (window.nav) window.nav('view-cottages'); } },
        { key: 'stays', label: 'My Stays', views: ['view-guest-bookings'],
          icon: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
          go: function () { if (window.openGuestArea) window.openGuestArea(); } },
        { key: 'account', label: 'Account', views: [],
          icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
          go: function () { if (window.guestAccountTab) window.guestAccountTab(); else if (window.openGuestArea) window.openGuestArea(); } }
    ];

    function buildBar() {
        if (document.getElementById('guest-tabbar')) return;
        var bar = document.createElement('nav');
        bar.id = 'guest-tabbar';
        bar.setAttribute('aria-label', 'Guest navigation');
        TABS.forEach(function (t) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'gt-btn';
            b.dataset.tab = t.key;
            b.setAttribute('aria-label', t.label);
            b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.icon + '</svg><span>' + t.label + '</span>';
            b.addEventListener('click', function () { try { t.go(); } catch (e) {} });
            bar.appendChild(b);
        });
        document.body.appendChild(bar);

        var chip = document.createElement('div');
        chip.id = 'guest-install-chip';
        chip.innerHTML = '<span class="gic-text">Install the app for faster access &amp; stay notifications.</span>'
            + '<button class="gic-go" type="button">Install</button>'
            + '<button class="gic-x" type="button" aria-label="Dismiss">&times;</button>';
        document.body.appendChild(chip);
        chip.querySelector('.gic-go').addEventListener('click', promptInstall);
        chip.querySelector('.gic-x').addEventListener('click', function () { hideInstallChip(true); });
    }

    // Highlight the tab matching the active page-view. Exposed so index.html's
    // nav() can call it on every navigation (including programmatic ones).
    function setActiveTab(viewId) {
        var bar = document.getElementById('guest-tabbar');
        if (!bar) return;
        var activeKey = null;
        TABS.forEach(function (t) { if (t.views.indexOf(viewId) !== -1) activeKey = t.key; });
        bar.querySelectorAll('.gt-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tab === activeKey);
        });
    }
    window.setActiveTab = setActiveTab;

    // The shell applies for an installed PWA or a phone-sized viewport. Admins
    // are filtered out by CSS, so no auth check is needed here.
    function shellApplies() {
        var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
        var narrow = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        return !!(standalone || narrow);
    }
    function updateShell() {
        document.body.classList.toggle('guest-app', shellApplies());
        try { var av = document.querySelector('.page-view.active'); if (av) setActiveTab(av.id); } catch (e) {}
    }

    // ---- Install prompt (Android/desktop). iOS uses the existing A2HS hint. ----
    var deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        try { if (localStorage.getItem('chb-install-dismissed') === '1') return; } catch (err) {}
        var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        if (!standalone) showInstallChip();
    });
    window.addEventListener('appinstalled', function () { deferredPrompt = null; hideInstallChip(false); });

    function showInstallChip() { var c = document.getElementById('guest-install-chip'); if (c) c.classList.add('show'); }
    function hideInstallChip(remember) {
        var c = document.getElementById('guest-install-chip'); if (c) c.classList.remove('show');
        if (remember) { try { localStorage.setItem('chb-install-dismissed', '1'); } catch (e) {} }
    }
    function promptInstall() {
        if (!deferredPrompt) { hideInstallChip(false); return; }
        deferredPrompt.prompt();
        var p = deferredPrompt.userChoice;
        var done = function () { deferredPrompt = null; hideInstallChip(false); };
        if (p && p.finally) p.finally(done); else done();
    }
    window.promptInstall = promptInstall;

    function init() {
        buildBar();
        updateShell();
        var mqW = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
        if (mqW && mqW.addEventListener) mqW.addEventListener('change', updateShell);
        else window.addEventListener('resize', updateShell);
        var mqD = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
        if (mqD && mqD.addEventListener) mqD.addEventListener('change', updateShell);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
