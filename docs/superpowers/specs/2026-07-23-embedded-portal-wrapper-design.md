# Embedded Portal Wrapper (agency-level GHL menu link)

**Date:** 2026-07-23
**Status:** Approved

## Purpose

Agencies that install the Voxility marketplace app at the **agency level** get a
custom menu link that loads a Voxility page inside the GHL iframe. On first
load the page asks the operator for their portal URL; on every later load it
renders that URL directly in an inner iframe. The binding is stored per GHL
agency (`companyId`) on our side, so it follows the agency across users,
browsers, and devices.

The stored value is a **raw URL** (approach C — deliberately chosen): we do not
validate it against the `Portal` table or restrict it to Voxility-hosted
portals. Whatever HTTPS URL the agency saves is what gets rendered.

## Non-goals

- No auto-login into the portal via GHL identity. Viewers use the portal's own
  login (for Voxility portals: email + password from their invite).
- No sub-account (location-level) bindings — one URL per agency.
- No role gating on who inside the agency can set/change the URL.

## Components

### 1. Entry page — `app/embedded/leadconnector/portal/page.tsx`

Client page, registered in the marketplace listing as the agency-level custom
menu link. Mirrors the handshake mechanics of the existing
`app/embedded/leadconnector/page.tsx`:

- On mount, `postMessage({ message: 'REQUEST_USER_DATA' }, '*')` to the parent
  frame; accept the loosely-shaped response (`encryptedData` /
  `encrypted_user_data` / `payload`) with the same 5s timeout.
- Trust rests on **decrypting** the blob with the marketplace Shared Secret
  server-side, not on the postMessage origin (same rationale as the existing
  entry — thousands of unknowable whitelabel parent domains).

States:

| State | Render |
|---|---|
| `awaiting-parent` / `looking-up` | spinner + short status line |
| no binding | centered card: "Enter your portal URL" + input + Save |
| binding exists | full-bleed `<iframe src={portalUrl}>` + small "Change portal URL" control |
| error | inline message + "Open in new tab" fallback, matching the existing entry page |

"Change portal URL" returns to the form pre-filled with the current value;
saving re-renders the iframe.

### 2. API — `app/api/embedded/portal-binding/route.ts`

Both methods are authenticated by the encrypted identity blob itself (no
NextAuth session — agency viewers are not necessarily dashboard users). The
blob is decrypted with the existing helper in `lib/leadconnector-sso.ts`; a
payload that fails to decrypt or lacks a `companyId` is a 401.

- `POST { encryptedData }` → `{ portalUrl: string | null }` — look up the
  binding for the decrypted `companyId`.
- `PUT { encryptedData, portalUrl }` → validate + upsert → `{ portalUrl }`.

URL validation (pure helper in `lib/`, unit-tested):

- must parse as a URL,
- protocol must be `https:`,
- normalized via `URL#toString()` before storage.

### 3. Storage — `CompanyPortalBinding`

```prisma
model CompanyPortalBinding {
  id        String   @id @default(cuid())
  companyId String   @unique
  portalUrl String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Plus a Prisma migration (new migration directory; never edit committed ones).

### 4. Portal embed cookie (dependency)

If the saved URL is a Voxility portal, login inside the nested iframe breaks
today: the portal session cookie is `SameSite=Lax` (`lib/portal-auth.ts`),
which browsers refuse to send in third-party iframe contexts.

Mirror the established dual-cookie pattern from `lib/embed-session.ts`:

- The portal login page detects that it is running inside a frame
  (`window.self !== window.top` — a pasted URL carries no query-param signal)
  and sends `embedded: true` in the login POST body. The login API then sets
  an **additional** cookie `voxility_portal_embed` with `SameSite=None;
  Secure` alongside the regular Lax cookie.
- `middleware.ts` promotes the embed cookie's value onto the regular portal
  cookie name **request-side only** (same promotion mechanics as the dashboard
  embed cookie), so `getPortalSession()` and every `/portal` page work
  unchanged.
- The Lax cookie keeps protecting regular browser-tab sessions; the None
  cookie exists only for iframe use, keeping the leak-radius reasoning in the
  `portal-auth.ts` header intact.

## Error handling

- Parent frame never replies → same messaging as the existing entry page
  ("open from a Custom Menu Link"), with an open-in-new-tab CTA.
- Decrypt failure / missing `companyId` → 401 from the API, surfaced inline
  with the error code.
- Invalid URL on save → 400 with a human-readable message shown next to the
  input; nothing stored.
- The inner iframe intentionally has no load-failure detection (cross-origin
  iframes don't expose it reliably); the "Change portal URL" control is the
  escape hatch for a bad URL.

## Testing

- Unit tests (vitest, `lib/**/*.test.ts` scope) for the URL
  validation/normalization helper.
- Handshake, binding round-trip, and iframe rendering verified manually inside
  a GHL agency install (no integration harness exists for the iframe flow).
