/* ==========================================================================
   OnlyPads — the maths.
   Single source of truth. Every figure the UI shows comes from here, and if
   the Anchor program ever disagrees with this file, the UI is lying.
   Dual-mode: window.ONLYPAD.math in the browser, require()'d on the server.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ONLYPAD = root.ONLYPAD || {};
  root.ONLYPAD.math = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- configuration ---------- */
  var CFG = {
    /* The fee split, written on chain at launch and immutable.
       CUT is the default; the launcher may set it between CUT_MIN and CUT_MAX.
       TIPS and PAD are derived — see splitOf(). */
    SPLIT:     { CUT: 0.60, TIPS: 0.35, PAD: 0.05 },
    CUT_MIN:   0.40,
    CUT_MAX:   0.80,
    /* The Pad's share is always one eighth of whatever is left after the Cut.
       0.05 / (1 - 0.60) = 0.125. That is what makes 60/35/5 the default. */
    PAD_SHARE_OF_REST: 0.125,

    DROP_SEC:  900,      /* one Drop = 15 minutes, aligned to the wall clock */
    MAX_STACK: 12,       /* how many unclaimed Drops will stack */
    MIN_HOLD:  100,      /* $ONLYPADS under this is excluded from the weight set */
    BURN_SPLIT: 0.5,     /* half of every buyback burns, half fills the Tip Jar */

    EPOCH_SHIFT_MS: 0,   /* the demo's "skip a Drop" control moves this */
    MINT: '$ONLYPADS'
  };

  /* ---------- Proof of Sub ----------
     weight = balance x multiplier. The multiplier is piecewise-linear in days
     held, and the knots land on subscription months: 1 / 3 / 6 / 12 renewals.
     Deliberately slower than CLAIM's curve — a subscription should feel like
     one. Mirrors KNOTS in the Anchor program; keep the two in sync. */
  var CURVE = [
    { d: 0,   m: 1.0, tier: 'Fresh',        sub: 'day one' },
    { d: 30,  m: 1.5, tier: 'Subscribed',   sub: '1 renewal' },
    { d: 90,  m: 2.5, tier: 'Renewed',      sub: '3 renewals' },
    { d: 180, m: 4.0, tier: 'Loyal',        sub: '6 renewals' },
    { d: 365, m: 5.0, tier: 'Founding Sub', sub: '12 renewals' }
  ];
  var UNBROKEN = 5.0;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function nowSec() { return Math.floor((Date.now() + CFG.EPOCH_SHIFT_MS) / 1000); }

  /* The multiplier for a Sub who has held `days` without selling. */
  function multiplier(days, neverSold) {
    var d = Math.max(0, Number(days) || 0);
    var top = CURVE[CURVE.length - 1];
    if (neverSold && d >= top.d) return UNBROKEN;
    for (var i = 1; i < CURVE.length; i++) {
      var a = CURVE[i - 1], b = CURVE[i];
      if (d <= b.d) return a.m + (b.m - a.m) * ((d - a.d) / (b.d - a.d));
    }
    return UNBROKEN;
  }

  /* The tier name for a streak. "Unbroken" outranks the ladder. */
  function tierOf(days, neverSold) {
    var d = Math.max(0, Number(days) || 0);
    if (neverSold && d >= CURVE[CURVE.length - 1].d) {
      return { tier: 'Unbroken', sub: 'held since launch, never sold', m: UNBROKEN };
    }
    var found = CURVE[0];
    for (var i = 0; i < CURVE.length; i++) if (d >= CURVE[i].d) found = CURVE[i];
    return { tier: found.tier, sub: found.sub, m: found.m };
  }

  /* Streak in renewals (30-day periods) — how the UI talks about hold time. */
  function renewals(days) { return Math.floor(Math.max(0, Number(days) || 0) / 30); }

  /* A Sub's weight. Anything under MIN_HOLD is removed from the weight set
     entirely rather than given a zero share, so dust cannot dilute real Subs. */
  function weight(balance, days, neverSold) {
    var b = Number(balance) || 0;
    if (b < CFG.MIN_HOLD) return 0;
    return b * multiplier(days, neverSold);
  }

  /* ---------- Drops: the 15-minute Tip Jar epochs ---------- */
  function dropIndex(sec) { return Math.floor((sec == null ? nowSec() : sec) / CFG.DROP_SEC); }
  function secsLeftInDrop(sec) {
    var s = sec == null ? nowSec() : sec;
    return CFG.DROP_SEC - (s % CFG.DROP_SEC);
  }
  function dropProgress(sec) {
    return 1 - (secsLeftInDrop(sec) / CFG.DROP_SEC);
  }

  /* what a Sub can claim from the Tip Jar */
  function share(myWeight, totalWeight, jar, drops) {
    var w = Number(myWeight) || 0, tw = Number(totalWeight) || 0;
    if (!w || !tw) return 0;
    return (Number(jar) || 0) * (w / tw) * clamp(Number(drops) || 0, 0, CFG.MAX_STACK);
  }

  /* ---------- the three-way split ---------- */
  /* Given a creator's Cut, return the whole split. The Cut is the only number
     a launcher chooses; the other two follow from it. */
  function splitOf(cutPct) {
    var cut = clamp(Number(cutPct) || CFG.SPLIT.CUT, CFG.CUT_MIN, CFG.CUT_MAX);
    var rest = 1 - cut;
    var pad = rest * CFG.PAD_SHARE_OF_REST;
    return { cut: cut, tips: rest - pad, pad: pad };
  }

  /* The same split as whole percentages, guaranteed to add up to 100.
     Use this for anything a human reads. Rounding the three fractions
     independently does not work: 1 - 0.8 is 0.19999999999999996 in binary
     floating point, so an 80% cut renders as 80/17/2 and a 40% cut as
     40/53/8. A split that does not sum to 100 looks like a bug because it
     is one. Doing the arithmetic in integer percent space removes it. */
  function splitPct(cutPct) {
    var cut = Math.round(clamp(Number(cutPct) || CFG.SPLIT.CUT, CFG.CUT_MIN, CFG.CUT_MAX) * 100);
    var rest = 100 - cut;
    var pad = Math.round(rest * CFG.PAD_SHARE_OF_REST);
    return { cut: cut, tips: rest - pad, pad: pad };
  }

  /* how much of a coin's reward has actually reached the creator, 0..1.
     Verified coins sit at 1. Unclaimed coins sit low: the Cut is in escrow. */
  function cutReached(paid, escrow) {
    var p = Number(paid) || 0, e = Number(escrow) || 0;
    if (p + e <= 0) return 0;
    return p / (p + e);
  }

  /* how full the OnlyVault is — claimable vs already claimed out */
  function vaultFill(claimable, claimed) {
    var c = Number(claimable) || 0, d = Number(claimed) || 0;
    if (c + d <= 0) return 0;
    return c / (c + d);
  }

  /* ---------- formatting ---------- */
  function pct(v, dp) { return ((Number(v) || 0) * 100).toFixed(dp == null ? 0 : dp) + '%'; }
  function usd(v, dp) {
    var n = Number(v) || 0;
    if (dp == null) dp = n < 100 ? 2 : 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function usdShort(v) {
    var n = Number(v) || 0;
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }
  function sol(v, dp) { return (Number(v) || 0).toFixed(dp == null ? 3 : dp) + ' SOL'; }
  function short(addr, n) {
    var s = String(addr || '');
    if (s.length <= 10) return s;
    n = n || 4;
    return s.slice(0, n) + '…' + s.slice(-n);
  }

  return {
    CFG: CFG, CURVE: CURVE, UNBROKEN: UNBROKEN,
    clamp: clamp, nowSec: nowSec,
    multiplier: multiplier, tierOf: tierOf, renewals: renewals, weight: weight,
    dropIndex: dropIndex, secsLeftInDrop: secsLeftInDrop, dropProgress: dropProgress,
    share: share, splitOf: splitOf, splitPct: splitPct, cutReached: cutReached, vaultFill: vaultFill,
    pct: pct, usd: usd, usdShort: usdShort, sol: sol, short: short
  };
}));
