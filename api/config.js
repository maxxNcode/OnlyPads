/* ==========================================================================
   CLAIM — api/config.js
   GET /api/config

   Runtime configuration for the browser.

   The site is static, so anything the client needs must either be baked in at
   build time or fetched at runtime. Fetching is better here: the RPC URL and
   the deployed mint address can change without a rebuild.

   ONLY PUBLIC VALUES MAY EVER BE RETURNED FROM THIS ENDPOINT. The service role
   key and the Pinata JWT must never appear here — see the explicit guard at
   the bottom, which fails loudly if a private name is ever added to the map.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');

/** Names that must never be served. Checked at the bottom of this file. */
var FORBIDDEN = ['SERVICE_ROLE', 'SERVICE_KEY', 'PINATA', 'ADMIN_SECRET', 'SECRET', 'PRIVATE'];

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['GET'])) return;

  var payload = {
    ok: true,
    cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
    // A public RPC endpoint is not a secret, but it does carry an API key for
    // Helius, so it is served from the server environment rather than committed.
    rpcUrl: env.rpcUrl(),
    platformMint: env.platformMint(),
    // Where every launched coin's creator fee is routed, and the origin each
    // coin's own page lives on. Both are needed BEFORE the launch form is usable:
    // the fee wallet goes on chain permanently and the site URL goes into the
    // metadata that gets pinned, so neither may be guessed by the browser.
    feeWallet: env.feeWallet(),
    siteUrl: env.siteUrl(),
    features: {
      database: env.dbConfigured(),
      uploads: Boolean(env.pinataJwt()),
      launches: env.dbConfigured() && Boolean(env.pinataJwt()) && Boolean(env.rpcUrl())
    },
    epoch: {
      // Mirrored here so the client can render a countdown before it has
      // fetched /api/epoch for the first time.
      seconds: Number(process.env.EPOCH_SECONDS) || 900
    }
  };

  /* Guard: a config endpoint is the single easiest place to leak a secret by
     accident. If a forbidden name ever reaches this payload, fail closed
     rather than serve it. */
  var serialised = JSON.stringify(payload);
  for (var i = 0; i < FORBIDDEN.length; i++) {
    var marker = process.env[FORBIDDEN[i]] || process.env['SUPABASE_' + FORBIDDEN[i]];
    if (marker && serialised.indexOf(marker) !== -1) {
      console.error('[config] refusing to serve: a private value leaked into the public config payload');
      return http.fail(res, 500, 'config_leak', 'Configuration is misconfigured. Nothing was served.');
    }
  }
  if (/eyJ[A-Za-z0-9_-]{20,}/.test(serialised.replace(payload.rpcUrl || '', ''))) {
    // A JWT-shaped string anywhere other than the known RPC URL is a bug.
    console.error('[config] refusing to serve: a JWT-shaped value is present in the payload');
    return http.fail(res, 500, 'config_leak', 'Configuration is misconfigured. Nothing was served.');
  }

  return http.ok(res, payload, 300);
});
