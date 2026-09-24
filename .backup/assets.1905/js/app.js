/* ==========================================================================
   OnlyPad — rendering.
   Reads ONLYPAD.data (simulated) and ONLYPAD.math (the real rules). Nothing
   here invents a number. Every simulated figure is badged DEMO.
   ========================================================================== */
(function (root, doc) {
  'use strict';

  var M = root.ONLYPAD.math;
  var D = root.ONLYPAD.data;
  var CFG = M.CFG;

  /* ---------- tiny helpers ---------- */
  function $(id) { return doc.getElementById(id); }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function monogram(name) { return String(name || '?').trim().charAt(0).toUpperCase(); }
  function modeLabel(m) { return m === 'ppv' ? 'PPV' : (m === 'lock' ? 'Lock' : 'Stream'); }

  function timeAgo(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec < 8) return 'just now';
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  }

  /* ---------- toasts ---------- */
  function toast(kind, title, desc) {
    var wrap = $('toasts');
    if (!wrap) return;
    var ic = kind === 'ok' ? 'M20 6L9 17l-5-5'
      : kind === 'err' ? 'M18 6L6 18M6 6l12 12'
        : kind === 'warn' ? 'M12 8v5M12 17h.01'
          : 'M12 8v5M12 17h.01';
    var el = doc.createElement('div');
    el.className = 'toast toast--' + kind;
    el.innerHTML =
      '<div class="toast__ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="' + ic + '"/></svg></div>' +
      '<div><div class="toast__t">' + h(title) + '</div>' +
      '<div class="toast__d">' + h(desc) + '</div></div>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 4200);
  }

  /* ---------- live feed ----------
     Three kinds of event. A launch carries the split instead of an amount,
     because a coin that has just been created has not paid anyone yet. */
  function feedRow(f) {
    var isLaunch = f.kind === 'launch';
    var isCut = f.kind === 'cut';
    /* On an UNCLAIMED coin the Cut has not been paid to anyone yet — it is
       sitting in Creator Escrow. Saying "paid to" there would be a lie, and
       it is the exact thing this product is about. */
    var pending = isCut && !f.verified;

    var color = isLaunch ? '' : (pending ? ' style="color:var(--amber)"'
      : (isCut ? '' : ' style="color:var(--ink)"'));
    var what, where, amount;

    if (isLaunch) {
      what = 'New Only launched by ' + h(f.who);
      where = 'split';
      amount = f.split || '60/35/5';
    } else if (isCut) {
      what = pending ? 'Cut accrued in escrow for ' + h(f.who) : 'The Cut paid to ' + h(f.who);
      where = pending ? 'in escrow' : 'to creator';
      amount = '+' + M.usd(f.amount);
    } else {
      what = 'Tips claimed by ' + h(f.who);
      where = 'to a Sub';
      amount = M.usd(f.amount);
    }

    return '<div class="frow' + (f.fresh ? ' frow--fresh' : '') + '">' +
      '<div class="frow__av">' + h(monogram(f.name)) + '</div>' +
      '<div class="frow__main">' +
        '<div class="frow__t">' + h(f.name) + ' <span class="frow__tk">' + h(f.ticker) + '</span>' +
          (f.fresh ? ' <span class="frow__new">NEW</span>' : '') + '</div>' +
        '<div class="frow__s">' + what + ' · ' + h(timeAgo(f.secsAgo)) + '</div>' +
      '</div>' +
      '<div class="frow__amt">' +
        '<span class="frow__v"' + color + '>' + amount + '</span>' +
        '<span class="frow__d">' + where + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderFeed() {
    var box = $('tickerRows');
    if (!box) return;
    box.innerHTML = D.feed.map(feedRow).join('');
  }

  /* ---------- stats ---------- */
  function sum(key) {
    return D.onlys.reduce(function (a, o) { return a + o[key]; }, 0);
  }

  /* The stats strip mirrors the reference's four: three market figures and one
     wallet figure. Labels are the reference's, adapted to OnlyPad's vocabulary. */
  function statValues() {
    return {
      onlys:  { v: D.onlys.length, dec: 0, prefix: '' },
      mcap:   { v: sum('mcap'), dec: 0, prefix: '$' },
      vol24:  { v: sum('vol24'), dec: 0, prefix: '$' },
      escrow: { v: D.onlys.reduce(function (a, o) { return a + o.escrow; }, 0), dec: 2, prefix: '$' }
    };
  }

  function initStats() {
    var stats = statValues();
    Object.keys(stats).forEach(function (k) {
      var el = doc.querySelector('[data-stat="' + k + '"]');
      if (!el) return;
      el.dataset.count = stats[k].v;
      el.dataset.dec = stats[k].dec;
      el.dataset.prefix = stats[k].prefix;
      el.textContent = stats[k].prefix + '0';
    });
  }

  /* Re-reads the totals without replaying the count-up. The live feed moves the
     numbers, so the two must not disagree. Skipped while a count-up is running
     so the two writers do not fight over the same element.

     It MUST also refresh dataset.count, not just the text: the count-up reads
     its target from there, so updating only the text let a later reveal animate
     the number back down to a stale value. That is how "Onlys launched" showed
     12 after a thirteenth was launched. */
  function refreshStats() {
    var stats = statValues();
    Object.keys(stats).forEach(function (k) {
      var el = doc.querySelector('[data-stat="' + k + '"]');
      if (!el || el.dataset.animating) return;
      var s = stats[k];
      el.dataset.count = s.v;
      el.dataset.dec = s.dec;
      el.dataset.prefix = s.prefix;
      el.textContent = s.prefix + s.v.toLocaleString('en-US', {
        minimumFractionDigits: s.dec, maximumFractionDigits: s.dec
      });
    });
  }

  function countUp(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    var target = parseFloat(el.dataset.count || '0');
    var dec = parseInt(el.dataset.dec || '0', 10);
    var prefix = el.dataset.prefix || '';
    var suffix = el.dataset.suffix || '';
    var start = null, dur = 1100;
    el.dataset.animating = '1';
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = target * eased;
      el.textContent = prefix + v.toLocaleString('en-US', {
        minimumFractionDigits: dec, maximumFractionDigits: dec
      }) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else {
        el.textContent = prefix + target.toLocaleString('en-US', {
          minimumFractionDigits: dec, maximumFractionDigits: dec
        }) + suffix;
        delete el.dataset.animating;
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- board ---------- */
  /* Shared bits of the creator-profile grammar. */
  var LOCK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" ' +
    'height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  var TICK_SVG = '<svg class="oftick" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 6L9 17l-5-5"/></svg>';

  var CROWN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M2 6.5l5.2 3.6L12 3l4.8 7.1L22 6.5 20.4 18H3.6L2 6.5z"/></svg>';

  /* The card follows the creator-funding layout the user supplied: a media panel,
     a circular avatar with the identity inline beside it, a glowing bar, and a
     raised/total pair under a status pill.

     The figures are the creator's Cut — what the coin has earned them, out of
     everything the coin has generated. That ratio IS the launcher's split, so
     the bar differs coin to coin and never has to be faked. Whether the money
     has actually reached them is carried by the pill colour and the locked tile,
     NOT by shrinking the bar to zero, which just looks broken. */
  function onlyCard(o) {
    var sp = M.splitPct(o.cut);
    var locked = !o.verified;
    var earned = o.paid + o.escrow;                                   /* paid or held */
    var share = o.generated > 0 ? earned / o.generated : sp.cut / 100;

    var pill = '<span class="ofpill' + (locked ? ' ofpill--warn' : '') + '">' +
      CROWN_SVG + (locked ? 'Unclaimed' : 'Verified') + '</span>';

    /* A coin launched seconds ago has no Cut yet, so "Locked — $0.00" reads like
       a bug. Say what it is actually waiting for. */
    var lock = locked
      ? '<div class="oflock">' +
          '<div class="oflock__ic">' + LOCK_SVG + '</div>' +
          '<div>' +
            '<div class="oflock__t">' +
              (o.escrow > 0 ? 'Locked — ' + M.usd(o.escrow) : 'Locked — nothing yet') +
            '</div>' +
            '<div class="oflock__d">@' + h(o.handle) + ' has not claimed. ' +
              (o.escrow > 0 ? 'It unlocks the moment they verify.'
                            : 'The Cut accrues from the first trade.') +
            '</div>' +
          '</div>' +
        '</div>'
      : '';

    return '<article class="gcard ofcard' + (o.fresh ? ' is-fresh' : '') + '" ' +
      'data-id="' + h(o.id) + '" data-verified="' + (o.verified ? '1' : '0') + '" ' +
      'data-key="' + h((o.name + ' ' + o.handle + ' ' + o.ticker).toLowerCase()) + '">' +
      '<div class="ofcover">' +
        '<span class="tag tag--' + h(o.mode) + ' ofcover__mode">' + h(modeLabel(o.mode)) + '</span>' +
        '<div class="ofcover__mark">' + h(o.ticker) + '</div>' +
      '</div>' +
      '<div class="gcard__body">' +
        '<div class="ofidrow">' +
          '<div class="ofav">' + h(monogram(o.name)) + '</div>' +
          '<div class="ofid">' +
            '<div class="ofid__n">' + h(o.name) + (o.verified ? TICK_SVG : '') + '</div>' +
            '<div class="ofid__h">@' + h(o.handle) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ofprog"><i style="width:' + (share * 100).toFixed(1) + '%"></i></div>' +
        '<div class="ofmeta">' + pill +
          '<span class="ofamount' + (locked ? ' ofamount--warn' : '') + '">' +
            M.usd(earned, 0) + '<em>/</em>' + M.usd(o.generated, 0) +
          '</span>' +
        '</div>' +
        '<div class="ofsub">' +
          '<span>' + o.subs.toLocaleString('en-US') + ' Subs · ' + sp.cut + '% to creator</span>' +
          '<span class="minisplit">' +
            '<i class="a" style="width:' + sp.cut + '%"></i>' +
            '<i class="b" style="width:' + sp.tips + '%"></i>' +
            '<i class="c" style="width:' + sp.pad + '%"></i>' +
          '</span>' +
        '</div>' +
        /* the market figures the reference's board carries per coin */
        '<div class="ofmkt">' +
          '<div><b>' + M.usdShort(o.mcap) + '</b><span>Market cap</span></div>' +
          '<div><b>' + M.usdShort(o.vol24) + '</b><span>Volume 24h</span></div>' +
          '<div><b>' + M.usdShort(o.liq || 0) + '</b><span>Liquidity</span></div>' +
        '</div>' +
        lock +
        '<div class="ofaction">' +
          '<button class="btn btn--primary btn--full" type="button" data-sub="' + h(o.ticker) + '">' +
            'Sub to ' + h(o.ticker) + '</button>' +
          '<div class="ofcue">' + (locked
            ? 'Locked until they claim'
            : (o.claimable > 0 ? 'Tips from ' + M.usd(o.claimable) : 'No Tips yet')) + '</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function platformCard() {
    var p = D.platform;
    var q = Math.min(100, (p.queued / 1200) * 100);
    return '<article class="gcard ofcard gcard--top" data-id="platform" data-verified="1" data-key="$only platform token onlypad">' +
      '<div class="ofcover">' +
        '<span class="tag tag--stream ofcover__mode">Solana</span>' +
        '<div class="ofcover__mark">$ONLY</div>' +
      '</div>' +
      '<div class="gcard__body">' +
        '<div class="ofidrow">' +
          '<div class="ofav">$</div>' +
          '<div class="ofid">' +
            '<div class="ofid__n">$ONLY' + TICK_SVG + '</div>' +
            '<div class="ofid__h">The Pad token</div>' +
          '</div>' +
        '</div>' +
        '<div class="ofprog"><i style="width:' + q.toFixed(1) + '%"></i></div>' +
        '<div class="ofmeta">' +
          '<span class="ofpill">' + CROWN_SVG + 'Platform</span>' +
          '<span class="ofamount">' + M.usd(p.queued, 0) + '<em>/</em>$1,200</span>' +
        '</div>' +
        '<div class="ofsub">' +
          '<span>' + p.holders.toLocaleString('en-US') + ' holders · ' +
            (p.burned / 1e6).toFixed(2) + 'M burned</span>' +
          '<span class="minisplit"><i class="a" style="width:50%"></i><i class="c" style="width:50%"></i></span>' +
        '</div>' +
        '<div class="ofmkt">' +
          '<div><b>' + M.usdShort(p.mcap) + '</b><span>Market cap</span></div>' +
          '<div><b>' + M.usdShort(p.vol24) + '</b><span>Volume 24h</span></div>' +
          '<div><b>' + M.usdShort(p.liq) + '</b><span>Liquidity</span></div>' +
        '</div>' +
        '<div class="ofaction">' +
          '<button class="btn btn--primary btn--full" type="button" data-sub="$ONLY">Buy $ONLY</button>' +
          '<div class="ofcue">' + M.usd(p.jar) + ' in the Tip Jar</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderBoard() {
    var grid = $('boardGrid');
    if (!grid) return;
    var q = ($('boardSearch') && $('boardSearch').value || '').trim().toLowerCase();
    var filter = (doc.querySelector('#boardFilters .is-on') || {}).dataset;
    filter = filter ? filter.filter : 'all';

    var rows = D.onlys.filter(function (o) {
      if (filter === 'verified' && !o.verified) return false;
      if (filter === 'unclaimed' && o.verified) return false;
      if (q && (o.name + ' ' + o.handle + ' ' + o.ticker).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    var html = '';
    /* $ONLY is pinned at the top unless a filter or search excludes it */
    var showPlatform = (!q && filter === 'all') ||
      (('$only platform token onlypad'.indexOf(q) !== -1) && q) ||
      (filter === 'verified' && !q);
    if (showPlatform) html += platformCard();
    html += rows.map(onlyCard).join('');
    if (!rows.length && !showPlatform) html = '<div class="empty">No Onlys match that.</div>';
    grid.innerHTML = html;

    var meta = $('boardMeta');
    if (meta) {
      meta.textContent = rows.length + ' Only' + (rows.length === 1 ? '' : 's') +
        ' shown · ' + D.onlys.length + ' launched · source: demo dataset';
    }
    reveal(grid);
  }

  function initBoard() {
    var search = $('boardSearch');
    if (search) search.addEventListener('input', renderBoard);
    var chips = $('boardFilters');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      Array.prototype.forEach.call(chips.querySelectorAll('button'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      renderBoard();
    });
    /* The card's primary action. Nothing is wired, so it says so rather than
       silently doing nothing when clicked. */
    var grid = $('boardGrid');
    if (grid) grid.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sub]');
      if (!b) return;
      toast('info', 'Not wired up yet',
        'This build has no chain connection, so nothing was signed. Subbing to ' + b.dataset.sub +
        ' would buy the coin on pump.fun.');
    });
  }

  /* ---------- launch wizard ---------- */
  var launch = { kind: 'creator', mode: 'stream', cut: 0.60, pair: 'SOL' };

  function renderSplit() {
    var sp = M.splitPct(launch.cut);
    var c = sp.cut, t = sp.tips, p = sp.pad;

    var bar = $('prevSplitBar');
    if (bar) {
      var a = bar.querySelector('.a'), b = bar.querySelector('.b'), cc = bar.querySelector('.c');
      if (a) a.style.width = c + '%';
      if (b) b.style.width = t + '%';
      if (cc) cc.style.width = p + '%';
    }
    function set(id, v) { var el = $(id); if (el) el.textContent = v; }
    set('prevSplitTop', c + ' / ' + t + ' / ' + p);
    set('prevCutPct', c + '%');
    set('prevTipsPct', t + '%');
    set('prevPadPct', p + '%');
    set('prevCutRow', c + '%');
    set('prevTipsRow', t + '%');
    set('prevPadRow', p + '%');
    set('cutValue', c + '%');
    set('prevKind', launch.kind === 'creator' ? 'Creator Launch' : 'Fan Launch');
    set('prevModePill', modeLabel(launch.mode));
    set('prevPair', launch.pair === 'SOL' ? '\u25ce SOL' : (launch.pair === 'USDC' ? '$ USDC' : '+ Custom'));

    var badge = $('prevBadge');
    if (badge) {
      badge.textContent = launch.kind === 'creator' ? 'VERIFIED' : 'UNCLAIMED';
      /* deliberately not ofcover__badge — that class absolutely-positions the
         badge onto a cover, and this one sits in the preview card's header */
      badge.className = 'tag ' + (launch.kind === 'creator' ? 'tag--verified' : 'tag--unclaimed');
    }
    var note = $('prevEscrowNote');
    if (note) {
      note.textContent = launch.kind === 'creator'
        ? 'The Cut streams to your wallet on every trade, from the first one.'
        : 'The Cut accrues in Creator Escrow until the creator verifies and claims it.';
    }
  }

  function initLaunch() {
    /* coin type */
    var kindGroup = $('kindGroup');
    if (kindGroup) kindGroup.addEventListener('click', function (e) {
      var b = e.target.closest('.mode'); if (!b) return;
      Array.prototype.forEach.call(kindGroup.querySelectorAll('.mode'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      launch.kind = b.dataset.kind;
      renderSplit();
    });

    /* claim mode */
    var modeGroup = $('modeGroup');
    if (modeGroup) modeGroup.addEventListener('click', function (e) {
      var b = e.target.closest('.mode'); if (!b) return;
      Array.prototype.forEach.call(modeGroup.querySelectorAll('.mode'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      launch.mode = b.dataset.mode;
      renderSplit();
    });

    /* creator's cut */
    var cut = $('fCut');
    if (cut) cut.addEventListener('input', function () {
      launch.cut = parseFloat(cut.value) / 100;
      renderSplit();
    });

    /* pair */
    var pairGroup = $('pairGroup');
    if (pairGroup) pairGroup.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(pairGroup.querySelectorAll('button'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      launch.pair = b.dataset.pair;
      renderSplit();
    });

    /* live preview of name / ticker / image */
    var name = $('fName'), ticker = $('fTicker'), img = $('imgInput');
    if (name) name.addEventListener('input', function () {
      var el = $('prevName'); if (el) el.textContent = name.value || 'Claim Coin';
      var cnt = $('cntName'); if (cnt) cnt.textContent = name.value.length + '/32';
      var av = $('prevAv');
      if (av && !av.querySelector('img')) av.textContent = monogram(name.value || '?');
    });
    if (ticker) ticker.addEventListener('input', function () {
      var el = $('prevTicker'); if (el) el.textContent = '$' + (ticker.value || '').toUpperCase();
      var cnt = $('cntTicker'); if (cnt) cnt.textContent = ticker.value.length + '/10';
    });
    var bid = $('fBid');
    if (bid) bid.addEventListener('input', function () {
      var el = $('prevBid'); if (el) el.textContent = bid.value ? bid.value + ' SOL' : '—';
    });
    if (img) img.addEventListener('change', function () {
      var f = img.files && img.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var av = $('prevAv');
        if (av) av.innerHTML = '<img src="' + r.result + '" alt="">';
        var lab = $('upload'); if (lab) lab.classList.add('has-img');
        var t = $('uploadText'); if (t) t.textContent = f.name;
      };
      r.readAsDataURL(f);
    });

    /* agree + wallet gate */
    var agree = $('agree'), btn = $('launchBtn'), hint = $('launchHint');
    function gate() {
      if (!btn) return;
      var ok = agree && agree.checked && root.ONLYPAD.wallet.connected;
      btn.disabled = !ok;
      if (hint) hint.textContent = !root.ONLYPAD.wallet.connected
        ? 'Connect a wallet and tick the box to enable.'
        : (agree && agree.checked ? 'Ready. The split is written on chain at launch and cannot be changed.'
          : 'Tick the box to enable.');
    }
    if (agree) agree.addEventListener('change', gate);
    if (btn) btn.addEventListener('click', function () { emitLaunch(); });
    root.ONLYPAD.gate = gate;

    renderSplit();
  }

  /* ---------- launching ----------
     Builds the Only from the wizard, puts it in the live feed, and adds it to
     the board. Nothing touches a chain, and the toast says so rather than
     letting the user believe a real coin exists. */
  function emitLaunch() {
    var W = root.ONLYPAD.wallet;
    var nameEl = $('fName'), tkEl = $('fTicker'), hdEl = $('fHandle');

    var name = ((nameEl && nameEl.value) || '').trim() || 'Untitled Only';
    var tkRaw = ((tkEl && tkEl.value) || '').trim().replace(/^\$/, '');
    var ticker = '$' + (tkRaw || name.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'ONLY').toUpperCase();
    var handle = ((hdEl && hdEl.value) || '').trim().replace(/^@/, '').toLowerCase() || 'unclaimed';

    var sp = M.splitPct(launch.cut);
    var locked = launch.kind === 'fan';
    var id = 'only-' + Date.now();

    var only = {
      demo: true, fresh: true, id: id,
      handle: handle, name: name, ticker: ticker,
      verified: !locked,
      mode: launch.mode,
      cut: sp.cut / 100, tips: sp.tips / 100, pad: sp.pad / 100,
      generated: 0, paid: 0, escrow: 0, claimable: 0, claimed: 0,
      mcap: 4200, vol24: 0, liq: 0, subs: 0, days: 0
    };
    D.onlys.push(only);
    /* The board is ranked by market cap and a coin with no trades yet has none,
       so it sorts last. The is-fresh ring, the feed row and the scroll are what
       make it findable — the sort stays honest. */
    D.onlys.sort(function (a, b) { return b.mcap - a.mcap; });

    D.feed.unshift({
      demo: true, fresh: true, kind: 'launch',
      name: name, handle: handle, ticker: ticker,
      verified: !locked, mode: launch.mode,
      split: sp.cut + '/' + sp.tips + '/' + sp.pad,
      who: (W.connected && W.address) ? M.short(W.address) : 'you',
      secsAgo: 0
    });
    if (D.feed.length > 16) D.feed.length = 16;

    renderFeed();
    renderBoard();
    refreshStats();

    toast('ok', 'Launched on the Pad — demo only',
      name + ' (' + ticker + ') is in the live feed. No real coin was created: this build has no chain connection.');

    var card = $('boardGrid') && $('boardGrid').querySelector('[data-id="' + id + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return only;
  }

  /* ---------- the feed keeps moving ----------
     The reference calls this live activity, so it should not sit still. Every
     event generated here is simulated and the header pill says so. */
  var LIVE_MS = 12000;

  function tick() {
    var pool = D.onlys.filter(function (o) { return !o.fresh; });
    if (!pool.length) return;

    var o = pool[Math.floor(Math.random() * pool.length)];
    var isCut = Math.random() > 0.45;
    var amt = isCut ? (0.8 + Math.random() * 180) : (0.4 + Math.random() * 70);
    var locked = !o.verified;

    D.feed.forEach(function (f) { f.secsAgo = (f.secsAgo || 0) + LIVE_MS / 1000; });
    D.feed.unshift({
      demo: true, kind: isCut ? 'cut' : 'tips',
      name: o.name, handle: o.handle, ticker: o.ticker, verified: o.verified,
      amount: amt,
      who: isCut ? ('@' + o.handle) : (o.handle.slice(0, 2) + '8f\u2026' + o.handle.slice(-2) + 'k1'),
      secsAgo: 0
    });
    if (D.feed.length > 16) D.feed.length = 16;

    /* the reward the coin generated grows whichever way it split */
    o.generated += amt;
    if (isCut) { if (locked) o.escrow += amt; else o.paid += amt; }
    else { o.claimable += amt * 0.4; o.claimed += amt * 0.6; }

    renderFeed();
    refreshStats();

    /* nudge just this coin's card so the board and the feed agree, rather than
       re-rendering the whole grid every twelve seconds */
    var card = $('boardGrid') && $('boardGrid').querySelector('[data-id="' + o.id + '"]');
    if (card) {
      var earned = o.paid + o.escrow;
      var share = o.generated > 0 ? earned / o.generated : o.cut;
      var amtEl = card.querySelector('.ofamount');
      if (amtEl) amtEl.innerHTML = M.usd(earned, 0) + '<em>/</em>' + M.usd(o.generated, 0);
      var barEl = card.querySelector('.ofprog > i');
      if (barEl) barEl.style.width = (share * 100).toFixed(1) + '%';
    }
  }

  /* ---------- FAQ ---------- */
  function initFaq() {
    var list = $('faqList');
    if (!list) return;
    list.addEventListener('click', function (e) {
      var q = e.target.closest('.fq'); if (!q) return;
      var item = q.parentNode;
      var body = item.querySelector('.fa');
      var open = item.classList.contains('is-open');
      /* one at a time, like the reference */
      Array.prototype.forEach.call(list.querySelectorAll('.fitem.is-open'), function (x) {
        x.classList.remove('is-open');
        var b = x.querySelector('.fa'); if (b) b.style.maxHeight = '0px';
      });
      if (!open) {
        item.classList.add('is-open');
        body.style.maxHeight = body.scrollHeight + 'px';
      }
    });
  }

  /* ---------- nav ---------- */
  function initNav() {
    var nav = $('nav'), burger = $('burger'), links = $('navLinks');
    if (burger) burger.addEventListener('click', function () {
      links.classList.toggle('is-open');
    });
    if (links) links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') links.classList.remove('is-open');
    });
    window.addEventListener('scroll', function () {
      if (nav) nav.classList.toggle('is-stuck', window.scrollY > 8);
    }, { passive: true });
  }

  /* ---------- reveal + counters ---------- */
  function show(n) {
    n.classList.add('is-in');
    /* querySelectorAll, not querySelector — the stats row holds five counters
       and only the first one was ever animating. */
    Array.prototype.forEach.call(n.querySelectorAll('[data-count]'), countUp);
  }

  /* One observer, reused. renderBoard() calls reveal() on every keystroke in the
     search box, and building a fresh IntersectionObserver each time leaked one
     per call. */
  var io = null;

  function reveal(scope) {
    var nodes = (scope || doc).querySelectorAll('.rv:not(.is-in)');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(nodes, show);
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          show(en.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
  }

  /* The observer alone is not enough. A jump scroll — a nav anchor, or landing
     on #faq from a link — can move an element past the viewport between two
     frames, so the observer never sees it intersect and it sits at opacity 0
     for good. This sweeps up anything the observer missed. Cheap: it only ever
     queries elements that are still unrevealed. */
  function sweep() {
    var bottom = window.innerHeight;
    Array.prototype.forEach.call(doc.querySelectorAll('.rv:not(.is-in)'), function (n) {
      if (n.getBoundingClientRect().top < bottom) show(n);
    });
  }
  var sweeping = false;
  function onScroll() {
    if (sweeping) return;
    sweeping = true;
    requestAnimationFrame(function () { sweeping = false; sweep(); });
  }

  /* ---------- creator escrow ---------- */
  function renderEscrow() {
    var unclaimed = D.onlys.filter(function (o) { return !o.verified; });
    var total = unclaimed.reduce(function (a, o) { return a + o.escrow; }, 0);

    var el = $('escTotal'); if (el) el.textContent = M.usd(total);
    var cnt = $('escCount'); if (cnt) cnt.textContent = unclaimed.length;

    /* The preview strip: one locked tile per unclaimed Only. This is the
       locked-media-grid idiom doing real work — it is a list of money sitting
       there waiting for a creator to come and take it. */
    var strip = $('escStrip');
    if (strip) {
      strip.innerHTML = unclaimed.map(function (o) {
        return '<div class="oflocktile">' +
          '<div class="oflocktile__ic">' + LOCK_SVG + '</div>' +
          '<div class="oflocktile__h">' + h(o.ticker) + '</div>' +
          '<div class="oflocktile__v">' + M.usd(o.escrow) + '</div>' +
          '<div class="oflocktile__s">@' + h(o.handle) + '</div>' +
        '</div>';
      }).join('');
    }

    var btn = $('verifyBtn');
    if (btn) btn.addEventListener('click', function () {
      toast('info', 'Not wired up yet',
        'Verification needs a real wallet signature. In this build the escrow figure is simulated and ' +
        'labelled DEMO — nothing was signed.');
    });
  }

  /* ---------- the $ONLY card ---------- */
  function renderToken() {
    var p = D.platform;
    var q = $('queuedBurn'); if (q) q.textContent = M.usd(p.queued);
    var bar = $('burnBar'); if (bar) bar.style.width = Math.min(100, (p.queued / 1200) * 100).toFixed(1) + '%';
    var ca = $('caText'); if (ca) ca.textContent = p.address;
    var copy = $('caCopy');
    if (copy) copy.addEventListener('click', function () {
      var done = function () { toast('ok', 'Address copied', p.address); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(p.address).then(done, done);
      } else done();
    });
  }

  /* ---------- wallet (real if a provider exists, simulated otherwise) ---------- */
  function syncWalletLabel() {
    var btn = $('walletBtn'), label = $('walletLabel');
    var W = root.ONLYPAD.wallet;
    if (!btn || !label) return;
    if (W.connected && W.address) {
      btn.classList.add('is-connected');
      label.textContent = W.address.slice(0, 4) + '…' + W.address.slice(-4);
    } else if (W.connected) {
      btn.classList.add('is-connected');
      label.textContent = 'Connecting…';
    } else {
      btn.classList.remove('is-connected');
      label.textContent = 'Connect wallet';
    }
  }

  function initWallet() {
    var btn = $('walletBtn');
    if (!btn) return;
    root.ONLYPAD.syncWalletLabel = syncWalletLabel;
    btn.addEventListener('click', function () {
      var W = root.ONLYPAD.wallet;
      if (W.connected) {
        W.disconnect();
        toast('info', 'Wallet disconnected', 'Session ended.');
      } else {
        /* wallet.js owns the reporting: it toasts honestly about whether a real
           provider answered or a simulated address was generated. */
        W.connect();
      }
      syncWalletLabel();
      if (root.ONLYPAD.gate) root.ONLYPAD.gate();
      if (root.ONLYPAD.onWallet) root.ONLYPAD.onWallet();
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    var yr = $('yr'); if (yr) yr.textContent = new Date().getFullYear();
    renderFeed();
    initStats();
    renderBoard();
    initBoard();
    initLaunch();
    renderEscrow();
    renderToken();
    initFaq();
    initNav();
    initWallet();
    reveal();
    /* the safety net for anything a jump scroll skips */
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    sweep();
    setInterval(tick, LIVE_MS);
    if (root.ONLYPAD.initEpoch) root.ONLYPAD.initEpoch();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.ONLYPAD.app = { toast: toast, renderBoard: renderBoard, monogram: monogram, modeLabel: modeLabel };
}(window, document));
