# Personalized Voice Demos at Scale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-provision per-prospect Gemini voice demos (`xovera.io/try/<slug>`) that answer as the prospect's business, fed by knowledge crawled from their website, with a claim → checkout conversion path.

**Architecture:** Lazy provisioning — the prospecting tool registers a cheap `DemoProspect` row via an API-key-guarded `/api/v1` endpoint; the first landing-page visit triggers idempotent provisioning (KnowledgeDomain + IngestionRun + Agent + GeminiVoiceConfig, all inside a single internal demos workspace). The public `/try/[slug]` page polls a status endpoint, then mints browser Gemini Live tokens from a slug-parameterized sibling of the existing `voice-demo/web-token` route with IP/concurrency/cooldown guards tracked in a `DemoTryCall` table. Claiming re-parents the demo assets into a fresh workspace and lands on billing.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (hand-run SQL migrations), Gemini Live via existing `lib/voice/gemini/*`, `lib/ingest` crawl pipeline, Voyage embeddings via `retrieveChunks`, Vitest for `lib/**` helpers.

**Spec:** `docs/superpowers/specs/2026-07-17-voice-demo-prospecting-design.md`

**House rules that bind every task:** never run migrations against the DB (hand-run SQL only — `npx prisma generate` is fine, `prisma migrate dev` is NOT); no "GHL"/"HighLevel" identifiers; theme tokens only (remapped zinc scale + accent tokens — **never `bg-white`**, it renders brand orange); commit + push to main after every task.

**New env vars (set in Vercel before go-live, all have safe defaults except the first):**
- `DEMO_WORKSPACE_ID` — internal demos workspace id (required; feature 503s without it)
- `DEMO_TRY_MAX_SECS` (default 180) — per-call hard cap
- `DEMO_TRY_MAX_CONCURRENT` (default 15) — global simultaneous demo calls
- `DEMO_TRY_IP_COOLDOWN_SECS` (default 120) — min gap between calls from one IP
- `DEMO_PROSPECT_TTL_DAYS` (default 14) — days until an unclaimed demo is reaped

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `DemoProspect` + `DemoTryCall` models |
| `prisma/migrations/manual_demo_prospects.sql` (create) | Hand-run DDL for both tables |
| `lib/demo-prospects/slug.ts` (create) | Slug generation + website-domain normalization (pure) |
| `lib/demo-prospects/slug.test.ts` (create) | Vitest for the above |
| `lib/demo-prospects/templates.ts` (create) | `{{var}}` rendering, vertical presets, landing-path map (pure) |
| `lib/demo-prospects/templates.test.ts` (create) | Vitest for the above |
| `lib/demo-prospects/provision.ts` (create) | `ensureProvisioned()` — idempotent provisioning service |
| `lib/demo-prospects/claim.ts` (create) | `claimProspect()` — workspace creation + asset re-parenting |
| `app/api/v1/demo-prospects/route.ts` (create) | POST register + GET engagement (API-key auth) |
| `app/api/public/try/[slug]/status/route.ts` (create) | Public status poll; triggers provisioning |
| `app/api/public/try/[slug]/web-token/route.ts` (create) | Guarded Gemini token mint per prospect |
| `app/api/public/try/[slug]/call-end/route.ts` (create) | Best-effort call-duration beacon |
| `lib/voice/use-public-voice-call.ts` (modify) | Optional `tokenEndpoint` / `onEnded` options |
| `app/try/[slug]/page.tsx` (create) | Server component: load prospect, render client |
| `app/try/[slug]/TryDemoClient.tsx` (create) | Build-sequence poll, call UI, dual CTA |
| `app/try/[slug]/claim/page.tsx` (create) | Auth-gated claim → redirect to billing |
| `app/api/cron/demo-prospect-reaper/route.ts` (create) | Daily cleanup of expired demos |
| `vercel.json` (modify) | Register the reaper cron |

---

### Task 1: Prisma models + hand-run SQL

**Files:**
- Modify: `prisma/schema.prisma` (append at end of file)
- Create: `prisma/migrations/manual_demo_prospects.sql`

- [ ] **Step 1: Append models to `prisma/schema.prisma`**

Add at the end of the file:

```prisma
// ── Voice-demo prospecting funnel ────────────────────────────────────
// One row per cold-emailed business. Registered cheaply by the outbound
// prospecting tool via /api/v1/demo-prospects; the heavy assets (agent,
// voice config, knowledge domain + crawl) are provisioned lazily on the
// first /try/[slug] visit and live in the internal demos workspace
// (DEMO_WORKSPACE_ID). Claiming re-parents those assets into the
// prospect's real workspace.
model DemoProspect {
  id                 String    @id @default(cuid())
  slug               String    @unique
  businessName       String
  websiteUrl         String
  websiteDomain      String // normalized host, e.g. "acmeplumbing.com"
  contactEmail       String?
  vertical           String? // maps to a landing page + template preset
  templates          Json? // optional per-prospect {prompt,instructions,firstMessage} template overrides
  metadata           Json? // free-form from the prospecting tool; string values become template vars
  status             String    @default("registered") // registered | provisioning | ready | failed | expired | claimed
  agentId            String?
  knowledgeDomainId  String?
  ingestionRunId     String?
  clickedAt          DateTime?
  firstCallAt        DateTime?
  callCount          Int       @default(0)
  totalCallSecs      Int       @default(0)
  claimedByUserId    String?
  claimedWorkspaceId String?
  expiresAt          DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@index([status])
  @@index([websiteDomain])
  @@index([expiresAt])
}

// One row per public demo call. Powers the abuse guards on the /try
// token route (per-IP cooldown + global concurrency) without a session
// table: a call counts as "active" while startedAt is within the demo
// cap and endedAt is null, so stale rows age out of the guard queries
// by time alone — no reaper needed at the call level.
model DemoTryCall {
  id         String    @id @default(cuid())
  prospectId String
  ip         String
  startedAt  DateTime  @default(now())
  endedAt    DateTime?
  secs       Int       @default(0)

  @@index([ip, startedAt])
  @@index([startedAt])
  @@index([prospectId])
}
```

- [ ] **Step 2: Create `prisma/migrations/manual_demo_prospects.sql`**

```sql
-- Voice-demo prospecting funnel (hand-run; matches the DemoProspect +
-- DemoTryCall models in schema.prisma). Run once in production.

CREATE TABLE IF NOT EXISTS "DemoProspect" (
  "id"                 TEXT NOT NULL,
  "slug"               TEXT NOT NULL,
  "businessName"       TEXT NOT NULL,
  "websiteUrl"         TEXT NOT NULL,
  "websiteDomain"      TEXT NOT NULL,
  "contactEmail"       TEXT,
  "vertical"           TEXT,
  "templates"          JSONB,
  "metadata"           JSONB,
  "status"             TEXT NOT NULL DEFAULT 'registered',
  "agentId"            TEXT,
  "knowledgeDomainId"  TEXT,
  "ingestionRunId"     TEXT,
  "clickedAt"          TIMESTAMP(3),
  "firstCallAt"        TIMESTAMP(3),
  "callCount"          INTEGER NOT NULL DEFAULT 0,
  "totalCallSecs"      INTEGER NOT NULL DEFAULT 0,
  "claimedByUserId"    TEXT,
  "claimedWorkspaceId" TEXT,
  "expiresAt"          TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DemoProspect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DemoProspect_slug_key" ON "DemoProspect"("slug");
CREATE INDEX IF NOT EXISTS "DemoProspect_status_idx" ON "DemoProspect"("status");
CREATE INDEX IF NOT EXISTS "DemoProspect_websiteDomain_idx" ON "DemoProspect"("websiteDomain");
CREATE INDEX IF NOT EXISTS "DemoProspect_expiresAt_idx" ON "DemoProspect"("expiresAt");

CREATE TABLE IF NOT EXISTS "DemoTryCall" (
  "id"         TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "ip"         TEXT NOT NULL,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"    TIMESTAMP(3),
  "secs"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DemoTryCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DemoTryCall_ip_startedAt_idx" ON "DemoTryCall"("ip", "startedAt");
CREATE INDEX IF NOT EXISTS "DemoTryCall_startedAt_idx" ON "DemoTryCall"("startedAt");
CREATE INDEX IF NOT EXISTS "DemoTryCall_prospectId_idx" ON "DemoTryCall"("prospectId");
```

- [ ] **Step 3: Regenerate the Prisma client and typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: generate succeeds; tsc exits 0. Do NOT run `prisma migrate dev` — Ryan applies the SQL by hand in production; locally you may apply `manual_demo_prospects.sql` to your local DB with `npx prisma db execute --file prisma/migrations/manual_demo_prospects.sql` if you need live testing.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/manual_demo_prospects.sql
git commit -m "feat(demos): DemoProspect + DemoTryCall models with hand-run SQL"
git push origin main
```

---

### Task 2: Slug + domain helpers (TDD)

**Files:**
- Create: `lib/demo-prospects/slug.ts`
- Test: `lib/demo-prospects/slug.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { generateProspectSlug, normalizeWebsiteDomain } from './slug'

describe('normalizeWebsiteDomain', () => {
  it('strips protocol, www, path, query, and lowercases', () => {
    expect(normalizeWebsiteDomain('https://www.AcmePlumbing.com/about?x=1')).toBe('acmeplumbing.com')
  })
  it('handles bare domains without protocol', () => {
    expect(normalizeWebsiteDomain('acmeplumbing.com')).toBe('acmeplumbing.com')
  })
  it('keeps non-www subdomains', () => {
    expect(normalizeWebsiteDomain('https://shop.acme.co.uk/x')).toBe('shop.acme.co.uk')
  })
  it('throws on garbage', () => {
    expect(() => normalizeWebsiteDomain('not a url at all !!')).toThrow()
  })
})

describe('generateProspectSlug', () => {
  it('slugifies the business name and appends a random suffix', () => {
    const slug = generateProspectSlug("Joe's Plumbing & Heating")
    expect(slug).toMatch(/^joe-s-plumbing-heating-[a-f0-9]{8}$/)
  })
  it('truncates very long names to keep slugs manageable', () => {
    const slug = generateProspectSlug('A'.repeat(200))
    // 40-char base + hyphen + 8-char suffix
    expect(slug.length).toBeLessThanOrEqual(49)
  })
  it('produces distinct slugs for the same name', () => {
    expect(generateProspectSlug('Acme')).not.toBe(generateProspectSlug('Acme'))
  })
  it('falls back to "demo" for names with no usable characters', () => {
    expect(generateProspectSlug('!!!')).toMatch(/^demo-[a-f0-9]{8}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/demo-prospects/slug.test.ts`
Expected: FAIL — cannot resolve `./slug`.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Slug + domain helpers for the voice-demo prospecting funnel.
 * Pure functions — vitest-covered per the repo's lib-only test scope.
 */
import { randomBytes } from 'crypto'

/**
 * Normalize any website URL/host the prospecting tool sends into a bare
 * lowercase host ("acmeplumbing.com") used for idempotency — one live
 * demo per business domain. Strips protocol, "www.", path, and query.
 * Throws on unparseable input (the API surfaces this as a 400).
 */
export function normalizeWebsiteDomain(input: string): string {
  const trimmed = (input || '').trim()
  if (!trimmed) throw new Error('websiteUrl required')
  const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!host.includes('.')) throw new Error('websiteUrl must include a domain')
  return host
}

/**
 * "Joe's Plumbing & Heating" → "joe-s-plumbing-heating-4f8a2c1d".
 * The 8-hex-char random suffix makes slugs unguessable/unenumerable —
 * the slug IS the credential for the public demo surfaces.
 */
export function generateProspectSlug(businessName: string): string {
  const base =
    (businessName || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .replace(/-$/, '') || 'demo'
  return `${base}-${randomBytes(4).toString('hex')}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/demo-prospects/slug.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/demo-prospects/slug.ts lib/demo-prospects/slug.test.ts
git commit -m "feat(demos): slug generation + website-domain normalization helpers"
git push origin main
```

---

### Task 3: Dynamic agent templating (TDD)

**Files:**
- Create: `lib/demo-prospects/templates.ts`
- Test: `lib/demo-prospects/templates.test.ts`

This is the core mechanic Ryan asked for: prompt/instructions/greeting are templates; `{{businessName}}` etc. are dynamic per prospect; the prospecting tool can override per campaign; vertical presets sit in between.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  resolveTemplates,
  landingPathForVertical,
  buildTemplateVars,
} from './templates'

describe('renderTemplate', () => {
  it('substitutes {{vars}}', () => {
    expect(renderTemplate('Hi {{businessName}}!', { businessName: 'Acme' })).toBe('Hi Acme!')
  })
  it('renders unknown vars as empty string', () => {
    expect(renderTemplate('A{{nope}}B', {})).toBe('AB')
  })
  it('tolerates whitespace inside braces', () => {
    expect(renderTemplate('{{ businessName }}', { businessName: 'Acme' })).toBe('Acme')
  })
})

describe('buildTemplateVars', () => {
  it('merges base fields with string metadata values', () => {
    const vars = buildTemplateVars(
      { businessName: 'Acme', websiteDomain: 'acme.com', vertical: 'gym' },
      { ownerFirstName: 'Sam', ignored: 42 },
    )
    expect(vars).toEqual({
      businessName: 'Acme',
      websiteDomain: 'acme.com',
      vertical: 'gym',
      ownerFirstName: 'Sam',
    })
  })
  it('metadata cannot shadow base fields', () => {
    const vars = buildTemplateVars(
      { businessName: 'Acme', websiteDomain: 'acme.com', vertical: null },
      { businessName: 'Evil Corp' },
    )
    expect(vars.businessName).toBe('Acme')
  })
})

describe('resolveTemplates', () => {
  const vars = { businessName: 'Shred Gym', websiteDomain: 'shred.fit', vertical: 'gym' }

  it('uses the global default when no vertical/overrides', () => {
    const t = resolveTemplates({ vertical: null, overrides: null, vars: { ...vars, vertical: '' } })
    expect(t.prompt).toContain('Shred Gym')
    expect(t.firstMessage).toContain('Shred Gym')
  })
  it('applies a vertical preset when one exists', () => {
    const t = resolveTemplates({ vertical: 'gym', overrides: null, vars })
    expect(t.prompt).toContain('membership')
  })
  it('unknown vertical falls back to the default template', () => {
    const t = resolveTemplates({ vertical: 'submarine-dealer', overrides: null, vars })
    expect(t.prompt).toContain('Shred Gym')
  })
  it('per-prospect overrides beat everything and still render vars', () => {
    const t = resolveTemplates({
      vertical: 'gym',
      overrides: { prompt: 'Custom for {{businessName}}', firstMessage: 'Yo {{businessName}}' },
      vars,
    })
    expect(t.prompt).toBe('Custom for Shred Gym')
    expect(t.firstMessage).toBe('Yo Shred Gym')
  })
})

describe('landingPathForVertical', () => {
  it('maps known verticals', () => {
    expect(landingPathForVertical('med-spa')).toBe('/ai-for-med-spas')
    expect(landingPathForVertical('gym')).toBe('/ai-for-gyms')
  })
  it('falls back to /ai-receptionist', () => {
    expect(landingPathForVertical('unknown')).toBe('/ai-receptionist')
    expect(landingPathForVertical(null)).toBe('/ai-receptionist')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/demo-prospects/templates.test.ts`
Expected: FAIL — cannot resolve `./templates`.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Dynamic agent templating for prospect demos — THE core mechanic:
 * the demo agent's prompt/instructions/greeting are templates with
 * per-prospect variables, resolved at provision time so the voice
 * runtime just sees a normal agent.
 *
 * Resolution order per field:
 *   1. per-prospect override (POST body / DemoProspect.templates)
 *   2. vertical preset (VERTICAL_PRESETS)
 *   3. global default
 *
 * Pure functions — no db, no next. Vitest-covered.
 */

export interface DemoTemplateSet {
  prompt: string
  instructions: string | null
  firstMessage: string
}

export type TemplateVars = Record<string, string>

/** `{{ key }}` → vars[key]; unknown keys render as ''. */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}

/**
 * Base fields + string values from the prospecting tool's metadata
 * (so campaigns can use {{ownerFirstName}}, {{city}}, …). Base fields
 * win on collision — metadata can't rewrite the business name.
 */
export function buildTemplateVars(
  base: { businessName: string; websiteDomain: string; vertical: string | null },
  metadata: Record<string, unknown> | null | undefined,
): TemplateVars {
  const vars: TemplateVars = {}
  for (const [k, v] of Object.entries(metadata ?? {})) {
    if (typeof v === 'string') vars[k] = v
  }
  vars.businessName = base.businessName
  vars.websiteDomain = base.websiteDomain
  vars.vertical = base.vertical ?? ''
  return vars
}

const DEFAULT_PROMPT = `You are the AI receptionist for {{businessName}}. Answer every call the way a warm, capable front-desk person at {{businessName}} would: greet the caller, answer questions about the business, its services, opening hours, location, and pricing, and offer to take a message with the caller's name and number whenever something needs a human.

Ground everything you say about {{businessName}} in the knowledge provided. If you don't know something, say so honestly and offer to take a message — never invent details, prices, or availability. This is a live demonstration, so keep answers snappy and let the caller drive.`

const DEFAULT_FIRST_MESSAGE = `Thanks for calling {{businessName}}! How can I help you today?`

/** Tuned personas per outbound vertical. Partial — unset fields fall back to the defaults above. */
export const VERTICAL_PRESETS: Record<string, Partial<DemoTemplateSet>> = {
  'med-spa': {
    prompt: `You are the AI receptionist for {{businessName}}, a med spa. Answer calls the way a polished, reassuring front-desk coordinator would: help callers with questions about treatments, practitioners, pricing, and availability, and offer to take their name and number to arrange a consultation when they're ready.

Ground everything in the knowledge provided about {{businessName}}. Never give medical advice, never invent treatment outcomes or prices — if you don't know, say so and offer to have the team follow up.`,
  },
  gym: {
    prompt: `You are the AI receptionist for {{businessName}}, a gym. Answer calls with friendly energy: help callers with membership options, class schedules, opening hours, and trial passes, and offer to take their name and number so the team can get them started.

Ground everything in the knowledge provided about {{businessName}}. If you don't know a price or schedule detail, say so honestly and offer to take a message — never make one up.`,
  },
}

/** Vertical → existing marketing landing page for the "Learn more" CTA. */
export const VERTICAL_LANDING_PATHS: Record<string, string> = {
  'med-spa': '/ai-for-med-spas',
  gym: '/ai-for-gyms',
  'customer-service': '/ai-customer-service',
  sdr: '/ai-sdr',
  receptionist: '/ai-receptionist',
}

export function landingPathForVertical(vertical: string | null | undefined): string {
  return (vertical && VERTICAL_LANDING_PATHS[vertical]) || '/ai-receptionist'
}

/** Resolve override → preset → default per field, then render vars. */
export function resolveTemplates(input: {
  vertical: string | null | undefined
  overrides: Partial<DemoTemplateSet> | null | undefined
  vars: TemplateVars
}): DemoTemplateSet {
  const preset = (input.vertical && VERTICAL_PRESETS[input.vertical]) || {}
  const o = input.overrides ?? {}
  const promptTpl = o.prompt ?? preset.prompt ?? DEFAULT_PROMPT
  const instructionsTpl = o.instructions ?? preset.instructions ?? null
  const firstMessageTpl = o.firstMessage ?? preset.firstMessage ?? DEFAULT_FIRST_MESSAGE
  return {
    prompt: renderTemplate(promptTpl, input.vars),
    instructions: instructionsTpl ? renderTemplate(instructionsTpl, input.vars) : null,
    firstMessage: renderTemplate(firstMessageTpl, input.vars),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/demo-prospects/templates.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/demo-prospects/templates.ts lib/demo-prospects/templates.test.ts
git commit -m "feat(demos): dynamic agent templating — vars, vertical presets, landing-path map"
git push origin main
```

---

### Task 4: Provisioning service

**Files:**
- Create: `lib/demo-prospects/provision.ts`

DB-touching service — no vitest (repo convention: routes/prisma code verified live, not unit-tested).

- [ ] **Step 1: Write `lib/demo-prospects/provision.ts`**

```typescript
/**
 * Lazy provisioning for prospect voice demos. Called from the public
 * status endpoint on the first /try/[slug] visit — NOT at registration
 * time, so the ~97% of cold-emailed prospects who never click cost one
 * DB row and nothing else.
 *
 * Idempotent + re-entrant: each asset creation is guarded by its
 * nullable FK on the DemoProspect row, and the registered→provisioning
 * transition is a compare-and-swap so concurrent pollers don't
 * double-provision. A crash mid-way is healed by the next poll (the
 * remaining null fields get filled in).
 *
 * The crawl itself is asynchronous — the every-minute ingest-queue cron
 * picks up the queued IngestionRun. Readiness is agent-existence, not
 * crawl-completion: greeting + business name carry the demo even with
 * zero chunks landed.
 */
import { db } from '@/lib/db'
import { detectUrl } from '@/lib/ingest/detect'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'
import { buildTemplateVars, resolveTemplates, type DemoTemplateSet } from './templates'

const TTL_DAYS = Number(process.env.DEMO_PROSPECT_TTL_DAYS) || 14
const DEMO_TRY_MAX_SECS = Number(process.env.DEMO_TRY_MAX_SECS) || 180

export function demoWorkspaceId(): string | null {
  return process.env.DEMO_WORKSPACE_ID || null
}

type Prospect = NonNullable<Awaited<ReturnType<typeof db.demoProspect.findUnique>>>

/**
 * Ensure the prospect's demo assets exist. Returns the (possibly
 * updated) prospect row, or null if the slug doesn't exist / the
 * feature isn't configured.
 */
export async function ensureProvisioned(slug: string): Promise<Prospect | null> {
  const workspaceId = demoWorkspaceId()
  if (!workspaceId) return null

  let prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return null

  // Terminal / already-done states: nothing to do.
  if (!['registered', 'provisioning'].includes(prospect.status)) return prospect

  // CAS: registered → provisioning (stamps the click). Losing the race
  // is fine — fall through and run the idempotent steps anyway; each is
  // guarded by its own null-field check.
  if (prospect.status === 'registered') {
    await db.demoProspect.updateMany({
      where: { id: prospect.id, status: 'registered' },
      data: { status: 'provisioning', clickedAt: prospect.clickedAt ?? new Date() },
    })
    prospect = (await db.demoProspect.findUnique({ where: { slug } }))!
  }

  try {
    // 1. Knowledge domain (per-prospect isolation for retrieval scoping)
    let knowledgeDomainId = prospect.knowledgeDomainId
    if (!knowledgeDomainId) {
      const domain = await db.knowledgeDomain.create({
        data: {
          workspaceId,
          name: `Demo: ${prospect.businessName} (${prospect.slug})`,
          description: `Auto-crawled from ${prospect.websiteUrl} for the prospect voice demo.`,
        },
        select: { id: true },
      })
      knowledgeDomainId = domain.id
      await db.demoProspect.update({ where: { id: prospect.id }, data: { knowledgeDomainId } })
    }

    // 2. Crawl source + queued run (the ingest-queue cron does the work)
    let ingestionRunId = prospect.ingestionRunId
    if (!ingestionRunId) {
      const detection = await detectUrl(prospect.websiteUrl)
      const source = await db.knowledgeSource.create({
        data: {
          knowledgeDomainId,
          sourceType: detection.sourceType,
          urlOrIdentifier: prospect.websiteUrl,
          crawlConfig: detection.crawlConfig as object,
          isActive: true,
        },
        select: { id: true },
      })
      const run = await db.ingestionRun.create({
        data: { sourceId: source.id, status: 'queued' },
        select: { id: true },
      })
      ingestionRunId = run.id
      await db.demoProspect.update({ where: { id: prospect.id }, data: { ingestionRunId } })
    }

    // 3. Agent + voice config from resolved templates
    if (!prospect.agentId) {
      const vars = buildTemplateVars(
        {
          businessName: prospect.businessName,
          websiteDomain: prospect.websiteDomain,
          vertical: prospect.vertical,
        },
        (prospect.metadata ?? null) as Record<string, unknown> | null,
      )
      const templates = resolveTemplates({
        vertical: prospect.vertical,
        overrides: (prospect.templates ?? null) as Partial<DemoTemplateSet> | null,
        vars,
      })

      const location = await ensureDemoLocation(workspaceId)
      const agent = await db.agent.create({
        data: {
          workspaceId,
          locationId: location.id,
          name: `Demo — ${prospect.businessName}`,
          systemPrompt: templates.prompt,
          instructions: templates.instructions,
          enabledTools: [],
          agentType: 'SIMPLE',
          agentKind: 'reactive',
          voiceRuntime: 'gemini',
          knowledgeScopeAll: false,
          knowledgeDomainIds: [knowledgeDomainId],
        },
        select: { id: true },
      })

      // CAS the agentId on — if another racer beat us, roll back ours.
      const won = await db.demoProspect.updateMany({
        where: { id: prospect.id, agentId: null },
        data: { agentId: agent.id },
      })
      if (won.count === 0) {
        await db.agent.delete({ where: { id: agent.id } }).catch(() => {})
      } else {
        await db.geminiVoiceConfig.create({
          data: {
            agentId: agent.id,
            isActive: true,
            model: geminiVoiceModel(),
            firstMessage: templates.firstMessage,
            maxDurationSecs: DEMO_TRY_MAX_SECS,
            recordCalls: false,
          },
        })
      }
    }

    // 4. Finalize: ready + TTL clock starts now
    await db.demoProspect.updateMany({
      where: { id: prospect.id, status: 'provisioning' },
      data: {
        status: 'ready',
        expiresAt: new Date(Date.now() + TTL_DAYS * 86400_000),
      },
    })
    return db.demoProspect.findUnique({ where: { slug } })
  } catch (err) {
    console.error(`[demo-prospects] provisioning failed for ${slug}:`, err)
    // Only the agent is load-bearing — if it exists, stay provisioning
    // so the next poll retries the rest; otherwise mark failed.
    const fresh = await db.demoProspect.findUnique({ where: { slug } })
    if (fresh && !fresh.agentId) {
      await db.demoProspect.updateMany({
        where: { id: prospect.id, status: 'provisioning' },
        data: { status: 'failed' },
      })
    }
    return db.demoProspect.findUnique({ where: { slug } })
  }
}

/**
 * Agent.locationId is a required FK — mirror the wizard's placeholder
 * pattern inside the demos workspace.
 */
async function ensureDemoLocation(workspaceId: string): Promise<{ id: string }> {
  const existing = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
    orderBy: { installedAt: 'desc' },
  })
  if (existing) return existing
  const placeholderId = `placeholder:${workspaceId}`
  return db.location.upsert({
    where: { id: placeholderId },
    create: {
      id: placeholderId,
      workspaceId,
      companyId: '', userId: '', userType: '', scope: '',
      accessToken: '', refreshToken: '', refreshTokenId: '',
      expiresAt: new Date(0),
      crmProvider: 'none',
    },
    update: {},
    select: { id: true },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If `voiceRuntime`, `knowledgeScopeAll`, or `recordCalls` error, check the exact field names in `prisma/schema.prisma` (models `Agent` ~line 570 and `GeminiVoiceConfig` ~line 1890) and adjust — the field must exist; do not cast to `any`.

- [ ] **Step 3: Commit**

```bash
git add lib/demo-prospects/provision.ts
git commit -m "feat(demos): idempotent lazy provisioning service (domain + crawl + agent + voice config)"
git push origin main
```

---

### Task 5: Provisioning API for the prospecting tool

**Files:**
- Create: `app/api/v1/demo-prospects/route.ts`

- [ ] **Step 1: Write the route**

```typescript
/**
 * /api/v1/demo-prospects — the outbound prospecting tool's surface.
 *
 * POST registers a prospect (cheap row; NO crawl/agent — provisioning
 * is lazy, on first landing-page visit). Idempotent per website domain.
 * GET returns engagement signals so the tool can prioritize follow-up.
 *
 * Auth: Bearer ApiKey (lib/api-auth). Accepted keys: org-scope, or a
 * workspace-scope key belonging to the internal demos workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError, type KeyContext } from '@/lib/api-auth'
import { errorResponse, ok, parseLimit } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { generateProspectSlug, normalizeWebsiteDomain } from '@/lib/demo-prospects/slug'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'

function requireDemoKey(key: KeyContext): void {
  const ws = demoWorkspaceId()
  if (!ws) throw new AuthError(503, 'not_configured', 'Demo provisioning is not configured')
  if (key.scope !== 'org' && key.workspaceId !== ws) {
    throw new AuthError(403, 'forbidden', 'Key is not authorized for demo provisioning')
  }
}

function publicBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/$/, '')
}

export const POST = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    requireDemoKey(key)

    const body = (await req.json().catch(() => ({}))) as {
      businessName?: string
      websiteUrl?: string
      contactEmail?: string
      vertical?: string
      templates?: { prompt?: string; instructions?: string; firstMessage?: string }
      metadata?: Record<string, unknown>
    }
    const businessName = (body.businessName || '').trim().slice(0, 120)
    const websiteUrl = (body.websiteUrl || '').trim()
    if (!businessName) throw new AuthError(422, 'bad_param', 'businessName required')

    let websiteDomain: string
    try {
      websiteDomain = normalizeWebsiteDomain(websiteUrl)
    } catch {
      throw new AuthError(422, 'bad_param', 'websiteUrl must be a valid URL or domain')
    }

    // Idempotent per domain: one live demo per business at a time.
    const existing = await db.demoProspect.findFirst({
      where: { websiteDomain, status: { notIn: ['expired', 'claimed'] } },
      select: { slug: true },
    })
    if (existing) {
      return ok(
        { slug: existing.slug, url: `${publicBaseUrl()}/try/${existing.slug}`, existing: true },
        { apiKeyId: key.apiKeyId },
      )
    }

    const slug = generateProspectSlug(businessName)
    await db.demoProspect.create({
      data: {
        slug,
        businessName,
        websiteUrl: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
        websiteDomain,
        contactEmail: body.contactEmail?.trim().slice(0, 320) || null,
        vertical: body.vertical?.trim().slice(0, 60) || null,
        templates: body.templates && typeof body.templates === 'object' ? body.templates : undefined,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
      },
    })
    return ok({ slug, url: `${publicBaseUrl()}/try/${slug}`, existing: false }, { apiKeyId: key.apiKeyId })
  } catch (err) {
    return errorResponse(err)
  }
})

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    requireDemoKey(key)

    const url = new URL(req.url)
    const since = url.searchParams.get('since')
    const status = url.searchParams.get('status')
    const rows = await db.demoProspect.findMany({
      where: {
        ...(since ? { updatedAt: { gte: new Date(since) } } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: parseLimit(url, 100, 500),
      select: {
        slug: true, businessName: true, websiteDomain: true, vertical: true,
        status: true, clickedAt: true, firstCallAt: true, callCount: true,
        totalCallSecs: true, createdAt: true, updatedAt: true,
      },
    })
    return ok(rows, { apiKeyId: key.apiKeyId, count: rows.length })
  } catch (err) {
    return errorResponse(err)
  }
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If `withApiLog` or `ok`'s meta signature mismatches, read `lib/api-log.ts` and `lib/api-scope.ts` and match their real shapes (both exist — used by `app/api/v1/tickets/route.ts`).

- [ ] **Step 3: Smoke-test locally (needs local DB with Task 1 SQL applied)**

```bash
# Create an org-scope key directly in the local DB first (or reuse one),
# then:
curl -s -X POST localhost:3000/api/v1/demo-prospects \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"businessName":"Acme Plumbing","websiteUrl":"acmeplumbing.com","vertical":"receptionist"}'
```
Expected: `{"data":{"slug":"acme-plumbing-…","url":"http…/try/acme-plumbing-…","existing":false},…}`. Re-run the same body → `existing: true` with the same slug.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/demo-prospects/route.ts
git commit -m "feat(demos): /api/v1/demo-prospects register + engagement API"
git push origin main
```

---

### Task 6: Public status + call-end routes

**Files:**
- Create: `app/api/public/try/[slug]/status/route.ts`
- Create: `app/api/public/try/[slug]/call-end/route.ts`

- [ ] **Step 1: Write the status route**

```typescript
/**
 * GET /api/public/try/[slug]/status — landing-page poll target.
 * The FIRST poll is what triggers lazy provisioning (ensureProvisioned
 * is idempotent, so refreshes and concurrent tabs are safe). Also
 * reports crawl progress so the "building your AI" sequence is honest.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureProvisioned } from '@/lib/demo-prospects/provision'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const prospect = await ensureProvisioned(slug)
  if (!prospect) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let ingestion: { status: string; chunksCreated: number } | null = null
  if (prospect.ingestionRunId) {
    const run = await db.ingestionRun.findUnique({
      where: { id: prospect.ingestionRunId },
      select: { status: true, chunksCreated: true },
    })
    if (run) ingestion = { status: run.status, chunksCreated: run.chunksCreated }
  }

  return NextResponse.json({
    status: prospect.status,
    businessName: prospect.businessName,
    ingestion,
  })
}
```

- [ ] **Step 2: Write the call-end route**

```typescript
/**
 * POST /api/public/try/[slug]/call-end — best-effort duration beacon
 * from the browser when a demo call ends. Server-side truth for
 * callCount is the token mint; this only enriches totalCallSecs and
 * frees the call's concurrency slot early.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = (await req.json().catch(() => ({}))) as { callId?: string; secs?: number }
  const callId = typeof body.callId === 'string' ? body.callId : ''
  const secs = Math.max(0, Math.min(3600, Math.floor(Number(body.secs) || 0)))
  if (!callId) return NextResponse.json({ ok: false }, { status: 400 })

  const prospect = await db.demoProspect.findUnique({ where: { slug }, select: { id: true } })
  if (!prospect) return NextResponse.json({ ok: false }, { status: 404 })

  // Only close a call once, and only one belonging to this prospect.
  const updated = await db.demoTryCall.updateMany({
    where: { id: callId, prospectId: prospect.id, endedAt: null },
    data: { endedAt: new Date(), secs },
  })
  if (updated.count > 0 && secs > 0) {
    await db.demoProspect.update({
      where: { id: prospect.id },
      data: { totalCallSecs: { increment: secs } },
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: exit 0.

```bash
git add "app/api/public/try/[slug]/status/route.ts" "app/api/public/try/[slug]/call-end/route.ts"
git commit -m "feat(demos): public status (lazy-provision trigger) + call-end beacon routes"
git push origin main
```

---

### Task 7: Guarded per-prospect web-token route

**Files:**
- Create: `app/api/public/try/[slug]/web-token/route.ts`

Adapted from `app/api/public/voice-demo/web-token/route.ts` (single fixed agent) — parameterized by slug, plus the guards that route lacks: per-IP cooldown and global concurrency, tracked in `DemoTryCall`. The per-session hard cap baked into the minted token remains the authoritative cost backstop (same as the existing demo), so no call-level cron is needed.

- [ ] **Step 1: Write the route**

```typescript
/**
 * POST /api/public/try/[slug]/web-token — mint an ephemeral Gemini Live
 * token for a prospect's personalized voice demo. Parameterized sibling
 * of /api/public/voice-demo/web-token with cold-email-scale guards:
 *   - per-IP: one call per DEMO_TRY_IP_COOLDOWN_SECS (default 120)
 *   - global: DEMO_TRY_MAX_CONCURRENT active calls (default 15)
 *   - per-browser cookie cooldown (soft)
 *   - hard per-session cap DEMO_TRY_MAX_SECS baked into the token (the
 *     real cost guard — a call cannot outlive it)
 * Injects retrieval from the prospect's own crawled knowledge domain as
 * ragContext. Tools stripped; nothing writes or self-trains.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
import { mintGeminiVoiceToken, GeminiVoiceNotConfiguredError, GeminiVoiceTokenMintError } from '@/lib/voice/gemini/mint'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'
import { retrieveChunks } from '@/lib/ingest/retrieve'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'

const MAX_SECS = Number(process.env.DEMO_TRY_MAX_SECS) || 180
const MAX_CONCURRENT = Number(process.env.DEMO_TRY_MAX_CONCURRENT) || 15
const IP_COOLDOWN_SECS = Number(process.env.DEMO_TRY_IP_COOLDOWN_SECS) || 120
const COOLDOWN_COOKIE = 'xv_try_demo'

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

const UNAVAILABLE = { error: 'This demo isn’t available right now.', code: 'UNAVAILABLE' }

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const workspaceId = demoWorkspaceId()
  if (!workspaceId) return NextResponse.json(UNAVAILABLE, { status: 503 })

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect || prospect.status !== 'ready' || !prospect.agentId) {
    return NextResponse.json(UNAVAILABLE, { status: 503 })
  }
  if (prospect.expiresAt && prospect.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This demo has expired.', code: 'EXPIRED' }, { status: 410 })
  }

  // ── Guards ─────────────────────────────────────────────────────────
  if (req.cookies.get(COOLDOWN_COOKIE)) {
    return NextResponse.json(
      { error: 'You just tried a call — give it a minute and try again.', code: 'COOLDOWN' },
      { status: 429 },
    )
  }
  const ip = clientIp(req)
  const now = Date.now()
  const [ipRecent, activeCalls] = await Promise.all([
    db.demoTryCall.count({
      where: { ip, startedAt: { gt: new Date(now - IP_COOLDOWN_SECS * 1000) } },
    }),
    db.demoTryCall.count({
      where: { startedAt: { gt: new Date(now - MAX_SECS * 1000) }, endedAt: null },
    }),
  ])
  if (ipRecent > 0) {
    return NextResponse.json(
      { error: 'You just tried a call — give it a minute and try again.', code: 'IP_COOLDOWN' },
      { status: 429 },
    )
  }
  if (activeCalls >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: 'The demo line is busy right now — try again in a couple of minutes.', code: 'BUSY' },
      { status: 429 },
    )
  }

  // ── Agent + knowledge ──────────────────────────────────────────────
  const agent = await db.agent.findFirst({
    where: { id: prospect.agentId, workspaceId },
    select: { id: true, name: true, systemPrompt: true, instructions: true, locationId: true, workspaceId: true },
  })
  if (!agent) return NextResponse.json(UNAVAILABLE, { status: 503 })
  const config = await db.geminiVoiceConfig.findUnique({ where: { agentId: agent.id } })

  let ragContext = ''
  if (prospect.knowledgeDomainId) {
    const chunks = await retrieveChunks(
      workspaceId,
      `about ${prospect.businessName}: services, opening hours, location, pricing, contact`,
      { knowledgeDomainIds: [prospect.knowledgeDomainId], scopeToDomains: true, limit: 8 },
    )
    ragContext = chunks.map(c => c.content).join('\n\n')
  }

  const session = buildGeminiVoiceSession(
    {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      instructions: agent.instructions,
      enabledTools: [], // demo: conversational only
      locationId: agent.locationId,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
    },
    {
      voiceName: config?.voiceName ?? null,
      model: config?.model || geminiVoiceModel(),
      firstMessage: config?.firstMessage ?? null,
      endCallMessage: config?.endCallMessage ?? null,
      language: config?.language ?? null,
      maxDurationSecs: Math.min(config?.maxDurationSecs ?? MAX_SECS, MAX_SECS),
    },
    { ragContext },
  )

  try {
    const minted = await mintGeminiVoiceToken(session)

    // Record the call (server-side truth for callCount) and free the slot
    // via call-end / the time-window ageing in the guard queries.
    const call = await db.demoTryCall.create({
      data: { prospectId: prospect.id, ip },
      select: { id: true },
    })
    await db.demoProspect.update({
      where: { id: prospect.id },
      data: { callCount: { increment: 1 }, firstCallAt: prospect.firstCallAt ?? new Date() },
    }).catch(() => {})

    const res = NextResponse.json({
      callId: call.id,
      connection: {
        token: minted.token,
        vendorModelId: minted.vendorModelId,
        provider: 'gemini-live' as const,
        maxSessionSecs: minted.maxSessionSecs,
        frameFpsCap: 0,
      },
      tools: [],
      vendorConfig: session.liveConfig,
      maxSessionSecs: minted.maxSessionSecs,
    })
    res.cookies.set(COOLDOWN_COOKIE, '1', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
      maxAge: IP_COOLDOWN_SECS,
    })
    return res
  } catch (err) {
    if (err instanceof GeminiVoiceNotConfiguredError) {
      return NextResponse.json(UNAVAILABLE, { status: 503 })
    }
    if (err instanceof GeminiVoiceTokenMintError) {
      return NextResponse.json(
        { error: 'Couldn’t start the voice session — try again in a moment.', code: 'MINT_FAILED' },
        { status: 502 },
      )
    }
    throw err
  }
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: exit 0.

```bash
git add "app/api/public/try/[slug]/web-token/route.ts"
git commit -m "feat(demos): per-prospect Gemini web-token route with IP/concurrency/cooldown guards"
git push origin main
```

---

### Task 8: Parameterize the voice-call hook

**Files:**
- Modify: `lib/voice/use-public-voice-call.ts`

The hook hardcodes `fetch('/api/public/voice-demo/web-token')`. Add an options object — existing callers (`components/landing/VoiceWebCall.tsx` calls it with no args) stay working unchanged.

- [ ] **Step 1: Modify the hook**

Change the signature and the two touchpoints (keep everything else byte-identical):

```typescript
export interface PublicVoiceCallOptions {
  /** Token mint endpoint. Default: the fixed homepage demo agent. */
  tokenEndpoint?: string
  /** Fired once per call on teardown with how long it ran. */
  onEnded?: (info: { secsUsed: number; callId: string | null }) => void
}

export function usePublicVoiceCall(options: PublicVoiceCallOptions = {}) {
```

Inside the hook add refs after the existing ones:

```typescript
  const callIdRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const onEndedRef = useRef(options.onEnded)
  onEndedRef.current = options.onEnded
```

In `endCall`, before `setState(next)` add:

```typescript
    if (startedAtRef.current !== null) {
      const secsUsed = Math.round((Date.now() - startedAtRef.current) / 1000)
      startedAtRef.current = null
      onEndedRef.current?.({ secsUsed, callId: callIdRef.current })
      callIdRef.current = null
    }
```

In `startCall`, replace the fetch line:

```typescript
      const res = await fetch(options.tokenEndpoint ?? '/api/public/voice-demo/web-token', { method: 'POST' })
```

and after the destructure `const { connection, tools, vendorConfig, maxSessionSecs } = data` add:

```typescript
      callIdRef.current = typeof data.callId === 'string' ? data.callId : null
      startedAtRef.current = Date.now()
```

Also add `options.tokenEndpoint` to `startCall`'s dependency array: `}, [endCall, options.tokenEndpoint])`.

- [ ] **Step 2: Typecheck + verify the existing landing demo still compiles**

Run: `npx tsc --noEmit`
Expected: exit 0 (VoiceWebCall's zero-arg call is compatible with the defaulted options param).

- [ ] **Step 3: Commit**

```bash
git add lib/voice/use-public-voice-call.ts
git commit -m "feat(demos): usePublicVoiceCall accepts tokenEndpoint + onEnded options"
git push origin main
```

---

### Task 9: `/try/[slug]` landing page + client

**Files:**
- Create: `app/try/[slug]/page.tsx`
- Create: `app/try/[slug]/TryDemoClient.tsx`

Styling rules: remapped zinc tokens + accent utilities only (`bg-zinc-900` card surface, `text-zinc-100` primary text, `border-zinc-800`, `bg-accent-primary-bg` etc.). **Never `bg-white`** (renders brand orange). Before finalizing markup, skim the `@theme` block in `app/globals.css` and copy button/card classes from a neighboring public page (`app/c/[slug]/HostedCallClient.tsx` is the closest sibling).

- [ ] **Step 1: Write the server component `app/try/[slug]/page.tsx`**

```tsx
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { landingPathForVertical } from '@/lib/demo-prospects/templates'
import TryDemoClient from './TryDemoClient'

type Params = { params: Promise<{ slug: string }> }

// Cold-email demo pages must never be indexed.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const p = await db.demoProspect.findUnique({
    where: { slug },
    select: { businessName: true },
  }).catch(() => null)
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: `${p.businessName} — AI receptionist demo`,
    description: `Hear the AI receptionist Xovera built for ${p.businessName}.`,
    robots: { index: false, follow: false },
  }
}

export default async function TryDemoPage({ params }: Params) {
  const { slug } = await params
  const prospect = await db.demoProspect.findUnique({
    where: { slug },
    select: { slug: true, businessName: true, websiteDomain: true, vertical: true, status: true },
  }).catch(() => null)
  if (!prospect) notFound()

  return (
    <TryDemoClient
      slug={prospect.slug}
      businessName={prospect.businessName}
      websiteDomain={prospect.websiteDomain}
      initialStatus={prospect.status}
      learnMoreHref={`${landingPathForVertical(prospect.vertical)}?demo=${prospect.slug}`}
    />
  )
}
```

- [ ] **Step 2: Write the client component `app/try/[slug]/TryDemoClient.tsx`**

```tsx
'use client'

/**
 * The prospect-facing demo page. Three phases:
 *  1. building — poll /status every 2.5s; the first poll triggers lazy
 *     provisioning server-side. Honest staged copy driven by real
 *     ingestion progress.
 *  2. ready — big call button (mic → Gemini Live) + countdown.
 *  3. done/expired — dual CTA: claim → checkout, or vertical learn-more.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePublicVoiceCall } from '@/lib/voice/use-public-voice-call'

type Phase = 'building' | 'ready' | 'failed' | 'gone'

const POLL_MS = 2500
const MAX_POLL_MS = 3 * 60_000 // stop polling after 3 minutes and show failed state

export default function TryDemoClient({
  slug, businessName, websiteDomain, initialStatus, learnMoreHref,
}: {
  slug: string
  businessName: string
  websiteDomain: string
  initialStatus: string
  learnMoreHref: string
}) {
  const [phase, setPhase] = useState<Phase>(
    initialStatus === 'ready' ? 'ready'
    : initialStatus === 'failed' ? 'failed'
    : ['expired', 'claimed'].includes(initialStatus) ? 'gone'
    : 'building',
  )
  const [buildStep, setBuildStep] = useState(0)
  const [hasCalled, setHasCalled] = useState(false)
  const pollStartRef = useRef(Date.now())

  const { state, error, secondsLeft, startCall, endCall, reset } = usePublicVoiceCall({
    tokenEndpoint: `/api/public/try/${slug}/web-token`,
    onEnded: ({ secsUsed, callId }) => {
      setHasCalled(true)
      if (callId) {
        // Best-effort beacon; sendBeacon survives tab close.
        const payload = JSON.stringify({ callId, secs: secsUsed })
        if (!navigator.sendBeacon?.(`/api/public/try/${slug}/call-end`, new Blob([payload], { type: 'application/json' }))) {
          void fetch(`/api/public/try/${slug}/call-end`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true,
          }).catch(() => {})
        }
      }
    },
  })

  // Status polling while building.
  useEffect(() => {
    if (phase !== 'building') return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/try/${slug}/status`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (data.status === 'ready') { setPhase('ready'); return }
        if (data.status === 'failed') { setPhase('failed'); return }
        if (['expired', 'claimed'].includes(data.status)) { setPhase('gone'); return }
        // Advance the visible step from real signals: run queued → 1,
        // running → 2, chunks landing → 3.
        const ing = data.ingestion
        setBuildStep(ing?.chunksCreated > 0 ? 3 : ing?.status === 'running' ? 2 : 1)
      } catch { /* transient — keep polling */ }
      if (Date.now() - pollStartRef.current > MAX_POLL_MS) { setPhase('failed'); return }
      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }
    let timer = setTimeout(tick, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [phase, slug])

  const claimHref = `/try/${slug}/claim`
  const live = state === 'live' || state === 'connecting'

  const stop = useCallback(() => { void endCall('ended') }, [endCall])

  return (
    <main className="min-h-screen bg-black text-zinc-100 flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16 flex-1 flex flex-col items-center justify-center text-center gap-8">

        {phase === 'building' && (
          <>
            <h1 className="text-3xl font-semibold">Building {businessName}&rsquo;s AI receptionist…</h1>
            <ol className="space-y-3 text-left text-zinc-400">
              {[
                `Reading ${websiteDomain}`,
                'Learning your services and hours',
                'Training your receptionist',
              ].map((label, i) => (
                <li key={label} className={`flex items-center gap-3 ${buildStep > i ? 'text-zinc-100' : ''}`}>
                  <span className={`inline-block h-2 w-2 rounded-full ${buildStep > i ? 'bg-accent-primary-bg' : 'bg-zinc-700 animate-pulse'}`} />
                  {label}
                </li>
              ))}
            </ol>
            <p className="text-sm text-zinc-500">This usually takes under a minute — we&rsquo;re building it live from your website.</p>
          </>
        )}

        {phase === 'ready' && (
          <>
            <p className="text-sm uppercase tracking-widest text-zinc-500">Live demo</p>
            <h1 className="text-3xl font-semibold">
              This is what {businessName}&rsquo;s AI receptionist sounds like
            </h1>
            <p className="text-zinc-400 max-w-md">
              Tap the button and ask it anything a caller would — your hours, your services, your prices. It learned them from {websiteDomain}.
            </p>

            {state === 'error' && error && <p className="text-accent-red-fg text-sm">{error}</p>}

            {!live ? (
              <button
                onClick={() => void startCall()}
                className="rounded-full bg-accent-primary-bg px-10 py-5 text-lg font-semibold text-accent-primary-fg shadow-lg hover:opacity-90 transition"
              >
                📞 Answer a call at {businessName}
              </button>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-full border border-zinc-800 bg-zinc-900 px-8 py-4 text-lg">
                  {state === 'connecting' ? 'Connecting…' : `Live — ${secondsLeft ?? ''}s left`}
                </div>
                <button onClick={stop} className="text-sm text-zinc-400 underline hover:text-zinc-100">
                  End call
                </button>
              </div>
            )}

            {(hasCalled || state === 'ended') && (
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <a href={claimHref} className="rounded-lg bg-accent-primary-bg px-6 py-3 font-semibold text-accent-primary-fg hover:opacity-90 transition">
                  Get this for {businessName}
                </a>
                <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                  Learn more
                </a>
              </div>
            )}
          </>
        )}

        {phase === 'failed' && (
          <>
            <h1 className="text-3xl font-semibold">We couldn&rsquo;t finish building this demo</h1>
            <p className="text-zinc-400 max-w-md">
              No drama — we can still show you exactly what an AI receptionist would do for {businessName}.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a href={claimHref} className="rounded-lg bg-accent-primary-bg px-6 py-3 font-semibold text-accent-primary-fg hover:opacity-90 transition">
                Get this for {businessName}
              </a>
              <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                Learn more
              </a>
            </div>
          </>
        )}

        {phase === 'gone' && (
          <>
            <h1 className="text-3xl font-semibold">This demo has wrapped up</h1>
            <p className="text-zinc-400 max-w-md">
              The live demo for {businessName} is no longer running — but getting the real thing takes minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a href={claimHref} className="rounded-lg bg-accent-primary-bg px-6 py-3 font-semibold text-accent-primary-fg hover:opacity-90 transition">
                Get this for {businessName}
              </a>
              <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                Learn more
              </a>
            </div>
          </>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-zinc-600">
        A demo built by <a href="/" className="underline">Xovera</a>. Not affiliated with or endorsed by {businessName}.
      </footer>
    </main>
  )
}
```

- [ ] **Step 3: Verify styling tokens against `app/globals.css`**

Read the `@theme` block in `app/globals.css` and confirm `bg-accent-primary-bg`, `text-accent-primary-fg`, and `text-accent-red-fg` exist as utilities (they are referenced in CLAUDE.md; if the exact names differ, match what neighboring pages like `app/c/[slug]/HostedCallClient.tsx` actually use). `bg-black` is intentionally the page background (remapped token).

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add "app/try/[slug]/page.tsx" "app/try/[slug]/TryDemoClient.tsx"
git commit -m "feat(demos): /try/[slug] landing page — build sequence, live call, dual CTA"
git push origin main
```

---

### Task 10: Claim flow → checkout

**Files:**
- Create: `lib/demo-prospects/claim.ts`
- Create: `app/try/[slug]/claim/page.tsx`

- [ ] **Step 1: Write `lib/demo-prospects/claim.ts`**

```typescript
/**
 * Claiming a demo: the prospect signed in and wants the agent for real.
 * Creates a fresh workspace named after their business (mirrors the
 * POST /api/workspaces create shape) and RE-PARENTS the demo assets
 * into it — agent, voice config (rides along via agentId), and the
 * crawled knowledge domain. Their demo becomes their real agent; no
 * rebuild. Idempotent: a second claim by the same user returns the
 * already-claimed workspace; a claim by a different user is refused.
 */
import { db } from '@/lib/db'
import { demoWorkspaceId } from './provision'

export type ClaimResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'not_found' | 'claimed_by_other' | 'not_configured' }

export async function claimProspect(slug: string, userId: string): Promise<ClaimResult> {
  const demoWs = demoWorkspaceId()
  if (!demoWs) return { ok: false, reason: 'not_configured' }

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return { ok: false, reason: 'not_found' }

  if (prospect.status === 'claimed') {
    if (prospect.claimedByUserId === userId && prospect.claimedWorkspaceId) {
      return { ok: true, workspaceId: prospect.claimedWorkspaceId }
    }
    return { ok: false, reason: 'claimed_by_other' }
  }

  // Create the workspace (same shape as POST /api/workspaces).
  const baseSlug = prospect.businessName
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace'
  const workspace = await db.workspace.create({
    data: {
      name: prospect.businessName,
      slug: `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`,
      icon: '🎙️',
      installSource: 'demo_prospect',
      primaryCrmProvider: 'native',
      plan: 'trial',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      members: { create: { userId, role: 'owner' } },
    },
    select: { id: true },
  })

  // CAS the claim BEFORE moving assets so two racing claims can't both
  // re-parent. Loser gets claimed_by_other (or their own workspace).
  const won = await db.demoProspect.updateMany({
    where: { id: prospect.id, status: { not: 'claimed' } },
    data: {
      status: 'claimed',
      claimedByUserId: userId,
      claimedWorkspaceId: workspace.id,
      expiresAt: null, // reaper must never touch claimed assets
    },
  })
  if (won.count === 0) {
    const fresh = await db.demoProspect.findUnique({ where: { slug } })
    if (fresh?.claimedByUserId === userId && fresh.claimedWorkspaceId) {
      return { ok: true, workspaceId: fresh.claimedWorkspaceId }
    }
    return { ok: false, reason: 'claimed_by_other' }
  }

  // Re-parent assets. Agent needs a Location in the NEW workspace
  // (required FK) — create the same placeholder the wizard uses.
  if (prospect.agentId) {
    const placeholderId = `placeholder:${workspace.id}`
    const location = await db.location.upsert({
      where: { id: placeholderId },
      create: {
        id: placeholderId,
        workspaceId: workspace.id,
        companyId: '', userId: '', userType: '', scope: '',
        accessToken: '', refreshToken: '', refreshTokenId: '',
        expiresAt: new Date(0),
        crmProvider: 'none',
      },
      update: {},
      select: { id: true },
    })
    await db.agent.update({
      where: { id: prospect.agentId },
      data: {
        workspaceId: workspace.id,
        locationId: location.id,
        name: `${prospect.businessName} receptionist`,
      },
    }).catch(err => console.error(`[demo-claim] agent re-parent failed for ${slug}:`, err))
  }
  if (prospect.knowledgeDomainId) {
    await db.knowledgeDomain.update({
      where: { id: prospect.knowledgeDomainId },
      data: { workspaceId: workspace.id, name: `${prospect.businessName} website` },
    }).catch(err => console.error(`[demo-claim] domain re-parent failed for ${slug}:`, err))
  }

  return { ok: true, workspaceId: workspace.id }
}
```

- [ ] **Step 2: Write `app/try/[slug]/claim/page.tsx`**

```tsx
/**
 * Auth-gated claim step. The /try page's primary CTA links here; an
 * unauthenticated prospect bounces through /login and lands back here
 * via callbackUrl. On success we go straight to billing — the demo
 * they just talked to is now their real agent, and the plan picker
 * (voice-inclusive plans) is the next screen.
 */
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { claimProspect } from '@/lib/demo-prospects/claim'

export const metadata = { robots: { index: false, follow: false } }

type Params = { params: Promise<{ slug: string }> }

export default async function ClaimPage({ params }: Params) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/try/${slug}/claim`)}`)
  }

  const result = await claimProspect(slug, session.user.id)
  if (result.ok) {
    redirect(`/dashboard/${result.workspaceId}/settings/billing?fromDemo=1`)
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">
          {result.reason === 'claimed_by_other'
            ? 'This demo has already been claimed'
            : 'This demo link isn’t valid anymore'}
        </h1>
        <p className="text-zinc-400">
          You can still get an AI receptionist for your business in minutes.
        </p>
        <a href="/ai-receptionist" className="inline-block rounded-lg bg-accent-primary-bg px-6 py-3 font-semibold text-accent-primary-fg hover:opacity-90 transition">
          See how it works
        </a>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify the `/login` callbackUrl param name**

Read `app/login/page.tsx` and confirm the query param it honors for post-login redirect (NextAuth default is `callbackUrl`). If it uses something else, match it.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint` — expected: both exit 0. If `installSource: 'demo_prospect'` fails because the Workspace model constrains values, use `'direct'` instead (check the schema comment at the `installSource` field).

```bash
git add lib/demo-prospects/claim.ts "app/try/[slug]/claim/page.tsx"
git commit -m "feat(demos): claim flow — workspace creation + asset re-parenting → billing"
git push origin main
```

---

### Task 11: Reaper cron

**Files:**
- Create: `app/api/cron/demo-prospect-reaper/route.ts`
- Modify: `vercel.json` (crons array)

- [ ] **Step 1: Write the cron route**

```typescript
/**
 * Daily cleanup of expired prospect demos. Deletes the heavy assets
 * (agent → voice config cascades; knowledge domain → sources/runs/
 * chunks cascade) but KEEPS the DemoProspect row as status 'expired'
 * so the /try link degrades to a CTA page instead of a 404 and the
 * engagement history survives for the prospecting tool.
 * Claimed prospects have expiresAt null — never touched.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordCronRun } from '@/lib/cron-heartbeat'

const MAX_PER_RUN = 50
const REGISTERED_MAX_AGE_DAYS = 90

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let reaped = 0
  let failedRows = 0

  try {
    const expired = await db.demoProspect.findMany({
      where: {
        status: { in: ['ready', 'failed', 'provisioning'] },
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, slug: true, agentId: true, knowledgeDomainId: true },
      take: MAX_PER_RUN,
    })

    for (const p of expired) {
      try {
        if (p.agentId) await db.agent.delete({ where: { id: p.agentId } }).catch(() => {})
        if (p.knowledgeDomainId) await db.knowledgeDomain.delete({ where: { id: p.knowledgeDomainId } }).catch(() => {})
        await db.demoProspect.update({
          where: { id: p.id },
          data: { status: 'expired', agentId: null, knowledgeDomainId: null, ingestionRunId: null },
        })
        reaped++
      } catch (err) {
        failedRows++
        console.error(`[demo-reaper] failed for ${p.slug}:`, err)
      }
    }

    // Never-clicked rows from ancient campaigns: expire quietly.
    const stale = await db.demoProspect.updateMany({
      where: {
        status: 'registered',
        createdAt: { lt: new Date(now.getTime() - REGISTERED_MAX_AGE_DAYS * 86400_000) },
      },
      data: { status: 'expired' },
    })

    await recordCronRun('demo-prospect-reaper', true)
    return NextResponse.json({ reaped, failedRows, staleRegistered: stale.count })
  } catch (err) {
    await recordCronRun('demo-prospect-reaper', false, err instanceof Error ? err.message : String(err))
    console.error('[demo-reaper] run failed:', err)
    return NextResponse.json({ error: 'reaper failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Register the cron in `vercel.json`**

Add to the `crons` array (keep existing entries untouched):

```json
    {
      "path": "/api/cron/demo-prospect-reaper",
      "schedule": "20 3 * * *"
    }
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: exit 0.

```bash
git add app/api/cron/demo-prospect-reaper/route.ts vercel.json
git commit -m "feat(demos): daily demo-prospect reaper cron"
git push origin main
```

---

### Task 12: Full verification pass

**Files:** none new — verification only.

- [ ] **Step 1: Full local gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all exit 0 (test run includes the new `lib/demo-prospects/*.test.ts` suites).

- [ ] **Step 2: End-to-end walk (local dev server, local DB with the manual SQL applied)**

1. Create the internal demos workspace locally (or pick an existing one) and set `DEMO_WORKSPACE_ID` in `.env.local`; ensure `GEMINI_API_KEY` and `VOYAGE_API_KEY` are set.
2. Insert an org-scope ApiKey row (or reuse) and `POST /api/v1/demo-prospects` with a real small business site → note the returned `/try/<slug>` URL.
3. Open the URL in the browser (use the preview tools, not manual asking): watch the build sequence progress as the `ingest-queue` cron processes the run (trigger it manually locally: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/ingest-queue`).
4. When ready, start a call; confirm the greeting uses the business name, ask a question answered by the crawled site, confirm the countdown ends the call at the cap.
5. Immediately try a second call → expect the 429 cooldown message.
6. `GET /api/v1/demo-prospects` with the API key → confirm `clickedAt`, `callCount: 1`, `totalCallSecs > 0`.
7. Click "Get this for {business}" → login → confirm redirect to billing with a fresh workspace containing the agent (check the agents list) and the knowledge domain.
8. `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/demo-prospect-reaper` → `{ reaped: 0, ... }` (nothing expired yet).

- [ ] **Step 3: Production checklist (hand-run items for Ryan — list in the final report, do not run)**

- Run `prisma/migrations/manual_demo_prospects.sql` against production.
- Create the production demos workspace; set `DEMO_WORKSPACE_ID` in Vercel (use `printf '%s' "$VAL" | vercel env add …`, never `echo`).
- Mint an org-scope ApiKey for the prospecting tool (generate the key value yourself and hand it over — don't give Ryan a command to run).
- Optional tuning: `DEMO_TRY_MAX_SECS`, `DEMO_TRY_MAX_CONCURRENT`, `DEMO_TRY_IP_COOLDOWN_SECS`, `DEMO_PROSPECT_TTL_DAYS`.

- [ ] **Step 4: Final commit if the walk surfaced fixes**

```bash
git add -A && git commit -m "fix(demos): post-verification fixes" && git push origin main
```

---

## Deviations from the spec (intentional)

1. **No `demos:*` API-key scopes** — the ApiKey model only has `workspace`/`org` scope. The route accepts an org-scope key or a workspace-scope key bound to the demos workspace. Same security posture, zero schema surgery on ApiKey.
2. **No call-level cron reaper** — browser Gemini sessions die at the token's `maxSessionSecs` (same backstop the existing homepage demo relies on), and guard queries age calls out by time window. The daily prospect reaper handles asset cleanup; a per-call reaper would reap nothing.
3. **Claim is a page, not an API route** — `/try/[slug]/claim` composes cleanly with `/login?callbackUrl=…`, avoiding the cookie round-trip machinery the spec sketched.
