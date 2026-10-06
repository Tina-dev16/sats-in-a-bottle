# Sats in a Bottle: Design System

Brutalist editorial on a warm gray canvas. Modelled on dayos.com. Flat surfaces, no shadows, no gradients (except one fade mask on 3D art), condensed uppercase headlines, one pale mint accent and one yellow spark.

Source of truth in code: `web/src/styles.css` (tokens at the top, sections below). Components: `web/src/components/`. 3D: `web/src/lib/bottleScene.js`, blocks: `web/src/components/Blocks.jsx`.

---

## 1. Color

| Token | Value | Use |
|---|---|---|
| `--color-warm-canvas` | `#e5e5e5` | Page background. Never pure white. |
| `--color-paper-white` | `#ffffff` | Cards, white sections, modals |
| `--color-carbon-black` | `#000000` | Text, primary buttons, inverted sections |
| `--color-mist-gray` | `#f3f3f3` | Pill background, quiet panels, gray buttons |
| `--color-ash` | `#c6c6c6` | Hairlines, inactive progress |
| `--color-smoke` | `#979797` | Secondary text on dark, muted copy |
| `--color-slate` | `#444444` | Secondary text on light, nav links, ghost buttons |
| `--color-graphite` | `#2f2f2f` | Dark buttons, tiles on black, header pill on black |
| `--color-mint-chip` | `#d1ffca` | Tags, glass tint, focus underline, small accents |
| `--color-voltage-yellow` | `#fff100` | Header button over black, status "ready", coins. Micro-accents only |
| `--color-danger` | `#b00020` | Errors, destructive outline buttons |

Block art tones: ink `#1a1a1a`, mint, yellow, off-white `#efede8`, skin `#f1cdb0` (baby model only), concrete panel `#d8d4cc`.

Rules
- Mint and yellow are never large surface fills. Yellow on dark header button and "ready" states only.
- Contrast: black on `#e5e5e5`/white, white on black. Gray text only for secondary copy.

## 2. Typography

| Role | Family | Weight | Notes |
|---|---|---|---|
| Display / headings | **Barlow Condensed** (stand-in for SuisseIntlCond) | 600 | Uppercase, line-height .92 to .95, letter-spacing -0.012em |
| Body, nav, buttons | **Inter Variable** (stand-in for SuisseIntl) | 450 body, 500 buttons/nav | letter-spacing -0.011em |
| Labels, tags, meta | **JetBrains Mono** | 400 | 11 to 12px, uppercase, -0.03em |

Scale (fluid with `clamp`)
- Hero `.h-hero`: 52px to 104px (7.2vw), 4 lines, left aligned
- Dashboard greeting: up to 150px
- Statement `.h-statement`: 44 to 72px
- Column head `.h-col`: 36 to 52px
- Secondary head `.h-sub`: Inter 450, uppercase, 30 to 44px
- Body 16 to 20px, line-height 1.2 to 1.33
- Mono label 12px

Rules
- Condensed face only at 36px and above. Never for body.
- All display headings uppercase. No emoji. No em dashes anywhere in UI copy.
- Copy is short: a headline, one sentence, a button.

## 3. Layout and spacing

- Base unit 8px. Common steps: 8, 16, 24, 32, 40, 64.
- Container `.wrap`: `width: min(100% - 176px, 1264px)`; 20px side gutters under 800px. Content left edge sits at 88px on a 1440 viewport.
- Section padding: black 64px (arc sections 80px top), white 64px, cards section 56px. Keep spacing tight.
- Header: fixed, 72px tall, 56px side padding. Content below starts at 96px (`.page`), dashboard and landing are full-bleed (`.page-full`).
- Anchor targets: `scroll-margin-top: 72px` so links land just under the header.

## 4. Shape

| Element | Radius |
|---|---|
| Buttons | 8px (ghost 4px) |
| Header pill | 40px |
| Tags | 64px |
| Cards | 32px (small 24px) |
| Featured card | 56px |
| Arc sections (top corners only) | 72px, 40px on mobile |
| Inputs | underline only (`border-bottom: 2px solid #000`), textareas 16px |

No box-shadows. Depth comes from surface contrast: canvas, white, black.

## 5. Header

- Left: bottle icon + "Sats in a Bottle" (Inter 700, 20px, -0.04em).
- Center: pill, 44px tall, `#f0f0f0`, links Inter 14px/450 `#444`, active/hover black.
- Right: black button, 38px tall, 8px radius, Inter 14px/500, white text.
- Over a `[data-dark]` section the pill becomes `#1b1b1b` with `#a8a8a8` links and the button turns **yellow with black text**. Detected via `elementsFromPoint` on scroll.
- After 8px of scroll the header gets a backing (`rgba(229,229,229,.94)` + blur, `rgba(0,0,0,.94)` over dark) so content never collides with it.
- Hidden pill under 980px.

## 6. Section patterns (landing and dashboard)

1. **Hero**: full viewport. Left: headline (top 130 to 150px) and a 20px paragraph at the bottom-left. Right: 3D bottle canvas, 58% wide, bottom edge fades out (mask).
2. **Black arc** (`.dk.arc`, `data-dark`): three columns, condensed head + 18px white paragraph; big statement headline below.
3. **Black feature trio**: rotating block art, head, one line.
4. **White arc** (`.wh.arc`, 20px side margins): `.h-sub` + gray subtext, featured card (`#e5e5e5`, 56px radius, text left, art right on `#d8d4cc`).
5. **Cards on canvas**: three white cards, art strip on top, title, gray text, gray button.
6. **Split CTA row**: two white halves with a hairline between, 60px condensed heads, 54px outlined arrow box (top-right).
7. **Footer**: compact black band, logo + one line.

## 7. Components

- **Primary button**: `#000`, white text, 8px radius, 48px high (`.btn-dark`); small 38px (`.btn-sm`). Hover graphite.
- **Ghost**: transparent, 1.5px `#444` border, 4px radius.
- **Gray button** (`.btn-gray`): `#f3f3f3`, black text, 40px high. For secondary card actions.
- **Dark small** (`.btn-dark-sm`): `#2f2f2f`, 48px.
- **Yellow**: only for the header button on black and "Open it now".
- **Tag**: mono 12px, uppercase, pill. Variants: mint (default), dark, light, yellow, gray.
- **Status tag**: sealed = dark, ready = yellow, claimed = mint, others gray.
- **Card** `.card`: white, 32px radius, 20px padding, no border/shadow. `.card.ink` is black with white text.
- **Inputs** `.fld` / `.wiz-body`: mono 12px label, 24 to 26px value, bottom border; focus adds a 3px mint underline (`box-shadow: 0 3px 0 mint`).
- **Countdown**: four tiles (days, hrs, min, sec), condensed numerals, graphite tiles on black.
- **Modal**: white, 32px radius, 560px max, backdrop `rgba(0,0,0,.55)`, focus trapped on open, Escape closes.
- **Toast**: black pill, bottom center, 4.5s.
- **Progress bar** (wizard): 5 segments, 5px tall, black when reached, ash otherwise.
- **Callout**: mint (info), yellow (warning), pink `#ffd9de` (error).

## 8. Imagery and motion

**Hero bottle (three.js)**: glass bottle (lathe geometry, physical transmission, mint tint) on a concrete block with two small cubes (mint, yellow). Black ₿ wrap, rolled message, sats coins, cork.
- Intro plays once (~5s) with scroll locked and a Skip link: wrap slides to the neck, message drops in, coins pour in, cork presses in, sparks at the seal.
- Then loops: hold, cork pops with burst and flash, fade out, rebuild. Bottle always stands on the block.
- Smoothing is time-based, not per-frame. Reduced motion shows the sealed state, no loop.
- Same canvas is reused (smaller, `zoom` prop) on sign-in (cork pops every ~6s), the create wizard (progress follows the step), and bottle pages (state follows status).

**Block art (CSS 3D)**: real boxes in `Blocks.jsx`, rotating on Y (18s, tilted -24deg), speckle texture, per-face shading. Models: `cluster`, `cake`, `cap`, `baby`. No extra WebGL contexts. Reduced motion freezes them.

**UI motion**: reveal-on-scroll (opacity + 28px rise, .8s), hover lift on cards (-4px), 150ms color/transform transitions. Nothing bounces.

## 9. Voice

Plain, specific, short. No exclamation marks, no emoji, no em dashes, no filler ("seamless", "powerful"). Prefer a contrast headline over a slogan.
Hero: "Not just a transfer. A bottle with a date on it."

## 10. Accessibility

- Visible focus ring: 3px black outline, 3px offset.
- Touch targets 38px minimum, 48px for primary actions.
- Countdown has `role="timer"` with a spoken label; toasts use `aria-live`; modals use `role="dialog"` and restore focus.
- Canvas has a role and label; SVG fallback if WebGL fails.
- `prefers-reduced-motion` disables reveal, loop, spin and smooth scroll.

## 11. Differences from dayos.com (deliberate)

- Hero object is a bottle on a concrete block instead of their cube stack.
- Barlow Condensed + Inter in place of the licensed Suisse Int'l family.
- Four nav links instead of seven.
- Block art is generated in CSS 3D rather than pre-rendered images.

## 12. Don'ts

- No box-shadows, gradients, or borders on cards.
- No pure white page background.
- No mint/yellow large fills.
- No condensed face below 36px or in body copy.
- No emoji, em dashes, or exclamation marks in copy.
- No centered-hero layouts; the system is left-aligned with the object on the right.
