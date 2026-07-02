# Per-location widget control + embed-ready portal — Design

**Date:** 2026-07-02
**Status:** Approved by Ryan (design review 2026-07-02)

## Problem

Agencies connect Voxility to LeadConnector at the agency level, which means we
can know every location (sub-account) in the agency. Agencies and our own
workspace admins need to turn the chat widget on or off **per location** —
a searchable, filterable location list with bulk enable/disable — surfaced in
both the workspace admin dashboard (internal staff acting on behalf of
clients) and the client portal (the agency's own UI). The portal must also
become embeddable inside the LeadConnector menu via a custom menu link.

## Hard constraints

- **60 widgets are live. Nothing about existing embeds may change.** The
  per-location kill switch is opt-in (new embed attribute) and fail-open
  (any missing data or lookup error → widget renders as today).
- The agency-level connection is a **new, separate LeadConnector marketplace
  app** (different client ID/secret) from the existing per-location install
  infra, because one workspace can contain many widgets and the connection is
  workspace-level. Existing `Location` token rows are untouched.
- No `ghl`/`GHL`/`HighLevel` in any new identifier; use `leadconnector` /
  "your CRM".
- Migration SQL is hand-run by Ryan; the migration file is created but the
  build never applies it destructively.

## Decisions made in review

| Decision | Choice |
|---|---|
| List scope | All agency locations (synced via agency token), not just installed ones |
| Runtime location identity | Optional `data-location-id="{{location.id}}"` merge-tag attribute on the embed snippet |
| Default state | Enabled (`widgetEnabled` defaults true); toggle is opt-out |
| Portal embedding scope | Embed-ready now (CSP + cookie + chrome); SSO auto-login is a later pass |

## Data model (new tables only)

```prisma
model AgencyConnection {
  id                   String    @id @default(cuid())
  workspaceId          String
  workspace            Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  provider             String    @default("leadconnector")
  companyId            String            // LeadConnector agency/company id
  accessToken          String
  refreshToken         String
  expiresAt            DateTime
  scope                String
  tokenRefreshFailedAt DateTime?
  connectedByUserId    String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  locations            AgencyLocation[]

  @@unique([workspaceId, companyId])
}

model AgencyLocation {
  id                     String    @id @default(cuid())
  connectionId           String
  connection             AgencyConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  locationId             String            // LeadConnector location id
  name                   String
  city                   String?
  state                  String?
  country                String?
  email                  String?
  phone                  String?
  widgetEnabled          Boolean   @default(true)
  widgetEnabledUpdatedAt DateTime?
  widgetEnabledUpdatedBy String?           // "user:<id>" | "portal:<portalUserId>"
  lastSyncedAt           DateTime  @default(now())
  removedAt              DateTime?         // gone from agency on last sync; toggle preserved
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  @@unique([connectionId, locationId])
  @@index([locationId])
}
```

`removedAt` is a soft flag so a location that disappears and reappears keeps
its toggle. Sync upserts by `(connectionId, locationId)` and never deletes.

## Agency OAuth + sync

- Env vars: `LEADCONNECTOR_AGENCY_CLIENT_ID`, `LEADCONNECTOR_AGENCY_CLIENT_SECRET`
  (placeholders until Ryan creates the marketplace app; UI shows a
  "not configured" notice when absent).
- Routes: `app/api/auth/leadconnector-agency/install` (redirect to the
  LeadConnector OAuth chooser with `locations.readonly companies.readonly`)
  and `.../callback` (exchange code, upsert `AgencyConnection`, trigger first
  sync, redirect back to the locations page).
- `lib/leadconnector-agency.ts`: token exchange/refresh + paginated
  `GET /locations/search?companyId=…` listing + `syncAgencyLocations(connectionId)`
  (upsert rows, set `removedAt` on missing, clear it on reappearing).
- Sync triggers: on connect, manual Refresh button, daily cron
  (`vercel.json` + `app/api/cron/sync-agency-locations`), which also refreshes
  near-expiry tokens (sets `tokenRefreshFailedAt` on persistent failure, shown
  as a reconnect banner).

## Enforcement path (the only touch to existing widget code)

- Embed snippet gains optional `data-location-id="{{location.id}}"`.
  Snippet-copy UI gets a LeadConnector variant documenting the merge tag.
- `public/widget.js`: read the attribute, append `&locationId=` to the config
  fetch. If the response is `{ disabled: true }`, exit without rendering.
- `app/api/widget/[widgetId]/config/route.ts`: when `locationId` is present,
  look up an `AgencyLocation` row for the widget's workspace + that
  locationId. Row exists with `widgetEnabled=false` → return
  `{ disabled: true }`. No param / no row / no connection / lookup throws →
  identical response to today (fail-open, wrapped in try/catch).

## Admin surface

`/dashboard/[workspaceId]/locations` (sidebar entry + `<NewBadge>` +
`FEATURE_SHIP_DATES` entry):

- No connection → explainer + Connect button (or "not configured" notice
  without env vars).
- Connected → location list: search box (name/email/city/locationId), filter
  tabs (All / Widget on / Widget off), checkbox multi-select, bulk
  Enable/Disable bar, per-row toggle, per-row details (name, city/state,
  email, locationId), last-synced timestamp + Refresh button.
- APIs: `GET /api/workspaces/[workspaceId]/agency-locations`
  (q/filter/page), `PATCH` same route `{ locationIds, widgetEnabled }`,
  `POST .../agency-locations/sync`. All gated admin/owner via the existing
  workspace access helper.
- Styling: copy a neighboring dashboard page; remapped zinc scale + accent
  tokens only.

## Portal surface

`/portal/locations`, sharing the list component:

- Scope: portal session → `brandIds` → brands' `workspaceId`s → those
  workspaces' `AgencyConnection`s → their locations.
- Same toggle/bulk powers; writes attribute `portal:<portalUserId>`.
- APIs: `GET/PATCH /api/portal/locations`, `POST /api/portal/locations/sync`,
  gated by `getPortalSession()`.

## Embed-ready portal

- `next.config.ts`: add `{ source: "/portal/:path*" }` to the
  `frame-ancestors *` CSP rules (same rationale as dashboard — thousands of
  whitelabel parent domains, enumeration impossible).
- Cookies: keep `voxility_portal` (`SameSite=Lax`) and additionally set
  `voxility_portal_embed` (`SameSite=None; Secure`) at login;
  `getPortalSession()` accepts either (embed cookie only as fallback).
  Mirrors the dashboard's dual-cookie pattern; existing portal users see no
  change.
- Portal layout uses the existing `EmbeddedProvider` /
  `?embedded=leadconnector` detection to trim outer chrome when framed.
- Agencies add a LeadConnector custom menu link →
  `https://<portal-domain>/portal?embedded=leadconnector`. Login inside the
  iframe once per 14 days; SSO auto-login is explicitly out of scope.

## Testing & verification

- Unit tests (vitest, `lib/**`): sync diffing (upsert/removedAt semantics),
  portal→workspace scope resolution, config-route disable decision as a pure
  helper.
- Manual/preview: dashboard locations page renders and toggles; widget config
  endpoint contract checked with/without `locationId`; portal page in a
  framed context.

## Out of scope

- SSO auto-login for the portal from the LeadConnector menu.
- Per-widget-per-location granularity (toggle is per-location, all widgets).
- Any change to the existing per-location install OAuth infra or `Location` table.
