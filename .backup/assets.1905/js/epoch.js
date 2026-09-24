/* ==========================================================================
   OnlyPad — the Tip Jar.
   The 15-minute Drop clock, the jar itself, your position, and the Sub
   leaderboard. Drops are aligned to the wall clock (900-second buckets), not
   to when the page loaded, so every visitor sees the same countdown.
   ========================================================================== */
(function (root, doc) {
  'use strict';

  var M = root.ONLYPAD.math;
  var D = root.ONLYPAD.data;
  var CFG = M.CFG;
  var RING = 2 * Math.PI * 76;   /* matches r=76 in the SVG */
  var sortKey = 'claimable';
  var skipped = 0;               /* the demo "skip a Drop" control */

  function $(id) { return doc.getElementById(id); }
  function set(id, v) { var el = $(id); if (el) el.textContent = v; }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mmss(t) {
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function dropsOpen() { return Math.min(CFG.MAX_STACK, D.jar.dropsOpen + skipped); }

  /* ---------- the jar and the clock ---------- */
  function renderJar() {
    var sec = M.nowSec();
    var idx = M.dropIndex(sec);
    var left = M.secsLeftInDrop(sec);
    var p = M.dropProgress(sec);

    set('dropNo', '#' + (idx % 100000));
    set('dropCountdown', mmss(left));
    set('dropProgress', Math.round(p * 100) + '% of this Drop elapsed');
    set('jarPot', M.usd(D.jar.pot));
    set('jarQueued', M.usd(D.platform.queued));

    var ring = $('dropRing');
    if (ring) {
      ring.setAttribute('stroke-dasharray', RING.toFixed(2));
      ring.setAttribute('stroke-dashoffset', (RING * (1 - p)).toFixed(2));
    }

    /* the stack meter: Drops already open, then the one running now */
    var dots = $('dropDots');
    if (dots) {
      var open = dropsOpen();
      var html = '';
      for (var i = 0; i < CFG.MAX_STACK; i++) {
        var cls = i < open - 1 ? 'edot edot--on'
          : (i === open - 1 ? 'edot edot--now' : 'edot');
        html += '<span class="' + cls + '"></span>';
      }
      dots.innerHTML = html;
    }
    set('jarOpenCount', dropsOpen() + ' of ' + CFG.MAX_STACK + ' Drops open');

    var row = $('stackRow');
    if (row) {
      if (dropsOpen() > 1) {
        row.hidden = false;
        set('stackTitle', dropsOpen() + ' Drops stacked');
        set('stackDesc', 'Nothing is lost by being away. Claim once and you take all ' +
          dropsOpen() + ' in a single transaction.');
      } else {
        row.hidden = true;   /* hiding is not enough — clear it too */
        set('stackTitle', '');
        set('stackDesc', '');
      }
    }
  }

  /* ---------- your position ---------- */
  function renderYou() {
    var W = root.ONLYPAD.wallet;
    var empty = $('yourPosEmpty'), body = $('yourPosBody');
    if (!empty || !body) return;

    if (!W.connected) {
      empty.hidden = false; body.hidden = true;
      var btn = $('claimJarBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Connect wallet to claim'; }
      set('claimHint', 'Drops are 15 minutes long. Unclaimed Drops stack.');
      return;
    }

    empty.hidden = true; body.hidden = false;
    var pos = W.position;
    var w = M.weight(pos.balance, pos.days, pos.neverSold);
    var tier = M.tierOf(pos.days, pos.neverSold);
    var eligible = w > 0;

    var rows = D.subs.concat([{
      demo: true, address: pos.address, balance: pos.balance, days: pos.days,
      neverSold: pos.neverSold, weight: w, eligible: eligible,
      streak: M.renewals(pos.days), claimed: 0, you: true
    }]);
    var total = rows.reduce(function (a, b) { return a + b.weight; }, 0);
    var claimable = M.share(w, total, D.jar.pot, dropsOpen());

    set('ypWallet', M.short(pos.address));
    set('ypBalance', pos.balance.toLocaleString('en-US') + ' ' + CFG.MINT);
    set('ypHeld', pos.days + 'd · ' + M.renewals(pos.days) + ' renewal' + (M.renewals(pos.days) === 1 ? '' : 's'));
    set('ypMult', M.multiplier(pos.days, pos.neverSold).toFixed(2) + '\u00d7');
    set('ypWeight', eligible ? Math.round(w).toLocaleString('en-US') : '—');
    set('ypShare', eligible && total ? M.pct(w / total, 2) : '—');
    set('ypClaimable', eligible ? M.usd(claimable) : '—');
    set('ypTier', tier.tier);

    var badge = $('ypSim');
    if (badge) badge.hidden = W.real;

    var btn = $('claimJarBtn');
    if (btn) {
      btn.disabled = !eligible || claimable <= 0;
      btn.textContent = !eligible
        ? 'Under the ' + CFG.MIN_HOLD + ' ' + CFG.MINT + ' floor'
        : (claimable > 0 ? 'Claim ' + M.usd(claimable) + ' from the Tip Jar' : 'Nothing to claim yet');
    }
    set('claimHint', !eligible
      ? 'Wallets under ' + CFG.MIN_HOLD + ' ' + CFG.MINT + ' are left out of the weight set entirely, so dust cannot dilute real Subs.'
      : 'Drops are 15 minutes long. Unclaimed Drops stack up to ' + CFG.MAX_STACK + '.');
  }

  /* ---------- the Sub leaderboard ---------- */
  function lbRow(row, total) {
    var tier = M.tierOf(row.days, row.neverSold);
    var claimable = M.share(row.weight, total, D.jar.pot, dropsOpen());
    var rank = row.you ? '\u2014' : row.rank;
    var rankCls = (!row.you && row.rank <= 3) ? ' lb-rank--' + row.rank : '';
    var mult = M.multiplier(row.days, row.neverSold).toFixed(2) + '\u00d7';

    return '<tr class="' + (row.you ? 'is-you' : '') + '">' +
      '<td><span class="lb-rank' + rankCls + '">' + rank + '</span></td>' +
      '<td><div class="lb-w">' +
        '<span class="lb-w__av">' + h((row.address || '?').slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="lb-w__a">' + h(M.short(row.address)) + '</span>' +
        (row.you ? '<span class="lb-w__you">YOU</span>' : '') +
        (row.demo && !row.you ? '<span class="lb-w__sim">DEMO</span>' : '') +
        (row.you && row.sim ? '<span class="lb-w__sim">SIM</span>' : '') +
      '</div></td>' +
      '<td>' + h(tier.tier) + '</td>' +
      '<td class="num">' + row.balance.toLocaleString('en-US') + '</td>' +
      '<td class="num mint">' + mult + '</td>' +
      '<td class="num">' + (row.eligible ? Math.round(row.weight).toLocaleString('en-US') : '<span class="dim">—</span>') + '</td>' +
      '<td><span class="streak' + (row.streak >= 6 ? ' streak--hot' : '') + '">' +
        row.streak + ' renewal' + (row.streak === 1 ? '' : 's') + '</span></td>' +
      '<td class="num">' + M.usd(row.claimed) + '</td>' +
      '<td class="num amber">' + (row.eligible ? M.usd(claimable) : '<span class="dim">—</span>') + '</td>' +
    '</tr>';
  }

  function renderLb() {
    var tb = $('lbBody');
    if (!tb) return;

    var rows = D.subs.slice();
    var W = root.ONLYPAD.wallet;
    if (W.connected) {
      var pos = W.position;
      var w = M.weight(pos.balance, pos.days, pos.neverSold);
      rows.push({
        demo: true, sim: !W.real, address: pos.address, balance: pos.balance, days: pos.days,
        neverSold: pos.neverSold, weight: w, eligible: w > 0,
        streak: M.renewals(pos.days), claimed: 0, you: true, rank: 9999
      });
    }
    var total = rows.reduce(function (a, b) { return a + b.weight; }, 0);
    rows.forEach(function (r) { r._claimable = M.share(r.weight, total, D.jar.pot, dropsOpen()); });

    var sorted = rows.slice().sort(function (a, b) {
      if (a.you) return 1;
      if (b.you) return -1;
      if (sortKey === 'claimable') return b._claimable - a._claimable;
      if (sortKey === 'claimed') return b.claimed - a.claimed;
      if (sortKey === 'streak') return b.streak - a.streak;
      return b.weight - a.weight;
    });
    /* the connected wallet always appears, even below the visible cut */
    var VISIBLE = 12;
    var visible = sorted.slice(0, VISIBLE);
    var youRow = sorted.filter(function (r) { return r.you; })[0];
    if (youRow && visible.indexOf(youRow) === -1) {
      visible[VISIBLE - 1] = youRow;
    }

    tb.innerHTML = visible.map(function (r) { return lbRow(r, total); }).join('');

    var meta = $('lbMeta');
    if (meta) {
      meta.textContent = rows.length + ' Subs · ' + Math.round(total).toLocaleString('en-US') +
        ' total weight · ' + D.subs.filter(function (r) { return !r.eligible; }).length +
        ' under the floor, excluded';
    }
    var foot = $('lbFoot');
    if (foot) foot.textContent = 'source: demo dataset — no wallet is read from chain in this build';
    var you = $('lbYou');
    if (you) you.hidden = !W.connected;
  }

  /* ---------- boot ---------- */
  function render() { renderJar(); renderYou(); renderLb(); }

  root.ONLYPAD.initEpoch = function () {
    render();
    setInterval(renderJar, 1000);

    var chips = $('lbSort');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(chips.querySelectorAll('button'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      sortKey = b.dataset.sort;
      renderLb();
    });

    var claim = $('claimJarBtn');
    if (claim) claim.addEventListener('click', function () {
      var pos = root.ONLYPAD.wallet.position;
      if (!pos) return;
      var w = M.weight(pos.balance, pos.days, pos.neverSold);
      var rows = D.subs.concat([{ weight: w }]);
      var total = rows.reduce(function (a, b) { return a + b.weight; }, 0);
      var amt = M.share(w, total, D.jar.pot, dropsOpen());
      root.ONLYPAD.app.toast('info', 'Not wired up yet',
        'This build has no chain connection, so nothing was signed. A real claim would send ' +
        M.usd(amt) + ' to your wallet.');
    });

    var skip = $('skipDrop');
    if (skip) skip.addEventListener('click', function () {
      if (skipped >= CFG.MAX_STACK - 1) {
        root.ONLYPAD.app.toast('warn', 'Stack is full',
          'Unclaimed Drops stack up to ' + CFG.MAX_STACK + '. Beyond that you need to claim.');
        return;
      }
      skipped++;
      render();
      root.ONLYPAD.app.toast('ok', 'Drop skipped (demo)',
        'The clock moved forward. ' + dropsOpen() + ' Drops are now open and stacked.');
    });
  };

  root.ONLYPAD.onWallet = function () { renderYou(); renderLb(); };
}(window, document));
