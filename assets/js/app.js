/* ==========================================================================
   OnlyPads — page behaviour.
   Reads ONLYPAD.math (the real rules) and the live registry through ONLYPAD.api.

   THERE IS NO SIMULATED DATASET ANY MORE. `data.js` is gone from the page: every
   figure rendered here comes from the launch registry or from maths. The stats
   strip, the board, the Creator Escrow panel, the holders leaderboard and the Tip
   Jar all read live state, and show an em dash or an explicit empty state rather
   than a plausible invented number.
   ========================================================================== */
(function (root, doc) {
  'use strict';

  /* A 404 on maths kills the page with a bare TypeError, so fail loudly instead.
     `data` is deliberately NOT required — nothing reads it. */
  if (!root.ONLYPAD || !root.ONLYPAD.math) {
    doc.documentElement.setAttribute('data-boot-error', '1');
    var msg = doc.createElement('p');
    msg.style.cssText = 'padding:24px;font:14px/1.6 system-ui;color:#F5F5F5;background:#0E0E0E';
    msg.textContent = 'The page could not start. Reload it.';
    (doc.body || doc.documentElement).appendChild(msg);
    return;
  }

  var M = root.ONLYPAD.math;
  var CFG = M.CFG;

  /* ---------- helpers ---------- */
  function $(id) { return doc.getElementById(id); }
  function all(sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function monogram(name) { return String(name || '?').trim().charAt(0).toUpperCase(); }
  /* "we do not know" must never render as "we measured zero". */
  function usdOrDash(v) {
    return (v === null || v === undefined || v === '') ? '\u2014' : M.usdShort(v);
  }
  function modeLabel(m) { return m === 'ppv' ? 'PPV' : (m === 'lock' ? 'Lock' : 'Stream'); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function mmss(t) {
    var s = Math.max(0, Math.round(t));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  var LOCK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" ' +
    'height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  var TICK_SVG = '<svg class="oftick" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  var CROWN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M2 6.5l5.2 3.6L12 3l4.8 7.1L22 6.5 20.4 18H3.6L2 6.5z"/></svg>';

  /* ---------- toast ---------- */
  function toast(title, body) {
    var wrap = $('toasts');
    if (!wrap) return;
    var el = doc.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<div class="toast__t"></div><div class="toast__d"></div>';
    el.querySelector('.toast__t').textContent = title;
    el.querySelector('.toast__d').textContent = body;
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 5200);
  }
  var NOT_WIRED = 'Not wired up yet';
  var NOT_WIRED_BODY = 'This needs the pump.fun fee-sharing SDK and a signed transaction. ' +
    'This build has no chain connection, so nothing was created.';

  /* ---------- there is no live activity feed ----------
     A feed was built, then removed on 2026-09-25. It read "Cut paid to @northstar" for
     creators whose Cut is in Creator Escrow: `data.js` picks a random Only per row and
     ignores `verified`, so it claimed payouts the mechanic says cannot have happened.
     That is this project's one copy rule — an UNCLAIMED coin has paid its creator
     NOTHING. A feed may come back, but only if it reads `verified` and says "accrued in
     escrow" for those rows.

     `D.feed` is still generated in `data.js`. Do NOT delete it there: the PRNG is
     consumed in order, so removing the feed loop would reshuffle the whole Sub
     leaderboard. It is unused data on purpose. */

  /* ---------- the three figures ---------- */
  /* ---------- the three figures ---------- */
  /* TRUTH ONLY. Every figure comes from the live registry, never the simulated
     dataset — "12 Onlys launched" when nothing has launched is the same lie as a
     fabricated card, and it sits directly above the board. An empty registry shows
     an em dash, which is the honest reading. */
  function renderStats() {
    var sp = M.splitPct(CFG.SPLIT.CUT);
    setText('feeCut', sp.cut + '%');
    setText('feeTips', sp.tips + '%');
    setText('feePad', sp.pad + '%');
    setText('minHold', CFG.MIN_HOLD);

    var rows = (live.coins || []).filter(function (c) { return !c.isPlatform; });
    function total(key) {
      return rows.reduce(function (a, o) { return a + (Number(o[key]) || 0); }, 0);
    }
    var dash = rows.length ? null : '\u2014';

    var stats = {
      onlys: rows.length,
      mcap: dash || M.usdShort(total('mcap')),
      vol24: dash || M.usdShort(total('vol24')),
      escrow: dash || M.usd(total('escrow'), 0)
    };
    Object.keys(stats).forEach(function (k) {
      var el = doc.querySelector('[data-stat="' + k + '"]');
      if (el) el.textContent = String(stats[k]);
    });
  }

  /* The hero split card. The percentages come from splitPct() — the same call the
     fee section and every card uses — so the maths stays single-source and the
     card can never disagree with the rest of the page. */
  function renderHeroSplit() {
    var sp = M.splitPct(CFG.SPLIT.CUT);
    setText('heroCut', sp.cut + '%');
    setText('heroTips', sp.tips + '%');
    setText('heroPad', sp.pad + '%');
    [['heroSegA', sp.cut], ['heroSegB', sp.tips], ['heroSegC', sp.pad]].forEach(function (s) {
      var el = $(s[0]);
      if (el) el.style.width = s[1] + '%';
    });
  }

  /* ---------- the contract address ----------
     The CA is `$ONLYPADS`'s mint, so it comes from GET /api/config — the real
     source — and not from a constant in a client file that could drift from what
     is actually deployed. Unset means the token is not live, and the chip says so
     rather than showing a plausible address. */
  function caAddress() {
    return (cfg && cfg.platformMint) ? String(cfg.platformMint) : null;
  }
  function caLive() { return !!caAddress(); }

  /* Paint only — no listeners, so it is safe to call again after cfg changes. */
  function paintCA() {
    var chip = $('caChip'), val = $('caValue'), btn = $('caBtn');
    if (!chip || !val) return;
    var live = caLive();
    val.textContent = live ? M.short(caAddress(), 6) : 'To be launched';
    val.classList.toggle('ca__v--pending', !live);
    chip.classList.toggle('is-live', live);
    if (live) chip.setAttribute('title', caAddress());
    else chip.removeAttribute('title');
    if (btn) btn.setAttribute('aria-label', live ? 'Copy contract address' : 'Contract address not live yet');
  }

  function initCA() {
    paintCA();
    var btn = $('caBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var lbl = $('caBtnLabel');
      /* read the address at click time, so a config refresh needs no rebind */
      if (!caLive()) {
        /* The button stays ENABLED before launch and explains itself. A dead disabled
           button reads as a broken page; this reads as "not yet". */
        toast('Not launched yet',
          'There is no contract address yet — $ONLYPADS has not gone live. It will appear here, ' +
          'and this button will copy it, the moment it does.');
        return;
      }
      copyText(caAddress()).then(function () {
        if (lbl) lbl.textContent = 'Copied';
        btn.classList.add('is-done');
        toast('Copied',
          'The contract address is on your clipboard. Always check it against the one pinned on ' +
          'our own channels before you trade.');
        setTimeout(function () {
          if (lbl) lbl.textContent = 'Copy';
          btn.classList.remove('is-done');
        }, 2000);
      }).catch(function () {
        toast('Could not copy', 'Your browser blocked clipboard access. The address is ' + caAddress());
      });
    });
  }

  /* the resolved /api/config, exposed so the audit can exercise the LIVE branch —
     the pending branch is what ships, and an untested path is the one that breaks
     at launch. */
  root.ONLYPAD.paintCA = paintCA;
  root.ONLYPAD.getConfig = function () { return cfg; };

  /* Clipboard with a fallback: the async API needs a secure context and
     file:// does not qualify. */
  function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text);
    }
    /* the clipboard API needs a secure context; this covers file:// and old browsers */
    return new Promise(function (resolve, reject) {
      try {
        var ta = doc.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px;top:0';
        doc.body.appendChild(ta);
        ta.select();
        var ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('execCommand refused'));
      } catch (e) { reject(e); }
    });
  }


  /* ---------- the creator card ----------
     The OnlyFans grammar: cover, avatar overlapping it, identity, the bar, the
     badge and the earned/generated pair, the split, the market figures, the
     locked tile, and an action that never hides.

     The bar is the creator's Cut — earned over generated. That ratio IS the
     launcher's split, so it differs coin to coin and is never faked. Whether the
     money has reached the creator is carried by the badge and the locked tile,
     NOT by shrinking the bar to zero, which just reads as broken. */
  function onlyCard(o) {
    var sp = M.splitPct(o.cut);
    var locked = !o.verified;
    var earned = (o.paid || 0) + (o.escrow || 0);
    var share = o.generated > 0 ? earned / o.generated : sp.cut / 100;

    var pill = '<span class="ofpill' + (locked ? ' ofpill--warn' : '') + '">' +
      CROWN_SVG + (locked ? 'Unclaimed' : 'Verified') + '</span>';

    /* A coin with no Cut yet must not read "Locked — $0.00". Say what it waits for. */
    var lock = locked
      ? '<div class="oflock">' +
          '<div class="oflock__ic">' + LOCK_SVG + '</div>' +
          '<div>' +
            '<div class="oflock__t">' +
              (o.escrow > 0 ? 'Locked \u2014 ' + M.usd(o.escrow, 0) : 'Locked \u2014 nothing yet') +
            '</div>' +
            '<div class="oflock__d">@' + h(o.handle) + ' has not claimed. ' +
              (o.escrow > 0 ? 'It unlocks the moment they verify.'
                            : 'The Cut accrues from the first trade.') +
            '</div>' +
          '</div>' +
        '</div>'
      : '';

    /* The creator's own image where there is one. $ONLYPADS shows the logo because
       it has no coin image — it is not deployed — and a monogram would read as a
       missing asset rather than a deliberate mark. A launched coin with no image
       keeps its monogram, which is honest: nobody gave us one. */
    var avatar = o.isPlatform
      ? '<img class="ofav__logo" src="/brand/onlypad-mark.png" alt="">'
      : (o.image ? '<img src="' + h(o.image) + '" alt="">' : h(monogram(o.name)));

    return '<article class="gcard" ' +
      'data-id="' + h(o.id) + '" data-verified="' + (o.verified ? '1' : '0') + '" ' +
      'data-key="' + h((o.name + ' ' + o.handle + ' ' + o.ticker).toLowerCase()) + '">' +
        '<div class="ofcover">' +
        '<span class="tag tag--' + h(o.mode) + ' ofcover__mode">' +
          h(o.isPlatform ? 'Platform' : modeLabel(o.mode)) + '</span>' +
        '<div class="ofcover__mark">' + h(o.ticker) + '</div>' +
      '</div>' +
      '<div class="gcard__body">' +
        '<div class="ofidrow">' +
          '<div class="ofav">' + avatar + '</div>' +
          '<div class="ofid">' +
            '<div class="ofid__n">' + h(o.name) + (o.verified ? TICK_SVG : '') + '</div>' +
            '<div class="ofid__h">@' + h(o.handle) + '</div>' +
            (o.twitter
              ? '<a class="ofx" href="' + h(o.twitter) + '" target="_blank" rel="noopener noreferrer">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                '<path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.6l-5.2-6.8L5.4 22H2.3l7.6-8.7L1.6 2h6.8l4.7 6.2L18.9 2zm-1.1 18h1.8L7.3 3.8H5.3L17.8 20z"/></svg>' +
                'X</a>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="ofprog"><i style="width:' + (share * 100).toFixed(1) + '%"></i></div>' +
        '<div class="ofmeta">' + pill +
          '<span class="ofamount' + (locked ? ' ofamount--warn' : '') + '">' +
            /* A live coin has no published lifetime figure, so the denominator is
               an em dash rather than a zero that would read as a measurement. */
            M.usd(earned || o.escrow || 0, 0) + '<em>/</em>' +
            (o.generated === null || o.generated === undefined ? '\u2014' : M.usd(o.generated, 0)) +
          '</span>' +
        '</div>' +
        '<div class="ofsub">' +
          '<span>' + (o.subs || 0).toLocaleString('en-US') + ' Subs \u00b7 ' + sp.cut + '% to creator</span>' +
          '<span class="minisplit" aria-hidden="true">' +
            '<i class="a" style="width:' + sp.cut + '%"></i>' +
            '<i class="b" style="width:' + sp.tips + '%"></i>' +
            '<i class="c" style="width:' + sp.pad + '%"></i>' +
          '</span>' +
        '</div>' +
        '<div class="ofmkt">' +
          '<div><b>' + usdOrDash(o.mcap) + '</b><span>Market cap</span></div>' +
          '<div><b>' + usdOrDash(o.vol24) + '</b><span>Volume 24h</span></div>' +
          '<div><b>' + usdOrDash(o.liq) + '</b><span>Liquidity</span></div>' +
        '</div>' +
        lock +
        '<div class="ofaction">' +
          '<button class="btn btn--primary btn--full" type="button" data-sub="' + h(o.ticker) + '">' +
            'Sub to ' + h(o.ticker) + '</button>' +
          '<div class="ofcue">' + (o.creatorVerified === false
            ? 'Listed \u2014 creator not yet confirmed'
            : (locked
              ? 'Locked until they claim'
              : (o.claimable > 0 ? 'Tips from ' + M.usd(o.claimable, 0) : 'No Tips yet'))) + '</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }


  function renderBoard() {
    var grid = $('boardGrid');
    if (!grid) return;
    var input = $('boardSearch');
    var q = (input && input.value || '').trim().toLowerCase();
    var on = doc.querySelector('#boardFilters .is-on');
    var filter = on ? on.getAttribute('data-filter') : 'all';

    /* TRUTH ONLY. The only source is the live registry — there is no simulated
       fallback, because a fabricated row is indistinguishable from a real one. */
    var source = live.coins || [];
    var rows = source.filter(function (o) {
      if (filter === 'verified' && !o.verified) return false;
      if (filter === 'unclaimed' && o.verified) return false;
      if (q && (o.name + ' ' + o.handle + ' ' + o.ticker).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    var html = rows.map(onlyCard).join('');
    if (!rows.length) {
      html = '<div class="empty">' +
        (live.coins
          ? 'No Onlys match that.'
          : (live.source === 'offline'
            ? 'The launch registry could not be reached.'
            : 'Nothing launched yet.')) +
      '</div>';
    }
    grid.innerHTML = html;

    setText('boardMeta', live.coins
      ? rows.length + ' shown \u00b7 every one launched here'
      : 'no launches yet');
  }

  function initBoard() {
    var input = $('boardSearch');
    if (input) input.addEventListener('input', renderBoard);
    var chips = $('boardFilters');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      all('button', chips).forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.add('is-on');
      renderBoard();
    });
  }

  /* ---------- creator escrow ---------- */
  /* Driven by the live registry, not the simulated dataset: this panel claims to
     show money waiting for real creators, so it may only show real coins. */
  function renderEscrow() {
    var unclaimed = (live.coins || []).filter(function (o) { return !o.verified && !o.isPlatform; });
    var total = unclaimed.reduce(function (a, o) { return a + (o.escrow || 0); }, 0);
    var largest = unclaimed.reduce(function (a, o) { return Math.max(a, o.escrow || 0); }, 0);
    setText('escTotal', unclaimed.length ? M.usd(total, 0) : '\u2014');
    setText('escCount', unclaimed.length);
    setText('escLargest', unclaimed.length ? M.usd(largest, 0) : '\u2014');

    var strip = $('escStrip');
    if (!strip) return;
    if (!unclaimed.length) {
      /* PENDING, not empty. An em dash in a panel reads as unfinished; a stated
         pending state reads as deliberate. The distinction is the whole point —
         the escrow system is not live because $ONLYPADS is not deployed yet, and
         that is a fact about the project, not a gap in the page. */
      strip.innerHTML = '<div class="oflocktile">' +
        '<div class="oflocktile__ic">' + LOCK_SVG + '</div>' +
        '<div class="oflocktile__h">Escrow is pending launch</div>' +
        '<div class="oflocktile__v">\u2014</div>' +
        '<div class="oflocktile__s">opens with the first Fan Launch</div>' +
      '</div>';
      return;
    }
    strip.innerHTML = unclaimed.map(function (o) {
      return '<div class="oflocktile">' +
        '<div class="oflocktile__ic">' + LOCK_SVG + '</div>' +
        '<div class="oflocktile__h">@' + h(o.handle) + '</div>' +
        '<div class="oflocktile__v">' + M.usd(o.escrow, 0) + '</div>' +
        '<div class="oflocktile__s">' + h(o.ticker) + ' \u00b7 unclaimed</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- the Sub leaderboard ---------- */
  /* ---------- the Sub leaderboard ----------
     TRUTH ONLY. This used to render 48 invented wallets from the simulated
     dataset — addresses, balances, streaks and claimable amounts, all made up,
     presented as a public leaderboard of real people. There is no holder data
     source yet: `$ONLYPADS` is not deployed and nothing indexes its holders, so
     the honest answer is that there is nothing to show.

     The table fills in when a real source exists. Until then it says so. */
  function renderLeaderboard() {
    var body = $('lbBody');
    if (!body) return;

    var rows = (live.holders || null);
    if (!rows || !rows.length) {
      body.innerHTML = '<div class="lb__msg">' +
        '<b>Pending launch.</b> This leaderboard is built from on-chain $ONLYPADS balances. The token ' +
        'has not been deployed yet, so there is nothing to rank — it opens the moment $ONLYPADS goes ' +
        'live. It stays empty rather than showing invented wallets.' +
      '</div>';
      setText('lbMeta', 'opens at launch');
      return;
    }

    body.innerHTML = rows.map(function (row) {
      var tier = M.tierOf(row.days, row.neverSold).tier;
      var mult = M.multiplier(row.days, row.neverSold);
      return '<div class="lb__row' + (row.eligible ? '' : ' is-out') + '">' +
        '<span class="lb__r">' + row.rank + '</span>' +
        '<span class="lb__w">' + h(M.short(row.address, 4)) + '</span>' +
        '<span class="lb__t">' + h(tier) + ' \u00b7 ' + mult.toFixed(2) + '\u00d7</span>' +
        '<span class="lb__n ta-r">' + Math.round(row.balance).toLocaleString('en-US') + '</span>' +
        '<span class="lb__n ta-r">' + row.streak + '</span>' +
        '<span class="lb__n ta-r">' + Math.round(row.weight).toLocaleString('en-US') + '</span>' +
        '<span class="lb__c ta-r ' + (row.eligible ? 'lb__c--on' : 'lb__c--off') + '">' +
          (row.eligible ? M.usd(row.claimable, 2) : 'not eligible') + '</span>' +
      '</div>';
    }).join('');

    var eligible = rows.filter(function (r) { return r.eligible; }).length;
    setText('lbMeta', rows.length + ' wallets \u00b7 ' + eligible + ' eligible \u00b7 ' +
      (rows.length - eligible) + ' under the ' + CFG.MIN_HOLD + ' $ONLYPADS floor');
  }

  /* ---------- Proof of Sub ladder ---------- */
  function renderTiers() {
    var wrap = $('tierList');
    if (!wrap) return;
    var cards = M.CURVE.map(function (k, i) {
      var top = i === M.CURVE.length - 1;
      return '<div class="tier' + (top ? ' tier--top' : '') + '">' +
        '<div class="tier__m">' + k.m.toFixed(1) + '\u00d7</div>' +
        '<div class="tier__t">' + h(k.tier) + '</div>' +
        '<div class="tier__s">' + h(k.sub) + '</div>' +
        '<div class="tier__d">day ' + k.d + '</div>' +
      '</div>';
    });
    cards.push('<div class="tier tier--top">' +
      '<div class="tier__m">' + M.UNBROKEN.toFixed(1) + '\u00d7</div>' +
      '<div class="tier__t">Unbroken</div>' +
      '<div class="tier__s">held since launch, never sold</div>' +
      '<div class="tier__d">any day</div>' +
    '</div>');
    wrap.innerHTML = cards.join('');
  }

  /* ---------- the Tip Jar and the Drop clock ----------
     HALF REAL, HALF NOT, AND THE SPLIT MATTERS.

     The Drop index is REAL: it is `floor(now / 900)` on the wall clock, so the
     countdown and the Drop number are a genuine function of the time and are the
     same for everyone. Nothing is stored and nothing is invented.

     The MONEY is not. Nothing funds the Tip Jar — there is no buyback, no crank,
     and `$ONLYPADS` is not deployed — so the pot, the burned supply and the
     market cap have no source at all. They show an em dash rather than the
     simulated dataset's invented pot, which read exactly like a real balance. */
  function platformRow() {
    var rows = live.coins || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].isPlatform) return rows[i];
    return null;
  }

  var dropBase = null;
  function renderJar() {
    var left = M.secsLeftInDrop();
    setText('jarClock', mmss(left));
    var bar = $('jarBar');
    if (bar) bar.style.width = (M.dropProgress() * 100).toFixed(1) + '%';

    var idx = M.dropIndex();
    if (dropBase === null) dropBase = idx;
    var open = Math.min(CFG.MAX_STACK, idx - dropBase);

    var p = platformRow();
    var launched = !!(p && p.mint);
    var dash = '\u2014';

    setText('jarSub', 'Drop #' + idx + ' \u00b7 ' + open + ' of ' + CFG.MAX_STACK +
      ' stacking \u00b7 15-minute epochs, aligned to the clock');
    setText('jarPot', dash);
    setText('jarDrops', open + ' of ' + CFG.MAX_STACK);
    setText('jarBurned', dash);
    setText('jarMcap', launched ? M.usdShort(p.mcap || 0) : dash);
    setText('jarSplit', (CFG.BURN_SPLIT * 100) + '% burn / ' + ((1 - CFG.BURN_SPLIT) * 100) + '% Tip Jar');
  }

  /* ---------- reveal ----------
     ONE observer, created once. The previous build built a fresh observer per
     call and re-ran it on every search keystroke, which leaked an observer per
     letter. The sweep is the safety net for a jump scroll (a nav anchor) that
     moves an element past the viewport between frames, where it would otherwise
     sit at opacity 0 forever. */
  var io = null;
  var RV = '.sec-head, .flow, .steps, .ofpanel, .lb, .tiers, .jar';
  function reveal() {
    var els = all(RV);
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -6% 0px' });
    }
    els.forEach(function (el) { if (!el.classList.contains('is-in')) io.observe(el); });
  }
  function sweep() {
    all(RV + ':not(.is-in)').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < (root.innerHeight || 0) && r.bottom > 0) el.classList.add('is-in');
    });
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    (root.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      ticking = false;
      sweep();
    });
  }

  /* ---------- theme ----------
     Dark is the default and lives in :root, so the attribute is only ever meaningful
     as "light". The pre-paint script in index.html has already applied any saved
     choice; this handles the toggle and keeps the accessible label in step. */
  /* ==========================================================================
     LIVE DATA
     The board reads /api/coins, which is backed by the onlypad_coins table. When
     that answers with real launched coins the board is LIVE; when the API is
     unreachable, or the registry is genuinely empty, the page falls back to the
     simulated dataset and SAYS SO on the board bar.

     "Realtime" here means polling, which is what the reference implementation
     does — there is no websocket and no need for one at this size. 15s is short
     enough that a launch appears while you are still looking at the page.

     The distinction the page must never lose: a fabricated row is
     indistinguishable from a real one to a reader, so the source is always named.
     ========================================================================== */
  var LIVE_MS = 15000;
  var live = { coins: null, at: null, source: 'demo' };

  /**
   * Map an /api/coins row onto the shape the card renders.
   *
   * `generated` comes back null on purpose. The API records that a coin EXISTS;
   * it does not publish a lifetime figure, and inventing a denominator would turn
   * the bar into a decoration instead of a measurement. The bar is therefore
   * drawn from the launcher's own split, which is exactly what that ratio means.
   */
  function fromApi(c) {
    return {
      demo: false,
      id: c.id,
      handle: c.handle || (c.ticker || '').replace(/^\$/, '').toLowerCase(),
      // The X profile the launcher supplied, shown on every launched coin.
      twitter: c.twitter || null,
      // The coin's own image. Null for a coin whose launcher gave none, and for
      // $ONLYPADS, which is not deployed — the card falls back to the logo there.
      image: c.image || null,
      isPlatform: !!c.isPlatform,
      name: c.name,
      ticker: c.ticker,
      verified: !!c.verified,
      // Absent means "confirmed" so the simulated dataset is unaffected; only an
      // explicit false — the index was unreachable — shows the unconfirmed cue.
      creatorVerified: c.creatorVerified !== false,
      mode: c.mode || 'stream',
      cut: typeof c.cutPct === 'number' ? c.cutPct : CFG.SPLIT.CUT,
      generated: null,
      paid: null,
      escrow: c.verified ? 0 : (c.escrow || 0),
      claimable: 0,
      mcap: c.marketCap || 0,
      vol24: c.volume24h === null || c.volume24h === undefined ? null : c.volume24h,
      liq: c.liquidity || 0,
      subs: c.subs || c.holders || 0,
      mint: c.mint,
      live: true
    };
  }

  function setSource(kind, text) {
    var line = $('srcLine'), t = $('srcText');
    if (!line || !t) return;
    line.classList.toggle('is-live', kind === 'live');
    line.classList.toggle('is-offline', kind === 'offline');
    t.textContent = text;
  }

  function loadLive() {
    var api = root.ONLYPAD && root.ONLYPAD.api;
    if (!api || typeof api.coins !== 'function') {
      setSource('offline', 'API not loaded \u2014 showing simulated data');
      return Promise.resolve();
    }
    return api.coins({ limit: 60 }).then(function (r) {
      if (!r || !r.ok) {
        live.coins = null;
        live.source = 'offline';
        setSource('offline', 'Launch registry unreachable');
        renderBoard();
        return;
      }
      /*
       * THE PLATFORM ROW COMES BACK FIRST from /api/coins, and that is what pins
       * $ONLYPADS to position 1. It is neither filtered out nor re-added here —
       * one source of ordering, so the pin cannot disagree with itself.
       *
       * There is deliberately NO simulated fallback. This board lists coins that
       * were really created here, and a fabricated row is indistinguishable from
       * a real one to anyone reading the page.
       */
      var list = r.coins || [];
      if (!list.length) {
        live.coins = null;
        live.source = 'empty';
        setSource('empty', 'Nothing launched yet');
        renderBoard();
        return;
      }
      live.coins = list.map(fromApi);
      live.source = 'db';
      live.at = Date.now();
      var launched = list.filter(function (c) { return !c.isPlatform; }).length;
      setSource('live', launched ? 'LIVE \u00b7 ' + launched + ' launched' : 'LIVE \u00b7 nothing launched yet');
      renderBoard();
      /* the figures and the escrow panel are derived from the same list */
      renderStats();
      renderEscrow();
    }).catch(function () {
      live.coins = null;
      live.source = 'offline';
      setSource('offline', 'Launch registry unreachable');
      renderBoard();
    });
  }

  /* ==========================================================================
     LAUNCH
     The one path that has to actually work.

     Everything that could waste a wallet signature is checked BEFORE the first
     prompt. A missing fee wallet or RPC would otherwise surface as a raw SDK
     error after the user had already approved a transaction — and a signature
     spent on a launch that was never going to succeed is the worst outcome here,
     because it costs real SOL.

     The order is fixed: config → validation → image → SDK → sign → record. The
     coin exists on chain after the SDK call, so recording is deliberately last
     and its failure is reported as "live but not listed", never as a failed
     launch.
     ========================================================================== */
  var cfg = null;     // GET /api/config
  var core = null;    // the vendored launch SDK, loaded on demand

  function loadCfg() {
    var api = root.ONLYPAD && root.ONLYPAD.api;
    if (!api || typeof api.config !== 'function') return Promise.resolve(null);
    return api.config().then(function (r) {
      cfg = r && r.ok ? r : null;
      return cfg;
    }).catch(function () { return null; });
  }

  function loadCore() {
    if (core) return Promise.resolve(core);
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = 'assets/js/vendor/onlypad-launch.js';
      s.onload = function () {
        core = root.ONLYPADLaunch;
        if (core && core.ready) resolve(core);
        else reject(new Error('The launcher loaded but did not register itself.'));
      };
      s.onerror = function () { reject(new Error('The launcher could not be loaded.')); };
      doc.head.appendChild(s);
    });
  }

  function openModal(open) {
    var m = $('launchModal');
    if (!m) return;
    m.hidden = !open;
    doc.body.style.overflow = open ? 'hidden' : '';
  }

  function step(which) {
    ['wizConnect', 'wizForm', 'wizStatus'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = (id !== which);
    });
  }

  function say(html) { var el = $('wizSay'); if (el) el.innerHTML = html; }

  function paintWallet() {
    var w = root.ONLYPAD && root.ONLYPAD.wallet;
    var btn = $('walletBtn'), lbl = $('walletLabel');
    if (!btn || !w) return;
    var on = w.connected();
    btn.classList.toggle('is-on', on);
    if (lbl) lbl.textContent = on ? w.short(w.address()) : 'Connect wallet';
    btn.title = on ? w.address() : 'Connect a Solana wallet';
  }

  /* An image is not optional: pump.fun needs one, and the metadata URI that
     points at it is written on chain and cannot be corrected afterwards. */
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Add an image \u2014 pump.fun requires one.'));
      if (file.size > 4 * 1024 * 1024) return reject(new Error('That image is over 4 MB. Use a smaller one.'));
      var fr = new FileReader();
      fr.onload = function () {
        resolve({ dataUrl: fr.result, filename: file.name, contentType: file.type || 'image/png' });
      };
      fr.onerror = function () { reject(new Error('That image could not be read.')); };
      fr.readAsDataURL(file);
    });
  }

  function doLaunch(ev) {
    if (ev) ev.preventDefault();
    var w = root.ONLYPAD && root.ONLYPAD.wallet;
    var warn = $('wizWarn'), go = $('wizGo');
    function bad(msg) { if (warn) warn.textContent = msg; }
    bad('');

    if (!w || !w.connected()) return bad('Connect a wallet first.');

    var handle = ($('fHandle').value || '').trim().replace(/^@/, '');
    var name = ($('fName').value || '').trim();
    var ticker = ($('fTicker').value || '').trim().replace(/^\$/, '');
    var desc = ($('fDesc').value || '').trim();
    var xUrl = ($('fX').value || '').trim();
    var cutPct = Number($('fCut').value) / 100;
    var bid = Number($('fBid').value) || 0;

    if (!handle) return bad('Give the creator handle \u2014 it is the @name this coin pays.');
    if (!name) return bad('Give the coin a name.');
    if (!ticker) return bad('Give the coin a ticker.');
    if (!/^[A-Za-z0-9]{1,10}$/.test(ticker)) return bad('A ticker is 1\u201310 letters or numbers, with no $.');
    if (!cfg || !cfg.feeWallet) return bad('The launch configuration has not loaded. Reload the page and try again.');
    if (!cfg.rpcUrl) return bad('No Solana RPC is configured, so a transaction cannot be built.');
    if (!(cutPct >= 0.4 && cutPct <= 0.8)) return bad('The Cut must be between 40% and 80%.');
    if (!(bid >= 0)) return bad('The starting bid cannot be negative.');
    /* The X link is displayed on every launched coin, so it is checked here rather
       than stored as whatever was typed. A profile URL, not a bare handle. */
    if (xUrl && !/^https?:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/i.test(xUrl)) {
      return bad('That does not look like an X profile link. Use https://x.com/yourname.');
    }

    if (go) go.disabled = true;
    step('wizStatus');
    say('Reading the image\u2026');

    readImage(($('fImg').files || [])[0])
      .then(function (img) {
        say('Loading the launcher\u2026');
        return loadCore().then(function (c) { return { c: c, img: img }; });
      })
      .then(function (o) {
        if (!o.c.isValidAddress(cfg.feeWallet)) {
          throw new Error('The configured fee wallet is not a valid Solana address, so a launch would be rejected.');
        }
        say(bid > 0
          ? 'Approve the <b>' + bid + ' SOL</b> starting bid in your wallet\u2026'
          : 'Approve the coin creation in your wallet\u2026');
        return o.c.launch({
          rpcUrl: cfg.rpcUrl,
          pinUrl: '/api/pin',
          siteUrl: cfg.siteUrl || location.origin,
          feeWallet: cfg.feeWallet,
          name: name,
          symbol: ticker,
          description: desc,
          twitter: '',
          imageUpload: o.img,
          startingBidSol: bid
        });
      })
      .then(function (r) {
        /* The coin EXISTS now. Everything past this point is bookkeeping, and a
           failure here must never be reported as a failed launch. */
        say('Live on pump.fun. Adding it to the board\u2026');
        var api = root.ONLYPAD.api;
        if (!api || typeof api.recordLaunch !== 'function') return { r: r, rec: null };
        return api.recordLaunch({
          wallet: w.address(),
          mint: r.mint,
          name: name,
          ticker: ticker,
          description: desc,
          creatorHandle: handle,
          twitter: xUrl || null,
          imageUrl: r.metadata ? r.metadata.image : null,
          metadataUri: r.uri,
          txSignature: r.signature,
          mode: 'stream',
          cutPct: cutPct,
          startingBidSol: bid
        }).then(function (rec) { return { r: r, rec: rec }; });
      })
      .then(function (o) {
        var ok = !!(o.rec && o.rec.ok);
        var done = $('wizDone'), msg = $('wizDoneMsg'), link = $('wizPump');
        if (msg) {
          msg.textContent = ok
            ? '$' + ticker + ' is live and listed on the board.'
            : '$' + ticker + ' is live on pump.fun, but it could not be added to the board. ' +
              'Nothing is lost \u2014 the coin exists.';
        }
        if (link) link.href = 'https://pump.fun/coin/' + o.r.mint;
        if (done) done.hidden = false;
        say(ok ? 'Done.' : 'Live, but not listed.');
        toast(ok ? 'Launched' : 'Live, but not listed',
          ok ? '$' + ticker + ' is trading on pump.fun.'
             : 'It exists on chain. Reload the page to retry the listing.');
        loadLive();
      })
      .catch(function (e) {
        step('wizForm');
        if (go) go.disabled = false;
        bad((e && e.message) || 'The launch did not complete.');
      });
  }

  function initLaunch() {
    var modal = $('launchModal');
    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) openModal(false);
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) openModal(false);
    });

    var cut = $('fCut'), out = $('cutOut');
    if (cut && out) {
      cut.addEventListener('input', function () { out.textContent = cut.value + '%'; });
    }

    var form = $('wizForm');
    if (form) form.addEventListener('submit', doLaunch);

    var cbtn = $('wizConnectBtn');
    if (cbtn) cbtn.addEventListener('click', function () {
      var w = root.ONLYPAD.wallet;
      if (!w) return;
      if (!w.available()) {
        var hint = $('wizConnectHint');
        if (hint) hint.textContent = 'No Solana wallet found in this browser. Install Phantom, Solflare or Backpack.';
        return;
      }
      cbtn.disabled = true;
      w.connect().then(function () {
        paintWallet();
        step('wizForm');
      }).catch(function (e) {
        var hint = $('wizConnectHint');
        if (hint) hint.textContent = (e && e.message) || 'The connection was cancelled.';
      }).then(function () { cbtn.disabled = false; });
    });

    var wbtn = $('walletBtn');
    if (wbtn) wbtn.addEventListener('click', function () {
      var w = root.ONLYPAD.wallet;
      if (!w) return;
      if (w.connected()) { w.disconnect(); paintWallet(); return; }
      openModal(true);
      step('wizConnect');
    });

    // a wallet that connects from its own UI, or is already connected on load
    var w = root.ONLYPAD.wallet;
    if (w && typeof w.on === 'function') w.on(function () { paintWallet(); });
    paintWallet();
  }

  /* ==========================================================================
     THE CREATOR SHORTLIST
     Ten nominees, one winner. The list lives in assets/js/candidates.js and ships
     with EMPTY slots on purpose: a real creator's handle cannot be published as a
     candidate for a payout they have not accepted. Filling a handle in flips that
     tile from "To be confirmed" to a real nominee with no code change, and setting
     `status: 'announced'` + `winner` switches the whole section to the announced
     state.
     ========================================================================== */
  function renderCandidates() {
    var grid = $('candGrid');
    if (!grid) return;
    var C = root.ONLYPAD && root.ONLYPAD.candidates;
    if (!C || !Array.isArray(C.nominees)) return;

    var done = C.status === 'announced' && !!C.winner;

    grid.innerHTML = C.nominees.map(function (n, i) {
      var num = ('0' + (i + 1)).slice(-2);
      var named = !!(n && n.handle);
      var isWin = done && named && n.handle === C.winner;
      var label = named ? (n.name || '@' + n.handle) : 'To be confirmed';
      var sub = named ? (n.audience || n.note || '') : 'Awaiting confirmation';
      return '<div class="cand__tile' + (named ? '' : ' is-tbc') + (isWin ? ' is-win' : '') + '">' +
        '<div class="cand__n">' + num + '</div>' +
        '<div class="cand__av">' +
          (named ? h(String(n.name || n.handle).trim().charAt(0).toUpperCase()) : '?') +
        '</div>' +
        '<div class="cand__h">' + h(label) + '</div>' +
        '<div class="cand__s">' + h(sub) + '</div>' +
      '</div>';
    }).join('');

    var foot = $('candFoot'), txt = $('candFootText'), title = $('candTitle'), sub = $('candSub');
    if (done) {
      if (foot) foot.classList.add('is-done');
      if (txt) txt.textContent = '@' + C.winner + ' receives every creator fee $ONLYPADS earns.';
      if (title) title.innerHTML = '$ONLYPADS pays <span class="accent">@' + h(C.winner) + '</span>.';
      if (sub) sub.textContent = 'The shortlist is closed. Every creator fee the $ONLYPADS coin earns ' +
        'is routed to their wallet.';
    } else if (txt) {
      txt.textContent = 'Winner announced soon.';
    }
  }

  function initTheme() {
    var btn = $('themeBtn');
    if (!btn) return;
    function isLight() { return doc.documentElement.getAttribute('data-theme') === 'light'; }
    function label() {
      btn.setAttribute('aria-label', isLight() ? 'Switch to dark theme' : 'Switch to light theme');
    }
    label();
    btn.addEventListener('click', function () {
      var next = isLight() ? 'dark' : 'light';
      doc.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('onlypad-theme', next); } catch (e) {}
      label();
    });
  }

  /* ---------- actions ---------- */
  function initActions() {
    doc.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-launch]')) {
        /* Real now: opens the wizard. The coin is created on chain by the user's
           own wallet, so the first thing the wizard does is make sure there is one. */
        openModal(true);
        var w = root.ONLYPAD && root.ONLYPAD.wallet;
        step(w && w.connected() ? 'wizForm' : 'wizConnect');
        return;
      }
      if (t.closest('[data-boost]')) { toast(NOT_WIRED, NOT_WIRED_BODY); return; }
      if (t.closest('[data-sub]')) {
        toast(NOT_WIRED, 'Subbing needs a signed transaction and a wallet. ' +
          'This build has no chain connection, so nothing was bought.');
        return;
      }
      if (t.closest('[data-claim]')) {
        toast(NOT_WIRED, 'Claiming needs a signed challenge and a wallet. ' +
          'This build has no chain connection, so no Cut was released.');
      }
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    setText('yr', new Date().getFullYear());
    renderStats();
    renderHeroSplit();
    initCA();
    renderEscrow();
    renderLeaderboard();
    renderTiers();
    renderJar();
    initBoard();
    renderBoard();
    renderCandidates();
    initTheme();
    initLaunch();
    initActions();

    /* The launch configuration, once. Without it the wizard refuses before it can
       waste a signature. */
    loadCfg();

    /* Ask the registry once, then keep asking. The board renders the simulated
       dataset until (and unless) the API answers with real coins. */
    loadLive();
    setInterval(loadLive, LIVE_MS);

    all(RV).forEach(function (el) { el.classList.add('rv'); });
    reveal();
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('resize', onScroll);
    sweep();
    setInterval(renderJar, 1000);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
}(window, document));
