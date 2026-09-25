/* ==========================================================================
   OnlyPads — api/rpc.js
   POST /api/rpc

   A same-origin JSON-RPC proxy to the Solana endpoint in the server environment.

   WHY THIS EXISTS — measured, not assumed:

     $ curl -X POST https://api.mainnet-beta.solana.com \
            -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash"}'
     -> HTTP 200, a blockhash

     ...the same request with `Origin: https://onlypads-ten.vercel.app` added:
     -> HTTP 403 {"code": 403, "message": "Access forbidden"}

   The public endpoint refuses browser-origin requests. A launch calls
   getLatestBlockhash as its very first network step, so the launch wizard died
   there on the live site before the wallet was ever prompted — the CSP allowed
   the host, the host simply would not answer.

   Two things fall out of proxying it:

   1. The browser only ever talks to its own origin, so no third party can break
      the launch by deciding it dislikes our Origin header.
   2. The RPC URL is no longer sent to the client at all. It used to be returned
      by /api/config, which meant an RPC URL carrying an API key was handed to
      every visitor. Now the key, if there is one, stays on the server.

   This is deliberately NOT an open relay. Only the methods the launcher and the
   coin pages actually call are forwarded, the body is size-capped, and the
   response is never cached. `sendTransaction` is on the list because a wallet
   that implements only `signTransaction` needs the app to broadcast for it.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');

/* Read-only calls the launcher, the coin page and the wallet layer make, plus
   the one write a sign-then-send wallet needs. Anything else is refused. */
var ALLOWED = [
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getEpochInfo',
  'getFeeForMessage',
  'getGenesisHash',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getParsedAccountInfo',
  'getRecentPrioritizationFees',
  'getSignatureStatuses',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTransaction',
  'getVersion',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction'
];

/** Refuse the whole request if any call in it is not on the list. */
function check(reqs) {
  for (var i = 0; i < reqs.length; i++) {
    var r = reqs[i];
    if (!r || typeof r !== 'object') return 'Every call must be a JSON-RPC object.';
    if (typeof r.method !== 'string') return 'Every call must name a method.';
    if (ALLOWED.indexOf(r.method) === -1) return 'This proxy does not forward "' + r.method + '".';
  }
  return null;
}

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['POST'])) return;

  var upstream = env.rpcUrl();
  if (!upstream) {
    return http.fail(res, 503, 'no_rpc', 'No Solana RPC is configured on the server.');
  }

  var body = await http.readJson(req, http.MAX_BODY);
  if (!body.ok) return http.fail(res, 400, 'bad_body', 'The request body was not usable JSON.');

  var payload = body.value;
  var reqs = Array.isArray(payload) ? payload : [payload];
  if (!reqs.length) return http.fail(res, 400, 'empty', 'No JSON-RPC call was supplied.');

  var bad = check(reqs);
  if (bad) return http.fail(res, 400, 'method_not_allowed', bad);

  var upstreamRes, text;
  try {
    upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    text = await upstreamRes.text();
  } catch (e) {
    return http.fail(res, 502, 'rpc_unreachable', 'The Solana endpoint could not be reached.');
  }

  /* Pass the upstream status through rather than flattening everything to 200:
     a 429 from the RPC is information the client should be able to see. */
  res.statusCode = upstreamRes.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}, { cors: false });
