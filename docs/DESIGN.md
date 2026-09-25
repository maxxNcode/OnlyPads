# OnlyPads — design rules

Split out of `.workbuddy-ai/memory/MEMORY.md` on 2026-09-26 to keep that file inside its
injection budget. **`assets/css/styles.css` is the source of truth for every value**; this
file records the rules and the reasons, which the CSS cannot.

**Two themes, DARK by default.** Dark in `:root`, light scoped on `html[data-theme="light"]`, so no
attribute = dark with no flash. Toggle persists to `localStorage['onlypad-theme']`; `theme.js` applies
it before the stylesheet paints. **Every colour-shaped value must be a token — when adding a rule, ask
what it looks like in the other theme.**

Layout is the GoFundMe landing page either way: **enormous display type at a LIGHT weight** — Plus
Jakarta Sans **200/300** carries `.h-xxl`/`.h-xl`/stat values while 600–800 stays on small text, so
the hierarchy is weight contrast.

**The green needs four tokens, because one cannot do four jobs.** `#00D17C` is unchanged in both
themes but its role is not — **on white it is 2.02:1 and can never be text or a thin graphic; on the
near-black ground it is 9.6:1 and can carry anything.** `--accent` = fill · `--accent-ink` = ink **on**
`--accent` · `--accent-text` = accent text · `--accent-gfx` = bars, dots, ticks.

**Never white on `--accent`; never `--accent` as text in light.** Dark ink on the bright green keeps
the brand colour intact while staying legible — do not "fix" it. **Not CLAIM's `#00B964`** — brighter,
because it came from the logo. Don't harmonise it back.

**Glow — exactly three touches, all tokenised, all `none` in light:** `--glow` (progress-bar fill),
`--glow-btn` (primary button), `--hero-wash` (one faint radial behind the hero). Brief: *"dont apply
glows too much"*. Set all three to `none` and the page goes completely flat — that is the dial.
`.ofprog` deliberately has **no** `overflow: hidden`, or it would clip the fill's glow.

**Contrast — 22 checks in BOTH themes, all pass.** **In light the binding surface is the green TINT,
not white** — it costs ~0.4 of a ratio point. **And the probe must composite alpha** down to an opaque
layer, or a tinted background reads as its own colour.

**The mark is the user's own supplied image, used as a FILE — not recreated. Do NOT hand-build an SVG
recreation** — tried across four turns; the user had to say so in capitals. Made transparent
2026-09-25 (`alpha = max(R,G,B)`, colour un-premultiplied, capped 1.6×): **128×128, 20 KB** (was 512
opaque, 212 KB). `brand/onlypad-mark-original.png` is the untouched 512 source — **keep it**.

The trademark risk was flagged twice; the user then supplied their own design and asked the site to
match it. Their project, their call, on the record as accepted. **Do not re-litigate it and do not
quietly revert it.** The mark *and* the wordmark are both in use, so the "no wordmark, no logo"
mitigation is spent.
