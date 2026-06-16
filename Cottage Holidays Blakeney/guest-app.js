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
    // go() that reuses the page's existing navigation — no new router. The bar is
    // laid out in three zones so the crown stays centred regardless of how many
    // icons sit on the right: left { Experiences }, centre { crown=Home },
    // right { Cottages, My Stays(only when signed in) }.
    var TABS = [
        { key: 'experiences', zone: 'left', label: 'Experiences',
          icon: '<path d="M12 3l2.1 4.6L19 9l-4 3.3.9 5.1L12 15.9 8.1 17.4 9 12.3 5 9l4.9-1.4z"/>',
          go: function () {
              if (window.toast) window.toast('Experiences — coming soon');
              else alert('Experiences — coming soon');
          } },
        { key: 'cottages', zone: 'right', label: 'Cottages', views: ['view-cottages', 'view-21a'],
          icon: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 14h18"/><path d="M7 10V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/>',
          go: function () { if (window.nav) window.nav('view-cottages'); } },
        { key: 'stays', zone: 'right', cls: 'gt-stays', label: 'My Stays', views: ['view-guest-bookings'],
          icon: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
          go: function () { if (window.openGuestArea) window.openGuestArea(); } }
    ];

    function makeTabBtn(t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gt-btn' + (t.cls ? ' ' + t.cls : '');
        b.dataset.tab = t.key;
        b.setAttribute('aria-label', t.label);
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.icon + '</svg><span>' + t.label + '</span>';
        b.addEventListener('click', function () { try { t.go(); } catch (e) {} });
        return b;
    }

    function buildBar() {
        if (document.getElementById('guest-tabbar')) return;
        var bar = document.createElement('nav');
        bar.id = 'guest-tabbar';
        bar.setAttribute('aria-label', 'Guest navigation');

        var left = document.createElement('div');
        left.className = 'gt-side gt-left';
        var right = document.createElement('div');
        right.className = 'gt-side gt-right';
        TABS.forEach(function (t) {
            (t.zone === 'left' ? left : right).appendChild(makeTabBtn(t));
        });

        // Centre: the crown logo doubles as the Home button.
        var home = document.createElement('button');
        home.type = 'button';
        home.className = 'gt-home';
        home.dataset.tab = 'home';
        home.setAttribute('aria-label', 'Home');
        home.innerHTML = '<img src="logo.svg" alt="Home">';
        home.addEventListener('click', function () { if (window.nav) window.nav('view-main'); });

        bar.appendChild(left);
        bar.appendChild(home);
        bar.appendChild(right);
        document.body.appendChild(bar);

        // Account moves out of the (now hidden) header into a floating top-right
        // button. Opens account details when signed in, else the sign-in flow.
        var fab = document.createElement('button');
        fab.type = 'button';
        fab.id = 'guest-account-fab';
        fab.setAttribute('aria-label', 'Account');
        fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/></svg>';
        fab.addEventListener('click', function () {
            if (window.guestAccountTab) window.guestAccountTab();
            else if (window.openGuestArea) window.openGuestArea();
        });
        document.body.appendChild(fab);

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
        // The crown (Home) lives outside TABS; map it explicitly. Experiences has
        // no view and never highlights.
        var activeKey = (viewId === 'view-main') ? 'home' : null;
        TABS.forEach(function (t) {
            if (t.views && t.views.indexOf(viewId) !== -1) activeKey = t.key;
        });
        bar.querySelectorAll('[data-tab]').forEach(function (b) {
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
