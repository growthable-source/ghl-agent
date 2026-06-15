# Voxility UI Style Guide

This is the practical guide for designing and building UI in the Voxility
dashboard (`ghl-agent`). It describes the token system the whole app runs
on, the rules that keep theming working, and the component patterns we
reuse. If you're designing a new screen, design **against these tokens** —
not against fixed hex values — because every screen renders in multiple
themes.

The source of truth is the `@theme` block in `app/globals.css`. When this
doc and that file disagree, the file wins — but tell us so we can fix the
doc.

---

## 1. The one rule that matters most

**Never design or build against raw colors. Everything is a theme token.**

The app ships several full themes (`soft-light`, `midnight`, `sunset`,
`dim`, …). The user picks one. A screen built with fixed colors looks
broken in three of the four themes. A screen built with tokens just works
everywhere, for free.

Two ways to use a token in code:

```tsx
// 1. Inline style with the CSS variable (preferred for one-offs)
<p style={{ color: 'var(--text-tertiary)' }}>Subtle label</p>

// 2. The remapped Tailwind classes (preferred for structural styling)
<div className="bg-zinc-900 border border-zinc-800 text-zinc-100">Card</div>
```

Both resolve to the same theme tokens. See §3 for why `bg-zinc-900` is
legal here even though it looks like a hardcoded color.

---

## 2. The token palette

Every theme defines the **same set of token names** with different values.
Design in terms of the names. Representative values shown for the two
anchor themes (`soft-light`, `midnight`).

### Surfaces (backgrounds, lightest → deepest)

| Token | soft-light | midnight | Use for |
|---|---|---|---|
| `--background` | `#f8f7f4` | `#05080f` | The page itself, behind everything |
| `--surface` | `#faf9f7` | `#090d15` | Cards, panels, the primary raised surface |
| `--surface-secondary` | `#f0eee9` | `#0f1524` | Insets, list rows, nested cards, inputs-at-rest |
| `--surface-tertiary` | `#e5e2dc` | `#1a2540` | Pressed/hover fills, chips, the deepest inset |

### Text (strongest → faintest)

| Token | soft-light | midnight | Use for |
|---|---|---|---|
| `--text-primary` | `#1c1917` | `#f8fafc` | Headings, primary body, values |
| `--text-secondary` | `#57534e` | `#94a3b8` | Secondary body, descriptions |
| `--text-tertiary` | `#78716c` | `#64748b` | Labels, captions, metadata |
| `--text-muted` | `#a8a29e` | `#475569` | Placeholder-level, disabled, the faintest text |

### Borders

| Token | Use for |
|---|---|
| `--border` | Default hairline between/around surfaces |
| `--border-secondary` | Slightly stronger border (hover, focus, emphasis) |

### Inputs

| Token | Use for |
|---|---|
| `--input-bg` | Text field / select background |
| `--input-border` | Field border at rest |
| `--input-text` | Typed text |
| `--input-placeholder` | Placeholder text |

### Accents (each has a solid + a tinted `-bg` companion)

| Token | Color family | Meaning — use it for |
|---|---|---|
| `--accent-primary` / `--accent-primary-bg` | **Brand orange** (`#e84425` / `#fa4d2e`) | Primary CTAs, active/selected state, brand moments, the one important action on a screen |
| `--accent-emerald` / `--accent-emerald-bg` | Green | Success, "done", online/available, "assigned to me", positive CSAT |
| `--accent-amber` / `--accent-amber-bg` | Amber/gold | Warnings, **internal notes**, ratings/CSAT stars, "needs attention but not broken" |
| `--accent-blue` / `--accent-blue-bg` | Blue | Informational, "handed off / human took over", neutral status |
| `--accent-red` / `--accent-red-bg` | Red | Errors, destructive actions, urgent priority |

**Rule of thumb:** one `--accent-primary` action per view. If everything
is orange, nothing is. Use the `-bg` tints for subtle fills (a chip, a
callout box); use the solid accent for text, borders, and the single
primary button.

---

## 3. The remapped `zinc` scale (and the gotchas)

For historical reasons, hundreds of components were written with Tailwind's
`zinc` scale. Rather than rewrite them, `app/globals.css` **remaps the zinc
scale onto the theme tokens**. So in this codebase:

| You write | It actually means |
|---|---|
| `bg-zinc-950` | `--surface` |
| `bg-zinc-900` | `--surface-secondary` |
| `bg-zinc-800` | `--surface-tertiary` |
| `border-zinc-800` | `--border` |
| `border-zinc-700` | `--border-secondary` |
| `text-zinc-100` / `text-zinc-200` | `--text-primary` |
| `text-zinc-300` | `--text-secondary` |
| `text-zinc-400` / `text-zinc-500` | `--text-tertiary` |
| `text-zinc-600` | `--text-muted` |

So `bg-zinc-900` is **fine** — it's theme-aware. Copying classes from a
neighboring dashboard page is a reliable way to stay on-system.

### ⚠️ Gotchas — these will bite you

- **`bg-white` is BRAND ORANGE.** It's the legacy primary-CTA pattern, so
  it's remapped to the orange button background. A "white card" renders as
  a giant orange slab. Never use `bg-white` for a surface — use `bg-zinc-900`
  or `var(--surface)`.
- **`bg-black` is the page background**, not black. Want true black (e.g. a
  video letterbox)? Use an explicit `style={{ background: '#000' }}`.
- **Raw palette classes ignore theming entirely.** `bg-gray-100`,
  `text-slate-500`, `amber-50`, etc. are *not* remapped — they render the
  same fixed color in every theme and will look wrong in most. Don't use
  them. Use the `zinc` scale or accent tokens.
- The remap is scoped to the light-ish themes via `:root:not([data-theme=…])`.
  The dark themes (`midnight`, `dim`, `sunset`) read the raw zinc values,
  which already happen to be dark. The net effect: stick to tokens/zinc and
  it's handled.

---

## 4. Themes to design for

The app currently ships: **`soft-light`** (warm paper light), **`midnight`**
(deep navy-black — the default dark), **`sunset`** (warm dark), **`dim`**
(muted slate dark). Design and review every new screen in at least
`soft-light` and `midnight` — they're the extremes. If it reads well in
both, it reads well in all.

When delivering mockups: please use the actual token values for the theme
you're mocking (pull them from §2), or just annotate elements by **token
name** ("this label = `--text-tertiary`") and we'll wire it up correctly.

---

## 5. Component patterns

These are the recurring shapes. Match them so the app feels consistent.

### Card / panel
```tsx
<div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">…</div>
```
- Radius: `rounded-xl` (cards/panels), `rounded-lg` (inputs, buttons,
  inner blocks), `rounded-full` (pills, avatars, icon buttons).
- Border: always `border-zinc-800` (= `--border`).
- Padding: `p-4`/`p-5` for cards; `px-3 py-2` for inputs.

### Input / select
```tsx
<input
  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
/>
```
Focus accent is the brand orange border (`focus:border-amber-400` is also
seen in older code, but new work should trend to `--accent-primary`).

### Primary button (the one important action)
```tsx
<button
  className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
  style={{ background: 'var(--accent-primary)', color: '#fff' }}
>Save</button>
```
Disabled state: `var(--surface-tertiary)` bg + `var(--text-tertiary)` text
+ `cursor-not-allowed`.

### Secondary / ghost button
```tsx
<button className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-sm font-medium">…</button>
```

### Chip / badge / status pill
Small `rounded-full` or `rounded`, `text-[10px]`/`text-[11px]`, uppercase
tracking for labels. Status colors come from the accent set — emerald for
active/positive, amber for warning/notes, blue for handed-off, red for
error/urgent. Pattern: accent text on the matching `-bg` tint.
```tsx
<span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
  style={{ color: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}>Active</span>
```

### Section label
Tiny uppercase caption above a group:
```tsx
<p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Brand</p>
```

### Established components — reuse, don't reinvent
- **`<SaveBar>` + `useDirtyForm`** — the sticky bottom save bar on agent
  sub-pages. New editable pages use this, not an inline "Save" button.
- **`<NewBadge since="YYYY-MM-DD">`** — the little "NEW" marker that
  auto-expires after 90 days. Ships on every new menu-visible feature.
- The inbox conversation panel, brand chips, assignee dropdown, and ticket
  composer are the canonical references for list/detail layouts.

---

## 6. Typography & spacing conventions (observed)

- **Type scale:** `text-xs` (12) for most body/labels, `text-sm` (14) for
  primary content and inputs, `text-base`/`text-lg` for headings, and the
  small `text-[10px]`/`text-[11px]` for captions and pills. The UI is
  information-dense and leans small — match that.
- **Weight:** `font-medium` for buttons/labels, `font-semibold` for
  emphasis and primary buttons, `font-bold` sparingly for page titles.
- **Tracking:** `uppercase tracking-wider` on tiny section labels.
- **Spacing:** multiples of 4 (`gap-2`, `gap-3`, `p-4`, `mb-6`). Vertical
  rhythm between sections is usually `space-y-4`/`space-y-5` inside a card,
  `mb-6` between major blocks.
- **Mono** (`font-mono`) for slugs, IDs, URLs, and other machine values.

---

## 7. Quick do / don't

**Do**
- Design against token *names*; let the theme supply the value.
- Use the remapped `zinc` scale + accent tokens; copy from a neighboring page.
- Keep one primary (`--accent-primary`) action per view.
- Check `soft-light` and `midnight` before calling a screen done.
- Reuse `SaveBar`, `NewBadge`, and existing card/input/chip patterns.

**Don't**
- Use `bg-white` (it's orange) or `bg-black` (it's the page bg) for surfaces.
- Use raw `gray-*` / `slate-*` / `amber-50`-style classes — they ignore the theme.
- Hardcode hex values for anything that should follow the theme.
- Invent new accent colors — the five accent families cover the semantics.
- Name anything with `GHL` / `HighLevel` — it's "your CRM" / `leadconnector`.

---

*Questions or a token that's missing for your design? Flag it — we'd rather
add a token than have a one-off hex sneak in.*
