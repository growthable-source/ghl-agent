# Co-Pilot co-browse overlay — design

Status: proposed (awaiting greenlight). Author: Claude + Ryan, 2026-06-18.

## Why

The live co-pilot guides users through their own product, but it cannot point
*on their actual screen*. Two prior on-screen-marker attempts were pulled:
the marker can only be drawn on a surface we own (an in-tab preview or a
picture-in-picture mirror), never the user's real screen or a Google Meet
window, and Gemini's emitted pixel coordinates don't reliably match its own
words. Decision (2026-06-18): ship verbal-only pointing now (done), then build
**co-browse** — drawing a real highlight on the actual product page.

## The defining constraint (read first)

**We cannot iframe an arbitrary third-party site.** Production web apps send
`X-Frame-Options: DENY` / `Content-Security-Policy: frame-ancestors`, and a
header-stripping proxy would break their auth, JS, and is legally untenable.

Therefore co-browse is only possible where **the customer embeds our SDK inside
their own product** — i.e. our script runs *in their page's own origin*, with
direct access to that page's DOM. This is the same audience as today's
`copilot.js` embed, but a different mode: today the embed `window.open()`s a
**separate Voxility tab** (to dodge iframe/permission limits); co-browse instead
runs the session **in-page**, as a widget panel inside the host product.

Consequences:
- **Scope: web products with our SDK installed.** Not Google Meet, not native
  apps, not arbitrary screen-shares. Those stay verbal-only. This must be set
  as the explicit product boundary.
- In-page, **screen-share is no longer required** for pointing — we read the DOM
  directly. (We may keep an optional frame feed for visual context, but pointing
  is DOM-based.)

## Key idea: point at DOM elements, not pixels

In-page we don't guess coordinates from a blurry frame — we hand the model a
**compact index of the page's visible, interactive elements** and let it point
by **element id**. The overlay is then drawn on the *real element's* bounding
box, so it's pixel-perfect by construction and survives scroll/resize/layout.

This also fixes the "says left, shows right" problem: there are no model
coordinates to be wrong; the model names an element, we own the geometry.

### Element index (host page → agent)

A small in-page collector walks the DOM for visible, actionable nodes
(`button, a, input, select, textarea, [role], [onclick]`, headings, labelled
landmarks), producing entries like:

```
{ id: "e12", role: "button", name: "Save changes", rect: {x,y,w,h}, path: "…" }
```

- Stable per-session `id` (e12), the accessible name, role, and current rect.
- Capped (~150 most-relevant, viewport-biased), refreshed on DOM mutation /
  navigation (debounced), and on the model's request.
- Sent to the model as context (compact JSON), refreshed like the screen-cue
  stream is today. Sensitive inputs (password, anything matching PII patterns)
  are sent as redacted placeholders — never their values.

### New tool: `highlight_element`

```
highlight_element({ elementId: "e12", label?: "Click Save", style?: "ring"|"arrow" })
```

- Client-executed (like `take_a_closer_look`): the host-page SDK looks up the
  element, draws an absolutely-positioned, `pointer-events:none` overlay on its
  real bounding box (scroll into view first if off-screen), labels it, and
  auto-clears after N seconds or on the next highlight.
- Returns honestly: "highlighted <name>" only if the element was found and
  on-page; otherwise tells the model the element is gone and to re-orient (no
  fake success — the lesson from the old `annotate_screen` stub).
- Replaces nothing in verbal mode; this tool only exists in co-browse sessions.

## Architecture seams

- **`public/copilot.js`** — add an in-page mode (`data-copilot-mode="cobrowse"`
  or a separate `copilot-cobrowse.js`): mounts a docked panel in the host page
  instead of `window.open`, boots the element collector + overlay layer, and
  runs the realtime session in-page. The existing new-tab mode stays the default
  for non-web / no-SDK cases.
- **Session service** — a co-browse session class: tool set includes
  `highlight_element` + `query_knowledge` (no `get_workspace_setup_state`),
  reuses the named-agent prompt + knowledge + uiMap + voice work already shipped.
- **Prompt** — a co-browse variant of the guide prompt: "you can point for real —
  call `highlight_element` with the id from the element index; one action at a
  time; confirm before the next." Drops the "you cannot draw" line for this mode
  only.
- **Realtime perception** — element index streamed via the existing
  `injectContext` / cue channel; optional low-fps frames for visual context.
- **Overlay + collector** — a small, dependency-free module loaded by the SDK,
  living in the host page. The hard parts: stable ids across re-renders,
  shadow-DOM / iframe traversal within the host, and rect tracking on scroll.

## Privacy & security

- In-page SDK sees the host DOM by definition — same trust as any embed script
  the customer installs. Document this clearly.
- Never transmit values of password/PII fields; redact in the element index.
- Honor the existing copilot plan gate + per-agent publish/allowedDomains.
- The overlay is `pointer-events:none` and visual-only — it never clicks or
  types (read-only/advisory posture is preserved; the user still acts).

## Phasing

1. **Spike** — in-page SDK boot + element collector + `highlight_element`
   overlay on a single test page; confirm the model reliably picks the right
   element id from the index. (Validates the core before the session plumbing.)
2. **Session wiring** — co-browse session class, prompt variant, tool gating,
   element-index streaming; reuse knowledge/uiMap/voice.
3. **Robustness** — DOM mutation/scroll tracking, shadow DOM, redaction, off-
   screen scroll-into-view, multi-element sequences.
4. **Productize** — embed snippet + docs, plan gating, NEW badge, fallback to
   verbal-only when the SDK isn't present.

## Open questions

- **OQ-1 — index vs. vision for *understanding*.** Pointing is DOM-based; do we
  still feed frames so the agent can *read* rendered content (charts, canvas,
  images the DOM doesn't describe)? Likely yes, low-fps, optional.
- **OQ-2 — embed friction.** This needs the customer to add an in-page script.
  Is that acceptable, or do we also want a Voxility-hosted "demo product" mode
  for prospects who can't install? (Separate, smaller effort.)
- **OQ-3 — id stability** across SPA re-renders: name+role+path heuristic vs.
  injecting `data-voxility-id`. Spike decides.
- **OQ-4 — does this also replace screen-share for *staff* (Voxility dashboard)
  guidance?** Our own dashboard could host the SDK natively → best-in-class
  in-app guidance, no screen-share at all. Tempting Phase-2 once the SDK exists.

## What this does NOT cover

Google Meet, native desktop apps, and any product where we can't run an in-page
script. Those remain verbal-only (current behavior). A true any-screen overlay
would require a browser extension or desktop helper — a separate, larger track
if ever wanted.
