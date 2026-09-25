/* ==========================================================================
   CLAIM — api/coin.js
   GET /api/coin?mint=<address>

   One coin, for its own page at /coin/<mint>.

   WHY A DEDICATED ENDPOINT RATHER THAN FILTERING /api/coins

   The coin page is the URL written into the coin's metadata and onto pump.fun,
   so it is the canonical address of that coin and it gets linked from outside.
   Fetching the whole board to pick one row out of it would make the page's cost
   grow with every launch, and would make a coin that has scrolled past the
   board's limit look like it does not exist.

   A 404 here is meaningful and is returned as one: the page then says the coin
   is not listed rather than rendering an empty shell.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');
var db = require('./_lib/db');
var shape = require('./_lib/shape');
var solana = require('./_lib/solana');
var platform = require('./_lib/platform');

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['GET'])) return;

  var q = http.query(req);
  var mint = typeof q.mint === 'string' ? q.mint.trim() : '';

  if (!mint) {
    return http.fail(res, 400, 'missing_mint', 'Pass ?mint=<address>.');
  }

  /* The platform token is not a row in onlypad_coins — it is synthesised — so it
     has to be answered before the table is consulted. */
  var platformMint = process.env.ONLYPAD_MINT || null;
  if (mint === 'platform' || (platformMint && mint === platformMint)) {
    return http.ok(res, {
      ok: true,
      source: 'platform',
      coin: await platform.platformRow()
    }, 5);
  }

  if (!solana.isValidAddress(mint)) {
    return http.fail(res, 400, 'invalid_mint', 'That is not a valid Solana mint address.');
  }

  if (!env.dbConfigured()) {
    return http.fail(res, 503, 'not_configured',
      'The coin registry is not configured yet. Set the database environment variables and redeploy.');
  }

  var r = await db.select('onlypad_coins', {
    /* The escrow embed, same as /api/coins: an UNCLAIMED coin's Cut has accrued
       and not been paid, and this page is where a creator comes to see that. */
    select: '*,onlypad_escrow(accrued_sol,claimed_sol)',
    eq: { mint: mint, status: 'live' },
    limit: 1
  });
  if (!r.ok) {
    console.error('[coin] lookup failed', r.error);
    return http.fail(res, 500, 'lookup_failed', 'The coin could not be looked up.');
  }
  if (!Array.isArray(r.data) || !r.data.length) {
    return http.fail(res, 404, 'not_found',
      'No coin launched from this site has that address.');
  }

  var coin = shape.coin(r.data[0]);

  /* How many other coins the same wallet has launched. Cheap, and it is the one
     piece of context that makes a coin page feel like part of a launchpad. */
  if (coin.launcher) {
    var mine = await db.select('onlypad_coins', {
      select: 'mint',
      eq: { launcher_wallet: coin.launcher, status: 'live' }
    });
    coin.launchedBy = coin.launcher;
    coin.launcherCoins = mine.ok && Array.isArray(mine.data) ? mine.data.length : 1;
  }

  return http.ok(res, {
    ok: true,
    source: 'db',
    coin: coin,
    siteUrl: env.siteUrl(),
    feeWallet: env.feeWallet()
  }, 5);
});
