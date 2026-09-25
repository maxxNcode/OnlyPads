/* Page script for launched.html. External because the CSP is script-src 'self'. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(v) {
    if (v === null || v === undefined) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Number(v).toFixed(2);
  }

  var yr = $('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  var tbtn = $('themeBtn');
  if (tbtn) tbtn.addEventListener('click', function () {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var next = light ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('onlypad-theme', next); } catch (e) {}
    tbtn.setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  });

  /* The coin's own image, or the OnlyPads logo for the platform row — $ONLYPADS has
     no coin image because it is not deployed yet, and a monogram would read as a
     missing asset. A launched coin with no image yet gets a monogram, which is
     honest: it means we have not been given one. */
  function thumb(c) {
    var src = c.isPlatform ? '/brand/onlypad-mark.png' : (c.image || null);
    if (src) {
      return '<img class="ltable__im' + (c.isPlatform ? ' ltable__im--logo' : '') + '" src="' +
        h(src) + '" alt="" width="36" height="36" loading="lazy" decoding="async">';
    }
    var letter = String(c.ticker || c.name || '?').replace(/^\$/, '').trim().charAt(0).toUpperCase();
    return '<span class="ltable__im ltable__im--mono" aria-hidden="true">' + h(letter || '?') + '</span>';
  }

  function row(c, i) {
    var x = c.twitter
      ? '<a class="ofx" href="' + h(c.twitter) + '" target="_blank" rel="noopener noreferrer">X</a>'
      : '<span class="ltable__none">—</span>';
    var handle = c.creatorHandle || c.handle || null;
    var status;
    if (c.isPlatform) status = '<span class="ltable__tag ltable__tag--ok">Platform</span>';
    else if (!c.verified) status = '<span class="ltable__tag ltable__tag--warn">Unclaimed</span>';
    else if (c.creatorVerified === false) status = '<span class="ltable__tag ltable__tag--warn">Unconfirmed</span>';
    else status = '<span class="ltable__tag ltable__tag--ok">Verified</span>';

    return '<div class="ltable__row' + (c.isPlatform ? ' is-top' : '') + '">' +
      '<span class="ltable__n">' + (i + 1) + '</span>' +
      '<span class="ltable__coin">' + thumb(c) +
        '<span class="ltable__txt">' +
          '<b>' + h(c.ticker || '—') + '</b>' +
          '<span class="ltable__name">' + h(c.name || '') + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="ltable__cr">' +
        (handle ? '@' + h(handle) : '<span class="ltable__none">—</span>') +
        ' ' + x +
      '</span>' +
      '<span class="ta-r ltable__mono">' + (c.cutPct ? Math.round(c.cutPct * 100) + '%' : '—') + '</span>' +
      '<span class="ta-r ltable__mono">' + usd(c.marketCap) + '</span>' +
      '<span>' + status + '</span>' +
    '</div>';
  }

  var api = window.ONLYPAD && window.ONLYPAD.api;
  if (!api) {
    $('lrows').innerHTML = '<div class="ltable__msg">The API could not be loaded, so the registry cannot be read.</div>';
    return;
  }

  api.coins({ limit: 100 }).then(function (r) {
    var rows = $('lrows'), foot = $('lfoot');
    if (!r || !r.ok || !r.coins || !r.coins.length) {
      rows.innerHTML = '<div class="ltable__msg">' +
        (r && r.ok
          ? 'Nothing launched yet.'
          : 'The launch registry could not be reached.') +
      '</div>';
      if (foot) foot.textContent = '';
      return;
    }
    rows.innerHTML = r.coins.map(row).join('');
    var launched = r.coins.filter(function (c) { return !c.isPlatform; }).length;
    if (foot) {
      foot.textContent = launched
        ? launched + ' coin' + (launched === 1 ? '' : 's') + '.'
        : 'OnlyPads is the only coin here so far.';
    }
  }).catch(function () {
    $('lrows').innerHTML = '<div class="ltable__msg">The launch registry could not be reached.</div>';
  });
}());
