/* ==========================================================================
   CLAIM — api/_lib/shape.js
   Maps database rows onto the exact JSON shape the front-end already expects.

   This is the only place that translation happens. If a column is renamed,
   this file breaks loudly in tests instead of silently rendering `undefined`
   on the board.
   ========================================================================== */
var math = require('../../assets/js/math');

var DAY = 86400;

function num(v, fallback) {
  var n = Number(v);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

function iso(v) {
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function ageDaysFrom(createdAt, nowSec) {
  var isoStr = iso(createdAt);
  if (!isoStr) return 0;
  var then = new Date(isoStr).getTime() / 1000;
  return Math.max(0, (nowSec - then) / DAY);
}

/**
 * A onlypad_vaults row → a board card.
 * `img` is deliberately omitted: the browser generates the SVG avatar from
 * `hue` + `ticker` in data.js, so we do not ship one over the wire.
 */
function vault(row, nowSec) {
  var unclaimed = num(row.unclaimed_amount);
  var claimed = num(row.claimed_amount);
  var total = unclaimed + claimed;
  return {
    id: row.id,
    mint: row.mint,
    name: row.name,
    ticker: row.ticker,
    mode: row.mode,
    creator: row.creator_wallet,
    ageDays: ageDaysFrom(row.created_at, nowSec),
    unclaimed: unclaimed,
    unclaimedStart: unclaimed,
    claimed: claimed,
    holders: num(row.holder_count),
    mcap: num(row.market_cap),
    vol: num(row.volume_24h),
    rate: num(row.rate_per_sec),
    hue: num(row.hue),
    imgUrl: row.image_url || null,
    claimedPct: total > 0 ? claimed / total : 0,
    isDemo: Boolean(row.is_demo),
    source: row.is_demo ? 'demo' : 'db',
    live: !row.is_demo
  };
}

/** A onlypad_holder_stats row → a leaderboard row. */
function holder(row, rank) {
  return {
    rank: rank,
    addr: row.wallet,
    balance: num(row.onlypad_balance),
    weight: num(row.weight),
    lifetimeClaimed: num(row.lifetime_claimed),
    claimCount: num(row.onlypad_count),
    streak: num(row.streak_epochs),
    lastClaimAt: iso(row.last_onlypad_at),
    isDemo: Boolean(row.is_demo)
  };
}

/** A onlypad_events row → a row in the live claims feed. */
function event(row) {
  return {
    id: row.id,
    kind: row.kind,
    wallet: row.wallet,
    amount: num(row.amount),
    weight: row.weight === null ? null : num(row.weight),
    multiplier: row.multiplier_bps ? num(row.multiplier_bps) / 10000 : null,
    vaultId: row.vault_id || null,
    epochIndex: row.epoch_index === null || row.epoch_index === undefined ? null : num(row.epoch_index),
    txSignature: row.tx_signature || null,
    at: iso(row.created_at)
  };
}

/** A onlypad_epochs row → the epoch card. */
function epoch(row, nowSec, cfg) {
  if (!row) return null;
  var idx = num(row.epoch_index);
  var startsAt = new Date(row.starts_at).getTime() / 1000;
  var endsAt = new Date(row.ends_at).getTime() / 1000;
  return {
    index: idx,
    startsAt: startsAt,
    endsAt: endsAt,
    secondsRemaining: Math.max(0, Math.round(endsAt - nowSec)),
    pot: num(row.pot_amount),
    buyback: num(row.buyback_amount),
    burn: num(row.burn_amount),
    totalWeight: num(row.total_weight),
    claimed: num(row.claimed_amount),
    claimers: num(row.claimer_count),
    finalized: Boolean(row.finalized)
  };
}

/** A onlypad_positions row → the shape computeShares() consumes. */
function positionForShares(row, nowSec) {
  var first = iso(row.first_buy_at);
  var daysHeld = first ? Math.max(0, (nowSec - new Date(first).getTime() / 1000) / DAY) : 0;
  return {
    wallet: row.wallet,
    balance: num(row.balance),
    daysHeld: daysHeld,
    // A position that has never been sold has never had its streak broken.
    neverSold: !row.last_sell_at,
    lastClaimEpoch: num(row.last_onlypad_epoch, math.epochIndex(nowSec)),
    rewardDebt: num(row.reward_debt)
  };
}

/** A onlypad_coins row → a row on the Launches board. */
function coin(row) {
  var mcap = num(row.market_cap_usd);
  /* The escrow embed comes back as an object or a one-element array depending on
     the relationship PostgREST infers, so accept both rather than silently
     reporting zero escrow for a coin that has some. */
  var esc = row.onlypad_escrow;
  if (Array.isArray(esc)) esc = esc[0] || null;
  var accrued = esc ? num(esc.accrued_sol) : 0;
  var claimed = esc ? num(esc.claimed_sol) : 0;

  return {
    id: row.id,
    mint: row.mint,
    name: row.name,
    ticker: row.ticker,
    description: row.description || '',
    mode: row.mode,
    image: row.image_url || null,
    twitter: row.twitter || null,
    launcher: row.launcher_wallet,
    feeWallet: row.fee_wallet,

    /* ---------- the two fields that carry the product ---------- */
    // false = UNCLAIMED. The Cut is in escrow and has NOT been paid to the
    // creator. Any copy written from this must say "accrued", never "paid".
    verified: Boolean(row.verified),
    // Distinct from `verified`, which is about the CREATOR having claimed their
    // Cut. This one is about whether WE could confirm the coin routes its fees
    // here. false means "unconfirmed", never "someone else's coin".
    creatorVerified: Boolean(row.creator_verified),
    creatorWallet: row.creator_wallet || null,
    // The @name the coin pays. Falls back to the ticker lowercased for a coin
    // recorded before the handle was collected, so the card never shows a bare
    // empty handle.
    handle: row.creator_handle || (row.ticker ? String(row.ticker).replace(/^\$/, '').toLowerCase() : null),
    // The launcher-set share of the creator fee, 0.40-0.80, frozen on chain.
    cutPct: row.cut_pct === null || row.cut_pct === undefined ? 0.6 : num(row.cut_pct),
    // What the coin has earned the creator so far, whether or not they have it.
    // `escrow` is the part still sitting unclaimed.
    escrow: Math.max(accrued - claimed, 0),
    claimed: claimed,

    txSignature: row.tx_signature || null,
    liquidity: num(row.liquidity_usd),
    volume24h: num(row.volume_24h_usd),
    marketCap: mcap,
    holders: num(row.holder_count),
    subs: num(row.subs),
    hue: num(row.hue),
    featured: Boolean(row.is_featured),
    rank: row.rank_override === null || row.rank_override === undefined ? null : num(row.rank_override),
    at: iso(row.created_at),
    isDemo: false,
    live: true
  };
}

/** Build an effective CFG from the onlypad_settings table, falling back to defaults. */
function cfgFromSettings(rows) {
  var cfg = {};
  for (var k in math.CFG) if (Object.prototype.hasOwnProperty.call(math.CFG, k)) cfg[k] = math.CFG[k];
  if (!Array.isArray(rows)) return cfg;

  var map = {
    epoch_seconds: 'EPOCH_SECONDS',
    pot_per_epoch: 'POT_PER_EPOCH',
    burn_split: 'BURN_SPLIT',
    min_hold: 'MIN_HOLD',
    max_stack: 'MAX_STACK'
  };
  rows.forEach(function (r) {
    var key = map[r.key];
    if (!key) return;
    var v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    var n = Number(v);
    if (isFinite(n)) cfg[key] = n;
  });
  return cfg;
}

module.exports = {
  vault: vault,
  holder: holder,
  event: event,
  epoch: epoch,
  coin: coin,
  positionForShares: positionForShares,
  cfgFromSettings: cfgFromSettings,
  ageDaysFrom: ageDaysFrom
};
