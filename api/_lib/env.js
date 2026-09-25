/* ==========================================================================
   CLAIM — api/_lib/env.js
   Resolves configuration from the environment, tolerating both naming
   conventions so the existing env file works unchanged on Vercel.

   SECURITY: everything exported here is SERVER-ONLY. The service role key
   bypasses every RLS policy in the database — if it ever reaches the browser,
   the entire schema is writable by anyone. It must only ever be read inside
   api/*.js, never sent in a response, never inlined into a page.
   ========================================================================== */

function pick() {
  for (var i = 0; i < arguments.length; i++) {
    var v = process.env[arguments[i]];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Supabase project URL. Prefers the server-side name, falls back to the
 *  VITE_-prefixed one already in the user's env file. */
function supabaseUrl() {
  return pick('SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
}

/** The privileged key. Never leaves the server. */
function serviceKey() {
  return pick('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
}

/** The publishable key. Safe to hand to a browser. */
function anonKey() {
  return pick('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

function pinataJwt() {
  return pick('PINATA_JWT');
}

function adminSecret() {
  return pick('ADMIN_SECRET');
}

/** Solana RPC. Used server-side only when the API needs to read chain state. */
function rpcUrl() {
  return pick('RPC_URL', 'VITE_RPC_URL', 'SOLANA_RPC_URL');
}

/**
 * The wallet every launched coin routes its pump.fun creator fee to.
 *
 * This is written on chain by `create_v2` at launch and pump.fun will not let it
 * be changed afterwards, so it is read from the environment rather than being a
 * literal in the client bundle — one place to change, and a redeploy is enough.
 *
 * ONLYPAD_FEE_WALLET is preferred so this project can diverge from CLAIM's; the
 * shared value is the fallback, which is why it works with the reused env file
 * unchanged. PERMANENT: a wrong value here is unfixable for every coin created
 * while it is set, so it is never taken from a request body.
 */
var DEFAULT_FEE_WALLET = '4R32VqnsupCXZWBhgicce8PbhHvFC7PaXskUCxBXnoCV';

function feeWallet() {
  return pick('ONLYPAD_FEE_WALLET', 'CLAIM_FEE_WALLET', 'FEE_WALLET') || DEFAULT_FEE_WALLET;
}

/**
 * The $ONLYPADS mint, once it exists. Unset means the platform token has not been
 * deployed, and the board's platform row says so rather than pretending.
 */
function platformMint() {
  return pick('ONLYPAD_MINT', 'CLAIM_MINT');
}

/**
 * The public origin, used to build each coin's page URL — `SITE_URL/coin/<mint>`
 * — which is written into the metadata JSON that goes on chain, so it must be the
 * domain people actually visit and not a preview deployment.
 */
function siteUrl() {
  /* ONLYPAD_SITE_URL only — deliberately NOT falling back to SITE_URL.
   *
   * SITE_URL is CLAIM's, and it is set in the shared env file, so a fallback
   * silently returned https://claimpad.site. This value is written into every
   * coin's metadata JSON whose CID goes on chain, so a wrong domain here is
   * unfixable for every coin launched while it is wrong. Null is the honest
   * answer until it is set, and the client shows no coin page URL rather than a
   * plausible wrong one.
   */
  var explicit = pick('ONLYPAD_SITE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  }
  return null;
}

/**
 * Which surface we are running on. 'vercel' in a deployed function,
 * 'local' under `vercel dev`, 'unknown' otherwise.
 */
function runtime() {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV;
  if (process.env.VERCEL) return 'vercel';
  return 'local';
}

/** Is the database configured at all? Lets endpoints degrade instead of crash. */
function dbConfigured() {
  return Boolean(supabaseUrl() && serviceKey());
}

/**
 * A safe summary for the health endpoint. Deliberately reports only whether
 * each secret is PRESENT, plus a short fingerprint — never the value itself.
 */
function describe() {
  var s = serviceKey();
  return {
    runtime: runtime(),
    region: process.env.VERCEL_REGION || null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ? String(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7) : null,
    supabase: {
      url: supabaseUrl() || null,
      urlSource: pick('SUPABASE_URL') ? 'SUPABASE_URL' : (pick('VITE_SUPABASE_URL') ? 'VITE_SUPABASE_URL' : null),
      serviceKeyPresent: Boolean(s),
      serviceKeyFingerprint: s ? s.slice(-8) : null,
      anonKeyPresent: Boolean(anonKey())
    },
    pinata: { jwtPresent: Boolean(pinataJwt()) },
    adminSecretPresent: Boolean(adminSecret()),
    rpcConfigured: Boolean(rpcUrl())
  };
}

module.exports = {
  supabaseUrl: supabaseUrl,
  serviceKey: serviceKey,
  anonKey: anonKey,
  pinataJwt: pinataJwt,
  adminSecret: adminSecret,
  rpcUrl: rpcUrl,
  feeWallet: feeWallet,
  platformMint: platformMint,
  siteUrl: siteUrl,
  runtime: runtime,
  dbConfigured: dbConfigured,
  describe: describe
};
