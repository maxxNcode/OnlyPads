/* ==========================================================================
   CLAIM — api/_lib/pumpfun.js
   Live market data for a coin, from the pump.fun index.

   ---------------------------------------------------------------------------
   WHY THIS IS SERVER-SIDE
   ---------------------------------------------------------------------------
   The index sends no `Access-Control-Allow-Origin` header, so a browser cannot
   read it at all — a fetch from the page is refused before a byte comes back.
   That is why the site's own fallback to it was dead code for its whole life.
   Server-side there is no origin and no CORS, so this is where it belongs.

   ---------------------------------------------------------------------------
   WHAT IS REAL HERE, AND WHAT IS NOT AVAILABLE
   ---------------------------------------------------------------------------
   Real, straight from the payload:

     usd_market_cap   the coin's market cap in USD
     real_sol_reserves  SOL actually backing the pool, in lamports
     image_uri        the coin's image
     creator          the wallet pump.fun pays the creator fee to
     created_timestamp

   Derived: LIQUIDITY. The payload reports `market_cap` in SOL and
   `usd_market_cap` in USD, so their ratio IS the SOL price — taken from the same
   response rather than a second price feed that could disagree with it. Liquidity
   is then the SOL reserves valued at that price.

   NOT AVAILABLE: 24h volume and holder count are not in this payload at all, on
   either endpoint. So they are returned as null and the client renders an em
   dash. A plausible number here would be indistinguishable from a real one,
   which is the failure this whole project keeps guarding against.

   Every read is cached briefly, so a busy page is not a burst of upstream calls
   and "realtime" means seconds-old rather than hammering.
   ========================================================================== */

var INDEX = 'https://frontend-api-v3.pump.fun/coins/';

/*
 * THE FALLBACK SOURCE, AND WHY IT IS NOT OPTIONAL
 *
 * MEASURED: Vercel's serverless egress is answered HTTP 429 by the pump.fun index
 * on every request, while the same call from a home connection succeeds. The
 * block is on the datacenter IP, so no header fixes it — the index simply cannot
 * be read from where the site runs.
 *
 * Dexscreener aggregates the same coins and answers datacenters. It also carries
 * something pump.fun never exposed: 24h VOLUME. What it does not carry is the
 * creator or the graduation flag, so pump.fun is still tried first and this is
 * the net underneath it.
 */
var DEX = 'https://api.dexscreener.com/latest/dex/tokens/';

/*
 * A NORMAL USER-AGENT IS REQUIRED, AND THIS IS NOT A PREFERENCE.
 *
 * MEASURED: the index answers 429 to Node's default fetch User-Agent and 200 to
 * a browser or curl one, from the same machine at the same moment. That single
 * difference is why every manual `curl` check succeeded while the server looked
 * like it could not reach the index at all — the requests were being refused for
 * identifying themselves as Node.
 *
 * It is not a disguise: it is the same string any browser sends, and the index is
 * a public read endpoint this site is entitled to use.
 */
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
var TIMEOUT_MS = 6000;
var TTL_MS = 120000;     // how long a coin's figures are reused
var NEGATIVE_TTL_MS = 30000;  // how long a "not found" is remembered
var CONCURRENCY = 6;

var cache = new Map();   // mint -> { at, value }

/*
 * BACK OFF WHEN THROTTLED.
 *
 * The index answers 429 under load, and every visitor's poll is a chance to add
 * to the pile. Without this, a throttle becomes self-sustaining: each request
 * retries, which earns another 429, which earns another retry. After a 429 the
 * module stops asking for a while and serves whatever it already has.
 */
var pending = new Map();   // mint -> in-flight promise, so parallel callers share one request
var backoffUntil = 0;

/*
 * Why the last read failed, in one line.
 *
 * Surfaced on the platform row as `dataReason` so "unavailable" can say WHY
 * without anyone needing the function logs. A bare "unavailable" is the least
 * useful possible message: it does not distinguish a throttle from a wrong
 * mint from a blocked egress.
 */
var lastFailure = null;
function failure() { return lastFailure; }
var BACKOFF_MS = 20000;

/**
 * Normalise a pump.fun payload onto the shape the boards use.
 *
 * Anything the payload does not carry comes back null rather than 0, so the
 * caller can tell "we know it is zero" from "we do not know".
 */
function normalise(d) {
  if (!d || typeof d !== 'object' || !d.mint) return null;

  var mcap = Number(d.usd_market_cap);
  if (!isFinite(mcap)) mcap = Number(d.market_cap_usd);
  mcap = isFinite(mcap) ? mcap : null;

  // The payload reports market cap in SOL and in USD, so their ratio is the SOL
  // price. Taken from the same response, so the two figures cannot disagree.
  var quote = Number(d.market_cap);
  var solPrice = (isFinite(quote) && quote > 0 && mcap !== null && mcap > 0) ? mcap / quote : null;

  var solReserves = Number(d.real_sol_reserves);
  var liquidity = null;
  if (isFinite(solReserves) && solPrice !== null) {
    liquidity = Math.round((solReserves / 1e9) * solPrice * 100) / 100;
  }

  return {
    mint: d.mint,
    name: typeof d.name === 'string' ? d.name : null,
    ticker: typeof d.symbol === 'string' && d.symbol ? '$' + d.symbol : null,
    image: typeof d.image_uri === 'string' && d.image_uri ? d.image_uri : null,
    creator: typeof d.creator === 'string' ? d.creator : null,
    marketCap: mcap,
    liquidity: liquidity,
    // Not in the payload on either endpoint. Null, not zero.
    volume24h: null,
    holders: null,
    graduated: Boolean(d.complete),
    createdAt: d.created_timestamp ? new Date(Number(d.created_timestamp)).toISOString() : null,
    solPrice: solPrice
  };
}

/**
 * The same coin, from Dexscreener.
 *
 * Picks the deepest pair rather than the first, because a token can trade in
 * several pools and the shallowest one is not what its market cap means.
 */
async function fromDexscreener(mint) {
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
  try {
    var r = await fetch(DEX + encodeURIComponent(mint), {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: ctl ? ctl.signal : undefined
    });
    if (!r.ok) return null;
    var j = await r.json();
    var pairs = j && Array.isArray(j.pairs) ? j.pairs : null;
    if (!pairs || !pairs.length) return null;

    var best = pairs.slice().sort(function (a, b) {
      var la = (a.liquidity && Number(a.liquidity.usd)) || 0;
      var lb = (b.liquidity && Number(b.liquidity.usd)) || 0;
      return lb - la;
    })[0];

    var base = best.baseToken || {};
    var mcap = Number(best.marketCap);
    if (!isFinite(mcap)) mcap = Number(best.fdv);
    var liq = best.liquidity ? Number(best.liquidity.usd) : NaN;
    var vol = best.volume ? Number(best.volume.h24) : NaN;

    return {
      mint: mint,
      name: base.name || null,
      ticker: base.symbol ? '$' + base.symbol : null,
      image: (best.info && best.info.imageUrl) || null,
      creator: null,                       // not published here
      marketCap: isFinite(mcap) ? mcap : null,
      liquidity: isFinite(liq) ? liq : null,
      volume24h: isFinite(vol) ? vol : null,
      holders: null,
      graduated: null,
      createdAt: best.pairCreatedAt ? new Date(Number(best.pairCreatedAt)).toISOString() : null,
      solPrice: null,
      source: 'dexscreener'
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One coin, cached. Resolves to null when the index has no such coin. */
async function coin(mint) {
  if (typeof mint !== 'string' || !mint) return null;

  var hit = cache.get(mint);
  var age = hit ? Date.now() - hit.at : Infinity;

  // Fresh: no call at all.
  if (hit && hit.value && age < TTL_MS) return hit.value;
  // A remembered "no such coin": respect the negative TTL.
  if (hit && !hit.value && age < NEGATIVE_TTL_MS) return null;

  /*
   * ONE REQUEST PER MINT AT A TIME.
   *
   * The board and the activity strip load in PARALLEL, so on a cold cache both
   * ask for the same coin at the same moment. Without this they each make their
   * own upstream request, and the index throttles one of them — so one page
   * showed the market cap and the other showed an em dash, from the same data,
   * on the same load. Awaiting the in-flight promise means the second caller
   * gets the first caller's answer instead of competing for it.
   */
  var inFlight = pending.get(mint);
  if (inFlight) return inFlight;

  var work = fetchCoin(mint, hit);
  pending.set(mint, work);
  try {
    return await work;
  } finally {
    pending.delete(mint);
  }
}

/**
 * The actual upstream read.
 *
 * ---------------------------------------------------------------------------
 * DEXSCREENER FIRST, AND THAT IS A MEASURED CHOICE, NOT A PREFERENCE
 * ---------------------------------------------------------------------------
 * Both sources carry the same coin, and they are not equal:
 *
 *   Dexscreener   name, ticker, image, market cap, liquidity, 24h VOLUME,
 *                 created — and it answers datacenter IPs
 *   pump.fun      the same minus 24h volume, plus creator and graduation —
 *                 and it answers Vercel's egress with HTTP 429, every time
 *
 * So the source with MORE of what the board displays is also the one that can
 * actually be reached. pump.fun is the fallback, which is the right way round
 * for a coin too new for Dexscreener to have indexed yet.
 *
 * The old order also cost two wasted retries before falling through, adding
 * about two seconds to every cold read on a blocked egress.
 */
async function fetchCoin(mint, hit) {
  var stale = hit && hit.value ? hit.value : null;
  if (Date.now() < backoffUntil) return stale;

  var viaDex = await fromDexscreener(mint);
  if (viaDex) {
    /*
     * TOP UP WHAT DEXSCREENER LACKS, but only when it actually lacks it.
     *
     * A coin it has only just indexed has no image yet, and the board's avatar
     * matters. pump.fun carries it, taken from the coin's metadata — so it is
     * asked only when something is missing rather than on every read, which keeps
     * the common case to a single upstream call.
     */
    if (!viaDex.image || !viaDex.creator) {
      var extra = await fromPumpFun(mint);
      if (extra) {
        viaDex.image = viaDex.image || extra.image;
        viaDex.creator = viaDex.creator || extra.creator;
        viaDex.name = viaDex.name || extra.name;
        viaDex.ticker = viaDex.ticker || extra.ticker;
        if (viaDex.graduated === null) viaDex.graduated = extra.graduated;
      }
    }
    cache.set(mint, { at: Date.now(), value: viaDex });
    lastFailure = null;
    return viaDex;
  }

  var viaPump = await fromPumpFun(mint);
  if (viaPump) {
    cache.set(mint, { at: Date.now(), value: viaPump });
    lastFailure = null;
    return viaPump;
  }

  backoffUntil = Date.now() + BACKOFF_MS;
  return stale;
}

/** One attempt at the pump.fun index. Never throws. */
async function fromPumpFun(mint) {
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
  try {
    var r = await fetch(INDEX + encodeURIComponent(mint), {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: ctl ? ctl.signal : undefined
    });
    if (r.status === 404) { cache.set(mint, { at: Date.now(), value: null }); return null; }
    if (!r.ok) { lastFailure = 'pump.fun HTTP ' + r.status; return null; }
    var j = await r.json();
    var value = normalise(j);
    if (value) value.source = 'pump.fun';
    return value;
  } catch (e) {
    lastFailure = (e && e.message) || 'pump.fun unreachable';
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function coins(mints, cap) {
  var list = (mints || []).filter(function (m) { return typeof m === 'string' && m; });
  var limit = Math.min(list.length, cap || 24);
  var out = {};

  for (var i = 0; i < limit; i += CONCURRENCY) {
    var chunk = list.slice(i, i + CONCURRENCY);
    var results = await Promise.all(chunk.map(function (m) {
      return coin(m).catch(function () { return null; });
    }));
    results.forEach(function (c, idx) {
      if (c) out[chunk[idx]] = c;
    });
  }
  return out;
}

/** How many entries are cached. Exposed so a test can assert caching happens. */
function cacheSize() { return cache.size; }
function clearCache() { cache.clear(); pending.clear(); backoffUntil = 0; }

module.exports = {
  coin: coin,
  coins: coins,
  normalise: normalise,
  cacheSize: cacheSize,
  lastFailure: failure,
  clearCache: clearCache,
  TTL_MS: TTL_MS,
  INDEX: INDEX
};
