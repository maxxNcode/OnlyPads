# OnlyPad — project memory

Launchpad concept. **Every coin pays its creator.** Sibling to **CLAIM**
(`C:\Users\USER\OneDrive\Desktop\CLAIM`) — same Solana/pump.fun architecture, same dark-mode-GoFundMe
design system, but the coin's creator reward routes to a *person* instead of to holders.

Full spec: `docs/CONCEPT.md`. **Nothing is built yet** — the workspace held only an empty folder
before this. This file records the decisions so they aren't re-litigated.

## The one hard constraint (don't design around anything else)

**OnlyFans has no official public API.** Verified 2026-09-24 — every "OnlyFans API" (`ofapis`,
`onlyfans-api.ai`, `ofmapi`, `ofauth`) is an unofficial reseller authenticating as the creator's own
app session: ToS violation + ban risk. There is no deposit address, so an outside system cannot credit
an OnlyFans balance.

**Therefore: the Cut is paid in SOL to a wallet.** OnlyPad borrows OnlyFans' *culture and vocabulary*,
never its API. If a future request assumes a real OnlyFans integration, this is why it was refused.

## Mechanic (canonical — don't drift)

- Fee split, on chain, written once, permanent: **60% The Cut → creator wallet · 35% → OnlyVault
  (Subs claim Tips) · 5% → Pad treasury**. `CFG.SPLIT`. Creator's Cut is launcher-set **40–80%**,
  frozen at launch.
- **60/35/5 is the contested number.** The tension: more to the creator = better cause, less to
  holders = unholdable coin. 60/35 is where both are real. Don't change it silently.
- **Proof of Sub:** `weight = balance × sub-streak multiplier`, piecewise-linear, in **renewals**
  (30-day periods). Day 1 → 1.0× (Fresh) · 1 renewal → 1.5× (Subscribed) · 3 → 2.5× (Renewed) ·
  6 → 4.0× (Loyal) · 12 → 5.0× (Founding Sub) · never sold → 5.0× (Unbroken).
  **Deliberately slower than CLAIM's curve** (which tops out at 180d). Single source of truth:
  `CURVE` in `assets/js/data.js` ↔ `KNOTS` in the Anchor program — keep in sync.
- **Selling resets streak to 1.0× and forfeits unclaimed Tips back to the OnlyVault. Claiming resets
  nothing.** Same rule as CLAIM; it's the selling point.

## What's new versus CLAIM (the actual delta)

1. **A third payout rail** — The Cut, paid to the creator's wallet.
2. **Creator Escrow** — on a **Fan Launch** the creator's 60% accrues in escrow against a future
   claim instead of being paid out. This is the growth loop: a fan gifts a creator a revenue stream,
   the creator verifies and withdraws a lump of SOL.
3. **Creator verification** — signed challenge binding a wallet to a handle. Badges **VERIFIED** vs
   **UNCLAIMED**. No CLAIM equivalent; this is where the moderation and legal exposure live.
4. Everything else (vault accumulator, epoch pot, wallet layer, schema conventions, test harness) is a
   **port**, not new work.

## Vocabulary (the name does the work — use these, don't invent synonyms)

The Pad · an **Only** · **OnlyVault** · **Sub** (a holder) · **Sub Streak** (counted in renewals) ·
**Proof of Sub** · **The Cut** (creator's share) · **Tips** (Subs' share) · **PPV** (milestone unlock
mode) · **the Tip Jar** (platform pot) · **a Drop** (one 15-min epoch) · **Creator Launch** /
**Fan Launch** · **VERIFIED** / **UNCLAIMED**.

**"Subs" is the single best thing about the name** — holders are literally called subscribers.

## Second layer

Pad's 5% buys `$ONLY` → **half burned, half into the Tip Jar** → `$ONLY` holders claim in **Drops**
(900s wall-clock buckets, aligned to the clock not page load), unclaimed Drops **stack**,
`MIN_HOLD` 100 `$ONLY` excluded from the weight set entirely, Sub set from a **fixed seed**.
`CFG.BURN_SPLIT = 0.5`. All inherited from CLAIM because it was right.

## Design

Inherits CLAIM's dark-mode-GoFundMe system **whole**: `--bg:#0E0E0E`, `--surface:#1A1A1A`,
`--line:#2A2A2A`, one accent action-only, no gradients/glows/shadows, selection by inversion,
Plus Jakarta Sans + JetBrains Mono.

**One change: the accent is rose, not green.** `--accent:#E8455F`, `--accent-text:#FF6B8A`.
Reasons: CLAIM's `#00B964` would make the two sites read as one product, and OnlyFans blue
(`#00AFF0`) is a trademark to stay away from. Rose reads fan/creator, not finance. (Keeping the green
is the defensible alternative if a matched pair is wanted.)

Card shape unchanged, except the **two figures** are **"Paid to creator"** and **"Subs claimable"**,
and the progress bar is the creator's **lifetime earnings** — a fundraiser thermometer pointed at a
person. That is the emotional core.

## Risk — do not let this slide

- **"OnlyPad" is a trademark risk** — same prefix, same commercial space as a registered mark.
  Flagged for counsel before launch. Mitigations still standing: no wordmark or logo, no implied
  affiliation, footer + FAQ disclaimer. (The brand blue is now in use at the user's explicit
  direction — that mitigation is spent and the risk is correspondingly higher.) **Fallback names
  carrying the same mechanic: `FanPad`, `CutPad`.**
- No fiat, no app stores, no mainstream exchanges — adult-adjacent tokens get refused/delisted. Stay
  SOL-native.
- **Escrowing a creator's money edges toward money transmission.** Escrow is the growth loop *and* the
  legal exposure. Consider a fixed abandonment rule (unclaimed Cut returns to the OnlyVault after N
  months).
- **18+ only, zero adult content on site.** Coins only for verified-adult creators. Immediate
  takedown-and-burn path if any coin is created for or by a minor. Not softenable.
- Impersonation needs a takedown process + a rule that unverified coins can't use a creator's likeness.

## Build conventions (the site exists now — read before editing)

No build step, no dependencies. Plain HTML/CSS/JS. ES5 `var` + function declarations. Globals on
`window.ONLYPAD`. **Load order: `math` → `data` → `wallet` → `app` → `epoch`.**

- **`assets/js/math.js` is the single source of truth.** The split, the Proof of Sub curve, the Drop
  index, the share formula. Never re-implement any of it. Dual-mode (`window.ONLYPAD.math` in the
  browser, `require`d in Node), so it can be tested without a browser.
- **`splitPct()` for anything a human reads, `splitOf()` for the fractions.** `1 - 0.8` is
  `0.19999999999999996` in floating point, so rounding the three fractions independently gives
  **80/17/2** and **40/53/8** — a split that does not sum to 100. `splitPct()` works in integer
  percent space and always sums to 100. Both are exported; use the right one.
- **`assets/js/data.js` is entirely simulated** — fixed seed (20260924), invented stage handles,
  every record carries `demo: true`. Swap it for `/api/onlys` when a backend exists; nothing else
  changes. The board must never reshuffle on reload, so the seed stays.
- **Reveal is observer + `sweep()`.** The IntersectionObserver alone is not enough: a jump scroll
  (nav anchor, or landing on `#faq`) moves an element past the viewport between frames and it sits at
  `opacity: 0` forever. `sweep()` is the rAF-throttled safety net. **Any new `.rv` element relies on
  both — do not remove the sweep.**
- **One accent, action-only.** Rose `#E8455F` = a button, a progress fill, a selected chip. Never
  decorative. Never OnlyFans blue `#00AFF0`. All tokens in `:root`; never hardcode a colour.
- Cards carry **two figures whose meaning depends on state**: verified → `Paid to creator`; unclaimed
  → `Waiting to claim` in amber. The progress bar is the OnlyVault fill, live-moving.
- **Copy rule that matters:** an UNCLAIMED coin has paid its creator *nothing* — the Cut is in escrow.
  Never write "paid to" for an unclaimed coin. The escrow is the product; the copy must not contradict it.
- Everything simulated is badged `DEMO` / `SIMULATED` in the UI **and** named in the reply.
- **Voice rule — the brand tagline is `Made for the gooners, by the gooners`.** User-supplied, set
  2026-09-24, deliberate. It is community in-joke copy for an 18+ product, not a typo, not a typo of
  "goers", and not something to professionalise away. Do not "fix" it, reword it, or strip it in a
  copy pass. It lives in exactly two places — `.hero__tagline` and `.foot__tagline` — and it is
  deliberately greyscale: the accent stays reserved for action, so the tagline must never be given
  `--accent-text`.

## The OnlyFans reference — where the line is

**Adopted: the pattern logic.** The component grammar is the stacked creator-profile hierarchy —
cover → avatar overlapping it → identity → social proof → content promise → an action that never hides
→ a locked tile that is *visibly* locked. All classes are `.of*`: `.ofcover` `__badge` `__mode`
`__mark`, `.ofav`, `.ofid`, `.oftick`, `.ofpromise`, `.ofstats`, `.oflock`, `.oflocktile`, `.ofstrip`,
`.ofaction`, `.ofcue`, `.ofpanel`.

**Accent: `--accent: #00D17C` — the logo's own green, set 2026-09-24 at the user's explicit request.**
The accent went **rose → blue `#00AFF0` → green `#00D17C`** in one day. Green is current. This green is
**sampled from the logo the user supplied**, not chosen: the mark's core fill measured `#03D17C`
across 3,221 px, with a neon highlight at `#12EB84`. Contrast measured in the browser: **9.57:1** on
the page background and for dark ink on the accent, 8.63:1 on a card surface.

**`--accent-ink` is DARK (`#0E0E0E`), not white.** White on this green is ~2.1:1 and fails WCAG AA.
A bright accent wants dark text — do not "fix" this back to white.

**`#00D17C` is NOT CLAIM's `#00B964`.** It is brighter and more saturated because it came from the
logo. Do not harmonise it back toward CLAIM's green.

I flagged the trademark risk twice and recommended against the blue; the user then supplied their own
design and asked for the site to match it. It is their project, their call, and it is on the record
here as accepted. **Do not re-litigate it and do not quietly revert it.**

**`--violet` (`#9B7BFF`) is for PPV mode, deliberately not a green.** Stream = accent green, PPV =
violet, Lock = amber. Keep three distinct mode colours.

**The mark is the user's own supplied image, used as a FILE — not recreated.** `brand/onlypad-mark.png`
is their PNG, cropped to the mark (content box `112,148 → 370,341` = 259×194 in the 480 source, padded
to a 295px square so the glow is not clipped) and exported at 512. `brand/onlypad-favicon-64.png` is a
64px derivation — the 512 is 217 KB and too heavy for an icon. The nav and footer use
`<img class="brand__mark" src="brand/onlypad-mark.png">`; `.brand__mark` already had
`width/height: 30px`. The image's black ground reads as a slightly darker tile on the `#0E0E0E` nav —
that is their design, leave it. A transparent variant is possible (key alpha off the green channel) if
they ever ask; offer it, do not do it unasked.

**DO NOT hand-build an SVG recreation of this logo.** I did that across four turns and the user had to
tell me in capitals. **When they hand over an image asset and say "use this", use the file.** A vector
recreation is only appropriate if they ask for one, and even then it should be offered rather than
substituted. `brand/onlypad-mark.svg` and `onlypad-mark-1024.png` (my recreations) were deleted.

The letterform, for reference only — the P's stem's left edge is a long straight diagonal running from
the bottom point up past the o, and that line is what cuts the o:
`M52 28 C62 22 76 20 92 26 C88 36 80 46 68 52 C64 54 61 55 58 55 C56 64 48 74 28 79 L52 28 Z
M60 33 C71 31 82 36 82 42 C82 48 71 51 60 50 Z`

**`--accent-ink` is DARK (`#0E0E0E`), not white.** White on `#00AFF0` measures 2.5:1 and fails WCAG
AA; `#0E0E0E` on it measures 7.7:1. OnlyFans' own white-on-blue button is a legibility defect, not a
detail worth copying. A bright accent wants dark text — do not "fix" this back to white.

**`--violet` (`#9B7BFF`) is for PPV mode, deliberately not a blue.** With a blue accent the old
`--blue` (`#4E9CFF`) made the Stream and PPV tags indistinguishable at tag size. Stream = accent blue,
PPV = violet, Lock = amber. Keep three distinct mode colours.

**Locked tiles mean escrow, and must look locked.** Dashed amber, lock glyph, the amount, and why it
is locked. The rule that follows from it: a locked state is never a tint of the normal state.

**Stat labels are one word each, in the product's own vocabulary: Subs · Cut · Tips.** Multi-word
labels ("To creator", "Claimable") wrap and make the row ragged. Keep them to one word.

**Superseded and safe to delete:** `.gcard__banner`, `.gcard__av`, `.gcard__mode`, `.gcard__nums`,
`.gcard__esc`, and the old `.escrow` / `.escrow__amt` / `.escrow__note`.

## Alignment with the reference site

**The live `claimpad.site` has DIVERGED from the local `CLAIM/` project on disk.** When the user points
at the live URL, **fetch the live site — do not read the local CLAIM copy as a proxy.** Known
divergences at 2026-09-24: the live board is a **table** (`# Token · Liquidity · Volume 24h · Market cap
· Holders`) where the local copy has a card grid with search and chips; the live launch wizard has
**two** steps and a **Starting bid** field where the local copy has three steps and a **Dev buy**; the
live holder leaderboard is its own section ("Who holds, and who gets paid."); the live stats strip has
**four** cells (Coins launched / Market cap / Volume 24h / Fee wallet) against the local five.

**Aligned to the reference (2026-09-24):** nav is the reference's five — `Discover · How it works ·
Holders · $ONLY · FAQ`; hero CTA is "See the launches"; stats are four (`Onlys launched · Market cap ·
Volume 24h · In Creator Escrow`) on a `repeat(4, 1fr)` grid whose ≤1080px breakpoint is
`repeat(2, 1fr)` with `nth-child(2n)` / `nth-child(n+3)` border rules; board heading is "Every Only
launched here."; the launch wizard's optional payment field is **Starting bid** (`#fBid` / `#prevBid`).

**The board carries the reference's market columns per coin** — Market cap / Volume 24h / Liquidity —
in a `.ofmkt` row. `liq` is in the demo data as `mcap × 0.08–0.18`.

**OPEN QUESTION, do not silently resolve:** the reference's board is a *table*, but the user explicitly
asked for the neon *card* grid two turns earlier. Those contradict. The cards currently carry the same
six data points the table would, so nothing is lost. If they ask for the table, that is a rebuild of
`onlyCard()` into a `<table>` — a real piece of work, not a tweak. Ask before doing it.

## The board — creator-funding cards

**Card grammar (set 2026-09-24 from a user reference):** media panel → **circular** avatar overlapping
its bottom edge → identity inline beside it (name + tick, @handle) → glowing bar → **crown pill** +
**`$earned / $generated`** in mono → a small meta line → full-width action. Classes: `.ofidrow`,
`.ofprog`, `.ofmeta`, `.ofpill` / `--warn`, `.ofamount` / `--warn`, `.ofsub`, `.ofaction`.

**The bar is the creator's Cut and it must not be faked.** `earned = paid + escrow` over `generated` —
that ratio *is* the launcher's split, so it varies coin to coin (50/60/70/80). **Whether the money has
reached the creator is carried by the pill colour and the locked tile, NOT by shrinking the bar to
zero** — a 0% bar on a Fan Launch looks broken.

**`.ofaction` takes `margin-top: auto`.** Grid rows stretch to equal height, so without it the button
floats mid-card on any card with no locked tile.

**`.boardglow` must keep `inset: 0`.** Negative left/right insets push past the section and scroll the
whole page sideways. The falloff comes from the gradient, not the box.

**The neon rule is relaxed on the board, deliberately and ONLY there.** The ported CLAIM system says
"no gradients, no glows, no neon"; the brand has since moved to a glowing neon mark and the user has
supplied two references in that language. The board may glow — tinted card border, outer shadow, a
glowing bar, a radial wash behind the section. **Do not extend the glow to the rest of the sheet, and
contrast must still pass.**

**No stock photography, ever.** The media slot is a flat panel with a watermark — the same call as the
monogram avatars. It is there for a creator's own image when there is real content; do not invent
imagery to fill it.

**`tick()` must recompute `.ofamount` and the bar, and must grow `o.generated`** alongside `paid` /
`escrow` / `claimable`, or the ratio drifts away from the split.

## The live activity feed and launching

**The hero feed is `Live activity / Launches and payouts, as they happen`,** matching the reference's
`Launches and claims, as they happen`. It carries three event kinds: `launch`, `cut`, `tips`, rendered
by `feedRow()`. **A launch row shows the split where a payout row shows an amount** — a coin created
seconds ago has not paid anyone yet, and the row must not imply it has.

**`emitLaunch()`** builds the Only from the wizard, unshifts the feed event, pushes it into `D.onlys`,
re-renders feed + board + stats, toasts, and scrolls to the new card. **The toast must keep saying no
real coin was created** — the UI behaves like a launch; the copy never claims one happened.

**The board sort stays honest.** Ranked by market cap, so a just-launched coin sorts **last**. Do not
fake a pin to the top. It is made findable by the `is-fresh` ring, the `NEW` feed badge, and the
scroll. `.frow--fresh` / `.frow__new` / `.gcard.is-fresh` are the classes.

**`tick()` runs every 12s** (`LIVE_MS`) so the feed moves: ages existing rows, unshifts a simulated
payout, calls `refreshStats()`, and nudges only the affected coin's card. **Do not re-render the whole
grid on a tick** — it churns the DOM and loses hover state every twelve seconds.

**`refreshStats()` must write `dataset.count`, not just the text.** The count-up reads its target from
`dataset.count`; updating only the text lets a later reveal animate the number back to a stale value.
That bug made "Onlys launched" read 12 after a thirteenth was launched. Any new writer of a
`[data-stat]` element has to keep `dataset.count` in step.

**`reveal()` uses one module-level IntersectionObserver.** It used to build a fresh one per call, and
`renderBoard()` calls it on every search keystroke — so typing leaked an observer per letter.

**A coin with no Cut yet needs its own copy:** "Locked — nothing yet / The Cut accrues from the first
trade", and "No Tips yet". "Locked — $0.00" reads like a bug.

## Status

**Landing page built and verified.** `index.html` + `assets/` — hero, three-way fee flow, launches
board (search + filters), launch wizard with a live split preview, creator escrow section, Tip Jar
with Drop clock and Sub leaderboard, `$ONLY`, Proof of Sub ladder, FAQ, footer disclaimer.

Verified by running it: **46 assertions** on the maths and dataset, plus a real headless-Chrome pass
(0 console errors, no overflow at 1440/390, all interactions exercised). Screenshots reviewed.

**The protocol is not built.** Next, in order: the third rail + escrow account in the Anchor program,
creator verification, wiring the split into pump.fun's fee-sharing config, a Drop crank, and a
backend to replace the local dataset.

Testing note for this machine: the sandbox **proxies the localhost port** and a `python -m http.server`
started with `nohup` does not survive between Bash calls. Render over `file://` instead and drive
Chrome via the DevTools Protocol on port 9222 (Node 22 has a global `WebSocket`, so no dependencies
are needed).

