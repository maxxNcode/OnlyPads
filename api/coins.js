/* ==========================================================================
   CLAIM — api/coins.js
   GET /api/coins?limit=24&q=&mode=

   The Launches board: every coin created from this site, newest first.

   THE PLATFORM TOKEN IS ALWAYS ROW ONE

   `$CLAIM` is pinned to index 0 in CODE, not by a sort key. A `rank_override`
   column would have been the obvious way and it is the wrong one: the platform
   token has to be first even when its market cap is the smallest thing on the
   board, and an ordering that depends on a value someone can edit is an ordering
   that can silently stop holding. So the row is built here and unshifted, and
   the client is told `featured: true` rather than being asked to guess.

   Its figures come from the environment with the site's existing defaults, so
   they can be corrected without a migration and without a redeploy of the page.

   THREE SOURCES, EACH LABELLED

   `db`    — real rows from onlypad_coins, written when a launch confirmed.
   `empty` — the database holds nothing yet, so the board shows the platform
             token and nothing else. There is deliberately NO demo fallback: a
             fabricated row is indistinguishable from a real one to a reader.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');
var db = require('./_lib/db');
var shape = require('./_lib/shape');
var platform = require('./_lib/platform');
var pumpfun = require('./_lib/pumpfun');

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['GET'])) return;

  var q = http.query(req);
  var limit = Math.min(Math.max(parseInt(q.limit, 10) || 24, 1), 100);
  var search = typeof q.q === 'string' ? q.q.trim().toLowerCase() : '';
  var mode = ['stream', 'ppv', 'lock'].indexOf(q.mode) !== -1 ? q.mode : null;

  var rows = [];
  var source = 'demo';

  if (env.dbConfigured()) {
    var r = await db.select('onlypad_coins', {
      /* The escrow embed is what makes the board honest about an UNCLAIMED coin:
         the Cut that has accrued but not been paid comes from its own table, so
         the card can show "in escrow" without a cached column that could drift. */
      select: '*,onlypad_escrow(accrued_sol,claimed_sol)',
      eq: { status: 'live' },
      order: 'created_at.desc',
      limit: limit
    });
    if (r.ok && Array.isArray(r.data)) {
      rows = r.data.map(shape.coin);
      source = 'db';
    }
  }

  /*
   * LIVE MARKET DATA FOR EVERY LAUNCHED COIN.
   *
   * `onlypad_coins` records that a coin EXISTS — it cannot know what it is worth,
   * because nothing writes market figures into it. Without this every launched
   * coin would sit at $0 market cap forever, which reads as a dead board.
   *
   * So each row is enriched from the pump.fun index, which is the same source the
   * coin's own page uses. Cached for a minute and fetched in bounded parallel —
   * see _lib/pumpfun.js. A coin the index cannot answer for keeps its stored
   * zeros rather than gaining invented ones.
   */
  if (rows.length) {
    var live = await pumpfun.coins(rows.map(function (c) { return c.mint; }), 24);
    rows = rows.map(function (c) {
      var l = live[c.mint];
      if (!l) return c;
      return Object.assign(c, {
        name: l.name || c.name,
        ticker: l.ticker || c.ticker,
        image: l.image || c.image,
        marketCap: l.marketCap === null ? c.marketCap : l.marketCap,
        liquidity: l.liquidity === null ? c.liquidity : l.liquidity,
        // These two are null from the index and stay null — the client shows an
        // em dash rather than a zero that looks like a measurement.
        volume24h: l.volume24h === null ? null : l.volume24h,
        holders: l.holders === null ? null : l.holders,
        marketDataSource: 'pump.fun'
      });
    });
  }

  /*
   * NO DEMO FALLBACK. An empty database means the board shows exactly one row —
   * the platform token — and says so.
   *
   * This used to substitute ten invented coins with invented market caps, which
   * is precisely what this board must not do: it lists coins that were really
   * created here, and a fabricated row is indistinguishable from a real one to
   * anyone reading the page.
   */
  source = rows.length ? 'db' : 'empty';

  /* Filters apply to the launched coins only. The platform token is not
     filterable and not searchable — hiding it would defeat the point of pinning
     it, and a search that returns nothing still has to show something. */
  var list = rows.filter(function (c) {
    if (mode && c.mode !== mode) return false;
    if (search && (c.name + ' ' + c.ticker).toLowerCase().indexOf(search) === -1) return false;
    return true;
  });

  var coins = [await platform.platformRow()].concat(list);

  return http.ok(res, {
    ok: true,
    source: source,
    total: coins.length,
    launched: rows.length,
    feeWallet: env.feeWallet(),
    coins: coins
  }, 5);
});
