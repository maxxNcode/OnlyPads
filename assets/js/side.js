/* ==========================================================================
   The sidebar: collapse state, and the mobile drawer.
   Loaded BEFORE the stylesheet so a collapsed rail never flashes expanded.
   External rather than inline because the CSP is script-src 'self'.
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'onlypad-side';
  var root = document.documentElement;
  try { if (localStorage.getItem(KEY) === 'min') root.classList.add('side-min'); } catch (e) {}

  function init() {
    var tog = document.getElementById('sideTog');
    var burger = document.getElementById('burger');
    var scrim = document.getElementById('sideScrim');

    function setMin(min) {
      root.classList.toggle('side-min', min);
      try { localStorage.setItem(KEY, min ? 'min' : 'full'); } catch (e) {}
      if (tog) {
        tog.setAttribute('aria-expanded', String(!min));
        tog.setAttribute('aria-label', min ? 'Expand menu' : 'Collapse menu');
      }
    }
    function setOpen(open) {
      root.classList.toggle('side-open', open);
      if (scrim) scrim.hidden = !open;
      if (burger) burger.setAttribute('aria-expanded', String(open));
    }

    if (tog) tog.addEventListener('click', function () { setMin(!root.classList.contains('side-min')); });
    if (burger) burger.addEventListener('click', function () { setOpen(!root.classList.contains('side-open')); });
    if (scrim) scrim.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    /* on mobile the drawer should close once a destination is chosen */
    [].forEach.call(document.querySelectorAll('.side__a'), function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });

    setMin(root.classList.contains('side-min'));
    initSpy();
  }

  /* ==========================================================================
     THE CURRENT-SECTION MARKER — it has to follow the scroll.
     `is-cur` used to be baked in at build time, so on the index page Discover was
     permanently highlighted and clicking Creator (or Fees, Holders, $ONLYPADS,
     FAQ) scrolled correctly but lit up the wrong link. A marker that does not
     move is worse than none: it tells the reader they are somewhere they are not.

     Only same-page hash links are managed. A page-level link like /launched keeps
     the marker it was built with, because the spy has nothing to observe for it.
     ========================================================================== */
  function initSpy() {
    var links = [].slice.call(document.querySelectorAll('.side__a'));
    var map = {};   // '#section' -> { link, el }
    links.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var i = href.indexOf('#');
      if (i === -1) return;                       // a page link, not a section
      var hash = href.slice(i);
      if (hash === '#' || map[hash]) return;
      var el = document.querySelector(hash);
      if (!el) return;                            // the section is not on this page
      map[hash] = { link: a, el: el };
    });
    var ids = Object.keys(map);
    if (!ids.length) return;

    /* ORDER BY DOCUMENT POSITION, not by the order the links happen to sit in the
       sidebar. The two are not the same: the sidebar reads Discover, Creator,
       Fees, but the page is laid out Creator, Fees, Discover. Scanning in link
       order means "the last section above the fold" is decided by a sequence that
       does not exist on the page — land on Discover and the marker jumps to Fees,
       because Fees is simply later in the list. */
    ids.sort(function (a, b) {
      var rel = map[a].el.compareDocumentPosition(map[b].el);
      if (rel & 4) return -1;   // b FOLLOWS a
      if (rel & 2) return 1;    // b PRECEDES a
      return 0;
    });

    var marked = null;

    /* Above the first section nothing has been reached yet. Mark the first link in
       the SIDEBAR, not the first section on the page — the two are not the same
       here (the nav reads Discover, Creator, Fees; the page is laid out Creator,
       Fees, Discover). Landing on the hero with the third nav item lit looks like
       a bug, so the fallback is nav order while the scroll logic is page order. */
    var home = ids[0];
    for (var q = 0; q < links.length; q++) {
      var hq = (links[q].getAttribute('href') || '');
      var iq = hq.indexOf('#');
      if (iq !== -1 && map[hq.slice(iq)]) { home = hq.slice(iq); break; }
    }

    function paint() {
      /* The current section is the LAST one (in document order) whose top has
         passed 40% of the viewport. Using the last rather than the first means a
         tall section keeps the marker while you are reading it, instead of
         handing it back to the one above as soon as its own top scrolls off. */
      var vh = window.innerHeight || root.clientHeight || 0;
      var cut = vh * 0.4;
      var best = null;
      for (var n = 0; n < ids.length; n++) {
        if (map[ids[n]].el.getBoundingClientRect().top <= cut) best = ids[n];
      }
      /* At the very bottom the last section may be too short to ever cross the
         40% line, so it would never light up. Pin it when the page cannot scroll
         any further. */
      var scrolled = window.pageYOffset || root.scrollTop || 0;
      if (vh && scrolled + vh >= root.scrollHeight - 2) best = ids[ids.length - 1];
      if (!best) best = home;
      if (best === marked) return;
      marked = best;
      ids.forEach(function (h) { map[h].link.classList.remove('is-cur'); });
      map[best].link.classList.add('is-cur');
    }

    var queued = false;
    function onScroll() {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
        queued = false;
        paint();
      });
    }

    /* Listen on the WINDOW — that is what actually scrolls, and an element only
       fires `scroll` when that element itself scrolls.
       The bug that made the marker stick was here: the threshold came from
       `root.innerHeight`, and an element has no `innerHeight` (it is a window
       property), so `cut` evaluated to 0. No section ever counted as "passed",
       `best` fell through to the fallback, and the marker sat on Discover
       wherever you went. Measured, not reasoned: putting just that one line back
       makes the marker land one section behind on every jump — with zero console
       errors, which is why it survived so long. */
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('hashchange', onScroll);

    /* Exposed so the audit can assert the marker actually moved, and can see the
       resolved map rather than inferring it from a colour. */
    window.ONLYPAD_SPY = {
      ids: ids.slice(),
      at: function () { return marked; },
      paint: paint
    };

    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
