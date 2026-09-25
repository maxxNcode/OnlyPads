/* ==========================================================================
   CLAIM — api/feed.js
   GET /api/feed?limit=6&wallet=<addr>

   The live activity strip in the hero.

   ---------------------------------------------------------------------------
   WHAT CHANGED, AND WHY
   ---------------------------------------------------------------------------
   This used to read onlypad_events only. The browser then ignored it entirely and
   rendered a hardcoded demo list whose figures ticked upward once a second from
   a fabricated `rate` — a number that was invented, animated, and presented as
   "streaming as its coin trades". Nothing about it was real.

   It now returns what actually happened, newest first, from two real sources:

     claim  — a row in onlypad_events, written by POST /api/claim when an epoch or
              a vault actually settled.
     launch — a row in onlypad_coins, written when a coin was actually created on
              pump.fun from this site.

   A launch is included because until a coin has traded and been settled there
   are no claims to show, and an empty strip at launch would read as a broken
   page. A launch is not a claim and is not labelled as one — `kind` says which
   it is, and the client renders them differently.

   Every figure here comes from a row. Nothing is derived, estimated, animated
   or invented, which is the only way a strip called "live" means anything.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');
var db = require('./_lib/db');
var shape = require('./_lib/shape');
var solana = require('./_lib/solana');
var platform = require('./_lib/platform');
var pumpfun = require('./_lib/pumpfun');

var MAX_LIMIT = 50;

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['GET'])) return;

  var q = http.query(req);
  var limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || 6));
  var wallet = q.wallet && solana.isValidAddress(q.wallet) ? q.wallet : null;

  if (!env.dbConfigured()) {
    return http.ok(res, { ok: true, source: 'error', reason: 'database is not configured', items: [] });
  }

  /* ---- real claims ---- */
  var claimOpts = {
    select: 'id,kind,wallet,amount,weight,multiplier_bps,vault_id,epoch_index,tx_signature,created_at',
    order: 'created_at.desc',
    limit: limit
  };
  if (wallet) claimOpts.eq = { wallet: wallet };

  /* ---- real launches ---- */
  var launchOpts = {
    select: 'id,mint,name,ticker,image_url,holder_count,market_cap_usd,volume_24h_usd,liquidity_usd,created_at',
    eq: { status: 'live' },
    order: 'created_at.desc',
    limit: limit
  };

  var results = await Promise.all([
    db.select('onlypad_events', claimOpts),
    db.select('onlypad_coins', launchOpts)
  ]);

  var claimRows = results[0].ok && Array.isArray(results[0].data) ? results[0].data : [];
  var launchRows = results[1].ok && Array.isArray(results[1].data) ? results[1].data : [];

  var items = [];

  claimRows.forEach(function (row) {
    var e = shape.event(row);
    items.push({
      kind: 'claim',
      id: 'claim-' + e.id,
      at: e.at,
      wallet: e.wallet,
      amount: e.amount,
      epochIndex: e.epochIndex,
      txSignature: e.txSignature
    });
  });

  /* Live figures for every launch in the strip, from the same cached source the
     board uses. A launch row with no market cap would be a row with nothing to
     say. */
  var launchCoins = launchRows.map(shape.coin);
  if (launchCoins.length) {
    var live = await pumpfun.coins(launchCoins.map(function (c) { return c.mint; }), limit);
    launchCoins = launchCoins.map(function (c) {
      var l = live[c.mint];
      if (!l) return c;
      return Object.assign(c, {
        name: l.name || c.name,
        ticker: l.ticker || c.ticker,
        image: l.image || c.image,
        marketCap: l.marketCap === null ? c.marketCap : l.marketCap,
        liquidity: l.liquidity === null ? c.liquidity : l.liquidity,
        volume24h: l.volume24h,
        holders: l.holders
      });
    });
  }

  launchCoins.forEach(function (c) {
    items.push({
      kind: 'launch',
      id: 'launch-' + c.id,
      at: c.at,
      mint: c.mint,
      name: c.name,
      ticker: c.ticker,
      image: c.image,
      hue: c.hue,
      twitter: c.twitter || null,
      holders: c.holders,
      marketCap: c.marketCap,
      volume24h: c.volume24h,
      liquidity: c.liquidity
    });
  });

  // Newest first across BOTH kinds. A row with no timestamp sorts last rather
  // than throwing the order off — a null would make the comparator return NaN
  // and silently stop sorting.
  items.sort(function (a, b) {
    var ta = a.at ? Date.parse(a.at) : 0;
    var tb = b.at ? Date.parse(b.at) : 0;
    return tb - ta;
  });

  /*
   * THE PLATFORM TOKEN IS ALWAYS THE FIRST ROW.
   *
   * It is not an "event" — nothing happened to it — so it is not in the activity
   * sort at all. It is placed here, before the slice, which is the only way to
   * guarantee it survives the limit and cannot be pushed out by a busy minute.
   */
  var p = await platform.platformRow();
  var lead = {
    kind: 'platform',
    id: 'platform',
    at: p.at,
    mint: p.mint,
    name: p.name,
    ticker: p.ticker,
    image: p.image,
    hue: p.hue,
    twitter: p.twitter || null,
    marketCap: p.marketCap,
    liquidity: p.liquidity,
    volume24h: p.volume24h,
    holders: p.holders,
    dataSource: p.dataSource
  };

  items = [lead].concat(items.slice(0, Math.max(0, limit - 1)));

  return http.ok(res, {
    ok: true,
    source: items.length > 1 ? 'db' : 'empty',
    count: items.length,
    claims: claimRows.length,
    launches: launchRows.length,
    items: items
  }, 5);
});
