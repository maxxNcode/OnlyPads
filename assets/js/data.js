/* ==========================================================================
   OnlyPad — demo dataset.
   EVERYTHING IN THIS FILE IS SIMULATED. The creators are invented stage
   handles, not real people, and no figure here is read from chain. Each record
   carries demo:true and the UI badges it DEMO. Replace this file with a real
   /api/onlys read when the backend exists; nothing else needs to change.
   Fixed seed, so the board does not reshuffle on reload — only the clock moves.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---------- seeded PRNG (mulberry32) ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var R = rng(20260924);
  function between(lo, hi) { return lo + R() * (hi - lo); }
  function pick(arr) { return arr[Math.floor(R() * arr.length)]; }

  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function addr() {
    var s = '';
    for (var i = 0; i < 44; i++) s += B58[Math.floor(R() * B58.length)];
    return s;
  }

  /* ---------- the creators ----------
     Invented stage handles. Deliberately not real names and not real people. */
  var CREATORS = [
    { handle: 'lumen',     name: 'Lumen',      verified: true,  mode: 'stream', cut: 0.60 },
    { handle: 'velvet',    name: 'Velvet',     verified: true,  mode: 'stream', cut: 0.70 },
    { handle: 'northstar', name: 'Northstar',  verified: false, mode: 'stream', cut: 0.60 },
    { handle: 'cassia',    name: 'Cassia',     verified: true,  mode: 'ppv',    cut: 0.50 },
    { handle: 'juniper',   name: 'Juniper',    verified: false, mode: 'stream', cut: 0.60 },
    { handle: 'sable',     name: 'Sable',      verified: true,  mode: 'stream', cut: 0.80 },
    { handle: 'marlow',    name: 'Marlow',     verified: true,  mode: 'lock',   cut: 0.60 },
    { handle: 'quill',     name: 'Quill',      verified: false, mode: 'stream', cut: 0.50 },
    { handle: 'orla',      name: 'Orla',       verified: true,  mode: 'stream', cut: 0.60 },
    { handle: 'halcyon',   name: 'Halcyon',    verified: true,  mode: 'stream', cut: 0.70 },
    { handle: 'wren',      name: 'Wren',       verified: false, mode: 'ppv',    cut: 0.60 },
    { handle: 'indigo',    name: 'Indigo',     verified: true,  mode: 'stream', cut: 0.60 }
  ];

  var M = root.ONLYPAD && root.ONLYPAD.math;
  function split(cut) { return M ? M.splitOf(cut) : { cut: cut, tips: 1 - cut - 0.05, pad: 0.05 }; }

  /* ---------- marquee creators ----------
     The six featured handles the board shows. Like everything in this file,
     they are invented and demo-flagged; they read as the platform's anchor
     creators until a real /api/onlys replaces them. */
  var MARQUEE = [
    { handle: 'velvet',   name: 'Velvet',   verified: true,  cut: 0.70, tag: 'Top creator',        audience: '4.2M followers' },
    { handle: 'sable',    name: 'Sable',    verified: true,  cut: 0.80, tag: 'Top creator',        audience: '2.8M followers' },
    { handle: 'halcyon',  name: 'Halcyon',  verified: true,  cut: 0.70, tag: 'Verified',           audience: '1.9M followers' },
    { handle: 'lumen',    name: 'Lumen',    verified: true,  cut: 0.60, tag: 'Verified',           audience: '1.4M followers' },
    { handle: 'orla',     name: 'Orla',     verified: true,  cut: 0.60, tag: 'Verified',           audience: '980K followers' },
    { handle: 'cassia',   name: 'Cassia',   verified: true,  cut: 0.50, tag: 'Verified',           audience: '760K followers' }
  ];

  var onlys = CREATORS.map(function (c, i) {
    var sp = split(c.cut);
    /* total creator reward this coin has generated, all time */
    var generated = between(420, 38000) * (c.verified ? 1 : 0.55);
    var creatorShare = generated * sp.cut;
    var tipsShare = generated * sp.tips;

    /* Tips: some already claimed out of the OnlyVault, some still sitting there */
    var claimed = tipsShare * between(0.30, 0.78);
    var claimable = tipsShare - claimed;

    /* The Cut. A verified creator is paid as it accrues. On a Fan Launch the
       Cut has never been claimed — it is sitting in Creator Escrow. */
    var paid = c.verified ? creatorShare : 0;
    var escrow = c.verified ? 0 : creatorShare;

    return {
      demo: true,
      id: 'only-' + c.handle,
      handle: c.handle,
      name: c.name,
      ticker: '$' + c.handle.toUpperCase(),
      verified: c.verified,
      mode: c.mode,
      cut: sp.cut, tips: sp.tips, pad: sp.pad,
      generated: generated,
      paid: paid,
      escrow: escrow,
      claimable: claimable,
      claimed: claimed,
      mcap: between(4200, 940000) * (c.verified ? 1 : 0.6),
      vol24: 0,
      subs: Math.round(between(38, 3400)),
    fans: c.fans || 0,
      days: Math.round(between(2, 430)),
      rank: i + 2
    };
  });
  onlys.forEach(function (o) {
    o.vol24 = o.mcap * between(0.04, 0.38);
    o.liq = o.mcap * between(0.08, 0.18);   /* pool depth — the board's Liquidity column */
  });
  onlys.sort(function (a, b) { return b.mcap - a.mcap; });
  onlys.forEach(function (o, i) { o.rank = i + 2; });

  /* ---------- fan counts ----------
     Invented audience sizes for the demo board. The seed ensures a stable
     shuffle, so a given creator keeps the same figure on every reload. */
  var FANS = [8200, 6100, 4700, 3100, 1900, 1400, 1100, 860, 640, 520, 410, 380];
  onlys.forEach(function (o, i) {
    if (!o.fans) o.fans = FANS[i % FANS.length] + Math.round(between(0, 240));
  });

  /* ---------- the six marquee cards ----------
     Sorted by audience, seeded so mcap, volume and fees look plausible and
     stay fixed across reloads. Each card keeps its own record from `onlys`. */
  var marquee = MARQUEE.map(function (m) {
    var o = onlys.filter(function (x) { return x.handle === m.handle; })[0];
    return Object.assign({}, o, {
      isMarquee: true,
      tag: m.tag,
      audience: m.audience,
      fans: 8200 + Math.round(between(0, 82000))
    });
  });

  /* ---------- the platform coin ---------- */
  var platform = {
    demo: true,
    mint: '$ONLY',
    address: 'ONLYpad' + addr().slice(7),
    mcap: 1180000,
    vol24: 186400,
    liq: 142300,
    burned: 4820000,
    queued: 812.40,
    jar: 0,
    holders: 3142
  };

  /* ---------- the Tip Jar ---------- */
  var jar = {
    demo: true,
    pot: between(180, 900),
    dropsOpen: 3,
    burnSplit: 0.5,
    queued: platform.queued
  };
  platform.jar = jar.pot;

  /* ---------- live feed ----------
     Mixed on purpose: launches and payouts, the way the reference reads. A
     launch row carries the split instead of an amount, because a coin that has
     just been created has not paid anyone yet. */
  var feed = [];
  function splitLabel(cut) {
    var s = M ? M.splitPct(cut) : { cut: 60, tips: 35, pad: 5 };
    return s.cut + '/' + s.tips + '/' + s.pad;
  }
  for (var i = 0; i < 4; i++) {
    var lo = onlys[Math.floor(R() * onlys.length)];
    feed.push({
      demo: true,
      kind: 'launch',
      name: lo.name,
      handle: lo.handle,
      ticker: lo.ticker,
      verified: lo.verified,
      mode: lo.mode,
      split: splitLabel(lo.cut),
      who: addr().slice(0, 4) + '…' + addr().slice(-4),
      secsAgo: Math.round(between(120, 4200))
    });
  }
  for (var k = 0; k < 6; k++) {
    var o = onlys[Math.floor(R() * onlys.length)];
    var isCut = R() > 0.42;
    feed.push({
      demo: true,
      kind: isCut ? 'cut' : 'tips',
      name: o.name,
      handle: o.handle,
      ticker: o.ticker,
      verified: o.verified,
      amount: isCut ? between(0.8, 240) : between(0.4, 96),
      who: isCut ? ('@' + o.handle) : (addr().slice(0, 4) + '…' + addr().slice(-4)),
      secsAgo: Math.round(between(4, 900))
    });
  }
  feed.sort(function (a, b) { return a.secsAgo - b.secsAgo; });

  /* ---------- the Sub leaderboard ----------
     48 rows from a fixed seed, so the board never reshuffles. Four of them sit
     under MIN_HOLD on purpose: they are excluded from the weight set entirely,
     not given a zero share, and the UI has to show that correctly. */
  var subs = [];
  for (var s = 0; s < 48; s++) {
    var balance = s < 4 ? between(12, 98) : between(140, 62000);
    var days = Math.round(between(1, 420));
    var neverSold = R() > 0.82;
    var w = M ? M.weight(balance, days, neverSold) : balance;
    subs.push({
      demo: true,
      address: addr(),
      balance: balance,
      days: days,
      neverSold: neverSold,
      weight: w,
      eligible: w > 0,
      streak: M ? M.renewals(days) : Math.floor(days / 30),
      claimed: between(0, 1400)
    });
  }
  var totalWeight = subs.reduce(function (a, b) { return a + b.weight; }, 0);
  subs.forEach(function (row) {
    row.shareOfJar = totalWeight ? row.weight / totalWeight : 0;
    row.claimable = row.shareOfJar * jar.pot * jar.dropsOpen;
  });
  subs.sort(function (a, b) { return b.weight - a.weight; });
  subs.forEach(function (row, i) { row.rank = i + 1; });

  root.ONLYPAD = root.ONLYPAD || {};
  root.ONLYPAD.data = {
    source: 'demo',
    onlys: onlys,
    marquee: marquee,
    platform: platform,
    jar: jar,
    feed: feed,
    subs: subs,
    totalWeight: totalWeight
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
