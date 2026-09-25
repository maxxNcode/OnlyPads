# OnlyPads — the launch path

Split out of `.workbuddy-ai/memory/MEMORY.md` on 2026-09-26 to keep that file inside its
injection budget. Read this before touching the launch wizard or the vendored launcher.

`ONLYPADLaunch.launch()` **never completed, not once**. Now verified to the signing call on the live
site by `.freebuff/launchtest.js` (stubbed provider + intercepted `/api/pin` — **nothing is signed or
pinned**). Four independent defects, none of which errored on page load:

1. **The vendored bundle is a CLAIM build.** `onlypad-launch.js` is CLAIM's `claim-launch.js` with
   `CLAIMLaunch` renamed — **4 bytes apart** — and it still reads **`window.CLAIM.wallet`** for the
   signer and the payer pubkey. Every launch threw "Connect a wallet first." `app.js`
   `shimClaimWallet()` aliases it at boot. **When porting a bundle, grep for every global it reads.**
2. **`create_v2` declares `creator` as a pubkey ARGUMENT**, so the IDL encoder Borsh-encodes it and
   calls `.toBuffer()`. Callers pass a string → `e.toBuffer is not a function`. Fixed at the SOURCE.
3. **No `recentBlockhash`** on the assembled transaction → `partialSign` throws before the wallet is
   ever prompted. **Phantom does not supply one** — the old comment claimed it did.
4. **`api.mainnet-beta.solana.com` returns HTTP 403 to any request carrying an `Origin` header** (200
   without one). The browser could never `getLatestBlockhash`. Fixed by `api/rpc.js`, a same-origin
   JSON-RPC proxy with a method allow-list; `/api/config` serves `/api/rpc` and the client resolves it
   against `location.origin`. **A CSP `connect-src` entry is not evidence the host answers.**

**The bundle is GENERATED — never edit it.** Its header names `CLAIM/tools/launch-core/` and
`CLAIM/tools/build-launch-core.mjs` (deps resolve from `DROPPROJECT/node_modules`). Rebuild, then
rename `CLAIMLaunch`→`ONLYPADLaunch` (2 occurrences). esbuild minification is not reproducible across
runs, so verify a rebuild by reading the call site, not by diffing.

**Also:** the wizard validated the X profile and then sent `twitter: ''`; the lazy bundle `src` was
relative, so it 404s on `/coin/<mint>` — **the same class as the stylesheet bug below.**

**Still unproven: the last step.** A real signature, a real `create_v2`, a coin live on pump.fun. That
needs real SOL, and `create_v2` writes the fee wallet on-chain permanently.

**Cold load is blank ~2.2–2.7 s**, dominated by one cross-origin request (Google Fonts 306 → 1973 ms,
while every local resource finished by 332 ms). Self-hosting the two families would remove it; not
done. Numbers in `memory/2026-09-26.md`.
