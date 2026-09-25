> **UPDATE 2026-09-25, same day.** The launch path below has since been built: a wallet-connect button,
> a full launch wizard (form → image → Pinata → `create_v2` → `/api/launch`), `vercel.json`, and
> migration 101 which makes the Cut slider and the creator handle actually persist. See the P0 list
> below for what that closes. **Still not ready** — items 5, 6 and the whole P1 section remain, and the
> pump.fun index 429 issue is now a known operational risk.

# OnlyPads — release readiness

**Assessed 2026-09-25.** Verdict first: **not ready.** The front end is done and the backend is real,
but **the site cannot launch a coin** — which is the one thing a launchpad has to do. Nothing here is
hard; it is unfinished, not broken.

---

## What is genuinely done and verified

| | state |
|---|---|
| Front end | Light + dark (dark default), OnlyFans card grammar, GoFundMe layout. 0 console errors, 22/22 contrast in both themes, 0 overflow at 1440/820/390 |
| Database | `onlypad_*` tables live in the shared Supabase, applied additively (4 added, 0 removed). 18 assertions pass against the real database |
| Product rules | Enforced in the database, not just the caller — a `cut` event for an unverified coin is refused; `verified` without a `creator_wallet` is impossible |
| API | health, config, coins, coin, feed, launch, pin — all verified against the live database |
| Launch verification | Real. `POST /api/launch` does a live RPC call to confirm the mint exists and a live pump.fun index call to confirm the creator is ours, and **fails closed** |
| Realtime | Polling `/api/coins` every 15s, with a source indicator (`LIVE · n launched` / `No coins launched yet` / `API unreachable`) |

---

## P0 — it cannot launch. Nothing else matters until these are done

**1. The launch button does nothing.**
`data-launch` still raises the "not wired up yet" toast. `api.recordLaunch()` exists, and the vendored
SDK exposes `ONLYPADLaunch.launch / estimateCost / isValidAddress` — **but nothing connects them.**
There is no wizard: no name/ticker/description form, no image picker, no Cut slider, no review step.
This is the single largest piece of remaining work.

**2. No wallet connect.**
`wallet.js` is loaded (Phantom / Solflare / Backpack) but there is no "Connect wallet" button anywhere
in the page. A launch needs a signer, so the flow cannot start.

**3. No IPFS upload wired.**
A coin's metadata URI is written on chain by `create_v2` and cannot be corrected afterwards, so the
metadata has to exist *before* the transaction is built. `POST /api/pin` (Pinata) is implemented and the
JWT is present, but nothing in the UI calls it.

**4. No `vercel.json` → not deployable.**
CLAIM's carries the CSP, the cache headers and the `/coin/:mint` rewrite. Without it there is no CSP, no
cache policy, and coin pages 404.

**5. `ONLYPAD_SITE_URL` is unset.**
So `siteUrl()` returns null and a launch's `coinPage` is null. This value goes into the metadata JSON
whose CID lands on chain, so it must be set **before the first launch** or every early coin carries no
URL, permanently.

**6. No `/coin/<mint>` page.**
`api/coin.js` works (returns `not_found` correctly for an unknown mint) but there is no `coin.html` to
render it. A launched coin has nowhere to live.

**7. `ONLYPAD_FEE_WALLET` is currently CLAIM's wallet.**
`4R32VqnsupCXZWBhgicce8PbhHvFC7PaXskUCxBXnoCV`. It is written on chain at launch and **pump.fun will not
let it be changed afterwards**, so every coin launched while it is wrong sends its creator fees to the
wrong place forever. This is a business decision, not a technical one, and it must be made first.

---

## P1 — the product is described on the page but does not work

**8. Creator Escrow never accrues.**
`onlypad_escrow` gets a row at launch and **nothing ever writes `accrued_sol`.** The Creator Escrow
panel, the amber locked tiles and the "in escrow" totals are therefore decorative — they will read $0
for every real coin. Escrow is the growth loop; without it there is no reason for a fan to launch for
someone else.

**9. Creator verification is not implemented.**
No signed challenge, no handle binding, no claim. Every coin is UNCLAIMED forever, so the VERIFIED badge
is unreachable and the escrow above can never be released.

**10. No claiming of any kind.**
Tips, the OnlyVault, Drops, `$ONLYPADS` holder rewards, Proof of Sub — all described on the page, none
implemented. The Tip Jar countdown is a live clock counting down to a pot that does not exist.

**11. No indexer.**
Market cap, volume and holders are fetched at read time and never persisted. That is fine for display,
but the database cannot sort, rank or filter by them, and a coin's figures vanish whenever the upstream
index is throttled.

**12. No admin or ops path.**
No way to feature a coin, hide a scam, correct a figure, or act on an impersonation report. CONCEPT.md
lists impersonation as the everyday problem; there is currently no lever to pull.

---

## P2 — release hygiene

**13. The 18+ gate is missing.** CONCEPT.md calls it non-negotiable and it is not in the build.

**14. `/api/config` hands the browser your Helius RPC URL including its API key.**
Anyone can read it from the network tab and spend your quota. The browser does need an RPC, so the fix
is a keyless or rate-limited endpoint rather than removing it — but shipping a keyed one is a bill
waiting to happen.

**15. The demo dataset is the fallback.** With an empty registry the board shows 12 invented creators.
It is labelled `DEMO` and the source line says so, but on a public launch an honest empty state is
probably the better default.

**16. No `README.md`, no `LICENSE`, no `package.json`.**

**17. No error reporting.** A failed launch tells the user; it tells nobody else.

**18. Legal, not technical — and unresolved.** The "OnlyPad" trademark risk, and the question of whether
escrowing a creator's money is money transmission. Both are flagged in `CONCEPT.md` and neither is a
code problem.

---

## The shortest path to a real launch

In order, and roughly one focused pass for 1–7:

1. Decide `ONLYPAD_FEE_WALLET`, set `ONLYPAD_SITE_URL`.
2. Add `vercel.json` (CSP, cache headers, `/coin/:mint` rewrite) and `coin.html`.
3. Add a Connect Wallet button; show the connected address.
4. Build the launch wizard: form → image → `/api/pin` → metadata → `ONLYPADLaunch.launch` → `/api/launch`.
5. **Test with a throwaway coin at a tiny dev buy**, then confirm it appears on the board as LIVE.

**Then, as phase two:** the escrow indexer, creator verification, and claiming. That is the half of the
product that makes it OnlyPads rather than a generic pump.fun front end — and it is a larger job than
everything above, because it needs a crank and signed challenges.

---

## One safety note that is not negotiable

**Never test-launch a real coin.** `create_v2` costs real SOL and writes the fee wallet on chain
permanently. Every check so far has stopped short of signing; the first real transaction should be a
deliberate, funded, throwaway test.
