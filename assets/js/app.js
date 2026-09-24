/* ==========================================================================
   OnlyPad — page behaviour.
   Three numbers and one button. Reads ONLYPAD.data (simulated) through
   ONLYPAD.math, so no figure here is invented locally.
   ========================================================================== */
(function (root, doc) {
  'use strict';

  var M = root.ONLYPAD.math;
  var D = root.ONLYPAD.data;

  function $(id) { return doc.getElementById(id); }
  function sum(key) {
    return D.onlys.reduce(function (a, o) { return a + o[key]; }, 0);
  }

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

  function boot() {
    var yr = $('yr');
    if (yr) yr.textContent = new Date().getFullYear();

    /* The three figures. Every one comes from the demo dataset, which is why
       the note under the strip says so. */
    var stats = {
      onlys:     D.onlys.length.toLocaleString('en-US'),
      generated: M.usd(sum('generated'), 0),
      paid:      M.usd(sum('paid'), 0)
    };
    Object.keys(stats).forEach(function (k) {
      var el = doc.querySelector('[data-stat="' + k + '"]');
      if (el) el.textContent = stats[k];
    });

    /* The featured-creator board. Exactly six marquee cards — that is the
       whole board now, not a lead-in to a longer list. */
    var board = $('board');
    if (board) {
      var frag = doc.createDocumentFragment();
      D.marquee.slice(0, 6).forEach(function (o) {
        var sp = M.splitPct(o.cut);
        var card = doc.createElement('article');
        card.className = 'creator' + (o.isMarquee ? ' creator--marquee' : '');
        card.innerHTML =
          '<div class="creator__top">' +
            '<div class="creator__ava" aria-hidden="true"></div>' +
            '<div class="creator__id">' +
              '<div class="creator__name"></div>' +
              '<div class="creator__handle"></div>' +
            '</div>' +
            (o.tag ? '<span class="creator__tag"></span>' : '') +
          '</div>' +
          '<div class="creator__cut"><b>' + sp.cut + '%</b> of creator fees <span class="accent">\u2192 their wallet</span></div>' +
          '<div class="creator__stats">' +
            '<div class="creator__stat"><div class="creator__k">Coin mcap</div><div class="creator__v"></div></div>' +
            '<div class="creator__stat"><div class="creator__k">24h vol</div><div class="creator__v"></div></div>' +
            '<div class="creator__stat"><div class="creator__k">Subs</div><div class="creator__v"></div></div>' +
            '<div class="creator__stat"><div class="creator__k">Fans boosted</div><div class="creator__v"></div></div>' +
          '</div>' +
          '<div class="creator__foot">' +
            '<span class="creator__aud"></span>' +
            '<button class="btn btn--primary" type="button" data-boost="' + o.handle + '">Boost</button>' +
          '</div>';
        card.querySelector('.creator__ava').textContent = (o.name || o.handle || '?').charAt(0).toUpperCase();
        card.querySelector('.creator__name').textContent = o.name || o.handle;
        if (o.verified) {
          var v = doc.createElement('span');
          v.className = 'creator__vcheck';
          v.title = 'Creator verified';
          v.textContent = '\u2713';
          card.querySelector('.creator__name').appendChild(v);
        }
        card.querySelector('.creator__handle').textContent = '@' + o.handle + ' \u00b7 ' + o.ticker;
        var tagEl = card.querySelector('.creator__tag');
        if (tagEl) tagEl.textContent = o.tag || '';
        var vals = card.querySelectorAll('.creator__v');
        vals[0].textContent = M.usdShort(o.mcap);
        vals[1].textContent = M.usdShort(o.vol24);
        vals[2].textContent = (o.subs || 0).toLocaleString('en-US');
        vals[3].textContent = (o.fans || 0).toLocaleString('en-US');
        card.querySelector('.creator__aud').textContent = o.audience || '';
        frag.appendChild(card);
      });
      board.appendChild(frag);
    }

    /* The boost action on a card says plainly that nothing is connected to a
       chain rather than silently doing nothing when clicked. */
    board = $('board');
    if (board) {
      Array.prototype.forEach.call(board.querySelectorAll('[data-boost]'), function (b) {
        b.addEventListener('click', function () {
          toast('Not wired up yet',
            'Boosting needs the pump.fun fee-sharing SDK and a signed transaction. ' +
            'This build has no chain connection, so nothing was created.');
        });
      });
    }

    /* One action. It says plainly that nothing is connected to a chain rather
       than silently doing nothing when clicked. */
    Array.prototype.forEach.call(doc.querySelectorAll('[data-launch]'), function (b) {
      b.addEventListener('click', function () {
        toast('Not wired up yet',
          'Launching needs the pump.fun fee-sharing SDK and a signed transaction. ' +
          'This build has no chain connection, so no coin was created.');
      });
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
}(window, document));
