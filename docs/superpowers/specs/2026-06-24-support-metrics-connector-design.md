# Support Metrics Connector — Design

**Date:** 2026-06-24
**Status:** Approved approach (A), pending spec review
**Owner:** Ryan

## Problem

Another app we're building needs to pull support/ticketing operations data —
ticket volume & status, SLA attainment, CSAT (satisfaction), queue depth,
operator load — into an external operations dashboard. Today every metric is
computed behind NextAuth **session-cookie** routes (`/api/workspaces/[id]/...`),
so no external service can read them. We need a machine-to-machine API.

## What already exists (reused, not rebuilt)

The metrics are mostly already computed inside the app:

- **Tickets reporting** — `app/api/workspaces/[workspaceId]/tickets/reports/route.ts`:
  counts by status/priority/brand/operator, avg resolution hours, period-over-period
  trend deltas, daily created/closed series.
- **CSAT** — `app/api/workspaces/[workspaceId]/csat/route.ts`: avg rating, response
  rate, 1–5 distribution, by-agent / by-operator / by-brand rollups, AI-vs-human filter.
- **Queue** — `lib/widget-routing.ts` (available-agent count, assignment) and
  `lib/queue-estimate.ts` (wait estimate).
- **Schema** — `Ticket`, `TicketMessage`, `TicketingSettings`, `WidgetConversation`
  (carries `csatRating`, `assignedAt`, `queuedAt`), `WorkspaceMember`
  (`isAvailable`), `Brand`/`BrandGroup`.

The **one real gap** is SLA: there are timing anchors (`createdAt`, `assignedAt`,
`closedAt`, `lastInboundAt`/`lastOutboundAt`, plus `TicketMessage.direction`) but
no stored **targets** to measure attainment against.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope | **Both** — per-workspace API keys **and** an org-wide roll-up |
| Payload | **Both** — aggregate metrics **and** raw-record drill-down |
| SLA | **Config in Xovera** — a first-class `SlaPolicy` table per workspace |
| Delivery | **REST pull only** (polling) for v1; webhooks deferred |
| Architecture | **A** — new versioned `/api/v1/...` namespace + Bearer API-key auth |

## Architecture

A dedicated, independently-versioned external surface under **`/api/v1/...`**,
separate from the cookie-authenticated browser routes. Each aggregate endpoint
calls a **shared pure metric function** in `lib/support-metrics/*`; the existing
in-app routes are refactored to call the same functions, so the browser dashboards
and the external API can never drift apart (single source of truth per metric).

```
External dashboard ──Bearer key──▶ /api/v1/* ──▶ lib/api-auth (verify+scope)
                                       │
                                       ▼
                              lib/support-metrics/* (pure) ──▶ db
                                       ▲
        in-app /api/workspaces/* ──────┘  (same functions, session-auth)
```

### 1. Authentication & key management

New Prisma model **`ApiKey`**:

```prisma
model ApiKey {
  id              String    @id @default(cuid())
  workspaceId     String?   // null = org-scope key
  scope           String    // 'workspace' | 'org'
  name            String
  prefix          String    // first 8 chars of the raw key, shown in UI
  hashedKey       String    @unique // SHA-256 of the raw key; raw never stored
  lastUsedAt      DateTime?
  createdByUserId String?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())

  workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, revokedAt])
  @@index([hashedKey])
}
```

- Raw key format: `vox_live_<base62(32 bytes)>`. **Generated server-side**, shown
  **once** at creation, never retrievable again (only `prefix` + `hashedKey` persist).
- `lib/api-auth.ts` — `authenticateApiKey(req)`:
  1. Read `Authorization: Bearer <key>`; 401 if absent/malformed.
  2. SHA-256 the key, look up a non-revoked `ApiKey` by `hashedKey`; 401 if none.
  3. Fire-and-forget `lastUsedAt = now()`.
  4. Return `{ scope, workspaceId }`.
- **Scope enforcement** (`resolveWorkspaceScope`):
  - `workspace` key → locked to its own `workspaceId`; any `?workspaceId=` that
    differs → 403.
  - `org` key → may call `/api/v1/org/*` and may pass `?workspaceId=` on
    per-workspace endpoints to scope down to any workspace; without it on a
    per-workspace endpoint → 422 (must specify which workspace).
- **Management UI:** new **Settings → API Access** page (per workspace), with a
  `<NewBadge since="2026-06-24">` + `FEATURE_SHIP_DATES` entry. Create key (reveal
  once), list keys (name, prefix, lastUsedAt), revoke. Session-authed, owner/admin only.
- **Org key:** provisioned by a hand-run script/SQL (matches existing secret-ops
  workflow) — not exposed in any workspace UI. One credential, held by our own app.
- **Rate limiting:** lightweight in-memory token bucket per key (e.g. 120 req/min)
  returning 429 with `Retry-After`. Acceptable for single-instance; revisit if we
  scale out. **`ApiRequestLog`** table (key id, path, status, ms, at) for auditing —
  included; written best-effort, never blocks the response.

### 2. SLA policy & computation

New Prisma model **`SlaPolicy`** (per workspace, per priority):

```prisma
model SlaPolicy {
  id               String   @id @default(cuid())
  workspaceId      String
  priority         String   // 'urgent' | 'high' | 'normal' | 'low' | 'default'
  firstResponseMins Int?    // target; null = not tracked
  resolutionMins   Int?
  enabled          Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([workspaceId, priority])
  @@index([workspaceId])
}
```

- **First-response time** for a ticket = `min(TicketMessage.createdAt where
  direction='outbound') − Ticket.createdAt`. Falls back to `assignedAt − createdAt`
  if no outbound message yet (still open → counts as elapsed-so-far for breach).
- **Resolution time** = `closedAt − createdAt` (only for closed/resolved tickets).
- **Attainment** = % of tickets in window whose measured time ≤ the policy target
  for that ticket's priority (falling back to the `'default'` policy row).
- `businessHoursOnly` is **out of scope for v1** — all SLA math is wall-clock 24×7.
  Noted as a future field/feature.
- SLA in v1 covers **tickets only**. Live-chat-conversation SLA (first human
  response on `WidgetConversation.assignedAt`) is a documented future extension.
- **Settings → SLA Policies** page (per workspace, `<NewBadge>`): edit targets per
  priority. Empty/unset = workspace has no SLA tracking; attainment endpoints return
  `null` rather than fabricated numbers.

### 3. Endpoint surface (v1)

All under `/api/v1`. Common query params: `from`/`to` (ISO) or `days` (1–365,
default 30); `brandId` (or `no_brand`); pagination `cursor`/`limit` on list endpoints.
Every response carries `{ scope, workspaceId, from, to }` metadata.

**Per-workspace** (workspace key, or org key + `?workspaceId=`):

| Method & path | Returns |
|---|---|
| `GET /api/v1/support/overview` | Top-line scorecards: open tickets, created/closed in window, avg resolution, CSAT avg & response rate, SLA attainment, live queue depth & available agents |
| `GET /api/v1/tickets/metrics` | Full tickets-report payload (status/priority/brand/operator breakdowns, trend, daily series) |
| `GET /api/v1/tickets` | Paginated raw tickets (drill-down): number, subject, status, priority, contact, assignee, timestamps, first-response & resolution time |
| `GET /api/v1/tickets/{id}` | Single ticket + messages |
| `GET /api/v1/csat/metrics` | Full CSAT payload (avg, response rate, distribution, by-agent/operator/brand) |
| `GET /api/v1/csat/responses` | Paginated raw CSAT responses (rating, comment, conversation, operator, submittedAt) |
| `GET /api/v1/sla/metrics` | Attainment % overall and per priority; first-response vs resolution; breach counts |
| `GET /api/v1/sla/breaches` | Paginated tickets that breached (which target, by how much) |
| `GET /api/v1/queue/snapshot` | Current queue depth, longest wait, available agents, max concurrent capacity |
| `GET /api/v1/operators` | Per-operator: assigned/open load, avg resolution, CSAT avg, availability |

**Org roll-up** (org key only):

| Method & path | Returns |
|---|---|
| `GET /api/v1/org/overview` | Fleet totals + a per-workspace array of the same scorecards as `support/overview`, so the dashboard can render both the roll-up and a workspace leaderboard |

### 4. Shared metric layer (refactor)

Extract the inline logic from the existing route handlers into pure, testable
functions — the in-app routes and the v1 routes both call these:

- `lib/support-metrics/tickets.ts` — `getTicketMetrics(db, scope)`,
  `listTickets(db, scope, page)`, `getTicket(db, scope, id)`
- `lib/support-metrics/csat.ts` — `getCsatMetrics(db, scope)`, `listCsatResponses(...)`
- `lib/support-metrics/sla.ts` — `getSlaMetrics(db, scope)`, `listSlaBreaches(...)`,
  plus `measureFirstResponseMins` / `measureResolutionMins` helpers
- `lib/support-metrics/queue.ts` — `getQueueSnapshot(db, scope)`
- `lib/support-metrics/operators.ts` — `getOperatorMetrics(db, scope)`
- `lib/support-metrics/overview.ts` — composes the above for the overview/org endpoints

`scope` is `{ workspaceId, from, to, brandId? }`. Functions take `db` so they're
unit-testable. The existing `tickets/reports` and `csat` routes are updated to call
these (behavior-preserving) so there is exactly one implementation per metric.

### 5. Error handling

Uniform JSON envelope: `{ error: { code, message } }`.

| Status | When |
|---|---|
| 401 | Missing/malformed/unknown/revoked key |
| 403 | Workspace key reaching outside its workspace; workspace key hitting `/org/*` |
| 404 | Unknown ticket/resource id within scope |
| 422 | Bad/missing params (e.g. org key with no `workspaceId` on a per-workspace endpoint; `days` out of range) |
| 429 | Rate limit; includes `Retry-After` |
| 500 | Unexpected; logged, generic message returned (no internals leaked) |

### 6. Testing

- **Unit (vitest, `lib/**/*.test.ts` — the allowed scope):**
  - `lib/api-auth.test.ts` — key hashing, scope resolution (workspace lock, org
    scope-down, 403/422 cases).
  - `lib/support-metrics/sla.test.ts` — first-response/resolution measurement and
    attainment math against fixture tickets + policies (incl. priority fallback to
    `'default'`, null-policy → null attainment).
  - `lib/support-metrics/*.test.ts` — metric shape/aggregation on seeded fixtures.
- **Route-level:** scenario harness (not unit tests) for auth gating and end-to-end
  payload shape, per existing convention.
- **Parity check:** assert refactored in-app routes return the same shape as before
  (snapshot of `tickets/reports` + `csat` payloads).

## Out of scope (v1)

- Webhooks / SSE push (REST pull only).
- Business-hours-aware SLA math.
- Live-chat-conversation SLA (tickets only).
- Materialized/snapshot read model (revisit only if polling load demands it).
- Write operations — the connector is strictly read-only.

## Migrations

Three new tables: `ApiKey`, `SlaPolicy`, `ApiRequestLog`, plus the `Workspace`
back-relation. Per repo convention, migration SQL is **applied by hand in
production by Ryan** — the build never auto-runs destructive migrations. A local
`npm run db:migrate -- --name support_metrics_connector` generates the migration;
production apply is manual.

## Naming

No `ghl`/`HighLevel` identifiers (grandfathering aside). External-facing copy uses
"your CRM"/generic support terminology. Key prefix `vox_live_`.
