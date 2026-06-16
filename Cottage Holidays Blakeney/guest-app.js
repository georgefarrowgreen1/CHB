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

    // The guest menu mirrors the admin's floating dock: one centred pill of equal
    // circular icon buttons with a white selection indicator that slides between
    // them. Each button maps to page-view(s) (for the highlight) and a go() that
    // reuses the page's existing navigation — no new router. The crown logo is the
    // Home button; My Stays only shows when signed in; Account is folded in (no
    // separate floating button).
    var DOCK = [
        { key: 'experiences', label: 'Experiences', cls: 'gt-auth',
          icon: '<path d="M12 3l2.1 4.6L19 9l-4 3.3.9 5.1L12 15.9 8.1 17.4 9 12.3 5 9l4.9-1.4z"/>',
          go: function () {
              if (window.toast) window.toast('Experiences — coming soon');
              else alert('Experiences — coming soon');
          } },
        { key: 'cottages', label: 'Cottages', views: ['view-cottages', 'view-21a'],
          icon: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 14h18"/><path d="M7 10V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/>',
          go: function () { if (window.nav) window.nav('view-cottages'); } },
        { key: 'home', crown: true, label: 'Home', views: ['view-main'],
          go: function () { if (window.nav) window.nav('view-main'); } },
        { key: 'stays', cls: 'gt-stays', label: 'My Stays', views: ['view-guest-bookings'],
          icon: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
          go: function () { if (window.openGuestArea) window.openGuestArea(); } },
        { key: 'account', label: 'Account',
          icon: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>',
          go: function () {
              if (window.guestAccountTab) window.guestAccountTab();
              else if (window.openGuestArea) window.openGuestArea();
          } }
    ];

    function makeDockBtn(t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'guest-dock-btn' + (t.cls ? ' ' + t.cls : '') + (t.crown ? ' gt-home' : '');
        b.dataset.tab = t.key;
        b.setAttribute('data-label', t.label);
        b.setAttribute('aria-label', t.label);
        b.title = t.label;
        b.innerHTML = t.crown
            ? '<img src="logo.svg" alt="Home">'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.icon + '</svg>';
        b.addEventListener('click', function () { try { t.go(); } catch (e) {} });
        return b;
    }

    function buildBar() {
        if (document.getElementById('guest-tabbar')) return;
        var wrap = document.createElement('div');
        wrap.id = 'guest-tabbar';
        wrap.setAttribute('role', 'navigation');
        wrap.setAttribute('aria-label', 'Guest navigation');

        var dock = document.createElement('nav');
        dock.className = 'guest-dock';
        // Sliding white selection pill (sized + positioned under .current by JS).
        var ind = document.createElement('span');
        ind.className = 'guest-dock-indicator';
        ind.setAttribute('aria-hidden', 'true');
        dock.appendChild(ind);
        DOCK.forEach(function (t) { dock.appendChild(makeDockBtn(t)); });

        wrap.appendChild(dock);
        document.body.appendChild(wrap);

        // The Home button is the crown <img>; until it loads its width is wrong, so
        // the indicator can land zero-width on the page you first arrive on. Re-place
        // it once the image (and the rest of the page) is ready.
        var crownImg = dock.querySelector('.gt-home img');
        if (crownImg && !crownImg.complete) crownImg.addEventListener('load', moveGuestDockIndicator);
        window.addEventListener('load', moveGuestDockIndicator);

        // Messages sits on its own at the bottom-left — detached from the menu but
        // reusing the exact dock pill + button styling (a one-button dock).
        var msgWrap = document.createElement('div');
        msgWrap.id = 'guest-msg-fab';
        var msgDock = document.createElement('nav');
        msgDock.className = 'guest-dock';
        msgDock.setAttribute('aria-label', 'Messages');
        var msgBtn = document.createElement('button');
        msgBtn.type = 'button';
        msgBtn.className = 'guest-dock-btn';
        msgBtn.setAttribute('data-label', 'Messages');
        msgBtn.setAttribute('aria-label', 'Messages');
        msgBtn.title = 'Messages';
        msgBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v10H9l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>';
        msgBtn.addEventListener('click', function () { if (window.toggleChat) window.toggleChat(); });
        msgDock.appendChild(msgBtn);
        msgWrap.appendChild(msgDock);
        document.body.appendChild(msgWrap);

        var chip = document.createElement('div');
        chip.id = 'guest-install-chip';
        chip.innerHTML = '<span class="gic-text">Install the app for faster access &amp; stay notifications.</span>'
            + '<button class="gic-go" type="button">Install</button>'
            + '<button class="gic-x" type="button" aria-label="Dismiss">&times;</button>';
        document.body.appendChild(chip);
        chip.querySelector('.gic-go').addEventListener('click', promptInstall);
        chip.querySelector('.gic-x').addEventListener('click', function () { hideInstallChip(true); });
    }

    // Slide the white indicator under the current button so it glides between tabs
    // (mirrors moveDockIndicator() for the admin dock). Hidden when no tab matches
    // (e.g. on a modal) or when the dock isn't visible.
    function moveGuestDockIndicator() {
        var dock = document.querySelector('.guest-dock');
        if (!dock) return;
        var ind = dock.querySelector('.guest-dock-indicator');
        if (!ind) return;
        var cur = dock.querySelector('.guest-dock-btn.current');
        if (!cur || cur.offsetParent === null) { ind.classList.remove('show'); return; }
        ind.style.width = cur.offsetWidth + 'px';
        ind.style.height = cur.offsetHeight + 'px';
        ind.style.left = cur.offsetLeft + 'px';
        ind.classList.add('show');
    }

    // Highlight the button matching the active page-view. Exposed so index.html's
    // nav() can call it on every navigation (including programmatic ones).
    // Experiences/Account map to no page-view and never highlight.
    function setActiveTab(viewId) {
        var dock = document.querySelector('.guest-dock');
        if (!dock) return;
        var activeKey = null;
        DOCK.forEach(function (t) {
            if (t.views && t.views.indexOf(viewId) !== -1) activeKey = t.key;
        });
        dock.querySelectorAll('.guest-dock-btn').forEach(function (b) {
            b.classList.toggle('current', b.dataset.tab === activeKey);
        });
        requestAnimationFrame(moveGuestDockIndicator);
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
        // Re-align the sliding indicator after a resize (button sizes change at the
        // dock's breakpoints, and signing in/out adds/removes the My Stays button).
        window.addEventListener('resize', function () {
            clearTimeout(window.__guestDockT);
            window.__guestDockT = setTimeout(moveGuestDockIndicator, 120);
        });
        // Safety net: place the indicator once layout has settled (fonts/images).
        setTimeout(moveGuestDockIndicator, 250);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
