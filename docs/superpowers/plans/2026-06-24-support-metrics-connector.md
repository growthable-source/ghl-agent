# Support Metrics Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, Bearer-key-authenticated `/api/v1/...` REST API so an external operations dashboard can pull ticketing, SLA, CSAT, queue, and operator metrics — per-workspace and as an org-wide roll-up.

**Architecture:** A new versioned external surface under `app/api/v1/`, authenticated by a hashed API key (`ApiKey` table) instead of NextAuth sessions. Each metric is computed by a pure function in `lib/support-metrics/*` that both the new v1 routes and the existing in-app dashboard routes call (single source of truth). SLA becomes a first-class `SlaPolicy` table; attainment is computed against stored targets. All work happens in `ghl-agent/`.

**Tech Stack:** Next.js 16 (App Router route handlers), Prisma 7 / Postgres, Node `crypto`, Vitest (unit scope = `lib/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-24-support-metrics-connector-design.md`

---

## File Structure

**New — auth & shared metrics:**
- `lib/api-auth.ts` — verify Bearer key, resolve scope (`{ scope, workspaceId }`)
- `lib/api-key.ts` — generate/hash raw keys (pure, no DB)
- `lib/support-metrics/types.ts` — `MetricScope`, shared result types
- `lib/support-metrics/sla.ts` — first-response/resolution measurement + attainment
- `lib/support-metrics/tickets.ts` — ticket metrics, list, single (extracted)
- `lib/support-metrics/csat.ts` — CSAT metrics + responses list (extracted)
- `lib/support-metrics/queue.ts` — live queue snapshot
- `lib/support-metrics/operators.ts` — per-operator rollup
- `lib/support-metrics/overview.ts` — composes overview + org roll-up
- `lib/api-scope.ts` — parse `from`/`to`/`days`/`brandId`/pagination from a request

**New — v1 routes (all `app/api/v1/...route.ts`):**
- `support/overview`, `tickets/metrics`, `tickets`, `tickets/[id]`,
  `csat/metrics`, `csat/responses`, `sla/metrics`, `sla/breaches`,
  `queue/snapshot`, `operators`, `org/overview`

**New — management UI:**
- `app/dashboard/[workspaceId]/settings/api-access/page.tsx` (+ client component)
- `app/dashboard/[workspaceId]/settings/sla/page.tsx` (+ client component)
- `app/api/workspaces/[workspaceId]/api-keys/route.ts` (session-authed CRUD)
- `app/api/workspaces/[workspaceId]/api-keys/[keyId]/route.ts` (revoke)
- `app/api/workspaces/[workspaceId]/sla-policies/route.ts` (session-authed CRUD)

**New — scripts:**
- `scripts/create-org-api-key.mjs` — hand-run org key provisioning

**Modified:**
- `prisma/schema.prisma` — `ApiKey`, `SlaPolicy`, `ApiRequestLog` + `Workspace` back-relation
- `app/api/workspaces/[workspaceId]/tickets/reports/route.ts` — call shared fn
- `app/api/workspaces/[workspaceId]/csat/route.ts` — call shared fn
- `components/dashboard/DashboardSidebar.tsx` — `FEATURE_SHIP_DATES` + nav entries with `<NewBadge>`

---

## Task 1: Schema — ApiKey, SlaPolicy, ApiRequestLog

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the three models + Workspace back-relation**

Find the `Workspace` model and add to its relation list:

```prisma
  ApiKeys     ApiKey[]
  SlaPolicies SlaPolicy[]
```

Append the new models near the other workspace-scoped models (e.g. after `LiveChatSettings`):

```prisma
model ApiKey {
  id              String    @id @default(cuid())
  workspaceId     String? // null = org-scope key
  scope           String // 'workspace' | 'org'
  name            String
  prefix          String // first 12 chars of the raw key, shown in UI
  hashedKey       String    @unique // SHA-256 hex of the raw key
  lastUsedAt      DateTime?
  createdByUserId String?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())

  workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, revokedAt])
}

model SlaPolicy {
  id                String   @id @default(cuid())
  workspaceId       String
  priority          String // 'urgent' | 'high' | 'normal' | 'low' | 'default'
  firstResponseMins Int? // target minutes; null = not tracked
  resolutionMins    Int?
  enabled           Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, priority])
  @@index([workspaceId])
}

model ApiRequestLog {
  id         String   @id @default(cuid())
  apiKeyId   String?
  scope      String
  workspaceId String?
  path       String
  status     Int
  durationMs Int
  createdAt  DateTime @default(now())

  @@index([apiKeyId, createdAt])
  @@index([createdAt])
}
```

- [ ] **Step 2: Generate the migration (local only — production applied by hand)**

Run: `npm run db:migrate -- --name support_metrics_connector`
Expected: a new folder under `prisma/migrations/` and `prisma generate` runs; Prisma Client now types `db.apiKey`, `db.slaPolicy`, `db.apiRequestLog`.

> Note: per repo convention Ryan applies the SQL by hand in production. Do not add any auto-apply tooling.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(api): schema for ApiKey, SlaPolicy, ApiRequestLog"
```

---

## Task 2: API key generation + hashing (pure, TDD)

**Files:**
- Create: `lib/api-key.ts`
- Test: `lib/api-key.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/api-key.test.ts
import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey } from './api-key'

describe('api-key', () => {
  it('generates a vox_live_ prefixed key with a 12-char display prefix', () => {
    const { raw, prefix, hashed } = generateApiKey()
    expect(raw.startsWith('vox_live_')).toBe(true)
    expect(prefix).toBe(raw.slice(0, 12))
    expect(prefix.length).toBe(12)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
  })

  it('hashApiKey is deterministic and matches generate', () => {
    const { raw, hashed } = generateApiKey()
    expect(hashApiKey(raw)).toBe(hashed)
  })

  it('different keys produce different hashes', () => {
    expect(generateApiKey().hashed).not.toBe(generateApiKey().hashed)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api-key.test.ts`
Expected: FAIL — cannot find module `./api-key`.

- [ ] **Step 3: Implement**

```ts
// lib/api-key.ts
import { randomBytes, createHash } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function base62(bytes: Buffer): string {
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 62]
  return out
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateApiKey(): { raw: string; prefix: string; hashed: string } {
  const raw = `vox_live_${base62(randomBytes(32))}`
  return { raw, prefix: raw.slice(0, 12), hashed: hashApiKey(raw) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api-key.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/api-key.ts lib/api-key.test.ts
git commit -m "feat(api): api key generation and hashing"
```

---

## Task 3: Auth + scope resolution (TDD)

**Files:**
- Create: `lib/api-auth.ts`
- Test: `lib/api-auth.test.ts`

The DB lookup is injected so the resolver is unit-testable without a database.

- [ ] **Step 1: Write the failing test**

```ts
// lib/api-auth.test.ts
import { describe, it, expect } from 'vitest'
import { resolveScope, AuthError } from './api-auth'

const wsKey = { scope: 'workspace' as const, workspaceId: 'ws_1' }
const orgKey = { scope: 'org' as const, workspaceId: null }

describe('resolveScope', () => {
  it('workspace key locked to its own workspace', () => {
    expect(resolveScope(wsKey, { requestedWorkspaceId: undefined }))
      .toEqual({ workspaceId: 'ws_1' })
  })

  it('workspace key rejects a different workspaceId (403)', () => {
    expect(() => resolveScope(wsKey, { requestedWorkspaceId: 'ws_2' }))
      .toThrow(AuthError)
    try { resolveScope(wsKey, { requestedWorkspaceId: 'ws_2' }) }
    catch (e) { expect((e as AuthError).status).toBe(403) }
  })

  it('org key scopes down with an explicit workspaceId', () => {
    expect(resolveScope(orgKey, { requestedWorkspaceId: 'ws_9' }))
      .toEqual({ workspaceId: 'ws_9' })
  })

  it('org key on a per-workspace endpoint with no workspaceId → 422', () => {
    try { resolveScope(orgKey, { requestedWorkspaceId: undefined }) }
    catch (e) { expect((e as AuthError).status).toBe(422) }
  })

  it('workspace key forbidden from org endpoints (403)', () => {
    try { resolveScope(wsKey, { orgEndpoint: true }) }
    catch (e) { expect((e as AuthError).status).toBe(403) }
  })

  it('org key allowed on org endpoints', () => {
    expect(resolveScope(orgKey, { orgEndpoint: true })).toEqual({ workspaceId: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api-auth.test.ts`
Expected: FAIL — cannot find module `./api-auth`.

- [ ] **Step 3: Implement**

```ts
// lib/api-auth.ts
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashApiKey } from '@/lib/api-key'

export class AuthError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export type KeyContext = { scope: 'workspace' | 'org'; workspaceId: string | null; apiKeyId?: string }

/**
 * Pure scope resolver. Given the authenticated key and what the request asked
 * for, returns the effective workspace scope (or null for org-wide endpoints)
 * or throws AuthError.
 */
export function resolveScope(
  key: { scope: 'workspace' | 'org'; workspaceId: string | null },
  opts: { requestedWorkspaceId?: string; orgEndpoint?: boolean }
): { workspaceId: string | null } {
  if (opts.orgEndpoint) {
    if (key.scope !== 'org') throw new AuthError(403, 'forbidden', 'Org-scope key required')
    return { workspaceId: null }
  }
  if (key.scope === 'workspace') {
    if (opts.requestedWorkspaceId && opts.requestedWorkspaceId !== key.workspaceId) {
      throw new AuthError(403, 'forbidden', 'Key is not scoped to that workspace')
    }
    return { workspaceId: key.workspaceId }
  }
  // org key on a per-workspace endpoint
  if (!opts.requestedWorkspaceId) {
    throw new AuthError(422, 'workspace_required', 'workspaceId query param required for org-scope key')
  }
  return { workspaceId: opts.requestedWorkspaceId }
}

/** Verify the Bearer key against the DB. Throws AuthError(401) on failure. */
export async function authenticateApiKey(req: NextRequest): Promise<KeyContext> {
  const header = req.headers.get('authorization') || ''
  const m = header.match(/^Bearer\s+(.+)$/i)
  if (!m) throw new AuthError(401, 'unauthorized', 'Missing Bearer token')
  const hashed = hashApiKey(m[1].trim())
  const row = await db.apiKey.findUnique({ where: { hashedKey: hashed } })
  if (!row || row.revokedAt) throw new AuthError(401, 'unauthorized', 'Invalid API key')
  // best-effort touch; never block
  db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { scope: row.scope as 'workspace' | 'org', workspaceId: row.workspaceId, apiKeyId: row.id }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api-auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/api-auth.ts lib/api-auth.test.ts
git commit -m "feat(api): bearer auth + scope resolution"
```

---

## Task 4: Request param parsing + v1 response helpers

**Files:**
- Create: `lib/api-scope.ts`
- Test: `lib/api-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/api-scope.test.ts
import { describe, it, expect } from 'vitest'
import { parseWindow } from './api-scope'

describe('parseWindow', () => {
  it('defaults to trailing 30 days', () => {
    const w = parseWindow(new URL('https://x/api/v1/tickets/metrics'))
    const ms = w.to.getTime() - w.from.getTime()
    expect(Math.round(ms / 86400000)).toBe(30)
  })
  it('honours days', () => {
    const w = parseWindow(new URL('https://x/y?days=7'))
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86400000)).toBe(7)
  })
  it('rejects days out of range', () => {
    expect(() => parseWindow(new URL('https://x/y?days=999'))).toThrow()
  })
  it('explicit from/to overrides days', () => {
    const w = parseWindow(new URL('https://x/y?from=2026-01-01&to=2026-01-08'))
    expect(w.from.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(w.to.toISOString().slice(0, 10)).toBe('2026-01-08')
  })
  it('reads brandId and no_brand', () => {
    expect(parseWindow(new URL('https://x/y?brandId=b1')).brandId).toBe('b1')
    expect(parseWindow(new URL('https://x/y?brandId=no_brand')).brandId).toBe('no_brand')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api-scope.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// lib/api-scope.ts
import { NextResponse } from 'next/server'
import { AuthError } from '@/lib/api-auth'

export type Window = { from: Date; to: Date; brandId?: string }

export function parseWindow(url: URL): Window {
  const to = url.searchParams.get('to')
    ? new Date(url.searchParams.get('to') + 'T00:00:00Z')
    : new Date()
  let from: Date
  const fromParam = url.searchParams.get('from')
  if (fromParam) {
    from = new Date(fromParam + 'T00:00:00Z')
  } else {
    const days = Number(url.searchParams.get('days') ?? 30)
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw new AuthError(422, 'bad_param', 'days must be 1..365')
    }
    from = new Date(to.getTime() - days * 86400000)
  }
  const brandId = url.searchParams.get('brandId') || undefined
  return { from, to, brandId }
}

/** Map an AuthError (or unknown) to a uniform JSON error response. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status })
  }
  console.error('[api/v1] unhandled', err)
  return NextResponse.json({ error: { code: 'internal', message: 'Internal error' } }, { status: 500 })
}

export function ok(data: unknown, meta: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ...meta, data })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api-scope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/api-scope.ts lib/api-scope.test.ts
git commit -m "feat(api): window/param parsing + response helpers"
```

---

## Task 5: SLA measurement + attainment (TDD — the genuinely new metric)

**Files:**
- Create: `lib/support-metrics/types.ts`
- Create: `lib/support-metrics/sla.ts`
- Test: `lib/support-metrics/sla.test.ts`

- [ ] **Step 1: Create shared types**

```ts
// lib/support-metrics/types.ts
import type { db as DbClient } from '@/lib/db'
export type Db = typeof DbClient
export type MetricScope = { workspaceId: string; from: Date; to: Date; brandId?: string }
```

- [ ] **Step 2: Write the failing test for the pure helpers**

```ts
// lib/support-metrics/sla.test.ts
import { describe, it, expect } from 'vitest'
import { firstResponseMins, resolutionMins, attainment } from './sla'

const t0 = new Date('2026-06-01T00:00:00Z')
const mins = (n: number) => new Date(t0.getTime() + n * 60000)

describe('sla measurement', () => {
  it('first response = first outbound message minus created', () => {
    const ticket = {
      createdAt: t0,
      messages: [
        { direction: 'inbound', createdAt: mins(1) },
        { direction: 'outbound', createdAt: mins(30) },
        { direction: 'outbound', createdAt: mins(90) },
      ],
      assignedAt: mins(10),
    }
    expect(firstResponseMins(ticket)).toBe(30)
  })

  it('first response falls back to assignedAt when no outbound yet', () => {
    const ticket = { createdAt: t0, messages: [{ direction: 'inbound', createdAt: mins(5) }], assignedAt: mins(20) }
    expect(firstResponseMins(ticket)).toBe(20)
  })

  it('first response is null when neither outbound nor assignment', () => {
    expect(firstResponseMins({ createdAt: t0, messages: [], assignedAt: null })).toBeNull()
  })

  it('resolution = closedAt minus created, null if not closed', () => {
    expect(resolutionMins({ createdAt: t0, closedAt: mins(120) })).toBe(120)
    expect(resolutionMins({ createdAt: t0, closedAt: null })).toBeNull()
  })

  it('attainment = % at or under target, null when no measurable items', () => {
    expect(attainment([30, 50, 90], 60)).toBe(67) // 2 of 3 <= 60 → 66.7 → 67
    expect(attainment([], 60)).toBeNull()
    expect(attainment([10, 20], null)).toBeNull() // no target → not tracked
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/support-metrics/sla.test.ts`
Expected: FAIL — cannot find module `./sla`.

- [ ] **Step 4: Implement the pure helpers + the DB-backed metric**

```ts
// lib/support-metrics/sla.ts
import type { Db, MetricScope } from './types'

type MsgLite = { direction: string; createdAt: Date }
type TicketLite = { createdAt: Date; messages: MsgLite[]; assignedAt: Date | null }

export function firstResponseMins(t: TicketLite): number | null {
  const firstOut = t.messages
    .filter((m) => m.direction === 'outbound')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
  const anchor = firstOut?.createdAt ?? t.assignedAt
  if (!anchor) return null
  return Math.round((anchor.getTime() - t.createdAt.getTime()) / 60000)
}

export function resolutionMins(t: { createdAt: Date; closedAt: Date | null }): number | null {
  if (!t.closedAt) return null
  return Math.round((t.closedAt.getTime() - t.createdAt.getTime()) / 60000)
}

export function attainment(values: number[], targetMins: number | null): number | null {
  if (targetMins == null || values.length === 0) return null
  const met = values.filter((v) => v <= targetMins).length
  return Math.round((met / values.length) * 100)
}

type PolicyMap = Map<string, { firstResponseMins: number | null; resolutionMins: number | null }>

function targetFor(map: PolicyMap, priority: string, field: 'firstResponseMins' | 'resolutionMins'): number | null {
  return (map.get(priority) ?? map.get('default'))?.[field] ?? null
}

/**
 * SLA attainment for tickets created in the window. Returns null fields when no
 * policy targets exist so the dashboard shows "not tracked" rather than a fake 100%.
 */
export async function getSlaMetrics(db: Db, scope: MetricScope) {
  const policies = await db.slaPolicy.findMany({ where: { workspaceId: scope.workspaceId, enabled: true } })
  const map: PolicyMap = new Map(
    policies.map((p) => [p.priority, { firstResponseMins: p.firstResponseMins, resolutionMins: p.resolutionMins }])
  )

  const where: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    createdAt: { gte: scope.from, lt: scope.to },
  }
  if (scope.brandId === 'no_brand') where.brandId = null
  else if (scope.brandId) where.brandId = scope.brandId

  const tickets = await db.ticket.findMany({
    where,
    select: {
      priority: true,
      createdAt: true,
      closedAt: true,
      assignedAt: true,
      messages: { select: { direction: true, createdAt: true } },
    },
  })

  const frByPriority = new Map<string, number[]>()
  const resByPriority = new Map<string, number[]>()
  for (const t of tickets) {
    const fr = firstResponseMins(t)
    if (fr != null && targetFor(map, t.priority, 'firstResponseMins') != null) {
      ;(frByPriority.get(t.priority) ?? frByPriority.set(t.priority, []).get(t.priority)!).push(fr)
    }
    const res = resolutionMins(t)
    if (res != null && targetFor(map, t.priority, 'resolutionMins') != null) {
      ;(resByPriority.get(t.priority) ?? resByPriority.set(t.priority, []).get(t.priority)!).push(res)
    }
  }

  const flat = (m: Map<string, number[]>) => [...m.values()].flat()
  const allFr = flat(frByPriority)
  const allRes = flat(resByPriority)
  // overall attainment compares each value to its own priority target
  const frMet = [...frByPriority.entries()].reduce(
    (n, [p, vals]) => n + vals.filter((v) => v <= targetFor(map, p, 'firstResponseMins')!).length, 0)
  const resMet = [...resByPriority.entries()].reduce(
    (n, [p, vals]) => n + vals.filter((v) => v <= targetFor(map, p, 'resolutionMins')!).length, 0)

  const byPriority = ['urgent', 'high', 'normal', 'low'].map((priority) => ({
    priority,
    firstResponseAttainment: attainment(frByPriority.get(priority) ?? [], targetFor(map, priority, 'firstResponseMins')),
    resolutionAttainment: attainment(resByPriority.get(priority) ?? [], targetFor(map, priority, 'resolutionMins')),
  }))

  return {
    tracked: map.size > 0,
    firstResponseAttainment: allFr.length ? Math.round((frMet / allFr.length) * 100) : null,
    resolutionAttainment: allRes.length ? Math.round((resMet / allRes.length) * 100) : null,
    firstResponseBreaches: allFr.length - frMet,
    resolutionBreaches: allRes.length - resMet,
    byPriority,
  }
}

/** Tickets that breached either target, for the /sla/breaches drill-down. */
export async function listSlaBreaches(db: Db, scope: MetricScope, limit = 100) {
  const policies = await db.slaPolicy.findMany({ where: { workspaceId: scope.workspaceId, enabled: true } })
  const map: PolicyMap = new Map(policies.map((p) => [p.priority, p]))
  const where: Record<string, unknown> = { workspaceId: scope.workspaceId, createdAt: { gte: scope.from, lt: scope.to } }
  if (scope.brandId === 'no_brand') where.brandId = null
  else if (scope.brandId) where.brandId = scope.brandId

  const tickets = await db.ticket.findMany({
    where,
    select: {
      id: true, ticketNumber: true, subject: true, priority: true, status: true,
      createdAt: true, closedAt: true, assignedAt: true,
      messages: { select: { direction: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const breaches = []
  for (const t of tickets) {
    const fr = firstResponseMins(t)
    const res = resolutionMins(t)
    const frTarget = targetFor(map, t.priority, 'firstResponseMins')
    const resTarget = targetFor(map, t.priority, 'resolutionMins')
    const frBreach = fr != null && frTarget != null && fr > frTarget
    const resBreach = res != null && resTarget != null && res > resTarget
    if (frBreach || resBreach) {
      breaches.push({
        id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, priority: t.priority, status: t.status,
        firstResponseMins: fr, firstResponseTarget: frTarget, firstResponseBreached: frBreach,
        resolutionMins: res, resolutionTarget: resTarget, resolutionBreached: resBreach,
      })
    }
    if (breaches.length >= limit) break
  }
  return breaches
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/support-metrics/sla.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add lib/support-metrics/types.ts lib/support-metrics/sla.ts lib/support-metrics/sla.test.ts
git commit -m "feat(metrics): SLA measurement + attainment"
```

---

## Task 6: Extract ticket metrics into a shared function

**Files:**
- Create: `lib/support-metrics/tickets.ts`
- Modify: `app/api/workspaces/[workspaceId]/tickets/reports/route.ts`

> This is a behavior-preserving extraction. Move the existing aggregation body
> (the part after the `getTicketingStatus` gate that builds `scorecards`, `trend`,
> `byStatus`, `byPriority`, `byBrand`, `byOperator`, `created`, `closed`,
> `allBrands`) out of the route handler and into `getTicketMetrics`.

- [ ] **Step 1: Create the shared function**

Create `lib/support-metrics/tickets.ts` exporting:

```ts
import type { Db, MetricScope } from './types'

// Move the existing computation from the reports route here verbatim, changing:
//   - inputs: take (db, scope) instead of reading req/params
//   - the date window: use scope.from / scope.to (the route currently derives
//     these from days/from/to — that logic moves to the caller via parseWindow)
//   - brand filter: scope.brandId ('no_brand' | id | undefined)
export async function getTicketMetrics(db: Db, scope: MetricScope) {
  // ...moved aggregation, returns the existing payload object...
}

export async function listTickets(db: Db, scope: MetricScope, opts: { cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: Record<string, unknown> = { workspaceId: scope.workspaceId, createdAt: { gte: scope.from, lt: scope.to } }
  if (scope.brandId === 'no_brand') where.brandId = null
  else if (scope.brandId) where.brandId = scope.brandId
  const rows = await db.ticket.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, ticketNumber: true, subject: true, status: true, priority: true,
      contactEmail: true, contactName: true, assignedUserId: true,
      createdAt: true, closedAt: true, lastActivityAt: true, brandId: true,
    },
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}

export async function getTicket(db: Db, scope: MetricScope, id: string) {
  return db.ticket.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
}
```

- [ ] **Step 2: Rewrite the route to call it**

In `app/api/workspaces/[workspaceId]/tickets/reports/route.ts`, after the
`getTicketingStatus` gate, replace the inline aggregation with:

```ts
import { getTicketMetrics } from '@/lib/support-metrics/tickets'
import { parseWindow } from '@/lib/api-scope'
// ...
  const { from, to, brandId } = parseWindow(new URL(req.url))
  const data = await getTicketMetrics(db, { workspaceId, from, to, brandId })
  return NextResponse.json({ inactive: false, days: Number(new URL(req.url).searchParams.get('days') ?? 30), from, to, ...data })
```

> Preserve every field the page currently reads. If the page expects `days`,
> `from`, `to` at the top level, keep them.

- [ ] **Step 3: Verify the in-app reports page still renders identically**

Run: `npx tsc --noEmit` (Expected: PASS)
Then start the dev server and verify via the preview workflow that
`/dashboard/<ws>/tickets/reports` shows the same scorecards/charts as before.

- [ ] **Step 4: Commit**

```bash
git add lib/support-metrics/tickets.ts "app/api/workspaces/[workspaceId]/tickets/reports/route.ts"
git commit -m "refactor(metrics): extract getTicketMetrics; reports route reuses it"
```

---

## Task 7: Extract CSAT metrics + add responses list

**Files:**
- Create: `lib/support-metrics/csat.ts`
- Modify: `app/api/workspaces/[workspaceId]/csat/route.ts`

- [ ] **Step 1: Create the shared function**

Move the CSAT aggregation body from the route into:

```ts
// lib/support-metrics/csat.ts
import type { Db, MetricScope } from './types'

export type CsatScope = MetricScope & { rating?: number; handler?: 'ai' | 'human' }

export async function getCsatMetrics(db: Db, scope: CsatScope) {
  // ...moved aggregation from csat/route.ts, returns existing payload
  // (scorecards, byAgent, byOperator, byBrand, recent)...
}

export async function listCsatResponses(db: Db, scope: CsatScope, opts: { cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: Record<string, unknown> = {
    csatSubmittedAt: { gte: scope.from, lt: scope.to },
    widget: { workspaceId: scope.workspaceId },
  }
  if (scope.rating) where.csatRating = scope.rating
  if (scope.handler === 'human') where.assignedAt = { not: null }
  if (scope.handler === 'ai') where.assignedAt = null
  const rows = await db.widgetConversation.findMany({
    where,
    orderBy: { csatSubmittedAt: 'desc' },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, csatRating: true, csatComment: true, csatSubmittedAt: true,
      assignedUserId: true, agentId: true,
    },
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}
```

- [ ] **Step 2: Rewrite the csat route to call `getCsatMetrics`**

In `app/api/workspaces/[workspaceId]/csat/route.ts`, after the access gate,
replace the inline aggregation with a call to `getCsatMetrics(db, scope)` built
from `parseWindow` + `rating`/`handler` query params. Keep the existing
`isMissingColumn` try/catch so a pre-migration DB still degrades gracefully.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` (Expected: PASS). Verify the in-app CSAT tab renders the same numbers via preview.

- [ ] **Step 4: Commit**

```bash
git add lib/support-metrics/csat.ts "app/api/workspaces/[workspaceId]/csat/route.ts"
git commit -m "refactor(metrics): extract getCsatMetrics + add listCsatResponses"
```

---

## Task 8: Queue snapshot + operator metrics

**Files:**
- Create: `lib/support-metrics/queue.ts`
- Create: `lib/support-metrics/operators.ts`

- [ ] **Step 1: Queue snapshot**

```ts
// lib/support-metrics/queue.ts
import type { Db } from './types'

export async function getQueueSnapshot(db: Db, workspaceId: string) {
  const settings = await db.liveChatSettings.findUnique({ where: { workspaceId } })
  const queued = await db.widgetConversation.findMany({
    where: { queuedAt: { not: null }, assignedUserId: null, status: { not: 'ended' }, widget: { workspaceId } },
    select: { queuedAt: true },
    orderBy: { queuedAt: 'asc' },
  })
  const available = await db.workspaceMember.count({ where: { workspaceId, isAvailable: true, role: { not: 'viewer' } } })
  const longestWaitSecs = queued.length && queued[0].queuedAt
    ? Math.round((Date.now() - queued[0].queuedAt.getTime()) / 1000)
    : 0
  return {
    depth: queued.length,
    availableAgents: available,
    maxConcurrentHumanChats: settings?.maxConcurrentHumanChats ?? null,
    queueEnabled: settings?.queueEnabled ?? false,
    longestWaitSecs,
  }
}
```

- [ ] **Step 2: Operator metrics**

```ts
// lib/support-metrics/operators.ts
import type { Db, MetricScope } from './types'

export async function getOperatorMetrics(db: Db, scope: MetricScope) {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: scope.workspaceId, role: { not: 'viewer' } },
    select: { userId: true, isAvailable: true, user: { select: { name: true, email: true, image: true } } },
  })
  const tickets = await db.ticket.groupBy({
    by: ['assignedUserId', 'status'],
    where: { workspaceId: scope.workspaceId, assignedUserId: { not: null }, createdAt: { gte: scope.from, lt: scope.to } },
    _count: { _all: true },
  })
  const openStatuses = new Set(['open', 'pending', 'on_hold'])
  return members.map((m) => {
    const mine = tickets.filter((t) => t.assignedUserId === m.userId)
    const assigned = mine.reduce((n, t) => n + t._count._all, 0)
    const open = mine.filter((t) => openStatuses.has(t.status)).reduce((n, t) => n + t._count._all, 0)
    return { userId: m.userId, name: m.user?.name ?? null, email: m.user?.email ?? null, image: m.user?.image ?? null, isAvailable: m.isAvailable, assigned, open }
  })
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add lib/support-metrics/queue.ts lib/support-metrics/operators.ts
git commit -m "feat(metrics): queue snapshot + operator rollup"
```

---

## Task 9: Overview composer (per-workspace + org roll-up)

**Files:**
- Create: `lib/support-metrics/overview.ts`

- [ ] **Step 1: Implement**

```ts
// lib/support-metrics/overview.ts
import type { Db, MetricScope } from './types'
import { getTicketMetrics } from './tickets'
import { getCsatMetrics } from './csat'
import { getSlaMetrics } from './sla'
import { getQueueSnapshot } from './queue'

export async function getWorkspaceOverview(db: Db, scope: MetricScope) {
  const [tickets, csat, sla, queue] = await Promise.all([
    getTicketMetrics(db, scope),
    getCsatMetrics(db, scope),
    getSlaMetrics(db, scope),
    getQueueSnapshot(db, scope.workspaceId),
  ])
  return {
    tickets: { open: tickets.scorecards.open, created: tickets.scorecards.created, closed: tickets.scorecards.closed, avgResolutionHours: tickets.scorecards.avgResolutionHours },
    csat: { avgRating: csat.scorecards.avgRating, responseRate: csat.scorecards.responseRate, totalRated: csat.scorecards.totalRated },
    sla: { tracked: sla.tracked, firstResponseAttainment: sla.firstResponseAttainment, resolutionAttainment: sla.resolutionAttainment },
    queue,
  }
}

export async function getOrgOverview(db: Db, from: Date, to: Date) {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true } })
  const perWorkspace = await Promise.all(
    workspaces.map(async (w) => ({
      workspaceId: w.id,
      name: w.name,
      ...(await getWorkspaceOverview(db, { workspaceId: w.id, from, to })),
    }))
  )
  const totals = perWorkspace.reduce(
    (acc, w) => {
      acc.ticketsOpen += w.tickets.open
      acc.ticketsCreated += w.tickets.created
      acc.ticketsClosed += w.tickets.closed
      acc.queueDepth += w.queue.depth
      return acc
    },
    { ticketsOpen: 0, ticketsCreated: 0, ticketsClosed: 0, queueDepth: 0 }
  )
  return { totals, workspaces: perWorkspace }
}
```

> `getTicketMetrics`/`getCsatMetrics` must expose `scorecards` exactly as named
> here. If field names differ after extraction, reconcile them — this is the
> Task-6/7 → Task-9 type-consistency contract.

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add lib/support-metrics/overview.ts
git commit -m "feat(metrics): workspace + org overview composer"
```

---

## Task 10: v1 route handlers

**Files:** create each `app/api/v1/<path>/route.ts`.

Every handler follows the same skeleton. Build it once for `support/overview`,
then replicate per endpoint changing only the data call.

- [ ] **Step 1: `app/api/v1/support/overview/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { getWorkspaceOverview } from '@/lib/support-metrics/overview'

export async function GET(req: NextRequest) {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = resolveScope(key, { requestedWorkspaceId: url.searchParams.get('workspaceId') || undefined })
    const { from, to, brandId } = parseWindow(url)
    const data = await getWorkspaceOverview(db, { workspaceId: workspaceId!, from, to, brandId })
    return ok(data, { scope: key.scope, workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
}
```

- [ ] **Step 2: Create the remaining per-workspace handlers**

Same skeleton, swapping the data call:
- `app/api/v1/tickets/metrics/route.ts` → `getTicketMetrics(db, scope)`
- `app/api/v1/tickets/route.ts` → `listTickets(db, scope, { cursor, limit })` (read `cursor`/`limit` from query)
- `app/api/v1/tickets/[id]/route.ts` → `getTicket(db, scope, id)`; return 404 via `throw new AuthError(404,'not_found','Ticket not found')` when null
- `app/api/v1/csat/metrics/route.ts` → `getCsatMetrics(db, scope)` (also read `rating`,`handler`)
- `app/api/v1/csat/responses/route.ts` → `listCsatResponses(db, scope, { cursor, limit })`
- `app/api/v1/sla/metrics/route.ts` → `getSlaMetrics(db, scope)`
- `app/api/v1/sla/breaches/route.ts` → `listSlaBreaches(db, scope, limit)`
- `app/api/v1/queue/snapshot/route.ts` → `getQueueSnapshot(db, workspaceId)`
- `app/api/v1/operators/route.ts` → `getOperatorMetrics(db, scope)`

- [ ] **Step 3: Org roll-up handler**

```ts
// app/api/v1/org/overview/route.ts
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { getOrgOverview } from '@/lib/support-metrics/overview'

export async function GET(req: NextRequest) {
  try {
    const key = await authenticateApiKey(req)
    resolveScope(key, { orgEndpoint: true }) // throws unless org key
    const { from, to } = parseWindow(new URL(req.url))
    const data = await getOrgOverview(db, from, to)
    return ok(data, { scope: 'org', from, to })
  } catch (err) {
    return errorResponse(err)
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke test against the dev server**

Generate a temporary key in a node REPL using `generateApiKey()`, insert a row
via `db.apiKey.create`, then:

```bash
curl -s -H "Authorization: Bearer <raw>" "http://localhost:3000/api/v1/support/overview?workspaceId=<ws>&days=30" | jq .
curl -s "http://localhost:3000/api/v1/support/overview" | jq .   # expect 401
```

Expected: first returns `{ scope, workspaceId, from, to, data: {...} }`; second returns `{ error: { code: 'unauthorized', ... } }` with HTTP 401.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1
git commit -m "feat(api): v1 read endpoints for tickets/csat/sla/queue/operators/overview"
```

---

## Task 11: Request logging middleware wrapper

**Files:**
- Create: `lib/api-log.ts`
- Modify: each `app/api/v1/**/route.ts` to wrap with the logger

- [ ] **Step 1: Implement a wrapper**

```ts
// lib/api-log.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export function withApiLog(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx?: unknown) => {
    const start = Date.now()
    const res = await handler(req, ctx as never)
    // best-effort; never block the response
    db.apiRequestLog
      .create({
        data: {
          path: new URL(req.url).pathname,
          status: res.status,
          durationMs: Date.now() - start,
          scope: res.headers.get('x-api-scope') || 'unknown',
          workspaceId: res.headers.get('x-api-workspace') || null,
          apiKeyId: res.headers.get('x-api-key-id') || null,
        },
      })
      .catch(() => {})
    return res
  }
}
```

To populate those header hints, have `ok()`/`errorResponse()` set
`x-api-scope`, `x-api-workspace`, `x-api-key-id` on the response (strip them
before returning to clients is optional; they're harmless metadata). Update the
`ok` helper to accept and set them.

- [ ] **Step 2: Wrap handlers**

Export each route's `GET` as `withApiLog(async (req) => {...})`. Keep logic identical.

- [ ] **Step 3: Typecheck + smoke + commit**

Run: `npx tsc --noEmit`; re-run the curl smoke test; confirm an `ApiRequestLog` row was written.

```bash
git add lib/api-log.ts app/api/v1
git commit -m "feat(api): best-effort request logging for v1"
```

---

## Task 12: Per-workspace API-key management API + UI

**Files:**
- Create: `app/api/workspaces/[workspaceId]/api-keys/route.ts` (GET list, POST create)
- Create: `app/api/workspaces/[workspaceId]/api-keys/[keyId]/route.ts` (DELETE = revoke)
- Create: `app/dashboard/[workspaceId]/settings/api-access/page.tsx`
- Create: `app/dashboard/[workspaceId]/settings/api-access/ApiAccessClient.tsx`

- [ ] **Step 1: CRUD route (session-authed, owner/admin only)**

```ts
// app/api/workspaces/[workspaceId]/api-keys/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateApiKey } from '@/lib/api-key'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const keys = await db.apiKey.findMany({
    where: { workspaceId, scope: 'workspace' },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { name } = await req.json()
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name required' }, { status: 422 })
  }
  const { raw, prefix, hashed } = generateApiKey()
  await db.apiKey.create({
    data: { workspaceId, scope: 'workspace', name, prefix, hashedKey: hashed, createdByUserId: access.session.user.id },
  })
  // raw returned ONCE, never stored
  return NextResponse.json({ key: raw, prefix })
}
```

- [ ] **Step 2: Revoke route**

```ts
// app/api/workspaces/[workspaceId]/api-keys/[keyId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; keyId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, keyId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await db.apiKey.updateMany({ where: { id: keyId, workspaceId }, data: { revokedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Build the settings page + client**

Server page loads keys via the GET route; client renders a table (name, prefix
`vox_live_…`, last used, created, Revoke button) and a "Create key" flow that
shows the raw key once in a copy-once modal. Copy classes/styling from an
existing settings page (e.g. another page under `app/dashboard/[workspaceId]/settings/`)
to stay on theme tokens — do not use raw Tailwind palette or `bg-white`.

- [ ] **Step 4: Typecheck + verify via preview + commit**

Run: `npx tsc --noEmit`; verify create/reveal/revoke works on `/dashboard/<ws>/settings/api-access`.

```bash
git add "app/api/workspaces/[workspaceId]/api-keys" "app/dashboard/[workspaceId]/settings/api-access"
git commit -m "feat(api): per-workspace API key management UI"
```

---

## Task 13: SLA policy management API + UI

**Files:**
- Create: `app/api/workspaces/[workspaceId]/sla-policies/route.ts` (GET, PUT upsert)
- Create: `app/dashboard/[workspaceId]/settings/sla/page.tsx`
- Create: `app/dashboard/[workspaceId]/settings/sla/SlaPolicyClient.tsx`

- [ ] **Step 1: CRUD route**

```ts
// app/api/workspaces/[workspaceId]/sla-policies/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }
const PRIORITIES = ['urgent', 'high', 'normal', 'low', 'default']

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const policies = await db.slaPolicy.findMany({ where: { workspaceId } })
  return NextResponse.json({ policies })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { priority, firstResponseMins, resolutionMins, enabled } = await req.json()
  if (!PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: 'invalid priority' }, { status: 422 })
  }
  const policy = await db.slaPolicy.upsert({
    where: { workspaceId_priority: { workspaceId, priority } },
    create: { workspaceId, priority, firstResponseMins: firstResponseMins ?? null, resolutionMins: resolutionMins ?? null, enabled: enabled ?? true },
    update: { firstResponseMins: firstResponseMins ?? null, resolutionMins: resolutionMins ?? null, enabled: enabled ?? true },
  })
  return NextResponse.json({ policy })
}
```

- [ ] **Step 2: Settings page + client**

A table with a row per priority (urgent/high/normal/low + a "Default" fallback
row), each with First Response (mins) and Resolution (mins) number inputs and an
enabled toggle, saved via PUT. Use the `useDirtyForm` + `<SaveBar>` pattern that
the other agent settings pages use. Theme tokens only.

- [ ] **Step 3: Typecheck + verify + commit**

Run: `npx tsc --noEmit`; verify save round-trips on `/dashboard/<ws>/settings/sla`.

```bash
git add "app/api/workspaces/[workspaceId]/sla-policies" "app/dashboard/[workspaceId]/settings/sla"
git commit -m "feat(sla): SLA policy management UI"
```

---

## Task 14: Org key provisioning script

**Files:**
- Create: `scripts/create-org-api-key.mjs`

- [ ] **Step 1: Implement**

```js
// scripts/create-org-api-key.mjs
// Usage: node scripts/create-org-api-key.mjs "Operations Dashboard"
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const base62 = (buf) => [...buf].map((b) => ALPHABET[b % 62]).join('')
const raw = `vox_live_${base62(randomBytes(32))}`
const hashed = createHash('sha256').update(raw).digest('hex')

const db = new PrismaClient()
const name = process.argv[2] || 'Org Operations Key'
await db.apiKey.create({ data: { scope: 'org', workspaceId: null, name, prefix: raw.slice(0, 12), hashedKey: hashed } })
console.log('\nOrg API key (store now — shown once):\n')
console.log('  ' + raw + '\n')
await db.$disconnect()
```

- [ ] **Step 2: Commit (do NOT run against production — Ryan runs it by hand)**

```bash
git add scripts/create-org-api-key.mjs
git commit -m "chore(api): org API key provisioning script"
```

---

## Task 15: NEW badge + nav entries

**Files:**
- Modify: `components/dashboard/DashboardSidebar.tsx`

- [ ] **Step 1: Add ship-date entries and nav links**

In `DashboardSidebar.tsx`, add to `FEATURE_SHIP_DATES`:

```ts
'settings/api-access': '2026-06-24',
'settings/sla': '2026-06-24',
```

Add nav items for "API Access" and "SLA Policies" under the Settings section,
each rendering `<NewBadge since="2026-06-24" />` next to the label, following the
existing nav-item pattern in that file.

- [ ] **Step 2: Typecheck + verify + commit**

Run: `npx tsc --noEmit`; verify the two nav items appear with NEW badges.

```bash
git add components/dashboard/DashboardSidebar.tsx
git commit -m "feat(nav): API Access + SLA Policies nav with NEW badges"
```

---

## Task 16: External API documentation

**Files:**
- Create: `docs/api/v1-support-metrics.md`

- [ ] **Step 1: Write consumer-facing docs**

Document: base URL, `Authorization: Bearer vox_live_…`, workspace vs org keys,
`?workspaceId=` scope-down rule, every endpoint with params + a sample JSON
response, the error envelope + status codes, pagination (`cursor`/`limit`), and
rate-limit behavior. This is what the other app's dev builds against.

- [ ] **Step 2: Commit**

```bash
git add docs/api/v1-support-metrics.md
git commit -m "docs(api): v1 support metrics connector reference"
```

---

## Task 17: Full verification + push

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS, including `lib/api-key.test.ts`, `lib/api-auth.test.ts`, `lib/api-scope.test.ts`, `lib/support-metrics/sla.test.ts`.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: both clean.

- [ ] **Step 3: End-to-end smoke**

With the dev server up and a seeded workspace key + org key:
- `GET /api/v1/support/overview?workspaceId=<ws>` → 200 with overview
- `GET /api/v1/org/overview` with workspace key → 403
- `GET /api/v1/org/overview` with org key → 200 with totals + per-workspace array
- `GET /api/v1/tickets?workspaceId=<ws>&limit=5` → 200, paginated, `nextCursor` present
- `GET /api/v1/sla/metrics?workspaceId=<ws>` with no policies → `data.tracked === false`, attainment null
- missing/invalid key on any endpoint → 401

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Notes for the implementer

- **Migrations:** generate locally; Ryan applies production SQL by hand. Never add auto-apply or deploy-blocking on schema state.
- **No `ghl`/`HighLevel`** in any new identifier, route, or file. Use generic "CRM"/support terms; key prefix is `vox_live_`.
- **Styling:** theme tokens only (remapped zinc + accent utilities). `bg-white` renders brand orange — never use it. Copy from a neighboring settings page.
- **Read-only:** the connector never mutates support data. The only writes are key management, SLA policy edits, and best-effort `lastUsedAt`/`ApiRequestLog`.
- **Type contract:** `getTicketMetrics`/`getCsatMetrics` must return a `scorecards` object with the exact field names used in Task 9 (`open`, `created`, `closed`, `avgResolutionHours` for tickets; `avgRating`, `responseRate`, `totalRated` for CSAT). Reconcile during Task 6/7 extraction.
