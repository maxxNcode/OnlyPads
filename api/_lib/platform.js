/* ==========================================================================
   ONLYPAD — api/_lib/platform.js
   The $ONLYPADS row that sits at index 0 of the board.

   ---------------------------------------------------------------------------
   WHY THIS IS BUILT IN CODE AND NOT A DATABASE ROW
   ---------------------------------------------------------------------------
   The platform token has to be first even when it is the smallest thing on the
   board. A `rank_override` column would be the obvious way and it is the wrong
   one: an ordering that depends on a value someone can edit is an ordering that
   can silently stop holding. So the row is assembled here and unshifted, and the
   client is told `featured: true` rather than being asked to guess.

   ---------------------------------------------------------------------------
   WHAT IT MUST NOT DO
   ---------------------------------------------------------------------------
   It must not invent a market cap. $ONLYPADS has not been deployed, so it has no
   price, no holders and no liquidity — and a plausible-looking number here would
   be indistinguishable from a real one to anyone reading the page. Every figure
   is 0 or null and `live: false` says so.

   Once ONLYPAD_MINT is set the row links to the real mint and the figures come
   from the same index every other coin uses.
   ========================================================================== */
var env = require('./env');

function platformRow() {
  var mint = env.platformMint();
  return {
    id: 'platform',
    mint: mint || null,
    name: '$ONLYPADS',
    ticker: '$ONLYPADS',
    description:
      'The Pad token. The Pad\'s 5% of every Only buys it — half is burned, half ' +
      'drops into the Tip Jar for holders to claim in Drops.',
    mode: 'stream',
    image: null,
    twitter: null,
    launcher: null,
    feeWallet: env.feeWallet(),

    // The platform token is the one coin that is not a creator launch, so the
    // Cut/escrow columns do not apply to it. `verified` is true because there is
    // no creator waiting to be paid; the escrow figures are genuinely zero.
    verified: true,
    creatorWallet: null,
    cutPct: 0.6,
    escrow: 0,
    claimed: 0,

    txSignature: null,
    liquidity: 0,
    // null, not 0: "we do not know" is not the same as "we measured zero".
    volume24h: null,
    marketCap: 0,
    holders: 0,
    subs: 0,
    hue: 0,

    featured: true,
    rank: 0,
    at: null,

    isPlatform: true,
    // Deployed or not. The client uses this to decide whether to offer a buy
    // action or say the token is not live yet.
    live: Boolean(mint),
    isDemo: false
  };
}

module.exports = { platformRow: platformRow };
