# Voxility UI Style Guide

A quick reference for designing screens that fit the Voxility dashboard.
The app supports light and dark themes — design in both. Use the color
roles below (not random hex), and we'll map them to the right theme.

---

## Brand

- **Primary / brand color:** orange — `#fa4d2e` (dark UI) · `#e84425` (light UI).
  This is *the* action color: primary buttons, active/selected states, key
  moments. Use it sparingly — **one primary action per screen**.
- **Voice:** clean, dense, professional. Lots of information, calmly
  organized. Small type, tight spacing, generous breathing room around
  groups.

---

## Color roles

Design in terms of these roles. Hex shown for our two anchor themes.

### Surfaces (page → raised → inset)
| Role | Light | Dark |
|---|---|---|
| Page background | `#f8f7f4` | `#05080f` |
| Card / panel | `#faf9f7` | `#090d15` |
| Inset / row / input | `#f0eee9` | `#0f1524` |
| Pressed / chip | `#e5e2dc` | `#1a2540` |

### Text (strong → faint)
| Role | Light | Dark |
|---|---|---|
| Primary (headings, values) | `#1c1917` | `#f8fafc` |
| Secondary (body) | `#57534e` | `#94a3b8` |
| Tertiary (labels, captions) | `#78716c` | `#64748b` |
| Muted (placeholder, disabled) | `#a8a29e` | `#475569` |

### Borders
Hairlines only — `#e0ddd6` (light) / `#121a2b` (dark). A slightly stronger
border marks hover/focus.

### Accents — and what they mean
| Color | Meaning |
|---|---|
| **Orange** `#fa4d2e` | Primary action, active/selected, brand |
| **Green** `#16a249` | Success, online/available, positive |
| **Amber** `#fbbf24` | Warning, internal notes, ratings |
| **Blue** `#60a5fa` | Informational, neutral status |
| **Red** `#ef4343` | Error, destructive, urgent |

Each accent also has a soft tinted background for subtle fills (chips,
callouts). Use accent text/border on its matching tint.

---

## Typography

- One clean sans-serif (system UI stack). Monospace for IDs, slugs, URLs.
- **Sizes:** captions/labels ~12px, body & inputs ~14px, headings 16–20px,
  tiny pill/section labels ~10–11px (often UPPERCASE with wide tracking).
- **Weight:** medium for buttons/labels, semibold for emphasis & primary
  buttons, bold only for page titles.
- The UI runs small and dense by design — don't scale type up.

---

## Spacing & shape

- **Spacing:** multiples of 4 (4 / 8 / 12 / 16 / 24). Tight inside
  components, roomier between sections.
- **Radius:** large for cards/panels, medium for buttons & inputs, full
  (pill) for chips, badges, avatars, and icon buttons.

---

## Components

- **Cards / panels:** raised surface, hairline border, large radius.
  Group related content; lead with a tiny uppercase label.
- **Buttons:** *Primary* = solid orange. *Secondary* = bordered/ghost with
  a hover fill. Disabled = muted fill + muted text.
- **Inputs:** inset surface, hairline border, orange focus accent.
- **Chips / status pills:** small, pill-shaped, tiny text. Color = accent
  meaning (green active, amber warning/note, blue handed-off, red urgent).
- **Density:** this is a working tool (an inbox, agent config, tickets) —
  favor compact rows and clear hierarchy over big hero spacing.

---

## Do / Don't

**Do**
- Design in light *and* dark — check both before calling it done.
- Use the color roles above; annotate mockups by role ("this = tertiary
  text", "primary button") so we map them correctly.
- Keep one primary (orange) action per screen.

**Don't**
- Use pure white as a surface, or pure black as a background — both read
  as "off-brand" here.
- Introduce new accent colors — the five families cover every state.
- Hardcode a hex for anything that should follow the theme.

---

*Need a color or component that isn't here? Ask — we'd rather add a role
than let a one-off slip in.*
