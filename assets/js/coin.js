/* Page script for coin.html. External because the CSP is script-src 'self'. */
(function () {
  'use strict';
  var M = window.ONLYPAD && window.ONLYPAD.math;
  function $(id) { return document.getElementById(id); }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usdOrDash(v) { return (v === null || v === undefined) ? '\u2014' : M.usdShort(v); }

  var yr = $('yr'); if (yr) yr.textContent = new Date().getFullYear();
  var tbtn = $('themeBtn');
  if (tbtn) tbtn.addEventListener('click', function () {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var next = light ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('onlypad-theme', next); } catch (e) {}
    tbtn.setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  });

  /* /coin/<mint> is rewritten to /coin, so the mint comes from the PATH, not the
     query string. Taking it from the query would break every shared link. */
  var parts = location.pathname.split('/').filter(Boolean);
  var mint = parts[0] === 'coin' ? (parts[1] || '') : '';
  var qsMint = new URLSearchParams(location.search).get('mint');
  if (!mint && qsMint) mint = qsMint;

  function fail(msg) {
    $('coinWrap').innerHTML = '<div class="ltable__msg">' + h(msg) + '</div>';
  }

  if (!mint) { fail('No coin was named in this link.'); return; }
  if (!M || !window.ONLYPAD.api) { fail('The page could not load its scripts. Reload it.'); return; }

  window.ONLYPAD.api.coin(mint).then(function (r) {
    if (!r || !r.ok || !r.coin) {
      fail((r && r.error && r.error.message) ||
        'That coin is not in the launch registry.');
      return;
    }
    var c = r.coin;
    var cut = Math.round((c.cutPct || 0.6) * 100);
    var locked = !c.verified;
    var unconfirmed = c.creatorVerified === false;
    var handle = c.handle || (c.ticker || '').replace(/^\$/, '').toLowerCase();

    var pill = c.isPlatform
      ? '<span class="ofpill">Platform</span>'
      : (locked
        ? '<span class="ofpill ofpill--warn">Unclaimed</span>'
        : '<span class="ofpill">Verified</span>');

    /* THE ESCROW BLOCK. This is the thing this page exists for: a creator arrives
       here to find out whether money is waiting for them, and an UNCLAIMED coin
       has paid them NOTHING — the Cut is in escrow. The copy must never say
       "paid" for an unclaimed coin. */
    var escrow;
    if (c.isPlatform) {
      escrow = '<div class="oflocktile">' +
        '<div class="oflocktile__ic">' + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' + '</div>' +
        '<div class="oflocktile__h">The Pad token</div>' +
        '<div class="oflocktile__v">\u2014</div>' +
        '<div class="oflocktile__s">no Cut, no escrow</div></div>';
    } else if (locked) {
      escrow = '<div class="oflocktile">' +
        '<div class="oflocktile__ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>' +
        '<div class="oflocktile__h">In Creator Escrow</div>' +
        '<div class="oflocktile__v">' + (c.escrow ? M.usd(c.escrow, 0) : '\u2014') + '</div>' +
        '<div class="oflocktile__s">@' + h(handle) + ' has not claimed</div></div>';
    } else {
      escrow = '<div class="oflocktile">' +
        '<div class="oflocktile__ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></div>' +
        '<div class="oflocktile__h">Creator verified</div>' +
        '<div class="oflocktile__v">' + (c.escrow ? M.usd(c.escrow, 0) : '\u2014') + '</div>' +
        '<div class="oflocktile__s">unclaimed balance</div></div>';
    }

    var x = c.twitter
      ? '<a class="ofx" href="' + h(c.twitter) + '" target="_blank" rel="noopener noreferrer">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.6l-5.2-6.8L5.4 22H2.3l7.6-8.7L1.6 2h6.8l4.7 6.2L18.9 2zm-1.1 18h1.8L7.3 3.8H5.3L17.8 20z"/></svg>X</a>'
      : '';

    document.title = (c.ticker || 'Coin') + ' — OnlyPads';
    $('coinWrap').innerHTML =
      '<article class="ofpanel coin__panel">' +
        '<div class="ofcover">' +
          '<span class="tag tag--' + h(c.mode || 'stream') + ' ofcover__mode">' +
            h(c.isPlatform ? 'Platform' : (c.mode === 'ppv' ? 'PPV' : (c.mode === 'lock' ? 'Lock' : 'Stream'))) + '</span>' +
          '<div class="ofcover__mark">' + h(c.ticker || '') + '</div>' +
        '</div>' +
        '<div class="ofpanel__b">' +
          '<div class="ofidrow">' +
            '<div class="ofav">' + h(String(c.name || c.ticker || '?').trim().charAt(0).toUpperCase()) + '</div>' +
            '<div class="ofid">' +
              '<div class="ofid__n">' + h(c.name || c.ticker || '') + '</div>' +
              '<div class="ofid__h">@' + h(handle) + '</div>' +
              x +
            '</div>' +
          '</div>' +
          '<div class="ofmeta" style="margin-top:16px">' + pill +
            '<span class="ofamount' + (locked ? ' ofamount--warn' : '') + '">' +
              cut + '%<em>/</em>to creator</span>' +
          '</div>' +
          '<div class="ofsub"><span>' +
            (c.subs ? c.subs.toLocaleString('en-US') + ' Subs' : 'no Subs yet') +
            ' \u00b7 ' + cut + '% to creator</span></div>' +
          '<div class="ofmkt">' +
            '<div><b>' + usdOrDash(c.marketCap) + '</b><span>Market cap</span></div>' +
            '<div><b>' + usdOrDash(c.volume24h) + '</b><span>Volume 24h</span></div>' +
            '<div><b>' + usdOrDash(c.liquidity) + '</b><span>Liquidity</span></div>' +
          '</div>' +
          '<div class="ofstrip">' + escrow + '</div>' +
          (unconfirmed
            ? '<p class="wiz__warn" style="margin-top:14px">Listed, but the creator could not be confirmed ' +
              'against the pump.fun index when it was recorded. The coin is real \u2014 its mint was checked ' +
              'on chain \u2014 but this listing is flagged as unconfirmed.</p>'
            : '') +
          '<div class="ofaction">' +
            '<a class="btn btn--primary btn--full" href="https://pump.fun/coin/' + h(c.mint) + '" ' +
              'target="_blank" rel="noopener noreferrer">Open on pump.fun</a>' +
            '<div class="ofcue">' +
              (locked ? 'Locked until they claim' : 'The Cut is paid in SOL to the creator\u2019s wallet') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>' +
      '<p class="coin__meta">' +
        'Mint <code>' + h(c.mint) + '</code>' +
        (c.launchedBy ? ' \u00b7 launched by <code>' + h(c.launchedBy) + '</code>' : '') +
        (c.launchedBy && c.launcherCoins > 1 ? ' \u00b7 ' + c.launcherCoins + ' coins launched' : '') +
      '</p>';
  }).catch(function () {
    fail('The launch registry could not be reached, so this coin cannot be shown.');
  });
}());
