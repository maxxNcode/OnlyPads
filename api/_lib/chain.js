/* ==========================================================================
   CLAIM — api/_lib/chain.js
   Read a token's largest holders straight from Solana.

   ---------------------------------------------------------------------------
   WHY THIS EXISTS
   ---------------------------------------------------------------------------
   The leaderboard reads `onlypad_holder_stats`, which is written by `onlypad_settle`
   when a claim lands. Before anyone has claimed it is empty, so the board showed
   "0 wallets" — honest, but it means the site has no holders to show on the day
   it launches, which is the day it most needs to look alive.

   The holders are not actually unknown. They are on chain, right now, and two
   RPC calls away:

     getTokenLargestAccounts   the biggest token accounts for the mint
     getMultipleAccounts       the owner of each of those accounts

   So this is a real read of real holders, used as a fallback when the database
   has nothing. It is NOT a simulation: every address and every balance comes from
   the chain.

   ---------------------------------------------------------------------------
   WHAT IT CANNOT KNOW
   ---------------------------------------------------------------------------
   Hold TIME. The chain records a balance, not how long it has been held, so the
   multiplier, the tier, the streak and the claimable amount are all unknown for a
   chain-sourced holder. They come back null and render as an em dash. Deriving a
   weight from balance alone would be inventing the one number the whole Proof-of-
   Hold mechanic is built on.

   The RPC carries an API key, so this is server-side only, like everything else
   in api/_lib.
   ========================================================================== */
var env = require('./env');
var solana = require('./solana');

/** The two token programs a mint can belong to. */
var TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

var TTL_MS = 60000;
var cache = new Map();

function cacheGet(mint) {
  var hit = cache.get(mint);
  if (!hit) return null;
  return (Date.now() - hit.at) < TTL_MS ? hit.value : null;
}
function cacheSet(mint, value) { cache.set(mint, { at: Date.now(), value: value }); }

var TIMEOUT_MS = 8000;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function rpc(method, params) {
  var url = env.rpcUrl();
  if (!url) return null;

  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
  try {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }),
      signal: ctl ? ctl.signal : undefined
    });
    if (!r.ok) return null;
    var j = await r.json();
    return j && j.result ? j.result : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The largest holders of `mint`, biggest first.
 *
 * @returns {Promise<Array<{addr:string, balance:number}>|null>}
 *          null when the RPC could not answer — which is different from an empty
 *          list, and the caller has to be able to tell them apart.
 */
async function largestHolders(mint, limit) {
  if (typeof mint !== 'string' || !mint) return null;
  var want = Math.min(Math.max(1, limit || 20), 50);

  /*
   * getTokenLargestAccounts would be the obvious call, and Helius refuses it
   * (measured: "-32600 Too many accounts requested (10000000 pubkeys)") while
   * serving every other method normally. So this walks the token accounts for
   * the mint directly.
   *
   * TWO THINGS KEEP THAT AFFORDABLE:
   *
   *   dataSlice   asks for 40 bytes instead of the whole account. An SPL token
   *               account is mint(32) owner(32) amount(8), so offset 32 gives
   *               exactly the owner and the balance — measured, the full parse
   *               was 1.2 MB for one memecoin, which is not something to pull
   *               through a serverless function on every board load.
   *   cache       the answer is reused for a minute, so a busy page is one call.
   */
  var cached = cacheGet(mint);
  if (cached) return cached;

  var accounts = await rpc('getProgramAccounts', [TOKEN_2022, {
    encoding: 'base64',
    filters: [
      // memcmp on the mint, which is the first field of every token account.
      { memcmp: { offset: 0, bytes: mint } }
    ],
    dataSlice: { offset: 32, length: 40 }
  }]);

  var list = accounts && Array.isArray(accounts) ? accounts : null;
  if (!list) {
    // The mint may be a classic SPL token rather than Token-2022 — try the other
    // program before giving up.
    list = await rpc('getProgramAccounts', [TOKEN_PROGRAM, {
      encoding: 'base64',
      filters: [{ memcmp: { offset: 0, bytes: mint } }],
      dataSlice: { offset: 32, length: 40 }
    }]);
    if (!list || !Array.isArray(list)) return null;
  }

  var out = [];
  list.forEach(function (a) {
    var b64 = a && a.account && a.account.data && a.account.data[0];
    if (typeof b64 !== 'string') return;
    var buf;
    try { buf = Buffer.from(b64, 'base64'); } catch (e) { return; }
    if (buf.length < 40) return;

    var owner = solana.bs58encode(buf.subarray(0, 32));
    // The amount is a little-endian u64 at offset 32 of the slice.
    var amount = buf.readBigUInt64LE(32);
    if (!owner) return;
    out.push({ addr: owner, balance: Number(amount) / 1e6, tokenAccount: a.pubkey });
  });

  out.sort(function (a, b) { return b.balance - a.balance; });
  out = out.slice(0, want);

  cacheSet(mint, out);
  return out;
}


/**
 * The balance of `mint` held by `owner`, in whole tokens.
 *
 * Used for the burn total: the incinerator is an ordinary token account holder
 * like any other, so its balance IS the number of tokens destroyed. Read from
 * chain rather than stored, because nothing on this site writes to it.
 *
 * @returns {Promise<number|null>} null when the RPC could not answer.
 */
async function tokenBalance(owner, mint) {
  if (!owner || !mint) return null;

  var res = await rpc('getTokenAccountsByOwner', [
    owner,
    { mint: mint },
    { encoding: 'jsonParsed' }
  ]);
  var list = res && Array.isArray(res.value) ? res.value : null;
  if (!list) return null;

  var total = 0;
  list.forEach(function (a) {
    var info = a && a.account && a.account.data && a.account.data.parsed
      ? a.account.data.parsed.info : null;
    var amt = info && info.tokenAmount ? Number(info.tokenAmount.uiAmount) : 0;
    if (isFinite(amt)) total += amt;
  });
  return total;
}

/** The Solana incinerator. Tokens sent here are unrecoverable, by construction. */
var INCINERATOR = '1nc1nerator11111111111111111111111111111111';

module.exports = {
  largestHolders: largestHolders,
  tokenBalance: tokenBalance,
  rpc: rpc,
  INCINERATOR: INCINERATOR
};
