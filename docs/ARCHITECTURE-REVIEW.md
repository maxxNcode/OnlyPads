# OnlyPad — architecture review

**Reviewed:** 2026-09-25 · commit `939a496 "OnlyPad Draft"` · working tree clean
**Scope:** `index.html`, `assets/`, `docs/CONCEPT.md`, `.backup/`, repo configuration
**Method:** full read of every source file, plus measured checks (WCAG contrast computed
from the token values, PNG dimensions read from the file headers, dead-code detection by
cross-referencing class/function names against the HTML and JS that consume them).

---

## 1. What the project is

OnlyPad is a **memecoin launchpad landing page** built around one idea: **every coin pays
its creator.** It is the sibling of a project called CLAIM — same Solana / pump.fun
architecture, same dark-mode-GoFundMe design system — but where CLAIM routes a coin's
trading reward to its *holders*, OnlyPad routes a share to a *person*.

The whole product follows from one constraint that is documented honestly at the top of
`docs/CONCEPT.md`:

> **OnlyFans has no official public API.** There is no developer programme, no payouts
> endpoint, no OAuth. Every "OnlyFans API" is an unofficial reseller authenticating as the
> creator's own app session. There is no deposit address, so nothing outside OnlyFans can
> credit an OnlyFans balance.

So the creator's share — **"The Cut"** — is paid in **SOL to a Solana wallet**. The project
borrows OnlyFans' *culture and vocabulary* (Subs, Drops, PPV, renewals) and never its API.
That is a genuinely well-reasoned product decision, and it is the load-bearing assumption
of the entire design.

**The site is a front end only.** There is no chain connection, no backend, no wallet
integration. Every figure on the page is simulated from a seeded PRNG, and the page says so
in the stats note. The "Launch a coin" and "Boost" buttons raise a toast that states plainly
that nothing was created.

### Repo provenance

A fork: `marshicode/OnlyPads` → `maxxNcode/OnlyPads`. `origin` is the fork, `upstream` is
the original. One commit on `main`, no divergence. `.workbuddy-ai/`, `.backup/` and
`.freebuff/` arrived from the clone — they are tracked on the remote, not local-only.

---

## 2. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Markup | Hand-written HTML5, single page | 138 lines, no templating |
| Styling | Hand-written CSS3, custom properties | 230 lines, one `:root` token block |
| Scripting | Vanilla ES5-syntax JS, IIFE modules | 3 files, no transpiler |
| Module system | Global namespace `window.ONLYPAD` | Ordered `<script>` tags, no bundler |
| Build step | **None** | No `package.json`, no `node_modules`, no `vercel.json` |
| Tests | None in the repo | `math.js` is *dual-mode* so it can be `require`d in Node |
| Fonts | Google Fonts CDN | Plus Jakarta Sans + JetBrains Mono, `&display=swap` |
| Images | 2 PNGs in `brand/` | 512×512 mark, 64×64 favicon |
| Hosting | Not configured | No headers, redirects, or caching rules |

**Runtime dependencies: exactly one** — the Google Fonts stylesheet. Everything else is
first-party. That is the project's strongest architectural property: the entire page is
~40 KB of readable source that opens from `file://` with no toolchain.

---

## 3. Module inventory

| File | Lines | Role |
|---|---:|---|
| `index.html` | 138 | Header, hero, creators board, 3-cell stats strip, 3 steps, creator disclosure, footer, toast host |
| `assets/css/styles.css` | 230 | Complete design system: tokens, reset, layout, components, responsive |
| `assets/js/math.js` | 171 | **Pure maths.** Split, Proof-of-Sub curve, Drop index, share formula, formatters |
| `assets/js/data.js` | 237 | **Seeded simulation.** 12 creators, marquee subset, platform coin, Tip Jar, feed, 48 Subs |
| `assets/js/app.js` | 126 | **DOM.** Renders stats + board, wires the two button actions, toast helper |
| `docs/CONCEPT.md` | 283 | Product spec, vocabulary, risk register, honest scope note |
| `brand/onlypad-mark.png` | 512×512 | 212.2 KB — displayed at 30×30 |
| `brand/onlypad-favicon-64.png` | 64×64 | 6.4 KB |

### The `.backup/` directory — read this before editing anything

`.backup/` holds a **much larger, earlier build** of the same project:

| | working tree | `.backup/*.1905` |
|---|---:|---:|
| `index.html` | 138 lines | **1002 lines** |
| `styles.css` | 230 lines | **983 lines** |
| `app.js` | 126 lines | **792 lines** |
| `math.js` | 171 lines | 171 lines |
| `data.js` | 237 lines | 201 lines |
| `wallet.js` | — | **120 lines** |
| `epoch.js` | — | **251 lines** |

The removed build had a five-item nav, a live activity feed, a launch wizard with a live
split preview, a fee-split diagram, a Creator Escrow section, a Tip Jar with a Drop
countdown, a 48-row Sub leaderboard, a `$ONLY` section, a Proof-of-Sub ladder, an FAQ, and
an 18+ entry gate. Its `app.js` had 33 top-level functions including `emitLaunch()`,
`tick()`, `refreshStats()`, `reveal()` and `sweep()`.

**This was a deliberate reduction at the user's direction** — `docs/CONCEPT.md` §"Honest
scope note" says so explicitly and names `.backup/` as the preservation copy. `math.js` is
byte-for-byte identical in both, confirming the maths was never reduced: it is the frozen
spec that the future Anchor program must match.

---

## 4. Architecture

### Layering

```
index.html  ──ordered <script> tags──▶  math.js  ──▶  data.js  ──▶  app.js
                                        (pure)      (simulated)    (DOM)
```

Dependencies flow strictly one way, and each layer only knows the one below it:

- **`math.js`** — zero dependencies. Pure functions. Dual-mode: it assigns
  `window.ONLYPAD.math` in a browser and `module.exports` under Node, via a single
  UMD-style wrapper. **This is the best decision in the codebase**: it makes the numbers
  testable without a browser, and it makes "the maths lives in one place" enforceable.
- **`data.js`** — depends on `math.js` (reads `root.ONLYPAD.math`). Contains no maths of
  its own, only a seeded PRNG (`mulberry32`) and record construction.
- **`app.js`** — depends on both. Contains no maths and no data. Reads `D.onlys` /
  `D.marquee`, formats through `M.*`, writes DOM.

No state container, no reactivity, no event bus. `boot()` runs once; the only interaction
is a click handler that raises a toast. There is no re-render path — which makes several
classes of bug that plagued the larger build (grid churn, hover-state loss, stale
`dataset.count` during count-up) structurally impossible here.

### Design system

One token block in `:root` drives everything. The accent is **`#00D17C`**, sampled from the
logo the user supplied rather than chosen, with **`--accent-ink: #0E0E0E`** — dark ink on a
bright accent, which is correct: white on this green measures ~2.1:1 and fails WCAG AA,
dark ink measures **9.57:1**.

The one-accent-action-only discipline is followed consistently. Two violations are noted in
§6.13.

---

## 5. Data flow

```
boot()
 ├─ $('yr').textContent = new Date().getFullYear()
 ├─ stats: { onlys: D.onlys.length, generated: M.usd(Σ generated), paid: M.usd(Σ paid) }
 │           └─▶ written to [data-stat=…] via textContent
 └─ board: D.marquee.slice(0,6) ──▶ 6 × <article class="creator">
              per card: M.splitPct(o.cut) ──▶ "70% of creator fees"
                        M.usdShort(o.mcap / o.vol24)
                        monogram from o.name[0]
              └─▶ listeners on [data-boost] ──▶ toast("Not wired up yet")
 [data-launch] listeners ──▶ toast("Not wired up yet")
```

The **simulation** inside `data.js` is a single deterministic pass:

```
rng(20260924) ──▶ 12 creators ──▶ splitOf(cut) ──▶ generated → paid|escrow, claimed+claimable
                                └─▶ mcap ──▶ vol24, liq
             ──▶ FANS[12] ──▶ fans
             ──▶ MARQUEE[6] ──▶ shallow copy of the matching only
             ──▶ feed: 4 launch rows + 6 payout rows, sorted by secsAgo
             ──▶ 48 subs: 4 under MIN_HOLD (weight 0, eligible false) + 44 real
                          weight ──▶ shareOfJar ──▶ claimable ──▶ sort desc ──▶ rank
```

**The fixed seed is load-bearing.** `R` is a single module-level PRNG consumed in a fixed
order, so the board is stable across reloads — which is a product requirement, not an
accident. It is also **fragile in a way that is worth knowing**: inserting one `between()`
call anywhere shifts every downstream value. Any edit to `data.js` that adds or removes a
random draw will silently reshuffle the entire dataset.

---

## 6. Findings

Severity: **H** = user-visible defect · **M** = latent bug or real maintenance hazard ·
**L** = cosmetic / hygiene.

### 6.1 — H · `--ink-4` fails WCAG AA, and it is used for the smallest type on the page

Measured contrast for every text token against every surface:

| Token | Value | on `--bg` #0E0E0E | on `--surface` #161616 | on `--surface-2` #1C1C1C | AA (4.5:1) |
|---|---|---:|---:|---:|---|
| `--ink` | `#F5F5F5` | 17.71 | 16.60 | 15.63 | PASS |
| `--ink-2` | `#B3B3B3` | 9.21 | 8.63 | 8.13 | PASS |
| `--ink-3` | `#808080` | 4.89 | 4.58 | **4.32** | marginal FAIL |
| `--ink-4` | `#5C5C5C` | **2.89** | **2.71** | **2.55** | **FAIL** |
| `--accent-text` | `#00D17C` | 9.57 | 8.97 | 8.45 | PASS |
| `--accent-ink` on `--accent` | `#0E0E0E` on `#00D17C` | 9.57 | — | — | PASS |

`--ink-4` sits at **2.89:1** on the page background and **2.55:1** on the marquee card
surface — below even the 3:1 threshold for large text, and it is used for *small* text:

- `.stat__k` — 0.72rem uppercase stat labels
- `.creator__k` — 0.62rem card stat labels
- `.stats__note` — 0.76rem, the "Simulated demo data" disclosure
- `.foot__legal` — 0.79rem, **the OnlyFans non-affiliation disclaimer**
- `.creator__aud`, `.foot__yr`, `.claimbox__a`

The legal disclaimer is the text most likely to be read carefully by a regulator or a
creator, and it is the least legible text on the page. `--ink-3` also fails on
`--surface-2` (4.32:1), which is where `.creator__handle` renders on all six marquee cards.

**Fix** (verified by computation, worst surface `--surface-2`):

| Token | Change | New worst ratio |
|---|---|---|
| `--ink-4` | `#5C5C5C` → **`#8A8A8A`** | 4.94:1 PASS |
| `--ink-3` | `#808080` → **`#909090`** | 5.34:1 PASS |

This is a two-line change in `:root` with no layout impact.

### 6.2 — H · A 212 KB logo is served for a 30×30 render

`brand/onlypad-mark.png` is **512×512 px, 212.2 KB**, displayed at **30×30 px** in the header
and **26×26 px** in the footer. On a 3× DPR phone the largest honest requirement is ~90×90.

The logo is therefore **~85% of the page's total transfer weight** (~40 KB of code + 212 KB
image ≈ 257 KB), and roughly 17× the linear resolution needed. Resizing to ~96×96 and
re-encoding takes it to an estimated 6–10 KB — a ~95% reduction in the single heaviest asset,
with zero visual change at the rendered size. An SVG of the mark would be better still.

There is no `srcset`, so every device downloads the 512.

### 6.3 — H · Duplicate `@media (max-width: 560px)` block

`styles.css` defines the same breakpoint twice:

- **Lines 209–218** — 8 rules, including `.board { grid-template-columns: 1fr; }` and
  `.creator__tag { display: none; }`
- **Lines 219–226** — a 6-rule copy of the same block, **missing** those two rules

Both apply. The second is a stale leftover from an edit. It happens to be harmless today
because the duplicate declarations are identical and the missing rules exist in the first
block — but it is a trap: editing the second block (the one that appears later, and
therefore looks authoritative) will silently have no effect on `.board` or `.creator__tag`.
Delete lines 219–226.

### 6.4 — M · `tierOf().m` is not the multiplier it claims to be

`math.js:66-74` returns `{ tier, sub, m }` where `m` is taken from the matched **curve knot**,
not from the interpolation:

```js
tierOf(45, false).m   // → 1.5   (the knot at d=30)
multiplier(45, false) // → 1.75  (the actual value)
```

`tierOf` is documented as "the tier name for a streak" but it returns a field named `m`
alongside it, which reads as "the multiplier for this streak". Any future UI that renders
`tierOf(x).m` as "your multiplier" will understate it. Nothing consumes `tierOf` today, so
this is latent — but it lives in the file that is designated the single source of truth.

**Fix:** either drop `m` from `tierOf`'s return value, or compute it with
`multiplier(d, neverSold)` so the two can never disagree.

### 6.5 — M · `data.js` re-implements the maths it is required not to

The stated rule is that `math.js` is the only place the maths exists. `data.js` breaks it
twice:

**(a) A divergent fallback** (`data.js:49-50`):

```js
var M = root.ONLYPAD && root.ONLYPAD.math;
function split(cut) { return M ? M.splitOf(cut) : { cut: cut, tips: 1 - cut - 0.05, pad: 0.05 }; }
```

The fallback is only correct at `cut = 0.60`. Compare against `splitOf`:

| `cut` | fallback `tips` | true `tips` |
|---:|---:|---:|
| 0.60 | 0.35 | 0.35 ✓ |
| 0.70 | 0.25 | 0.2625 ✗ |
| 0.80 | 0.15 | 0.175 ✗ |
| 0.50 | 0.45 | 0.4375 ✗ |

**(b) An inlined share formula** (`data.js:219-222`):

```js
row.shareOfJar = totalWeight ? row.weight / totalWeight : 0;
row.claimable  = row.shareOfJar * jar.pot * jar.dropsOpen;
```

This duplicates `M.share()` — including its `clamp(drops, 0, MAX_STACK)` guard, which is
simply absent here. It is correct only because `dropsOpen` happens to be 3 < 12.

Neither is a live bug. Both are exactly the kind of drift the "single source of truth" rule
exists to prevent, and both are silent when they break.

### 6.6 — M · `rank` is assigned twice, on two different bases

```js
rank: i + 2                    // data.js:100 — reserves rank 1 for the platform coin
...
onlys.forEach(function (o, i) { o.rank = i + 2; });   // data.js:108
```

The first assignment uses `i + 2`, implying rank 1 belongs to `$ONLY`. The second, after the
sort, also uses `i + 2`. But `onlys` contains **12 entries and no platform coin**, so the
final ranks run **2…13** with no rank 1 — or, if read as the post-sort pass, an off-by-one
against the stated intent of "`$ONLY` pinned at the top as the platform coin"
(`CONCEPT.md` §"The interface"). Nothing renders `rank` today, so it is latent. It should be
resolved in one direction and asserted.

### 6.7 — M · No guard on module load order

`app.js:9-10` runs at IIFE evaluation time, before `boot()`:

```js
var M = root.ONLYPAD.math;
var D = root.ONLYPAD.data;
```

If `math.js` or `data.js` fails to load (404, a CDN hiccup, a mistyped path, a stale cache),
`root.ONLYPAD` is `undefined` and the page dies with an uncaught `TypeError` before rendering
anything. The only signal is a console message. The page degrades to a header, a hero, and
three em-dashes, with no explanation.

**Fix:** three lines — `if (!M || !D) { /* render a visible "demo data failed to load" state */ return; }`.

### 6.8 — M · Unescaped interpolation into `innerHTML`

`app.js:57-76` builds each card from a template string, including:

```js
'<button … data-boost="' + o.handle + '">Boost</button>'
```

Every other dynamic value on the card is written with `textContent` — which is the right
instinct, and it is applied consistently. `o.handle` is the one exception, and it is
interpolated raw into markup. Today the handles are hardcoded demo strings, so this is not
exploitable. The moment a handle can come from a launch form or an API — which is the
documented plan for `data.js` — this becomes stored XSS.

**Fix:** build the button with `createElement` and set `dataset.boost`, or run the value
through an escape helper. The pattern matters more than the current data.

### 6.9 — L · Dead code and dead fields

| Item | Where | Note |
|---|---|---|
| `.creator__v--acc` | `styles.css:157` | Defined, never applied |
| `pick()` | `data.js:23` | Defined, never called |
| `MARQUEE[].cut`, `.name`, `.verified` | `data.js:56-63` | Shadowed by the `onlys` copy — editing them has no effect |
| `fans: c.fans \|\| 0` | `data.js:98` | `CREATORS` has no `fans`; always 0, always overwritten |
| `board = $('board')` | `app.js:102` | Re-queries an element already held |
| `D.marquee.slice(0, 6)` | `app.js:53` | `marquee` has exactly 6 entries |
| `stats.onlys` pre-formatted | `app.js:39` | Built as a string, then written via `textContent` |
| `rank: i + 2` | `data.js:100` | Immediately overwritten — see §6.6 |
| `pct` `sol` `short` `share` `dropIndex` `secsLeftInDrop` `dropProgress` `weight` `vaultFill` `cutReached` `tierOf` | `math.js` exports | Unused by the current page — **intentional** per `CONCEPT.md`, but should be labelled |

The unused `math.js` exports are a deliberate design choice ("the maths is still real… it is
the spec the Anchor program has to match"), not rot. A one-line comment in the export block
saying so would stop the next reader from deleting them.

`data.js:98` also has broken indentation (`fans: c.fans || 0,` sits at column 0 inside an
object literal), which reads as a hasty paste.

### 6.10 — L · Orphan anchors

`index.html:45` and `:75` define `id="creators"` and `id="how"`, but the header has **no nav
links** — the removed build's five-item nav is gone, and nothing on the page links to either
anchor. `scroll-padding-top` and `scroll-behavior: smooth` are configured for anchor
navigation that can no longer happen. Either add the nav or drop the ids and the
`scroll-padding-top`.

### 6.11 — L · Repo hygiene

- **No `.gitignore`.** Git tracks `.backup/` (428 KB of duplicated source, including a
  second copy of the 212 KB PNG), `.freebuff/` (a dev-server log, `http-8321.log`, and a
  `project-id`), and `.workbuddy-ai/` (AI session memory, including a 31 KB daily log).
  `.backup/` and `.freebuff/` are build/editor artefacts and do not belong in version
  control.
- **No `README.md`.** The only entry point for a new contributor is `docs/CONCEPT.md`, which
  is a product document, not a setup guide. There is no statement of how to run the page, no
  description of the module layering, and no note that `.backup/` exists.
- **No `LICENSE`.**
- **No `vercel.json`** or any host config — no cache headers, so a default host would serve
  the 212 KB PNG with `max-age=0, must-revalidate` on every visit.

### 6.12 — L · The "ES5" convention is inaccurate

The stated convention is "ES5 `var` + function declarations". The *syntax* is ES5, but the
*APIs* are not: `Math.imul` (`data.js:16-18`), `Object.assign` (`data.js:123`), `globalThis`
(`math.js:12`, `data.js:237`), `NodeList` iteration via `Array.prototype.forEach.call`
(`app.js:104`), `String.prototype.toLocaleString` with options (`math.js:147`). All are
ES2015+, `globalThis` is ES2020. Fine for any modern target, but the convention as written
would mislead someone into thinking they must avoid `const`/arrow functions for
compatibility reasons.

### 6.13 — L · Two hardcoded colours bypass the token system

- `styles.css:80` — `.btn--primary:hover { background: #1FDD8F; }` (contrast with
  `--accent-ink`: 10.84:1, so legible; but it is an untokenised accent derivative)
- `styles.css:148` — `.creator--marquee .creator__tag { border-color: rgba(0, 209, 124, .35); }`

Both are accent tints that should be tokens (e.g. `--accent-hi`, `--accent-line`) so the
accent can be changed in one place — which is precisely what happened three times during
this project's history (rose → blue → green).

### 6.14 — M · Documentation contradicts the code

**This is the highest-value finding for a new contributor, because it will cause real
wasted work.**

`docs/CONCEPT.md` is internally inconsistent. Its §"Honest scope note" correctly describes
the current reduced page and names `.backup/` as the preservation copy. But its earlier
sections still specify the **removed** build:

| `CONCEPT.md` says | Working tree actually has |
|---|---|
| §"The interface": card is `banner → avatar → title/ticker → **progress bar** → **two figures** → action` | avatar → name/handle → cut line → 4 stat cells → audience + Boost. **No progress bar, no two figures** |
| §"The interface": the two figures are `Paid to creator` / `Subs claimable` | absent |
| §"Section order" (12 numbered sections) | 4 sections: hero, creators board, stats, how-it-works |
| §"Stats strip — Onlys launched · market cap · volume 24h · Tip Jar" (4 cells) | 3 cells: Onlys launched · Creator fees earned · Paid to creators |
| §"Nav — OnlyPad · Launches · How it works · `$ONLY` · Launch a coin" | no nav |
| §"The Sub leaderboard" (sortable, wallet-pinned) | absent |
| §"What breaks": "18+ gate on entry" | no gate (it existed in `.backup/` as `id="agree"`) |
| §"Design tokens": `--surface:#1A1A1A` | `--surface:#161616`, plus a `--surface-2:#1C1C1C` that does not appear in the doc |
| §"Design tokens": accent is **rose `#E8455F`** | accent is **green `#00D17C`** |

The rose-vs-green entry is the most confusing: `CONCEPT.md` argues at length for rose and
closes with "the rose is the one I would ship", while the code has shipped green, sampled
from the logo, and `styles.css` carries a comment explaining why green is correct. The
document also contradicts itself on the curve's home — §"The hook" says `CURVE` lives in
`assets/js/data.js`, §"Honest scope note" says `assets/js/math.js`. It is in `math.js`.

**Recommendation:** split `CONCEPT.md` into *product intent* (the idea, the vocabulary, the
mechanic, the risk register — all still accurate) and *current implementation status* (the
scope note, which is accurate). Delete or clearly quarantine the interface/section-order
specs, or move them into the `.backup/` tree alongside the build they describe.

### 6.15 — L · Other gaps

- **No `<noscript>`** — a JS-disabled visitor sees three em-dashes and an empty board with
  no explanation.
- **No `og:image`** and no Twitter card, so sharing the link produces a bare text card.
- **No canonical URL.**
- **`overflow-x: hidden` on `body`** (`styles.css:50`) hides horizontal-overflow bugs rather
  than fixing them. It is currently masking nothing, but it will also mask the next one.
- **Google Fonts is an unbounded third-party dependency** — a render-blocking request to two
  hosts on every load, with no `preload` for the font files themselves and no CSP. Self-hosting
  the two families would remove the external dependency and the privacy exposure.
- **`.stats` uses `--line` as a 1px grid gap** (`styles.css:99-102`) — a neat technique, but
  it means the stats strip's internal dividers are the same token as its border, and the
  trick breaks if `--line` ever becomes transparent.
- **No visible focus style is defined.** The UA default outline survives (`button` resets
  `border`, not `outline`), so keyboard navigation works, but it is inconsistent with the
  design system. A `:focus-visible` rule would be an improvement, not a fix.
- **`#board` has `aria-live="polite"`** and is filled after load, so a screen reader will
  announce all six cards at once. For a static six-card board, `aria-live` adds noise rather
  than value.

---

## 7. What is genuinely good

Worth stating plainly, because the findings above are a long list:

1. **The layering is clean and enforced.** `math` → `data` → `app`, one direction, no cycles,
   no cross-talk. Each file has a single responsibility and says so in a header comment.
2. **`math.js` being dual-mode is the right call.** It is why the numbers can be verified in
   Node without a browser, and it is what makes "the maths lives in exactly one place" a
   testable claim rather than a hope.
3. **`splitPct()` exists because a real bug was found and understood.** Rounding three
   floating-point fractions independently renders an 80% cut as `80/17/2` — a split that does
   not sum to 100. Working in integer percent space removes it, and the comment in the file
   explains the arithmetic precisely enough that nobody will "simplify" it back.
4. **The honesty is consistent and unusual.** Simulated data is flagged in the dataset
   (`demo: true`), badged in the UI, disclosed under the stats strip, named in the
   `CONCEPT.md` scope note, and the buttons say outright that nothing was created. The
   footer carries an explicit non-affiliation disclaimer. For a project in a legally exposed
   space, that discipline is the right instinct.
5. **The risk register in `CONCEPT.md` is real.** Trademark, money transmission, exchange
   delisting, age verification, impersonation, and the cold-start problem ("the creator has
   to want this") are all named as obstacles rather than disclaimers. That is a better
   document than most shipped products have.
6. **Zero dependencies, no build step.** The whole site is 40 KB of readable source that
   opens from the filesystem. Nothing will break because a transitive dependency published a
   bad minor.

---

## 8. Recommended order of work

**Do now — small, high-value, no design decisions required**

1. Fix the contrast tokens (§6.1): `--ink-4` → `#8A8A8A`, `--ink-3` → `#909090`. Two lines.
2. Delete the duplicate media block (§6.3): `styles.css:219-226`.
3. Resize the logo (§6.2): re-export `onlypad-mark.png` at ~96×96. ~95% of the image weight.
4. Add `.gitignore` (§6.11): `.backup/`, `.freebuff/`, `.workbuddy-ai/`.
5. Add the load-order guard in `app.js` (§6.7): three lines.

**Do next — correctness**

6. Fix `tierOf`'s `m` (§6.4) so it cannot disagree with `multiplier`.
7. Remove the two maths re-implementations in `data.js` (§6.5) — call `M.splitOf` and
   `M.share`, or delete the fallbacks.
8. Resolve `rank` in one direction and assert it (§6.6).
9. Replace the `innerHTML` handle interpolation with `dataset` (§6.8).
10. Delete the dead code listed in §6.9.

**Do before the next contributor arrives — documentation**

11. Reconcile `CONCEPT.md` with the code (§6.14). Split product intent from implementation
    status; quarantine or delete the interface/section-order specs.
12. Add a `README.md`: what the project is, that there is no build step, the module layering
    and load order, that `math.js` is the single source of truth, and that `.backup/` holds
    the previous build.
13. Add a `LICENSE`.
14. Decide whether to restore anything from `.backup/`. The two builds are not
    variations — they are different products with different scopes, and the current one is a
    deliberate reduction. **Ask before restoring.**

**Before launch**

15. Host config: `immutable` caching for hashed assets, a bounded `max-age` plus
    `stale-while-revalidate` for unhashed names (fonts, the PNG), and HTML left
    revalidating so deploys propagate.
16. The 18+ gate (§6.14) — `CONCEPT.md` lists it as non-softenable, and it is not in the
    current build.
17. The trademark question. The page carries both a logo mark and an "OnlyPad" wordmark,
    while `CONCEPT.md` §"What breaks" states the minimum mitigation is to use neither. This
    was a deliberate call by the project owner with the risk on the record — it is flagged
    here as an accepted exposure, not an oversight. `FanPad` and `CutPad` remain the
    fallback names carrying the same mechanic.

---

## 9. Summary

OnlyPad is a small, clean, well-layered static front end for a genuinely well-reasoned
product idea. The engineering that exists is good: the module boundaries are real, the
maths is isolated and testable, and the honesty about what is simulated is consistent.

It is also a **deliberately reduced draft**, and most of the confusion a new reader will
experience comes from documentation that still describes the larger build now sitting in
`.backup/`. Fixing `CONCEPT.md` will do more for this project than fixing any individual
line of code.

Of the code-level findings, three are user-visible and cheap: **the `--ink-4` contrast
failure (2.89:1, on the legal disclaimer), the 212 KB logo rendered at 30px, and the
duplicated media query.** The rest are latent — real, worth fixing, but currently
unreachable from the page as shipped.
