# OnlyPad — the concept

**Every coin pays its creator.**

CLAIM routes a coin's reward to its *holders*. OnlyPad routes it to a *person*.

> **Launch a coin for a creator. Every trade pays their cut, straight to their wallet — and pays the Subs who hold it.**

That is the whole idea. Everything on the site follows from it.

---

## Before anything else: the one thing you cannot do

You asked for a coin that "routes fees to your favorite creator on OnlyFans." Read that literally and it is
not buildable. Three hard facts:

1. **OnlyFans has no official public API.** There is no developer programme, no payouts endpoint, no
   OAuth. Every "OnlyFans API" you can find — `ofapis`, `onlyfans-api.ai`, `ofmapi` — is an unofficial
   reseller that authenticates as the creator's own app session. Using one to move money is a
   ToS violation and a ban risk for the creator, and you would be holding their session credentials.
2. **You cannot credit an OnlyFans balance from outside.** There is no deposit address. Money enters
   OnlyFans through their own checkout and leaves through their own payout rails.
3. **So the Cut is paid in SOL, to a wallet.** A Solana address the creator controls. That is what
   "their cut, forever" means here, and it is strictly better than the version you asked for — it is
   instant, permissionless, and it survives the creator leaving the platform.

The rest of this document assumes that. What OnlyPad *does* with the OnlyFans name is use its
**culture and vocabulary** — the subscription, the fan, the cut — not its API.

---

## The name does the work

"OnlyPad" is `Only` + `Pad`, and the prefix is a gift: it gives you a whole vocabulary that no
competitor can copy without looking like a knock-off. Every mechanic below is named from it.

| OnlyPad term | What it is | Where it comes from |
|---|---|---|
| **The Pad** | the launchpad itself | *Pad*, as in launchpad |
| **An Only** (pl. **Onlys**) | one coin, launched for one creator | *Only*, as in OnlyFans |
| **OnlyVault** | the per-creator vault that fills with every trade | *Only* + Claim Vault |
| **Sub** | a holder of an Only — the fan who backs it | OnlyFans subscriber |
| **Sub Streak** | unbroken hold time, counted in **renewals** (30-day periods) | the subscription month |
| **Proof of Sub** | `weight = balance × sub-streak multiplier` | *Proof of Hold*, renamed |
| **The Cut** | the creator's share of every trade, paid to their wallet | "the creator's cut" |
| **Tips** | the Subs' share, claimed from the OnlyVault | tipping |
| **PPV** | the claim mode where the vault unlocks at market-cap milestones | pay-per-view unlock |
| **The Tip Jar** | the platform pot, claimed by `$ONLY` holders | the tip jar on a creator's page |
| **A Drop** | one 15-minute epoch; unclaimed Drops stack | a creator "dropping" content |
| **Creator Launch / Fan Launch** | who started the coin | — |
| **VERIFIED / UNCLAIMED** | whether the creator has claimed their Cut | — |

Two names carry more weight than the rest:

- **Subs.** Holders are called Subs. It is the single best thing about the name — a coin whose holders
  are literally called subscribers makes the whole product legible in one word. Say it out loud:
  *"Subs claim Tips from the OnlyVault."*
- **Proof of Sub.** CLAIM's Proof of Hold is `balance × hold-time`. Proof of Sub is the same maths with
  a better spine: the multiplier tiers land on **subscription months** (1 / 3 / 6 / 12), which is a
  rhythm people already understand from buying anything on subscription.

---

## The mechanic: three ways, not two

CLAIM's sharpest decision was that **0% goes to the launcher** — that is what makes the coin holdable.
OnlyPad has a harder problem: a creator cut is the *point*, but the more you pay the creator, the less
there is to make the coin worth holding. Get this wrong and you have built a donation widget.

So the reward splits three ways, written on chain at launch, immutable:

| Share | Goes to | Does what |
|---|---|---|
| **60%** | **The Cut** → the creator's wallet | Paid in SOL on every trade, forever. This is the product. |
| **35%** | **OnlyVault** → Subs claim | Accrues by Proof of Sub. Without this there is no reason to hold. |
| **5%** | **Pad treasury** → buys `$ONLY` | Half burned, half drops into the Tip Jar. |

**60 / 35 / 5 is the default, not the law.** The creator's Cut is launcher-set within **40–80%** at
launch and frozen after. A coin for a creator with a real audience can justify 80% — the coin is a
fan-funding vehicle and the Cut is the pitch. A coin with no audience behind it should sit at 40%,
because the only thing that will hold it up is the Tips. Either way the split is printed on the card
before anyone buys, so it is a choice, not a surprise.

**This is the tension in the design, and it is worth being explicit about it.** A pure creator payout
maximises the cause and destroys the market. A pure holder payout is CLAIM with a pink accent and no
reason to exist. 60/35 is where both are real. It is one constant — `CFG.SPLIT` — and moving it should
be a deliberate decision, not a nudge.

---

## The hook: Proof of Sub

If Tips were just `your balance / total supply`, the vault would be farmed by bots and dumped in an
afternoon. So weight is balance times how long you have held:

```
weight = balance × sub-streak multiplier
```

| Streak | Multiplier | Tier | Reads as |
|---|---|---|---|
| Day 1 | 1.0× | **Fresh** | just found them |
| 1 renewal (30d) | 1.5× | **Subscribed** | first month paid |
| 3 renewals (90d) | 2.5× | **Renewed** | stuck around |
| 6 renewals (180d) | 4.0× | **Loyal** | half a year |
| 12 renewals (365d) | 5.0× | **Founding Sub** | a year, unbroken |
| Never sold since launch | 5.0× | **Unbroken** | from the first trade |

**Sell anything — even a partial sell — and your streak resets to 1.0×, and every Tip you had accrued
but not yet claimed goes back into the OnlyVault for the Subs who stayed. Claiming resets nothing.**
You can claim as often as you like; only selling costs you.

This is deliberately **slower than CLAIM's curve** (which reaches 5.0× at 180 days). A subscription
model should feel like a subscription: the ladder is months, not weeks, and a year unbroken is the top
of it. The curve is piecewise-linear and lives in exactly one place per language — `CURVE` in
`assets/js/data.js` ↔ `KNOTS` in the Anchor program. Keep them in sync or the UI lies about the chain.

---

## Two ways a coin gets made — and the loop that makes this grow

This is the part CLAIM does not have, and it is the reason OnlyPad is a product rather than a skin.

**Creator Launch.** The creator launches from their own wallet, signs a challenge proving they control
the handle they are claiming, and the coin carries a **VERIFIED** badge. Their Cut streams to them from
the first trade. This is the clean case.

**Fan Launch.** Anyone can launch a coin for a creator who has not opted in. The coin carries an
**UNCLAIMED** badge, and the creator's 60% does not disappear — it **accrues in escrow** inside the
OnlyVault, against the creator's future claim.

That escrow is the growth engine. A fan launches an Only for a creator with a following. It trades.
The creator's unclaimed Cut piles up into a number that is real, liquid SOL, waiting on one action:
prove it's you, and take it. The pitch writes itself and it is not spam — it is *"someone built you a
revenue stream and it is sitting there."*

When the creator verifies, the badge flips to **VERIFIED**, the escrow pays out, and the creator takes
control of the name, the avatar, and the description. Until then, a Fan Launch coin must be clearly
labelled as unaffiliated, must not use the creator's likeness, and must be takedown-able. That is a
moderation surface you have to actually staff — see *What breaks*, below.

---

## The second layer: the Tip Jar

The OnlyVault pays the Subs of *one* coin. The Tip Jar pays the holders of *the platform*.

The Pad's 5% of every Only buys `$ONLY` on the open market. **Half is burned** — supply moves one
direction only. **The other half drops into the Tip Jar**, and `$ONLY` holders claim it in **Drops**
every 15 minutes:

```
share      = your weight / every eligible Sub's weight
weight     = your $ONLY balance × your sub-streak multiplier
claimable  = jar × share × Drops you have let stack
```

The decisions that matter, all inherited from CLAIM because they were right:

- **Drops are aligned to the wall clock** (900-second buckets), not to page load. Same countdown for
  everyone; the jar is a deterministic function of the Drop index.
- **Unclaimed Drops stack.** Miss six and you claim six in one transaction. A "claim in 15 minutes or
  lose it" rule punishes sleep and rewards bots.
- **Eligibility floor.** Wallets under `MIN_HOLD` (100 `$ONLY`) are removed from the weight set
  entirely — not given zero share — so dust cannot dilute real Subs.
- **The Sub set is generated from a fixed seed**, so the leaderboard does not reshuffle on reload.
  Only the clock moves.

### The Sub leaderboard

Every `$ONLY` holder, public: address, tier, held, multiplier, weight, streak, lifetime claimed, and
claimable right now. Sortable by claimable, lifetime, streak or weight. Your own wallet is highlighted
and pinned with its true rank even if you fall below the visible cut.

---

## The interface

CLAIM's UI is a **dark-mode reading of GoFundMe**, and that was your call, so OnlyPad inherits it
whole — same flat system, same card shape, same discipline. The card is the emotional core and it
survives the transplant almost unchanged:

> banner → avatar → title/ticker → progress bar → two figures → full-width action

The one change: **the two figures.** On CLAIM they are "unclaimed" and "your claim." Here they are
**"Paid to creator"** and **"Subs claimable"** — and the progress bar is the creator's lifetime
earnings. It is a fundraiser thermometer pointed at a person, which is exactly what it was designed
for.

Section order, mirroring the reference so the system reads the same:

1. **Nav** — OnlyPad · Launches · How it works · `$ONLY` · **Launch a coin**
2. **Hero** — headline, subline, two CTAs, live activity feed
3. **Where the fee goes** — the three-way split diagram. The centrepiece.
4. **Stats strip** — Onlys launched · market cap · volume 24h · Tip Jar
5. **Launches** — card grid ranked by market cap, `$ONLY` pinned at the top as the platform coin
6. **Proof of Sub** — the streak ladder
7. **The Tip Jar** — the Drop countdown and `$ONLY`
8. **How it works** — Launch → Vault → Sub → Claim
9. **For creators** — verification, escrow, claim your Cut (the section CLAIM has no equivalent of)
10. **FAQ** — including the unaffiliated disclaimer
11. **Close** — "Launch a coin that pays your creator."
12. **Footer** — *Not affiliated with, endorsed by, or connected to OnlyFans.*

### Design tokens

The house system is unchanged: `--bg:#0E0E0E`, `--surface:#1A1A1A`, `--line:#2A2A2A`, one accent, no
gradients, no glows, no shadows, selection by inversion, Plus Jakarta Sans + JetBrains Mono.

**One change, and I would make it: the accent is not green.** CLAIM's `#00B964` is the action colour
there, and reusing it makes the two sites read as one product. It also cannot be OnlyFans blue
(`#00AFF0`) — that is a trademark you do not want to touch. So: **rose**, `--accent:#E8455F`, with
`--accent-text:#FF6B8A` for accent-coloured text on dark. Warm, human, reads as "fan and creator"
rather than "finance", and unmistakably not the blue.

If you would rather the two sites be a matched pair, keep the green and change nothing else. Both are
defensible; the rose is the one I would ship.

---

## What breaks

Everything below is a real obstacle, not a disclaimer.

- **The trademark is the biggest risk, and it is about the name, not the mechanic.** "OnlyFans" is a
  registered mark and "OnlyPad" sits in the same commercial space with the same prefix. I would not
  launch the name without a lawyer looking at it. Minimum mitigation: never use their wordmark, logo
  or blue; never imply affiliation; carry the disclaimer in the footer and the FAQ. If you want the
  idea without the exposure, `FanPad` and `CutPad` carry the same mechanic with none of the risk.
- **No fiat, no app stores, no mainstream exchanges.** Adult-adjacent tokens are refused by payment
  processors and delisted by exchanges. Stay crypto-native: SOL in, SOL out, no card on-ramp. Do not
  plan around a Coinbase listing.
- **Escrowing a creator's money is a regulated activity in most jurisdictions.** Holding funds for
  someone else, with a claim process, edges toward money transmission. Escrow is the growth loop *and*
  the legal exposure. Get advice on the claim process specifically, and consider a fixed abandonment
  rule (unclaimed Cut returns to the OnlyVault after N months) to avoid holding funds forever.
- **Age and content, without exception.** The site carries no adult content — no images from the
  platform, no explicit media, nothing. 18+ gate on entry. A hard rule that a coin can only be created
  for a **verified adult** creator, and an immediate takedown-and-burn path if any coin is created for
  or by a minor. This is not a policy you can soften later.
- **Impersonation is the everyday problem.** Anyone can launch an Only with a famous creator's name.
  You need a takedown process, a name-claiming process, and a rule that unverified coins cannot use a
  creator's likeness. The VERIFIED / UNCLAIMED badge is the user-facing half of that; the back office
  is the other half.
- **The creator has to want this.** A Cut is only worth something if the creator will accept SOL and
  acknowledge the coin. Until one real creator does, this is a mechanic looking for a first customer.

---

## Honest scope note

**The landing page is built. The protocol is not.**

What exists in this repo now: `index.html` and `assets/` — a complete, self-contained front end. Plain
HTML/CSS/JS, no build step, no dependencies. It renders the hero, the three-way fee flow, the launches
board with search and filters, the launch wizard with a live split preview, the creator escrow section,
the Tip Jar with its Drop clock and Sub leaderboard, `$ONLY`, the Proof of Sub ladder and the FAQ.
Verified by running it in a real browser: no console errors, no horizontal overflow at 1440px or
390px, and all 46 assertions on the maths and the dataset pass.

**Everything numeric on the page is simulated, and every record says so.** The 12 creators are
invented stage handles, not real people. The Sub set, the balances, the jar and the escrowed amounts
all come from a fixed seed in `assets/js/data.js`. The UI badges them `DEMO`, and the wallet connect
reports honestly that it generated an address rather than signing anything. No chain call is made.

The maths, by contrast, is real: `assets/js/math.js` is the single source of truth for the split, the
Proof of Sub curve, the Drop index and the share formula, and it is what the page renders from.

What is **not** built, and needs keys and SOL:

1. **The three-way split and the escrow account** in an Anchor program — the Cut, the Tips, and the
   Creator Escrow that holds an unclaimed Cut. This is the one genuinely new piece of protocol work;
   the vault accumulator, the weight curve and the epoch pot are ports from CLAIM.
2. **Creator verification** — the signed challenge, the handle-binding record, and the escrow claim.
3. **Wiring the split into pump.fun's fee-sharing config** at coin creation, via their SDK.
4. **A Drop crank** funding the Tip Jar every 15 minutes, and an on-chain program for the jar itself.
5. **A backend** — the board currently reads a local dataset, not `/api/onlys`.

The three places the curve is defined must not drift: `CURVE` in `assets/js/math.js` ↔ `KNOTS` in the
Anchor program. The percentage split shown to users comes from `splitPct()`, which works in integer
percent space on purpose — rounding the three fractions independently gives 80/17/2, and a split that
does not sum to 100 looks like a bug because it is one.

