# Per-Location Widget Control + Embed-Ready Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workspace admins (dashboard) and agencies (portal) turn the chat widget on/off per LeadConnector location, with a searchable bulk-toggle location list, and make the portal embeddable in the LeadConnector menu.

**Architecture:** A new workspace-level `AgencyConnection` (separate LeadConnector marketplace app, agency-scoped OAuth) syncs all agency locations into `AgencyLocation` rows carrying a `widgetEnabled` flag. Enforcement is opt-in via a new `data-location-id` embed attribute → config API returns `{disabled:true}` → widget.js exits without rendering. Fail-open everywhere: the 60 live widgets never hit the new code path. A shared `LocationList` client component powers both the admin page and the portal page; portal embedding adds a `SameSite=None` companion cookie + CSP rule.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 (Postgres), vitest (lib-only scope), theme-token Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-02-per-location-widget-control-design.md`

**Working directory:** all paths relative to `ghl-agent/`. Run all commands from `ghl-agent/`.

**Non-negotiable constraints (from spec):**
- No `ghl`/`GHL`/`HighLevel` in any new identifier, path, or env var.
- Existing widget behavior must be bit-identical when no `locationId` reaches the config API.
- Migration SQL is hand-run by Ryan in production; never wire anything that auto-applies destructively.
- Commit + push to main after every task.
- New UI copies neighboring dashboard styling; remapped zinc scale + accent tokens only — never `bg-white`, never raw `gray-*`.

---

### Task 1: Prisma schema — AgencyConnection + AgencyLocation

**Files:**
- Modify: `prisma/schema.prisma` (Workspace model ~line 100s — find with `grep -n '"WorkspaceLocations"' prisma/schema.prisma`; new models appended at end of file)

- [ ] **Step 1: Add back-relation to Workspace model**

Find the `Workspace` model (it has the relation `locations Location[] @relation("WorkspaceLocations")`). Add one line among its relations:

```prisma
  agencyConnections     AgencyConnection[]
```

- [ ] **Step 2: Append new models at the end of schema.prisma**

```prisma
// ─── Agency-level CRM connection (per-location widget control) ─────────────
// Deliberately separate from the Location token store: this is a DIFFERENT
// LeadConnector marketplace app (agency-scoped install, its own client
// id/secret) connected once per workspace. One workspace has many widgets;
// the location toggle lives here, not on any widget.

model AgencyConnection {
  id                   String    @id @default(cuid())
  workspaceId          String
  workspace            Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  provider             String    @default("leadconnector")
  companyId            String
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
  id                     String           @id @default(cuid())
  connectionId           String
  connection             AgencyConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  locationId             String
  name                   String
  city                   String?
  state                  String?
  country                String?
  email                  String?
  phone                  String?
  widgetEnabled          Boolean          @default(true)
  widgetEnabledUpdatedAt DateTime?
  // Attribution: "user:<userId>" (dashboard) or "portal:<portalUserId>".
  widgetEnabledUpdatedBy String?
  lastSyncedAt           DateTime         @default(now())
  // Set when the location vanished from the agency on a sync; cleared if it
  // reappears. Soft flag so a toggle survives remove/re-add. Never deleted.
  removedAt              DateTime?
  createdAt              DateTime         @default(now())
  updatedAt              DateTime         @updatedAt

  @@unique([connectionId, locationId])
  @@index([locationId])
}
```

- [ ] **Step 3: Create + apply the migration locally**

Run: `npm run db:migrate -- --name add_agency_location_widget_control`
Expected: new folder `prisma/migrations/<timestamp>_add_agency_location_widget_control/migration.sql` containing two `CREATE TABLE`s + indexes; applies cleanly locally. (Prod SQL is hand-run by Ryan — flag the file path in the final summary.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (nothing references the models yet; this catches schema-gen issues).

- [ ] **Step 5: Commit + push**

```bash
git add prisma/
git commit -m "feat: AgencyConnection + AgencyLocation models for per-location widget control"
git push
```

---

### Task 2: Pure sync planner (TDD)

**Files:**
- Create: `lib/agency-location-sync.ts`
- Test: `lib/agency-location-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { planAgencyLocationSync, type FetchedAgencyLocation } from './agency-location-sync'

const fetched = (id: string, name = `Loc ${id}`): FetchedAgencyLocation => ({
  locationId: id, name, city: null, state: null, country: null, email: null, phone: null,
})

describe('planAgencyLocationSync', () => {
  it('upserts every fetched location', () => {
    const plan = planAgencyLocationSync([], [fetched('a'), fetched('b')])
    expect(plan.upserts.map(u => u.locationId)).toEqual(['a', 'b'])
    expect(plan.markRemoved).toEqual([])
  })

  it('marks locations missing from the fetch as removed', () => {
    const plan = planAgencyLocationSync(
      [{ locationId: 'a', removedAt: null }, { locationId: 'b', removedAt: null }],
      [fetched('a')],
    )
    expect(plan.markRemoved).toEqual(['b'])
  })

  it('does not re-mark already-removed locations', () => {
    const plan = planAgencyLocationSync(
      [{ locationId: 'b', removedAt: new Date('2026-01-01') }],
      [],
    )
    expect(plan.markRemoved).toEqual([])
  })

  it('a reappearing location is upserted (restore is the upsert clearing removedAt)', () => {
    const plan = planAgencyLocationSync(
      [{ locationId: 'a', removedAt: new Date('2026-01-01') }],
      [fetched('a')],
    )
    expect(plan.upserts.map(u => u.locationId)).toEqual(['a'])
    expect(plan.markRemoved).toEqual([])
  })

  it('dedupes fetched locations by locationId (defensive against API pagination overlap)', () => {
    const plan = planAgencyLocationSync([], [fetched('a', 'First'), fetched('a', 'Second')])
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].name).toBe('First')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/agency-location-sync.test.ts`
Expected: FAIL — module `./agency-location-sync` not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Pure diffing for agency-location sync. Separated from the DB writes in
 * lib/leadconnector-agency.ts so the remove/restore semantics are unit-
 * testable (vitest scope is lib/** pure helpers only).
 *
 * Semantics: sync never deletes. A location absent from the fetch gets
 * removedAt stamped (toggle preserved); a present location is upserted,
 * which also clears removedAt if it had been stamped before.
 */

export interface FetchedAgencyLocation {
  locationId: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  email: string | null
  phone: string | null
}

export interface ExistingAgencyLocationRow {
  locationId: string
  removedAt: Date | null
}

export interface AgencyLocationSyncPlan {
  upserts: FetchedAgencyLocation[]
  /** locationIds to stamp removedAt on (currently active but gone from the agency). */
  markRemoved: string[]
}

export function planAgencyLocationSync(
  existing: ExistingAgencyLocationRow[],
  fetchedList: FetchedAgencyLocation[],
): AgencyLocationSyncPlan {
  const seen = new Set<string>()
  const upserts: FetchedAgencyLocation[] = []
  for (const f of fetchedList) {
    if (seen.has(f.locationId)) continue
    seen.add(f.locationId)
    upserts.push(f)
  }
  const markRemoved = existing
    .filter(e => e.removedAt === null && !seen.has(e.locationId))
    .map(e => e.locationId)
  return { upserts, markRemoved }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/agency-location-sync.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit + push**

```bash
git add lib/agency-location-sync.ts lib/agency-location-sync.test.ts
git commit -m "feat: pure sync planner for agency locations"
git push
```

---

### Task 3: LeadConnector agency API client + sync writer

**Files:**
- Create: `lib/leadconnector-agency.ts`

No unit test (network + Prisma — outside vitest scope). Verified by typecheck now, live by Task 5's callback.

- [ ] **Step 1: Implement the client**

```ts
/**
 * Agency-level LeadConnector connection.
 *
 * A SEPARATE marketplace app from the per-location install infra
 * (app/api/auth/callback + lib/token-store): this one installs at the
 * agency (Company) level, once per workspace, purely to enumerate the
 * agency's locations for per-location widget control. Different client
 * id/secret on purpose — one workspace contains many widgets, and this
 * connection is workspace-scoped, not location-scoped.
 */

import { db } from '@/lib/db'
import { planAgencyLocationSync, type FetchedAgencyLocation } from '@/lib/agency-location-sync'

const API_BASE = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'
export const AGENCY_OAUTH_SCOPES = 'locations.readonly companies.readonly'

export function agencyOAuthConfigured(): boolean {
  return !!(process.env.LEADCONNECTOR_AGENCY_CLIENT_ID && process.env.LEADCONNECTOR_AGENCY_CLIENT_SECRET)
}

interface AgencyTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  scope?: string | string[]
  companyId?: string
  userType?: string
}

async function tokenRequest(params: Record<string, string>): Promise<AgencyTokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!,
    client_secret: process.env.LEADCONNECTOR_AGENCY_CLIENT_SECRET!,
    user_type: 'Company',
    ...params,
  })
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Agency token request failed (${res.status}): ${await res.text()}`)
  return res.json()
}

export async function exchangeAgencyCode(code: string): Promise<AgencyTokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${process.env.APP_URL}/api/auth/leadconnector-agency/callback`,
  })
}

/**
 * Returns a currently-valid access token for the connection, refreshing
 * (and persisting) if it expires within 5 minutes. Stamps
 * tokenRefreshFailedAt on refresh failure so the UI can show a
 * reconnect banner; clears it on success.
 */
export async function getAgencyAccessToken(connectionId: string): Promise<string> {
  const conn = await db.agencyConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { accessToken: true, refreshToken: true, expiresAt: true },
  })
  if (conn.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return conn.accessToken
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refreshToken })
    await db.agencyConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? conn.refreshToken,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
        tokenRefreshFailedAt: null,
      },
    })
    return t.access_token
  } catch (err) {
    await db.agencyConnection.update({
      where: { id: connectionId },
      data: { tokenRefreshFailedAt: new Date() },
    }).catch(() => {})
    throw err
  }
}

/** Paginated GET /locations/search for every location under the agency. */
export async function listAgencyLocations(accessToken: string, companyId: string): Promise<FetchedAgencyLocation[]> {
  const out: FetchedAgencyLocation[] = []
  const limit = 100
  let skip = 0
  // Hard cap of 100 pages (10k locations) so a pathological API response
  // can't loop forever.
  for (let page = 0; page < 100; page++) {
    const url = `${API_BASE}/locations/search?companyId=${encodeURIComponent(companyId)}&limit=${limit}&skip=${skip}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Version: API_VERSION, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`locations/search failed (${res.status}): ${await res.text()}`)
    const data = await res.json()
    const batch: any[] = Array.isArray(data?.locations) ? data.locations : []
    for (const l of batch) {
      if (!l?._id && !l?.id) continue
      out.push({
        locationId: String(l._id ?? l.id),
        name: String(l.name ?? 'Unnamed location'),
        city: l.city ?? null,
        state: l.state ?? null,
        country: l.country ?? null,
        email: l.email ?? null,
        phone: l.phone ?? null,
      })
    }
    if (batch.length < limit) break
    skip += limit
  }
  return out
}

/**
 * Fetch the agency's locations and reconcile AgencyLocation rows.
 * Upsert-only + removedAt stamping — never deletes, so widgetEnabled
 * toggles survive a location being removed and re-added.
 */
export async function syncAgencyLocations(connectionId: string): Promise<{ total: number; removed: number }> {
  const conn = await db.agencyConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { id: true, companyId: true },
  })
  const token = await getAgencyAccessToken(connectionId)
  const fetched = await listAgencyLocations(token, conn.companyId)
  const existing = await db.agencyLocation.findMany({
    where: { connectionId },
    select: { locationId: true, removedAt: true },
  })
  const plan = planAgencyLocationSync(existing, fetched)
  const now = new Date()
  for (const loc of plan.upserts) {
    const snapshot = {
      name: loc.name, city: loc.city, state: loc.state, country: loc.country,
      email: loc.email, phone: loc.phone, lastSyncedAt: now, removedAt: null,
    }
    await db.agencyLocation.upsert({
      where: { connectionId_locationId: { connectionId, locationId: loc.locationId } },
      create: { connectionId, locationId: loc.locationId, ...snapshot },
      update: snapshot,
    })
  }
  if (plan.markRemoved.length > 0) {
    await db.agencyLocation.updateMany({
      where: { connectionId, locationId: { in: plan.markRemoved } },
      data: { removedAt: now, lastSyncedAt: now },
    })
  }
  return { total: plan.upserts.length, removed: plan.markRemoved.length }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
git add lib/leadconnector-agency.ts
git commit -m "feat: LeadConnector agency API client + location sync"
git push
```

---

### Task 4: Enforcement — config route + widget.js (the only touch to live-widget code)

**Files:**
- Modify: `app/api/widget/[widgetId]/config/route.ts` (insert after line 23 `const w = v.widget`)
- Modify: `public/widget.js` (attribute read near line 34-36; config fetch near line 68)

- [ ] **Step 1: Add the location kill-switch check to the config route**

Insert immediately after `const w = v.widget` (line 23):

```ts
  // ── Per-location kill switch (opt-in, fail-open) ────────────────────
  // Only embeds that carry data-location-id send this param. A location
  // explicitly toggled off returns {disabled:true} and the embed renders
  // nothing. Every other path — no param, no AgencyLocation row, no
  // agency connection, DB error — falls through to the normal config
  // response, so pre-existing embeds are untouched.
  const embedLocationId = req.nextUrl.searchParams.get('locationId')
  if (embedLocationId) {
    try {
      const { db } = await import('@/lib/db')
      const row = await db.agencyLocation.findFirst({
        where: {
          locationId: embedLocationId,
          removedAt: null,
          connection: { workspaceId: w.workspaceId },
        },
        select: { widgetEnabled: true },
      })
      if (row && !row.widgetEnabled) {
        return NextResponse.json({ disabled: true }, { headers })
      }
    } catch {
      /* fail open — widget renders as normal */
    }
  }
```

- [ ] **Step 2: Teach widget.js the optional attribute**

In `public/widget.js`, after `var mountSelector = me.getAttribute('data-mount')` (line 36), add:

```js
  // Optional per-location identity for the agency kill switch. GHL/LC
  // resolves {{location.id}} per sub-account when the snippet is installed
  // via agency custom code — but on plain sites the literal braces come
  // through untouched, so treat an unreplaced merge tag as absent.
  var locationId = me.getAttribute('data-location-id')
  if (locationId && (locationId.indexOf('{{') !== -1 || !locationId.trim())) locationId = null
```

Then change the config fetch (line 68) from:

```js
  fetch(hostUrl + '/api/widget/' + widgetId + '/config?pk=' + encodeURIComponent(publicKey))
    .then(function (r) { return r.json() })
    .then(function (cfg) {
      if (cfg && cfg.id) { state.config = cfg; render(); startVisitorTracking() }
    })
```

to:

```js
  fetch(hostUrl + '/api/widget/' + widgetId + '/config?pk=' + encodeURIComponent(publicKey)
      + (locationId ? '&locationId=' + encodeURIComponent(locationId) : ''))
    .then(function (r) { return r.json() })
    .then(function (cfg) {
      if (cfg && cfg.disabled) return   // location toggled off — render nothing
      if (cfg && cfg.id) { state.config = cfg; render(); startVisitorTracking() }
    })
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: clean typecheck; existing tests + Task 2's tests pass.

- [ ] **Step 4: Verify the no-param path is untouched**

Run: `git diff app/api/widget/` and confirm the ONLY change is the inserted block, and that it is entered exclusively when `locationId` is present. This is the 60-live-widgets guarantee — eyeball it.

- [ ] **Step 5: Commit + push**

```bash
git add app/api/widget/ public/widget.js
git commit -m "feat: opt-in per-location widget kill switch (fail-open)"
git push
```

---

### Task 5: Agency OAuth install + callback routes

**Files:**
- Create: `app/api/auth/leadconnector-agency/install/route.ts`
- Create: `app/api/auth/leadconnector-agency/callback/route.ts`

- [ ] **Step 1: Install route (redirect to the agency-level OAuth chooser)**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { agencyOAuthConfigured, AGENCY_OAUTH_SCOPES } from '@/lib/leadconnector-agency'

/**
 * GET /api/auth/leadconnector-agency/install?workspaceId=...
 * Kicks off the AGENCY-level OAuth install (Company scope) for the
 * separate location-control marketplace app. Admin+ only.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  if (!agencyOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(`/dashboard/${workspaceId}/locations?error=not_configured`, req.url),
    )
  }
  const state = Buffer.from(JSON.stringify({ workspaceId }), 'utf8').toString('base64url')
  const chooser = new URL('https://marketplace.leadconnectorhq.com/oauth/chooseaccount')
  chooser.searchParams.set('response_type', 'code')
  chooser.searchParams.set('client_id', process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!)
  chooser.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/auth/leadconnector-agency/callback`)
  chooser.searchParams.set('scope', AGENCY_OAUTH_SCOPES)
  chooser.searchParams.set('state', state)
  return NextResponse.redirect(chooser)
}
```

- [ ] **Step 2: Callback route (exchange, upsert connection, first sync)**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { exchangeAgencyCode, syncAgencyLocations } from '@/lib/leadconnector-agency'

/**
 * GET /api/auth/leadconnector-agency/callback
 * Agency-level OAuth callback for the location-control app. Upserts the
 * workspace's AgencyConnection and runs the first location sync inline
 * (agencies are typically <1k locations; well within route timeout).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const rawState = searchParams.get('state')

  let workspaceId: string | null = null
  try {
    const decoded = JSON.parse(Buffer.from(rawState ?? '', 'base64url').toString('utf8'))
    if (decoded && typeof decoded.workspaceId === 'string') workspaceId = decoded.workspaceId
  } catch { /* handled below */ }

  const fail = (error: string) => NextResponse.redirect(
    new URL(workspaceId
      ? `/dashboard/${workspaceId}/locations?error=${encodeURIComponent(error)}`
      : `/dashboard?error=${encodeURIComponent(error)}`, req.url),
  )

  if (!workspaceId) return fail('missing_state')
  if (searchParams.get('error')) return fail(searchParams.get('error')!)
  if (!code) return fail('missing_code')

  try {
    const t = await exchangeAgencyCode(code)
    if (!t.companyId) return fail('no_company_in_grant')

    const session = await auth()
    const conn = await db.agencyConnection.upsert({
      where: { workspaceId_companyId: { workspaceId, companyId: t.companyId } },
      create: {
        workspaceId,
        companyId: t.companyId,
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
        scope: Array.isArray(t.scope) ? t.scope.join(' ') : (t.scope ?? ''),
        connectedByUserId: session?.user?.id ?? null,
      },
      update: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
        scope: Array.isArray(t.scope) ? t.scope.join(' ') : (t.scope ?? ''),
        tokenRefreshFailedAt: null,
      },
    })

    // First sync inline; failure is non-fatal (Refresh button retries).
    await syncAgencyLocations(conn.id).catch(err =>
      console.warn('[AgencyOAuth] initial location sync failed:', err?.message))

    return NextResponse.redirect(
      new URL(`/dashboard/${workspaceId}/locations?connected=1`, req.url),
    )
  } catch (err: any) {
    console.error('[AgencyOAuth] callback error:', err?.message)
    return fail('token_exchange_failed')
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
git add app/api/auth/leadconnector-agency/
git commit -m "feat: agency-level LeadConnector OAuth install + callback"
git push
```

---

### Task 6: Admin API routes (list / bulk toggle / sync)

**Files:**
- Create: `app/api/workspaces/[workspaceId]/agency-locations/route.ts`
- Create: `app/api/workspaces/[workspaceId]/agency-locations/sync/route.ts`

- [ ] **Step 1: List + bulk-toggle route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'

type Params = { params: Promise<{ workspaceId: string }> }

const PAGE_SIZE = 50

/**
 * GET /api/workspaces/:id/agency-locations?q=&filter=all|on|off&page=1
 * Location list for the per-location widget toggle. Member+ can view.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'member')
  if (access instanceof NextResponse) return access

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const filter = req.nextUrl.searchParams.get('filter') ?? 'all'
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1)

  const connection = await db.agencyConnection.findFirst({
    where: { workspaceId },
    select: { id: true, companyId: true, tokenRefreshFailedAt: true, updatedAt: true },
  })
  if (!connection) return NextResponse.json({ connected: false, locations: [], total: 0 })

  const where = {
    connectionId: connection.id,
    removedAt: null,
    ...(filter === 'on' ? { widgetEnabled: true } : filter === 'off' ? { widgetEnabled: false } : {}),
    ...(q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } },
        { city: { contains: q, mode: 'insensitive' as const } },
        { locationId: { contains: q } },
      ],
    } : {}),
  }

  const [total, enabledCount, locations, lastSynced] = await Promise.all([
    db.agencyLocation.count({ where }),
    db.agencyLocation.count({ where: { connectionId: connection.id, removedAt: null, widgetEnabled: true } }),
    db.agencyLocation.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, locationId: true, name: true, city: true, state: true,
        country: true, email: true, phone: true, widgetEnabled: true,
        widgetEnabledUpdatedAt: true, lastSyncedAt: true,
      },
    }),
    db.agencyLocation.aggregate({
      where: { connectionId: connection.id },
      _max: { lastSyncedAt: true },
    }),
  ])

  return NextResponse.json({
    connected: true,
    needsReconnect: !!connection.tokenRefreshFailedAt,
    locations,
    total,
    enabledCount,
    page,
    pageSize: PAGE_SIZE,
    lastSyncedAt: lastSynced._max.lastSyncedAt,
  })
}

/**
 * PATCH /api/workspaces/:id/agency-locations
 * Body: { locationIds: string[] (AgencyLocation.locationId), widgetEnabled: boolean }
 * Bulk + single toggle share this. Admin+ only.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => null)
  const locationIds: unknown = body?.locationIds
  const widgetEnabled: unknown = body?.widgetEnabled
  if (!Array.isArray(locationIds) || locationIds.length === 0 || locationIds.length > 500
      || !locationIds.every(id => typeof id === 'string') || typeof widgetEnabled !== 'boolean') {
    return NextResponse.json({ error: 'locationIds (1-500 strings) and widgetEnabled (boolean) required' }, { status: 400 })
  }

  const result = await db.agencyLocation.updateMany({
    where: {
      locationId: { in: locationIds },
      connection: { workspaceId },
    },
    data: {
      widgetEnabled,
      widgetEnabledUpdatedAt: new Date(),
      widgetEnabledUpdatedBy: `user:${access.session.user!.id}`,
    },
  })
  return NextResponse.json({ updated: result.count })
}
```

- [ ] **Step 2: Sync route**

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'

type Params = { params: Promise<{ workspaceId: string }> }

/** POST /api/workspaces/:id/agency-locations/sync — manual Refresh. Admin+. */
export async function POST(_req: Request, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const connection = await db.agencyConnection.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!connection) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  try {
    const result = await syncAgencyLocations(connection.id)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[AgencyLocations] manual sync failed:', err?.message)
    return NextResponse.json({ error: 'Sync failed — try reconnecting the agency' }, { status: 502 })
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `access.session.user!.id` trips strictness, use `access.session.user?.id ?? 'unknown'`.)

- [ ] **Step 4: Commit + push**

```bash
git add app/api/workspaces/
git commit -m "feat: admin APIs for agency-location list, bulk toggle, sync"
git push
```

---

### Task 7: Shared LocationList component

**Files:**
- Create: `components/locations/LocationList.tsx`

One client component used by BOTH the dashboard page and the portal page; only the API base URL and accent styling differ via props. Theme tokens only (`bg-zinc-900` card, `text-zinc-100`, `border-zinc-800`, `bg-accent-primary-bg` etc.) — check `app/globals.css` `@theme` if any class is in doubt; NEVER `bg-white`.

- [ ] **Step 1: Implement**

```tsx
'use client'

/**
 * Searchable, filterable agency-location list with per-row and bulk
 * widget on/off toggles. Shared between the workspace dashboard
 * (/dashboard/[workspaceId]/locations) and the customer portal
 * (/portal/locations) — pass the right API base for each surface:
 *   dashboard: /api/workspaces/<id>/agency-locations
 *   portal:    /api/portal/locations
 * Both bases expose GET (list), PATCH (bulk toggle), POST /sync.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface LocationRow {
  id: string
  locationId: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  email: string | null
  phone: string | null
  widgetEnabled: boolean
  widgetEnabledUpdatedAt: string | null
  lastSyncedAt: string
}

interface ListResponse {
  connected: boolean
  needsReconnect?: boolean
  locations: LocationRow[]
  total: number
  enabledCount: number
  page: number
  pageSize: number
  lastSyncedAt: string | null
}

export default function LocationList({
  apiBase,
  canManage,
}: {
  apiBase: string
  canManage: boolean
}) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (query: string, f: string, p: number) => {
    try {
      const res = await fetch(`${apiBase}?q=${encodeURIComponent(query)}&filter=${f}&page=${p}`)
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      setData(await res.json())
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load locations')
    }
  }, [apiBase])

  useEffect(() => { load(q, filter, page) }, [load, filter, page]) // q handled by debounce below

  function onSearch(value: string) {
    setQ(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setPage(1); load(value, filter, 1) }, 300)
  }

  async function applyToggle(locationIds: string[], widgetEnabled: boolean) {
    if (!canManage || locationIds.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationIds, widgetEnabled }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Update failed')
      setSelected(new Set())
      await load(q, filter, page)
    } catch (e: any) {
      setError(e?.message ?? 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await fetch(`${apiBase}/sync`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Sync failed')
      await load(q, filter, page)
    } catch (e: any) {
      setError(e?.message ?? 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  if (!data) {
    return <div className="p-6 text-sm text-zinc-500">{error ?? 'Loading locations…'}</div>
  }

  const rows = data.locations
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.locationId))
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-zinc-800 bg-accent-red-bg px-4 py-2 text-sm text-accent-red">
          {error}
        </div>
      )}
      {data.needsReconnect && (
        <div className="rounded-lg border border-zinc-800 bg-accent-amber-bg px-4 py-2 text-sm text-accent-amber">
          The agency connection needs to be reconnected — location data may be stale.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search name, email, city, or location ID…"
          className="w-72 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <div className="flex rounded-lg border border-zinc-800 overflow-hidden text-sm">
          {(['all', 'on', 'off'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1) }}
              className={`px-3 py-2 ${filter === f ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
            >
              {f === 'all' ? `All (${data.total})` : f === 'on' ? 'Widget on' : 'Widget off'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          {data.lastSyncedAt && <span>Synced {new Date(data.lastSyncedAt).toLocaleString()}</span>}
          <button
            onClick={syncNow}
            disabled={syncing || !canManage}
            className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            {syncing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {canManage && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm">
          <span className="text-zinc-300">{selected.size} selected</span>
          <button
            onClick={() => applyToggle([...selected], true)}
            disabled={busy}
            className="rounded-md bg-accent-primary-bg px-3 py-1.5 text-accent-primary disabled:opacity-50"
          >
            Turn widget on
          </button>
          <button
            onClick={() => applyToggle([...selected], false)}
            disabled={busy}
            className="rounded-md bg-accent-red-bg px-3 py-1.5 text-accent-red disabled:opacity-50"
          >
            Turn widget off
          </button>
          <button onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-zinc-300">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-4 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <span>
            {canManage && (
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={() => {
                  const next = new Set(selected)
                  if (allOnPageSelected) rows.forEach(r => next.delete(r.locationId))
                  else rows.forEach(r => next.add(r.locationId))
                  setSelected(next)
                }}
                className="accent-[#fa4d2e]"
              />
            )}
          </span>
          <span>Location</span>
          <span>Contact</span>
          <span>Location ID</span>
          <span className="text-right">Widget</span>
        </div>
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            No locations match{q ? ` “${q}”` : ''}.
          </div>
        )}
        {rows.map(r => (
          <div
            key={r.id}
            className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-4 border-b border-zinc-800 last:border-b-0 px-4 py-3 text-sm hover:bg-zinc-900/50"
          >
            <span>
              {canManage && (
                <input
                  type="checkbox"
                  checked={selected.has(r.locationId)}
                  onChange={() => {
                    const next = new Set(selected)
                    if (next.has(r.locationId)) next.delete(r.locationId)
                    else next.add(r.locationId)
                    setSelected(next)
                  }}
                  className="accent-[#fa4d2e]"
                />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-zinc-100">{r.name}</span>
              <span className="block truncate text-xs text-zinc-500">
                {[r.city, r.state, r.country].filter(Boolean).join(', ') || '—'}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-zinc-300">{r.email ?? '—'}</span>
              <span className="block truncate text-xs text-zinc-500">{r.phone ?? ''}</span>
            </span>
            <span className="truncate font-mono text-xs text-zinc-500">{r.locationId}</span>
            <span className="text-right">
              <button
                onClick={() => applyToggle([r.locationId], !r.widgetEnabled)}
                disabled={!canManage || busy}
                role="switch"
                aria-checked={r.widgetEnabled}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                  r.widgetEnabled ? 'bg-accent-primary' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-zinc-100 transition-transform ${
                    r.widgetEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>Page {data.page} of {totalPages} · {data.total} locations</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={data.page >= totalPages}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

Note: before finalizing, verify the accent utility names against `app/globals.css` (`grep -n "accent-primary\|accent-red\|accent-amber" app/globals.css`). If `bg-accent-primary` (solid) doesn't exist, use the `-bg` variants + text color as the existing pages do, and copy the toggle-switch colors from an existing toggle (e.g. grep `role="switch"` in `app/dashboard`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
git add components/locations/
git commit -m "feat: shared LocationList component (search, filter, bulk widget toggle)"
git push
```

---

### Task 8: Admin dashboard page + sidebar entry

**Files:**
- Create: `app/dashboard/[workspaceId]/locations/page.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx` (FEATURE_SHIP_DATES at line ~40; nav links around line ~460)

- [ ] **Step 1: Page**

```tsx
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireWorkspaceRole, workspaceRoleHas, type WorkspaceRole } from '@/lib/require-workspace-role'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { agencyOAuthConfigured } from '@/lib/leadconnector-agency'
import LocationList from '@/components/locations/LocationList'

export const dynamic = 'force-dynamic'

/**
 * Per-location widget control. Internal staff surface — the same list the
 * agency sees in their portal (/portal/locations), so support can flip
 * widgets on a client's behalf.
 */
export default async function LocationsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'member')
  if (access instanceof NextResponse) redirect('/login')
  const canManage = workspaceRoleHas(access.role as WorkspaceRole, 'admin')

  const connection = await db.agencyConnection.findFirst({
    where: { workspaceId },
    select: { id: true, companyId: true },
  })

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Locations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Turn the chat widget on or off per location in your CRM. Locations sync
          from your agency-level connection; the widget embed must include{' '}
          <code className="text-xs text-zinc-400">data-location-id</code> for the
          toggle to apply.
        </p>
      </div>

      {!connection ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-4">
          <p className="text-sm text-zinc-300">
            No agency connection yet. Connect your CRM agency account to pull in
            every location and control widgets per location.
          </p>
          {agencyOAuthConfigured() ? (
            <Link
              href={`/api/auth/leadconnector-agency/install?workspaceId=${workspaceId}`}
              className="inline-flex rounded-lg bg-accent-primary-bg px-4 py-2 text-sm font-medium text-accent-primary"
            >
              Connect agency account
            </Link>
          ) : (
            <p className="text-xs text-zinc-500">
              Agency connection isn&apos;t configured on this environment yet.
            </p>
          )}
        </div>
      ) : (
        <LocationList
          apiBase={`/api/workspaces/${workspaceId}/agency-locations`}
          canManage={canManage}
        />
      )}
    </div>
  )
}
```

(If `requireWorkspaceRole`'s NextResponse return doesn't suit a page context, swap to the pattern used by sibling pages — check how `app/dashboard/[workspaceId]/contacts/page.tsx` guards access and copy it exactly.)

- [ ] **Step 2: Sidebar entry + ship date**

In `components/dashboard/DashboardSidebar.tsx`:

Add to `FEATURE_SHIP_DATES` (line ~40):

```ts
  locations: '2026-07-02', // Per-location widget control (agency connection)
```

Add a nav link in the Settings cluster (near line ~460, alongside `navLink(`/dashboard/${workspaceId}/settings`, 'Settings')` — the `navLink` helper's 4th arg is a NEW-badge ship date, as seen on the Live chat queue entry):

```tsx
{navLink(`/dashboard/${workspaceId}/locations`, 'Locations', null, FEATURE_SHIP_DATES.locations)}
```

Match the exact `navLink(...)` signature used by neighbors — read 5 lines around the insertion point first.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
git add app/dashboard/ components/dashboard/DashboardSidebar.tsx
git commit -m "feat: admin Locations page with per-location widget toggles"
git push
```

---

### Task 9: Portal scope helper + portal API routes

**Files:**
- Create: `lib/portal-locations.ts`
- Create: `app/api/portal/locations/route.ts`
- Create: `app/api/portal/locations/sync/route.ts`

- [ ] **Step 1: Scope helper**

```ts
/**
 * Portal → agency-location scoping.
 *
 * Portals are brand-scoped (PortalUserBrand). Locations hang off
 * workspace-level AgencyConnections. Bridge: the user's brands →
 * those brands' workspaces → those workspaces' connections. A portal
 * user may span workspaces if their brands do; that's intentional —
 * the portal is the agency's UI and the agency owns those locations.
 */

import { db } from '@/lib/db'
import type { PortalSession } from '@/lib/portal-auth'

export async function getPortalConnectionIds(session: PortalSession): Promise<string[]> {
  if (session.brandIds.length === 0) return []
  const brands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { workspaceId: true },
  })
  const workspaceIds = [...new Set(brands.map(b => b.workspaceId))]
  if (workspaceIds.length === 0) return []
  const connections = await db.agencyConnection.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { id: true },
  })
  return connections.map(c => c.id)
}
```

- [ ] **Step 2: Portal list + toggle route**

`app/api/portal/locations/route.ts` — same response shape as the admin route so `LocationList` works unchanged:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { getPortalConnectionIds } from '@/lib/portal-locations'

const PAGE_SIZE = 50

export async function GET(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionIds = await getPortalConnectionIds(session)
  if (connectionIds.length === 0) {
    return NextResponse.json({ connected: false, locations: [], total: 0 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const filter = req.nextUrl.searchParams.get('filter') ?? 'all'
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1)

  const where = {
    connectionId: { in: connectionIds },
    removedAt: null,
    ...(filter === 'on' ? { widgetEnabled: true } : filter === 'off' ? { widgetEnabled: false } : {}),
    ...(q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } },
        { city: { contains: q, mode: 'insensitive' as const } },
        { locationId: { contains: q } },
      ],
    } : {}),
  }

  const [total, enabledCount, locations, lastSynced] = await Promise.all([
    db.agencyLocation.count({ where }),
    db.agencyLocation.count({ where: { connectionId: { in: connectionIds }, removedAt: null, widgetEnabled: true } }),
    db.agencyLocation.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, locationId: true, name: true, city: true, state: true,
        country: true, email: true, phone: true, widgetEnabled: true,
        widgetEnabledUpdatedAt: true, lastSyncedAt: true,
      },
    }),
    db.agencyLocation.aggregate({
      where: { connectionId: { in: connectionIds } },
      _max: { lastSyncedAt: true },
    }),
  ])

  return NextResponse.json({
    connected: true, locations, total, enabledCount,
    page, pageSize: PAGE_SIZE, lastSyncedAt: lastSynced._max.lastSyncedAt,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionIds = await getPortalConnectionIds(session)
  if (connectionIds.length === 0) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const locationIds: unknown = body?.locationIds
  const widgetEnabled: unknown = body?.widgetEnabled
  if (!Array.isArray(locationIds) || locationIds.length === 0 || locationIds.length > 500
      || !locationIds.every(id => typeof id === 'string') || typeof widgetEnabled !== 'boolean') {
    return NextResponse.json({ error: 'locationIds (1-500 strings) and widgetEnabled (boolean) required' }, { status: 400 })
  }

  const result = await db.agencyLocation.updateMany({
    where: { locationId: { in: locationIds }, connectionId: { in: connectionIds } },
    data: {
      widgetEnabled,
      widgetEnabledUpdatedAt: new Date(),
      widgetEnabledUpdatedBy: `portal:${session.userId}`,
    },
  })
  return NextResponse.json({ updated: result.count })
}
```

- [ ] **Step 3: Portal sync route**

`app/api/portal/locations/sync/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { getPortalConnectionIds } from '@/lib/portal-locations'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'

export async function POST() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionIds = await getPortalConnectionIds(session)
  if (connectionIds.length === 0) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  let total = 0, removed = 0
  for (const id of connectionIds) {
    try {
      const r = await syncAgencyLocations(id)
      total += r.total
      removed += r.removed
    } catch (err: any) {
      console.warn('[PortalLocations] sync failed for connection', id, err?.message)
    }
  }
  return NextResponse.json({ total, removed })
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit + push**

```bash
git add lib/portal-locations.ts app/api/portal/locations/
git commit -m "feat: portal APIs for agency-location list, toggle, sync"
git push
```

---

### Task 10: Portal Locations page + nav link

**Files:**
- Create: `app/portal/locations/page.tsx`
- Modify: `app/portal/layout.tsx` (nav block ~line 76-81; NAV_ICONS map ~line 115)

- [ ] **Step 1: Page**

```tsx
import LocationList from '@/components/locations/LocationList'

export const dynamic = 'force-dynamic'

/**
 * Agency-facing per-location widget control. Auth is enforced by the
 * portal layout (redirects to /portal/login without a session); the
 * API routes re-check the session on every call.
 */
export default function PortalLocationsPage() {
  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Locations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Turn the chat widget on or off for each of your locations.
        </p>
      </div>
      <LocationList apiBase="/api/portal/locations" canManage />
    </div>
  )
}
```

- [ ] **Step 2: Nav link**

In `app/portal/layout.tsx`, add after the Live Chats entry (line ~78):

```tsx
          <NavLink href="/portal/locations" label="Locations" icon="pin" />
```

And add to `NAV_ICONS` (line ~115):

```tsx
  pin: <><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
```

Add an inline NEW badge: import `NewBadge` at the top of the layout (`import NewBadge from '@/components/NewBadge'`) and extend the `NavLink` helper with an optional `isNew` prop rendering `<NewBadge since="2026-07-02" className="ml-1" />` after the label; pass `isNew` on the Locations entry only.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
git add app/portal/
git commit -m "feat: portal Locations page with widget toggles"
git push
```

---

### Task 11: Embed-ready portal (CSP + SameSite=None companion cookie + embedded chrome)

**Files:**
- Modify: `next.config.ts` (headers array, line ~53-56)
- Modify: `lib/portal-auth.ts` (setPortalCookie line ~137, getPortalSession line ~107, clearPortalCookie line ~148)
- Modify: `app/portal/layout.tsx` (wrap signed-in shell)
- Create: `components/portal/PortalShell.tsx`

- [ ] **Step 1: CSP — allow the portal to be framed**

In `next.config.ts`, add to the returned headers array (after the `/embedded/:path*` rule):

```ts
      // The customer portal is embeddable in the LeadConnector menu via
      // custom menu links — same thousands-of-whitelabel-domains reality
      // as the dashboard, so the same frame-ancestors * decision applies.
      // Auth is the portal's own JWT cookie, not parent-origin trust.
      { source: "/portal/:path*", headers: [cspHeader] },
```

- [ ] **Step 2: Companion embed cookie in portal-auth**

In `lib/portal-auth.ts`:

Below `const COOKIE_NAME = 'voxility_portal'` add:

```ts
// Companion cookie with SameSite=None so the portal session travels when
// the portal is framed inside the LeadConnector menu (third-party iframe
// context — Lax cookies don't attach there). Mirrors the dashboard's
// dual-cookie pattern: the Lax cookie stays the primary for normal tabs;
// this one exists purely for iframes. Same JWT value, same TTL.
const EMBED_COOKIE_NAME = 'voxility_portal_embed'
```

Replace `setPortalCookie` with:

```ts
export async function setPortalCookie(token: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  // SameSite=None requires Secure, so the embed cookie only exists in
  // production (HTTPS). Locally the portal can't be iframe-tested anyway.
  if (process.env.NODE_ENV === 'production') {
    jar.set(EMBED_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }
}
```

In `getPortalSession`, change the token read (line ~109) to fall back to the embed cookie:

```ts
  const token = jar.get(COOKIE_NAME)?.value ?? jar.get(EMBED_COOKIE_NAME)?.value
```

In `clearPortalCookie`, also delete the companion:

```ts
export async function clearPortalCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
  jar.delete(EMBED_COOKIE_NAME)
}
```

- [ ] **Step 3: PortalShell — trim chrome when framed**

Create `components/portal/PortalShell.tsx`:

```tsx
'use client'

/**
 * Client wrapper for the signed-in portal shell. When the portal runs
 * inside the LeadConnector menu (?embedded=leadconnector + iframe,
 * detected by EmbeddedProvider), the vertical sidebar is swapped for a
 * compact horizontal tab bar — the host app already provides the outer
 * chrome, and a 240px sidebar wastes most of a menu iframe.
 */

import { EmbeddedProvider, useEmbedded } from '@/lib/embedded-context'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const EMBED_TABS = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/conversations', label: 'Live Chats' },
  { href: '/portal/locations', label: 'Locations' },
  { href: '/portal/tickets', label: 'Tickets' },
  { href: '/portal/reports', label: 'Reports' },
  { href: '/portal/settings', label: 'Settings' },
]

function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const { embedded } = useEmbedded()
  const pathname = usePathname()

  if (!embedded) {
    return (
      <>
        {sidebar}
        <main className="flex-1 min-w-0">{children}</main>
      </>
    )
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <nav className="flex gap-1 border-b border-zinc-800 px-3 pt-2 text-sm overflow-x-auto">
        {EMBED_TABS.map(t => {
          const active = t.href === '/portal' ? pathname === '/portal' : pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`whitespace-nowrap rounded-t-lg px-3 py-2 ${
                active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}

export default function PortalShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <EmbeddedProvider>
      <Shell sidebar={sidebar}>{children}</Shell>
    </EmbeddedProvider>
  )
}
```

First check `lib/embedded-context.tsx:34-72` for the exact `EmbeddedProvider`/`useEmbedded` signatures (they exist; confirm `useEmbedded()` returns `{ embedded }` and that the provider tolerates being mounted outside the dashboard). If `useEmbedded` throws outside its provider, keep the provider wrap exactly as above.

- [ ] **Step 4: Use PortalShell in the layout**

In `app/portal/layout.tsx`, the signed-in return currently renders `<aside …>…</aside><main className="flex-1 min-w-0">{children}</main>` inside the flex container. Change it to:

```tsx
  return (
    <div
      className="min-h-screen flex bg-zinc-950 text-zinc-100"
      style={{ ['--portal-accent']: portal?.primaryColor || '#fbbf24' } as React.CSSProperties}
    >
      <PortalShell
        sidebar={
          <aside className="w-60 shrink-0 border-r border-zinc-800 flex flex-col">
            {/* …existing aside content unchanged… */}
          </aside>
        }
      >
        {children}
      </PortalShell>
    </div>
  )
```

with `import PortalShell from '@/components/portal/PortalShell'` at the top. The `<main>` element moves into PortalShell — don't render it twice.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: clean.

- [ ] **Step 6: Verify in the preview browser**

Start the dev server (preview_start), then:
- Load `/portal/login` — renders unchanged (Lax path, no embed cookie in dev).
- Load `/portal?embedded=leadconnector` in the preview — since it's not actually iframed, `EmbeddedProvider` should report `embedded: false` and render the normal sidebar. Confirm no console errors on both.

- [ ] **Step 7: Commit + push**

```bash
git add next.config.ts lib/portal-auth.ts app/portal/layout.tsx components/portal/
git commit -m "feat: embed-ready portal (CSP, SameSite=None companion cookie, framed chrome)"
git push
```

---

### Task 12: Embed-snippet LeadConnector variant

**Files:**
- Modify: `app/dashboard/[workspaceId]/widgets/[widgetId]/page.tsx` (find the embed-snippet block: `grep -n "data-widget-id" app/dashboard/\[workspaceId\]/widgets/\[widgetId\]/page.tsx`)

- [ ] **Step 1: Add a LeadConnector install variant below the existing snippet**

Read 30 lines around the grep hit first to match the page's copy-button pattern, then add a second snippet block using the same components/classes, titled "Installing via your CRM (per-location control)":

```tsx
{/* LeadConnector/agency install variant: the {{location.id}} merge tag is
    resolved per sub-account by the CRM when the snippet is added via
    agency-level custom code, which is what lets the per-location widget
    toggle (Locations page) target each site. On non-CRM sites the tag
    stays literal and widget.js ignores it. */}
```

Snippet text (rendered in the same `<pre>`/copy control the page already uses — reuse the exact same JSX structure as the block above it):

```html
<script src="https://<host>/widget.js"
        data-widget-id="<id>"
        data-public-key="<publicKey>"
        data-location-id="{{location.id}}"
        async></script>
```

with `<host>`, `<id>`, `<publicKey>` interpolated exactly like the existing snippet block interpolates them. Add a one-line hint under it: `Use this version when installing through your CRM's agency custom code — it enables per-location on/off from the Locations page.`

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
git add app/dashboard/
git commit -m "feat: CRM install snippet variant with data-location-id merge tag"
git push
```

---

### Task 13: Daily sync cron

**Files:**
- Create: `app/api/cron/sync-agency-locations/route.ts`
- Modify: `vercel.json` (crons array)

- [ ] **Step 1: Cron route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'
import { recordCronRun } from '@/lib/cron-heartbeat'

export const dynamic = 'force-dynamic'

/**
 * Daily agency-location sync. Keeps AgencyLocation rows current with the
 * agency (new sub-accounts appear with widgetEnabled=true; vanished ones
 * get removedAt stamped). Also exercises the token-refresh path so a
 * quiet connection doesn't sit on a dead token.
 * Secured by CRON_SECRET — matches the other crons.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connections = await db.agencyConnection.findMany({ select: { id: true } })
  let ok = 0, failed = 0
  for (const c of connections) {
    try {
      await syncAgencyLocations(c.id)
      ok++
    } catch (err: any) {
      failed++
      console.warn('[SyncAgencyLocations] connection', c.id, 'failed:', err?.message)
    }
  }
  await recordCronRun('sync-agency-locations').catch(() => {})
  return NextResponse.json({ connections: connections.length, ok, failed })
}
```

Check `lib/cron-heartbeat.ts` for `recordCronRun`'s exact signature (the refresh-tokens cron imports it) and match it.

- [ ] **Step 2: vercel.json entry**

Add to the `crons` array:

```json
    {
      "path": "/api/cron/sync-agency-locations",
      "schedule": "45 5 * * *"
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
git add app/api/cron/sync-agency-locations/ vercel.json
git commit -m "feat: daily agency-location sync cron"
git push
```

---

### Task 14: Full verification + ship summary

- [ ] **Step 1: Full check suite**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean. Fix anything that isn't before proceeding.

- [ ] **Step 2: Preview verification of the admin page**

Start the dev server via preview_start. Visit `/dashboard/<a-real-workspace-id>/locations`:
- Page renders (empty/connect state is fine without env vars — confirm the "not configured" notice shows, no 500).
- Sidebar shows "Locations" with the NEW badge.
- Console has no errors.
Screenshot as proof.

- [ ] **Step 3: Verify widget config contract by hand**

With the dev server running:
```bash
curl -s "http://localhost:3000/api/widget/<real-widget-id>/config?pk=<its-public-key>" | head -c 300
curl -s "http://localhost:3000/api/widget/<real-widget-id>/config?pk=<its-public-key>&locationId=nonexistent" | head -c 300
```
Expected: identical config JSON both times (no row → fail-open). Grab a real widget id/publicKey from the local DB (`npm run db:studio` or a quick node script).

- [ ] **Step 4: Write the ship summary for Ryan**

The final report must include:
1. **Hand-run SQL**: path of `prisma/migrations/<timestamp>_add_agency_location_widget_control/migration.sql` + its contents.
2. **Env vars needed**: `LEADCONNECTOR_AGENCY_CLIENT_ID`, `LEADCONNECTOR_AGENCY_CLIENT_SECRET` — set with `printf '%s' "$VALUE" | vercel env add NAME production` (never echo). Marketplace app requirements: agency-level (Company) install, scopes `locations.readonly companies.readonly`, redirect URI `https://app.xovera.io/api/auth/leadconnector-agency/callback`.
3. **How agencies onboard**: connect on the Locations page → snippet variant with `data-location-id="{{location.id}}"` for CRM installs → GHL custom menu link to `https://app.xovera.io/portal?embedded=leadconnector` (or their custom portal domain).
4. **What was NOT touched**: existing embeds/config path behavior, Location token store, existing portal login UX.

---

## Self-review notes (already applied)

- Spec coverage: models (T1), sync (T2-3), enforcement (T4), OAuth (T5), admin API/UI (T6-8), portal API/UI (T9-10), embed-ready portal (T11), snippet variant (T12), cron (T13), verification + ops summary (T14). NEW badges: dashboard (T8), portal (T10). No spec item unassigned.
- Fail-open guarantee is verified explicitly (T4 step 4, T14 step 3), not just asserted.
- Type consistency: `planAgencyLocationSync` / `FetchedAgencyLocation` / `markRemoved` names match across T2/T3; `LocationList` response shape matches both API routes (T6/T9); `apiBase` + `/sync` convention shared.
- Known look-before-you-edit points are flagged inline (navLink signature, accent utilities, requireWorkspaceRole in a page context, recordCronRun signature, embedded-context exports) — executors must read the neighboring code at those points rather than pasting blind.
