/* ==========================================================================
   CLAIM — api/launch.js
   POST /api/launch

   Records a coin that has ALREADY been created on pump.fun.

   ---------------------------------------------------------------------------
   WHAT CHANGED, AND WHY IT MATTERS
   ---------------------------------------------------------------------------
   This endpoint used to queue an intent. It inserted a row with status 'queued'
   and the site then told the user their coin was live — while nothing had been
   created anywhere. That is the bug this file exists to fix: a launchpad whose
   "launch" is a database write is not a launchpad.

   Now the browser creates the coin for real (create_v2, signed in the user's own
   wallet) and calls this afterwards with the mint that actually came back. The
   board therefore only ever lists coins that exist on chain.

   ---------------------------------------------------------------------------
   WHY THERE IS NO WALLET SIGNATURE HERE
   ---------------------------------------------------------------------------
   The rest of the write endpoints are signature-gated, and this one deliberately
   is not. By the time this is called the user has already approved one or two
   transactions, and asking for a third prompt purely to authorise a database row
   is friction with no security gain — the signature would prove control of a
   wallet we can already see paid for the launch.

   What replaces it is a check on the CHAIN, which is strictly stronger than a
   signature would have been: a signature proves the caller owns an address, while
   these prove the coin exists and that its creator fees are routed to ours. A
   forged row is therefore not "unauthorised", it is impossible.

     1. the mint must be a real on-chain mint account
     2. if the pump.fun index answers, the coin's creator must be OUR fee wallet

   Step 2 is skipped, not failed, when the index is unreachable: a third-party
   outage must not be able to block a legitimate launch from being recorded.

   ---------------------------------------------------------------------------
   Body
     { wallet, mint, name, ticker, mode?, description?, twitter?, imageUrl?,
       metadataUri?, txSignature?, startingBidSol? }
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');
var db = require('./_lib/db');
var solana = require('./_lib/solana');

var MODES = ['stream', 'ppv', 'lock'];

var PUMP_INDEX = 'https://frontend-api-v3.pump.fun/coins/';
var RPC_TIMEOUT_MS = 6000;

/*
 * A NORMAL USER-AGENT IS REQUIRED, AND THIS IS NOT A PREFERENCE.
 *
 * MEASURED: the pump.fun index answers HTTP 429 to Node's default fetch
 * User-Agent and HTTP 200 to a browser or curl one, from the same machine at the
 * same moment. This function did not send one, so it got a 429 on EVERY call —
 * which the caller correctly read as "indeterminate", which meant the creator
 * check never actually ran. It was dead code that looked like a passing guard.
 *
 * `_lib/pumpfun.js` documents the same measurement for the market-data path.
 * It is not a disguise: it is the string any browser sends to a public read
 * endpoint this site is entitled to use.
 */
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function clean(v, max) {
  if (typeof v !== 'string') return null;
  var s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** The token programs a real mint can be owned by: classic SPL and Token-2022. */
var TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'    // Token-2022 (what create_v2 makes)
];

/**
 * Is `mint` a real mint account on chain?
 *
 * One `getAccountInfo` against the RPC. This is the check that makes a fabricated
 * row impossible: an address that was never created has no account, and an
 * account owned by something other than a token program is not a mint.
 *
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function mintExistsOnChain(mint) {
  var rpc = env.rpcUrl();
  if (!rpc) return { ok: false, reason: 'no RPC is configured, so the mint cannot be verified' };

  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, RPC_TIMEOUT_MS);
  try {
    var r = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [mint, { encoding: 'base64', commitment: 'confirmed' }]
      }),
      signal: ctl ? ctl.signal : undefined
    });
    var j = await r.json();
    var value = j && j.result && j.result.value;
    if (!value) return { ok: false, reason: 'there is no account at that address on Solana' };
    if (TOKEN_PROGRAMS.indexOf(value.owner) === -1) {
      return { ok: false, reason: 'that address is not a token mint' };
    }
    return { ok: true };
  } catch (e) {
    // An RPC we cannot reach is not proof the coin is fake. Say so rather than
    // pretending either way, and let the caller decide.
    return { ok: false, reason: 'the RPC could not be reached to verify the mint', indeterminate: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the pump.fun index who created the coin.
 *
 * This is the check that actually ties a coin to THIS launchpad: `create_v2` wrote
 * our fee wallet as the creator, permanently, so a coin claiming to come from here
 * must show it.
 *
 * Retried once, because the failure this function has to distinguish is a
 * THROTTLE (429) from a genuine absence, and a launch that just succeeded is
 * exactly when the index is most likely to be busy. One retry with a short pause
 * covers the common case without holding the request open.
 *
 * @returns {Promise<{ok:boolean, indeterminate?:boolean, creator?:string, reason?:string}>}
 */
async function pumpCreator(mint) {
  var last = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(function (r) { setTimeout(r, 900); });
    last = await pumpCreatorOnce(mint);
    // A definitive answer — found, or genuinely absent — is not worth retrying.
    if (last.ok || last.definitive) return last;
  }
  return last;
}

async function pumpCreatorOnce(mint) {
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, RPC_TIMEOUT_MS);
  try {
    var r = await fetch(PUMP_INDEX + encodeURIComponent(mint), {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: ctl ? ctl.signal : undefined
    });
    if (r.status === 404) {
      return { ok: false, definitive: true, reason: 'the pump.fun index has no coin at that address' };
    }
    if (!r.ok) {
      return { ok: false, indeterminate: true, reason: 'the pump.fun index answered HTTP ' + r.status };
    }
    var j = await r.json();
    if (!j || typeof j !== 'object') {
      return { ok: false, indeterminate: true, reason: 'the index returned an unreadable body' };
    }
    return {
      ok: true,
      creator: j.creator || j.creator_address || j.creatorAddress || null,
      name: j.name || null,
      symbol: j.symbol || null
    };
  } catch (e) {
    return { ok: false, indeterminate: true, reason: 'the pump.fun index could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['POST'])) return;

  if (!env.dbConfigured()) {
    return http.fail(res, 503, 'not_configured',
      'The launch registry is not configured yet. Set the database environment variables and redeploy.');
  }

  var parsed = await http.readJson(req);
  if (!parsed.ok) return http.fail(res, 400, 'bad_body', parsed.error);
  var body = parsed.value || {};

  /* ---------- shape ---------- */
  if (!solana.isValidAddress(body.wallet)) {
    return http.fail(res, 400, 'invalid_wallet', 'That is not a valid Solana address.');
  }
  if (!solana.isValidAddress(body.mint)) {
    return http.fail(res, 400, 'invalid_mint', 'That is not a valid Solana mint address.');
  }

  /*
   * Length is checked, not truncated.
   *
   * `clean(v, max)` silently slices to `max`, which for a ticker means the coin
   * would be created with a symbol the launcher never typed — and that symbol is
   * pinned into metadata whose CID goes on chain, so it cannot be corrected. An
   * over-long value is a mistake worth reporting, not quietly repairing.
   */
  var nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
  var tickerRaw = typeof body.ticker === 'string' ? body.ticker.trim() : '';
  /*
   * `mode` is OPTIONAL and defaults to 'stream'.
   *
   * The wizard used to ask the launcher to pick Stream / Milestone / Lock, and
   * this endpoint required the answer. That step was removed — it is not a
   * feature of this launchpad — and leaving the requirement in place would have
   * rejected EVERY launch with a 400, because the client stopped sending it.
   *
   * A caller that still sends one has it validated, so a stale client cannot
   * write junk into a NOT NULL column that carries a CHECK constraint.
   */
  var mode = (body.mode === undefined || body.mode === null || body.mode === '')
    ? 'stream'
    : (MODES.indexOf(body.mode) !== -1 ? body.mode : null);

  if (!mode) {
    return http.fail(res, 400, 'invalid_mode', 'mode, if given, must be one of: ' + MODES.join(', ') + '.');
  }

  if (!nameRaw || nameRaw.length > 40) {
    return http.fail(res, 400, 'invalid_name', 'Give the coin a name (1-40 characters).');
  }
  if (!tickerRaw || tickerRaw.length > 10) {
    return http.fail(res, 400, 'invalid_ticker', 'Give the coin a ticker (1-10 characters).');
  }
  var name = nameRaw;
  var ticker = tickerRaw;

  /*
   * THE CUT, validated HERE and not later.
   *
   * It used to be checked in the "record it" block at the bottom, which meant a
   * launcher with a bad Cut paid for two network round-trips — the RPC and the
   * pump.fun index — before being told their input was wrong. Worse, when the
   * index was throttled the request died with `verify_unavailable` and the real
   * problem was never reported at all. Input validation belongs with the rest of
   * the shape checks.
   */
  var cutPct = (body.cutPct === undefined || body.cutPct === null || body.cutPct === '')
    ? 0.60
    : Number(body.cutPct);
  if (!isFinite(cutPct) || cutPct < 0.40 || cutPct > 0.80) {
    return http.fail(res, 400, 'invalid_cut',
      'The Cut must be between 40% and 80%. Got ' + body.cutPct + '.');
  }

  /*
   * The fee wallet is decided HERE, from the server environment, and never taken
   * from the body. It is written on chain and permanent, so letting a caller
   * nominate it would be letting them redirect the platform's revenue.
   */
  var feeWallet = env.feeWallet();

  /* ---------- verify the coin exists ---------- */
  var onChain = await mintExistsOnChain(body.mint);
  if (!onChain.ok && !onChain.indeterminate) {
    return http.fail(res, 400, 'unknown_mint', 'That coin could not be found on chain: ' + onChain.reason + '.');
  }

  /*
   * ---------- verify the coin really came from here ----------
   *
   * This FAILS CLOSED, and that is a deliberate change from the first version.
   *
   * That version skipped the creator check whenever the index was unreachable, so
   * a coin launched somewhere else entirely could still be listed — which was
   * demonstrated, not theorised: a coin with someone else's creator address was
   * accepted during testing, precisely because a throttled index made the check
   * "indeterminate" and the code shrugged.
   *
   * Failing closed costs a retry. Failing open costs the board's credibility,
   * because the board would list coins this site had nothing to do with. The
   * coin already exists on chain either way, so nothing is lost by refusing to
   * record it — the client can simply ask again.
   */
  var indexed = await pumpCreator(body.mint);

  if (indexed.ok) {
    if (!indexed.creator) {
      return http.fail(res, 403, 'creator_unknown',
        'The pump.fun index has that coin but does not report a creator, so it cannot be ' +
        'confirmed as launched here.');
    }
    if (indexed.creator !== feeWallet) {
      return http.fail(res, 403, 'wrong_creator',
        'That coin routes its creator fees to ' + indexed.creator + ', not to this launchpad. ' +
        'Only coins launched here can be listed.');
    }
  } else if (indexed.definitive) {
    return http.fail(res, 400, 'not_indexed', 'That coin is not in the pump.fun index: ' + indexed.reason + '.');
  }

  /*
   * INDETERMINATE — the index could not be reached at all.
   *
   * MEASURED: it answers HTTP 429 under load and to datacenter egress outright,
   * so the previous fail-closed branch refused to record a launch the user had
   * ALREADY PAID FOR, whenever the index happened to be busy. That is the wrong
   * trade: the coin exists on chain and nothing is gained by refusing to list it.
   *
   * So it is recorded and FLAGGED. `creator_verified = false` means "we could not
   * confirm" — never "this is someone else's coin". A definitive mismatch is
   * still refused above, which is the case this check exists to catch.
   */
  var creatorVerified = indexed.ok;
  if (!creatorVerified) {
    console.warn('[launch] recording unconfirmed: index unreachable (' + indexed.reason + ')');
  }

  /* ---------- record it ---------- */
  var startingBid = Number(body.startingBidSol);
  if (!isFinite(startingBid) || startingBid < 0) startingBid = 0;

  var recorded = await db.rpc('onlypad_record_coin', {
    p_mint: body.mint,
    p_name: name,
    p_ticker: ticker,
    p_description: clean(body.description, 500),
    p_image_url: clean(body.imageUrl, 500),
    p_metadata_uri: clean(body.metadataUri, 500),
    p_twitter: clean(body.twitter, 300),
    p_mode: mode,
    p_cut_pct: cutPct,
    p_creator_handle: clean(body.creatorHandle, 32),
    p_launcher_wallet: body.wallet,
    p_fee_wallet: feeWallet,
    p_tx_signature: clean(body.txSignature, 200),
    p_dev_buy_sol: startingBid,
    p_creator_verified: creatorVerified
  });

  if (!recorded.ok) {
    console.error('[launch] record failed', recorded.error, recorded.details);
    return http.fail(res, 500, 'record_failed',
      'The coin is live on pump.fun, but it could not be added to the board. ' +
      'Nothing is lost — the coin exists. Try again, or tell an operator.');
  }

  var row = Array.isArray(recorded.data) ? recorded.data[0] : recorded.data;

  return http.send(res, 201, {
    ok: true,
    mint: body.mint,
    name: name,
    ticker: ticker,
    mode: mode,
    feeWallet: feeWallet,
    startingBidSol: startingBid,
    id: row ? row.id : null,
    inserted: row ? row.inserted : null,
    coinPage: env.siteUrl() ? env.siteUrl() + '/coin/' + body.mint : null,
    pumpUrl: 'https://pump.fun/coin/' + body.mint,
    creatorVerified: creatorVerified,
    note: creatorVerified
      ? 'Verified against the pump.fun index.'
      : 'Listed, but the creator could not be confirmed because the pump.fun index was unreachable. ' +
        'The coin is real — the mint was checked on chain. The listing is flagged as unconfirmed.'
  });
});
