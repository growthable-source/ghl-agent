# Connection Health Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect broken GHL resource references (calendars, workflows) before they cause inbound-message failures, and gracefully degrade affected tools.

**Architecture:** A declarative validator framework collects every resource ID an agent references, validates each against the CRM via save-time + hourly cron + manual paths, persists per-reference health in a new `AgentReferenceHealth` table, and at runtime drops dependent tools from the agent's tool list. Workspace admin can override the default `tool_disable` mode to `agent_pause` or `warn_only`.

**Tech Stack:** Next.js 16 App Router · Prisma 7 · vitest · Vercel cron · existing `lib/crm/ghl/adapter.ts` (`GhlAdapter`).

**Spec reference:** `docs/superpowers/specs/2026-05-28-connection-health-checks-design.md`

---

## File Structure

**New files:**
- `prisma/migrations-legacy/manual_agent_reference_health.sql` — hand-run SQL migration
- `lib/agent/reference-health/validators.ts` — `VALIDATORS` registry + `Validator` interface
- `lib/agent/reference-health/collect.ts` — `collectAgentReferences()` — walks Agent + children
- `lib/agent/reference-health/check.ts` — `runReferenceHealthCheck()` — orchestrator
- `lib/agent/reference-health/collect.test.ts` — unit tests for the collector
- `lib/agent/reference-health/check.test.ts` — unit tests for transition detection (mocked validators)
- `app/api/cron/agent-reference-health/route.ts` — Vercel cron handler
- `app/api/workspaces/[workspaceId]/agents/[agentId]/reference-health/route.ts` — GET current health rows
- `app/api/workspaces/[workspaceId]/agents/[agentId]/reference-health/recheck/route.ts` — POST manual re-check
- `components/dashboard/AgentReferenceHealthBanner.tsx` — top-of-page banner

**Modified files:**
- `prisma/schema.prisma` — new model `AgentReferenceHealth`, new column `Workspace.brokenReferenceMode`, new relation on `Agent`
- `lib/notification-events.ts` — two new event entries
- `lib/crm/ghl/adapter.ts` — expose `getCalendar(id)` public method (currently `fetchCalendarMetadata` is private)
- `lib/ai-agent.ts` — runtime tool-disable + system-prompt injection
- `lib/conversation-state.ts` — skip stop-condition side effects when referenced workflow is broken
- `lib/routing.ts` — `agent_pause` mode early-out in `findMatchingAgent`
- `app/api/workspaces/[workspaceId]/agents/[agentId]/route.ts` — call `runReferenceHealthCheck` after PATCH
- `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx` — mount the banner
- `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx` — per-field status badges
- `app/dashboard/[workspaceId]/settings/page.tsx` (or wherever workspace settings live) — broken-reference mode picker
- `vercel.json` — cron entry

---

## Task 1: Schema + SQL migration

**Files:**
- Create: `prisma/migrations-legacy/manual_agent_reference_health.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write the SQL migration**

Create `prisma/migrations-legacy/manual_agent_reference_health.sql`:

```sql
-- AgentReferenceHealth table
CREATE TABLE IF NOT EXISTS "AgentReferenceHealth" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "sourceField" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "firstBrokenAt" TIMESTAMP(3),
  CONSTRAINT "AgentReferenceHealth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentReferenceHealth_agentId_resourceType_resourceId_sourceField_key"
  ON "AgentReferenceHealth"("agentId", "resourceType", "resourceId", "sourceField");

CREATE INDEX IF NOT EXISTS "AgentReferenceHealth_agentId_status_idx"
  ON "AgentReferenceHealth"("agentId", "status");

ALTER TABLE "AgentReferenceHealth"
  ADD CONSTRAINT "AgentReferenceHealth_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Workspace.brokenReferenceMode
ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "brokenReferenceMode" TEXT NOT NULL DEFAULT 'tool_disable';
```

- [ ] **Step 2: Ryan runs the SQL by hand**

Per `memory/feedback_migration_sql_first.md`, Ryan executes this against the production DB before continuing. The implementing agent should NOT run `prisma migrate dev` — leave the SQL file and stop here for the human gate.

- [ ] **Step 3: Add the Prisma model**

Append to `prisma/schema.prisma` (near the existing `Agent` model):

```prisma
model AgentReferenceHealth {
  id            String    @id @default(cuid())
  agentId       String
  agent         Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  resourceType  String    // 'calendar' | 'workflow' | (future)
  resourceId    String
  sourceField   String
  status        String    // 'healthy' | 'broken' | 'transient_error'
  lastCheckedAt DateTime
  lastError     String?
  firstBrokenAt DateTime?
  
  @@unique([agentId, resourceType, resourceId, sourceField])
  @@index([agentId, status])
}
```

- [ ] **Step 4: Add the relation on Agent**

Find the `model Agent {` block in `prisma/schema.prisma` and add this line (alongside existing relations):

```prisma
  referenceHealth AgentReferenceHealth[]
```

- [ ] **Step 5: Add the workspace column**

Find the `model Workspace {` block in `prisma/schema.prisma` and add (next to existing String columns):

```prisma
  /// 'tool_disable' (default) — drop the affected tools and keep the rest running.
  /// 'agent_pause' — skip the agent entirely when any reference is broken.
  /// 'warn_only' — runtime ignores broken state; rely on the runtime fallback.
  brokenReferenceMode String @default("tool_disable")
```

- [ ] **Step 6: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: completes without error; `node_modules/@prisma/client` updated.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations-legacy/manual_agent_reference_health.sql prisma/schema.prisma
git commit -m "schema: AgentReferenceHealth + Workspace.brokenReferenceMode"
```

---

## Task 2: Expose `getCalendar(id)` on the GHL adapter

**Files:**
- Modify: `lib/crm/ghl/adapter.ts`

- [ ] **Step 1: Add a public `getCalendar` method**

The class already has a private `fetchCalendarMetadata(calendarId)` that fetches `/calendars/${calendarId}` with Version `2021-04-15`. Add a public method that wraps it without the caching layer (so the health check always sees the live status). Inside `class GhlAdapter`, near other calendar methods (around the existing `getFreeSlots` definition):

```ts
/**
 * Fetch a single calendar by ID. Used by the reference-health validator
 * to confirm the calendar still exists in the CRM. Bypasses the in-memory
 * cache so a freshly-deleted calendar is detected on the next call rather
 * than the next adapter instance.
 */
async getCalendar(calendarId: string): Promise<unknown> {
  return this.apiFetch<unknown>(`/calendars/${calendarId}`, {
    headers: { Version: '2021-04-15' },
  })
}
```

- [ ] **Step 2: Add a `getCalendar` method to the `CrmAdapter` interface**

Find the `CrmAdapter` interface definition (likely in `lib/crm/types.ts` or `lib/crm/factory.ts`) and add:

```ts
/** Fetch a single calendar by ID. Throws on 404. */
getCalendar(calendarId: string): Promise<unknown>
```

If the interface lives elsewhere, search for `interface CrmAdapter` to find it. Add corresponding implementations to any other adapter that implements `CrmAdapter` (Native, HubSpot) so they don't break compilation — those can stub with `throw new Error('getCalendar not supported')` for now since the calendar validator only runs against agents with GHL locations.

- [ ] **Step 3: Commit**

```bash
git add lib/crm/
git commit -m "adapter: expose getCalendar(id) public method for reference health"
```

---

## Task 3: Validator registry

**Files:**
- Create: `lib/agent/reference-health/validators.ts`

- [ ] **Step 1: Create the validator registry file**

Create `lib/agent/reference-health/validators.ts`:

```ts
/**
 * Reference validator registry. Each validator knows how to check whether
 * a specific kind of CRM-referenced resource still exists, plus which agent
 * tools depend on that resource type.
 *
 * Add a new resource type here and the rest of the framework — collector,
 * checker, runtime tool-disable, UI — picks it up without code changes
 * elsewhere.
 */

import type { CrmAdapter } from '@/lib/crm/factory'

export interface Validator {
  /**
   * Returns null if the resource is healthy.
   * Returns a string (error message) if the resource is broken (404 / gone).
   * Throws if the check itself failed transiently (5xx, network). Callers
   * treat throws as 'transient_error' and preserve the previous status.
   */
  fetch: (adapter: CrmAdapter, id: string) => Promise<null | string>
  /** Human-friendly label shown in the UI and email body ("Calendar", "Workflow"). */
  label: string
  /**
   * Tools that should be hidden from the agent runtime when ANY reference
   * of this type on the agent is broken. The model literally doesn't see
   * these tools in its tool list.
   */
  dependentTools: string[]
}

export const VALIDATORS: Record<string, Validator> = {
  calendar: {
    label: 'Calendar',
    fetch: async (adapter, id) => {
      try {
        await adapter.getCalendar(id)
        return null
      } catch (err: any) {
        const msg = err?.message ?? ''
        if (/\b404\b|not\s*found/i.test(msg)) return msg
        // Anything else — auth, network, 5xx — is transient. Propagate so
        // the caller marks the check as transient_error rather than broken.
        throw err
      }
    },
    dependentTools: [
      'get_available_slots',
      'book_appointment',
      'cancel_appointment',
      'reschedule_appointment',
      'get_calendar_events',
    ],
  },
  workflow: {
    label: 'Workflow',
    fetch: async (adapter, id) => {
      // GHL doesn't expose a single-workflow GET; list and find. Cheap
      // enough — adapters cache the list per call.
      const ghl = adapter as any
      if (typeof ghl.listWorkflows !== 'function') {
        // Non-GHL adapters can't validate workflows yet — treat as healthy
        // so we don't false-alarm on other CRMs.
        return null
      }
      const workflows = await ghl.listWorkflows()
      if (!Array.isArray(workflows) || !workflows.some((w: any) => w.id === id)) {
        return `workflow ${id} not found`
      }
      return null
    },
    dependentTools: ['add_to_workflow', 'remove_from_workflow'],
  },
}

export function getValidator(resourceType: string): Validator | null {
  return VALIDATORS[resourceType] ?? null
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/reference-health/validators.ts
git commit -m "reference-health: validator registry (calendar + workflow)"
```

---

## Task 4: Reference collector (TDD)

**Files:**
- Create: `lib/agent/reference-health/collect.ts`
- Test: `lib/agent/reference-health/collect.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/agent/reference-health/collect.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { collectAgentReferences } from './collect'

describe('collectAgentReferences', () => {
  it('returns empty array when agent has no references', () => {
    const agent = {
      id: 'a1', calendarId: null,
      stopConditions: [], triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([])
  })

  it('emits a calendar reference when calendarId is set', () => {
    const agent = {
      id: 'a1', calendarId: 'cal_123',
      stopConditions: [], triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([
      { resourceType: 'calendar', resourceId: 'cal_123', sourceField: 'Agent.calendarId' },
    ])
  })

  it('emits workflow references from stop conditions', () => {
    const agent = {
      id: 'a1', calendarId: null,
      stopConditions: [
        { id: 'sc1', enrollWorkflowId: 'wf_enroll', removeWorkflowId: null },
        { id: 'sc2', enrollWorkflowId: null, removeWorkflowId: 'wf_remove' },
        { id: 'sc3', enrollWorkflowId: 'wf_both_a', removeWorkflowId: 'wf_both_b' },
      ],
      triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([
      { resourceType: 'workflow', resourceId: 'wf_enroll', sourceField: 'StopCondition[sc1].enrollWorkflowId' },
      { resourceType: 'workflow', resourceId: 'wf_remove', sourceField: 'StopCondition[sc2].removeWorkflowId' },
      { resourceType: 'workflow', resourceId: 'wf_both_a', sourceField: 'StopCondition[sc3].enrollWorkflowId' },
      { resourceType: 'workflow', resourceId: 'wf_both_b', sourceField: 'StopCondition[sc3].removeWorkflowId' },
    ])
  })

  it('combines calendar + workflow references in source order', () => {
    const agent = {
      id: 'a1', calendarId: 'cal_x',
      stopConditions: [{ id: 'sc1', enrollWorkflowId: 'wf_x', removeWorkflowId: null }],
      triggers: [],
    } as any
    const refs = collectAgentReferences(agent)
    expect(refs).toHaveLength(2)
    expect(refs[0].resourceType).toBe('calendar')
    expect(refs[1].resourceType).toBe('workflow')
  })

  it('skips empty-string IDs (treat as unset)', () => {
    const agent = {
      id: 'a1', calendarId: '',
      stopConditions: [{ id: 'sc1', enrollWorkflowId: '', removeWorkflowId: null }],
      triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- collect`
Expected: FAIL with "Cannot find module './collect'" or similar.

- [ ] **Step 3: Write the collector**

Create `lib/agent/reference-health/collect.ts`:

```ts
/**
 * Walks an Agent plus its directly-owned children (StopCondition, AgentTrigger)
 * and emits one tuple per CRM-referenced resource ID. Empty-string IDs are
 * treated as unset and skipped.
 *
 * Adding a new reference site (e.g. a new column on Agent, or a new child
 * model) means appending one block here. The rest of the framework picks
 * it up automatically as long as the resourceType has a registered validator.
 */

export interface AgentReference {
  resourceType: string
  resourceId: string
  sourceField: string
}

interface CollectableStopCondition {
  id: string
  enrollWorkflowId: string | null
  removeWorkflowId: string | null
}

interface CollectableAgent {
  id: string
  calendarId: string | null
  stopConditions: CollectableStopCondition[]
  triggers: unknown[]
}

export function collectAgentReferences(agent: CollectableAgent): AgentReference[] {
  const refs: AgentReference[] = []

  if (agent.calendarId && agent.calendarId.length > 0) {
    refs.push({
      resourceType: 'calendar',
      resourceId: agent.calendarId,
      sourceField: 'Agent.calendarId',
    })
  }

  for (const sc of agent.stopConditions) {
    if (sc.enrollWorkflowId && sc.enrollWorkflowId.length > 0) {
      refs.push({
        resourceType: 'workflow',
        resourceId: sc.enrollWorkflowId,
        sourceField: `StopCondition[${sc.id}].enrollWorkflowId`,
      })
    }
    if (sc.removeWorkflowId && sc.removeWorkflowId.length > 0) {
      refs.push({
        resourceType: 'workflow',
        resourceId: sc.removeWorkflowId,
        sourceField: `StopCondition[${sc.id}].removeWorkflowId`,
      })
    }
  }

  // AgentTriggers don't currently have workflow ID fields — when they do,
  // append here. The test for this case will fail first because we'll add
  // it before the field exists.

  return refs
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- collect`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/reference-health/collect.ts lib/agent/reference-health/collect.test.ts
git commit -m "reference-health: collectAgentReferences walks Agent + StopConditions"
```

---

## Task 5: Check orchestrator (TDD with mocked validators)

**Files:**
- Create: `lib/agent/reference-health/check.ts`
- Test: `lib/agent/reference-health/check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/agent/reference-health/check.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { evaluateReferences } from './check'

describe('evaluateReferences', () => {
  const healthyValidator = { label: 'X', dependentTools: [], fetch: vi.fn().mockResolvedValue(null) }
  const brokenValidator = { label: 'X', dependentTools: [], fetch: vi.fn().mockResolvedValue('not found') }
  const transientValidator = { label: 'X', dependentTools: [], fetch: vi.fn().mockRejectedValue(new Error('timeout')) }

  it('marks a reference healthy when validator returns null', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: healthyValidator },
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('healthy')
    expect(result[0].lastError).toBeNull()
  })

  it('marks a reference broken when validator returns a string', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: brokenValidator },
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('broken')
    expect(result[0].lastError).toBe('not found')
  })

  it('preserves the previous status when validator throws transiently', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: transientValidator },
      previousStatusByKey: new Map([['x:1:f', 'healthy']]),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('healthy')  // preserved
    expect(result[0].rawStatus).toBe('transient_error')
    expect(result[0].lastError).toContain('timeout')
  })

  it('marks transient as transient_error when no previous status exists', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: transientValidator },
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('transient_error')
  })

  it('skips references with no registered validator', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'unknown', resourceId: '1', sourceField: 'f' }],
      validators: {},
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result).toEqual([])
  })

  it('flags transitions from healthy to broken', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: brokenValidator },
      previousStatusByKey: new Map([['x:1:f', 'healthy']]),
      adapter: {} as any,
    })
    expect(result[0].transition).toBe('healthy_to_broken')
  })

  it('flags transitions from broken to healthy', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: healthyValidator },
      previousStatusByKey: new Map([['x:1:f', 'broken']]),
      adapter: {} as any,
    })
    expect(result[0].transition).toBe('broken_to_healthy')
  })

  it('returns null transition when status unchanged', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: healthyValidator },
      previousStatusByKey: new Map([['x:1:f', 'healthy']]),
      adapter: {} as any,
    })
    expect(result[0].transition).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- check`
Expected: FAIL with "Cannot find module './check'".

- [ ] **Step 3: Write the pure evaluation logic**

Create `lib/agent/reference-health/check.ts`:

```ts
/**
 * Reference-health orchestrator. Splits into two layers:
 *
 *   evaluateReferences()  — pure async function that runs validators
 *                            and decides write-status / transition.
 *                            No DB access. Easy to unit-test.
 *
 *   runReferenceHealthCheck(agentId)  — wraps evaluate with DB I/O:
 *                            loads the agent + previous statuses, calls
 *                            evaluate, upserts rows, fires notify on
 *                            transitions. The integration surface.
 */

import type { CrmAdapter } from '@/lib/crm/factory'
import type { Validator } from './validators'
import type { AgentReference } from './collect'

export interface EvaluationResult {
  ref: AgentReference
  /** What we observed this run. */
  rawStatus: 'healthy' | 'broken' | 'transient_error'
  /** What we persist to the DB. Transient errors preserve previous status. */
  writeStatus: 'healthy' | 'broken' | 'transient_error'
  lastError: string | null
  transition: 'healthy_to_broken' | 'broken_to_healthy' | null
}

export async function evaluateReferences(opts: {
  refs: AgentReference[]
  validators: Record<string, Validator>
  /** Map of "<resourceType>:<resourceId>:<sourceField>" → previous status. */
  previousStatusByKey: Map<string, string>
  adapter: CrmAdapter
}): Promise<EvaluationResult[]> {
  const { refs, validators, previousStatusByKey, adapter } = opts
  const results: EvaluationResult[] = []

  for (const ref of refs) {
    const validator = validators[ref.resourceType]
    if (!validator) continue  // unknown type — skip

    let rawStatus: EvaluationResult['rawStatus'] = 'healthy'
    let lastError: string | null = null

    try {
      const err = await validator.fetch(adapter, ref.resourceId)
      if (err) { rawStatus = 'broken'; lastError = err }
    } catch (err: any) {
      rawStatus = 'transient_error'
      lastError = err?.message ?? 'unknown'
    }

    const key = `${ref.resourceType}:${ref.resourceId}:${ref.sourceField}`
    const previousStatus = previousStatusByKey.get(key)

    // Transient errors don't clobber the last known good status. If we've
    // never checked this reference before, transient_error stays.
    const writeStatus: EvaluationResult['writeStatus'] =
      rawStatus === 'transient_error' && previousStatus
        ? (previousStatus as EvaluationResult['writeStatus'])
        : rawStatus

    let transition: EvaluationResult['transition'] = null
    if (previousStatus !== 'broken' && writeStatus === 'broken') {
      transition = 'healthy_to_broken'
    } else if (previousStatus === 'broken' && writeStatus === 'healthy') {
      transition = 'broken_to_healthy'
    }

    results.push({ ref, rawStatus, writeStatus, lastError, transition })
  }

  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- check`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/reference-health/check.ts lib/agent/reference-health/check.test.ts
git commit -m "reference-health: evaluateReferences pure logic (validator dispatch + transitions)"
```

---

## Task 6: DB-integrated `runReferenceHealthCheck`

**Files:**
- Modify: `lib/agent/reference-health/check.ts`

- [ ] **Step 1: Append the integration layer**

Add to the BOTTOM of `lib/agent/reference-health/check.ts`:

```ts
import { db } from '@/lib/db'
import { getCrmAdapter } from '@/lib/crm/factory'
import { collectAgentReferences } from './collect'
import { VALIDATORS } from './validators'

/**
 * Full check pass for a single agent. Loads the agent, collects refs,
 * runs evaluate, upserts rows, fires notifications on transitions.
 * Returns a summary the caller can use for logs / API responses.
 *
 * `throttleMinutes` skips references whose `lastCheckedAt` is younger
 * than the threshold. Cron passes 30; manual re-check passes 0.
 */
export async function runReferenceHealthCheck(
  agentId: string,
  opts: { throttleMinutes?: number } = {},
): Promise<{ healthy: number; broken: number; transient: number; skipped: number }> {
  const throttleMinutes = opts.throttleMinutes ?? 0

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { stopConditions: true, triggers: true },
  })
  if (!agent) return { healthy: 0, broken: 0, transient: 0, skipped: 0 }

  const refs = collectAgentReferences(agent as any)
  if (refs.length === 0) return { healthy: 0, broken: 0, transient: 0, skipped: 0 }

  // Load previous statuses for transition detection AND throttle decisions.
  const existing = await db.agentReferenceHealth.findMany({ where: { agentId } })
  const previousStatusByKey = new Map<string, string>()
  const lastCheckedByKey = new Map<string, Date>()
  for (const e of existing) {
    const key = `${e.resourceType}:${e.resourceId}:${e.sourceField}`
    previousStatusByKey.set(key, e.status)
    lastCheckedByKey.set(key, e.lastCheckedAt)
  }

  // Apply throttle — drop refs we just checked.
  const cutoff = Date.now() - throttleMinutes * 60_000
  const refsToCheck = throttleMinutes <= 0
    ? refs
    : refs.filter(r => {
        const key = `${r.resourceType}:${r.resourceId}:${r.sourceField}`
        const lc = lastCheckedByKey.get(key)
        return !lc || lc.getTime() < cutoff
      })
  const skipped = refs.length - refsToCheck.length

  const adapter = await getCrmAdapter(agent.locationId)
  const results = await evaluateReferences({
    refs: refsToCheck,
    validators: VALIDATORS,
    previousStatusByKey,
    adapter,
  })

  let healthy = 0, broken = 0, transient = 0
  for (const r of results) {
    const isBrokenTransition = r.transition === 'healthy_to_broken'

    await db.agentReferenceHealth.upsert({
      where: {
        agentId_resourceType_resourceId_sourceField: {
          agentId,
          resourceType: r.ref.resourceType,
          resourceId: r.ref.resourceId,
          sourceField: r.ref.sourceField,
        },
      },
      create: {
        agentId,
        resourceType: r.ref.resourceType,
        resourceId: r.ref.resourceId,
        sourceField: r.ref.sourceField,
        status: r.writeStatus,
        lastCheckedAt: new Date(),
        lastError: r.lastError,
        firstBrokenAt: r.writeStatus === 'broken' ? new Date() : null,
      },
      update: {
        status: r.writeStatus,
        lastCheckedAt: new Date(),
        lastError: r.lastError,
        // Only set firstBrokenAt on the transition INTO broken; leave it
        // alone otherwise so the UI can show "broken since N hours ago".
        ...(isBrokenTransition ? { firstBrokenAt: new Date() } : {}),
        // Clear firstBrokenAt when transitioning back to healthy.
        ...(r.transition === 'broken_to_healthy' ? { firstBrokenAt: null } : {}),
      },
    })

    if (r.transition) {
      // Fire notification in background so a Resend hiccup doesn't break
      // the check pass. fireReferenceTransitionNotification is in Task 7.
      void fireReferenceTransitionNotification({
        agentId,
        ref: r.ref,
        transition: r.transition,
        lastError: r.lastError,
        validatorLabel: VALIDATORS[r.ref.resourceType]?.label ?? r.ref.resourceType,
      }).catch((err: any) => {
        console.warn(`[ref-health] notify failed for ${agentId}:`, err?.message)
      })
    }

    if (r.writeStatus === 'healthy') healthy++
    else if (r.writeStatus === 'broken') broken++
    else transient++
  }

  return { healthy, broken, transient, skipped }
}

// fireReferenceTransitionNotification is implemented in Task 7 below.
// Forward declaration so this file compiles in isolation:
declare function fireReferenceTransitionNotification(opts: {
  agentId: string
  ref: AgentReference
  transition: 'healthy_to_broken' | 'broken_to_healthy'
  lastError: string | null
  validatorLabel: string
}): Promise<void>
```

- [ ] **Step 2: Commit (no test — DB integration is exercised in manual verification)**

```bash
git add lib/agent/reference-health/check.ts
git commit -m "reference-health: runReferenceHealthCheck DB integration + throttle"
```

---

## Task 7: Notifications on transitions

**Files:**
- Modify: `lib/notification-events.ts`
- Modify: `lib/agent/reference-health/check.ts`

- [ ] **Step 1: Add the two new event entries**

In `lib/notification-events.ts`, inside the `NOTIFICATION_EVENTS` array, append:

```ts
{
  id: 'reference_broken',
  label: 'Agent reference broken',
  description: 'An agent\'s calendar, workflow, or other CRM resource no longer resolves in the CRM.',
  defaultUserChannels: ['email', 'web_push'],
},
{
  id: 'reference_fixed',
  label: 'Agent reference recovered',
  description: 'A previously broken reference is healthy again.',
  defaultUserChannels: ['web_push'],
},
```

- [ ] **Step 2: Implement `fireReferenceTransitionNotification`**

REMOVE the `declare function fireReferenceTransitionNotification` line from `lib/agent/reference-health/check.ts` and REPLACE it with this implementation (at the bottom of the file):

```ts
async function fireReferenceTransitionNotification(opts: {
  agentId: string
  ref: AgentReference
  transition: 'healthy_to_broken' | 'broken_to_healthy'
  lastError: string | null
  validatorLabel: string
}): Promise<void> {
  const agent = await db.agent.findUnique({
    where: { id: opts.agentId },
    select: { name: true, workspaceId: true },
  })
  if (!agent?.workspaceId) return

  const { notify } = await import('@/lib/notifications')
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
  const link = `${appUrl}/dashboard/${agent.workspaceId}/agents/${opts.agentId}/tools`

  if (opts.transition === 'healthy_to_broken') {
    await notify({
      workspaceId: agent.workspaceId,
      event: 'reference_broken',
      title: `${opts.validatorLabel} ${opts.ref.resourceId} broken on agent "${agent.name}"`,
      body: [
        `Source: ${opts.ref.sourceField}`,
        opts.lastError ? `Error: ${opts.lastError}` : null,
        `Affected tools have been auto-disabled. Open the agent to fix the reference or pick a different one.`,
      ].filter(Boolean).join('\n\n'),
      link,
      severity: 'error',
    })
  } else {
    await notify({
      workspaceId: agent.workspaceId,
      event: 'reference_fixed',
      title: `${opts.validatorLabel} ${opts.ref.resourceId} healthy again on agent "${agent.name}"`,
      body: `Tools have been re-enabled.`,
      link,
      severity: 'info',
    })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/notification-events.ts lib/agent/reference-health/check.ts
git commit -m "reference-health: notify on healthy↔broken transitions"
```

---

## Task 8: Save-time validation in PATCH agent

**Files:**
- Modify: `app/api/workspaces/[workspaceId]/agents/[agentId]/route.ts`

- [ ] **Step 1: Read the existing route**

Read `app/api/workspaces/[workspaceId]/agents/[agentId]/route.ts` to find the PATCH handler. Identify the success-response point (after the agent update succeeds, before `return NextResponse.json(...)`).

- [ ] **Step 2: Call `runReferenceHealthCheck` after update**

Inside the PATCH handler, after the agent update has been written to the DB and before the response is returned, add:

```ts
// Validate every referenced CRM resource immediately so the UI can show
// any broken references inline. Don't block the save — even if a reference
// is broken, the user may have changed an unrelated field and we don't want
// to lose their work.
let referenceHealth: Array<{
  resourceType: string
  resourceId: string
  status: string
  lastError: string | null
}> = []
try {
  const { runReferenceHealthCheck } = await import('@/lib/agent/reference-health/check')
  await runReferenceHealthCheck(agentId, { throttleMinutes: 0 })
  const rows = await db.agentReferenceHealth.findMany({
    where: { agentId },
    select: { resourceType: true, resourceId: true, status: true, lastError: true },
  })
  referenceHealth = rows
} catch (err: any) {
  console.warn(`[agent PATCH] reference health check failed for ${agentId}:`, err?.message)
}
```

Then add `referenceHealth` into the response payload:

```ts
return NextResponse.json({ ...existing payload, referenceHealth })
```

- [ ] **Step 3: Commit**

```bash
git add app/api/workspaces/
git commit -m "agent PATCH: run reference health + return referenceHealth in payload"
```

---

## Task 9: Manual re-check API endpoint

**Files:**
- Create: `app/api/workspaces/[workspaceId]/agents/[agentId]/reference-health/recheck/route.ts`

- [ ] **Step 1: Create the route handler**

Create the file with this content:

```ts
/**
 * Manual "Re-check now" endpoint. Operator clicks the button on the broken
 * banner → we run the validator without throttle so they get an immediate
 * answer about whether their fix worked.
 *
 * Auth: standard workspace membership check via the existing helper.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { runReferenceHealthCheck } from '@/lib/agent/reference-health/check'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  const { workspaceId, agentId } = await context.params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // Workspace membership check
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
    select: { id: true },
  })
  if (!member) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Confirm the agent belongs to this workspace.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const result = await runReferenceHealthCheck(agentId, { throttleMinutes: 0 })
  const rows = await db.agentReferenceHealth.findMany({
    where: { agentId },
    select: {
      resourceType: true, resourceId: true, sourceField: true,
      status: true, lastError: true, lastCheckedAt: true,
    },
  })
  return NextResponse.json({ ...result, references: rows })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/workspaces/
git commit -m "reference-health: manual recheck POST endpoint"
```

---

## Task 10: GET reference health endpoint (for the banner)

**Files:**
- Create: `app/api/workspaces/[workspaceId]/agents/[agentId]/reference-health/route.ts`

- [ ] **Step 1: Create the GET endpoint**

```ts
/**
 * Read-only listing of an agent's reference health rows. Used by the
 * AgentReferenceHealthBanner component and the Tools page status badges.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  const { workspaceId, agentId } = await context.params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
    select: { id: true },
  })
  if (!member) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const references = await db.agentReferenceHealth.findMany({
    where: { agentId },
    select: {
      resourceType: true, resourceId: true, sourceField: true,
      status: true, lastError: true, lastCheckedAt: true, firstBrokenAt: true,
    },
    orderBy: { lastCheckedAt: 'desc' },
  })
  return NextResponse.json({ references })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/workspaces/
git commit -m "reference-health: GET endpoint for banner + tools-page badges"
```

---

## Task 11: Cron route

**Files:**
- Create: `app/api/cron/agent-reference-health/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Find an existing cron route to mirror auth pattern**

Look at `app/api/cron/stale-conversations/route.ts` (or any cron route — the repo already has crons). Note how it authenticates (likely a bearer token check via `CRON_SECRET` env var) and how it iterates.

- [ ] **Step 2: Create the cron handler**

Create `app/api/cron/agent-reference-health/route.ts`:

```ts
/**
 * Hourly cron: walks every Agent that has at least one resource reference
 * and runs the reference health check. References checked within the last
 * 30 minutes (e.g. via the manual re-check button) are skipped via the
 * runReferenceHealthCheck throttle.
 *
 * Returns a summary so Vercel cron logs show whether the run was meaningful.
 *
 * Auth: same CRON_SECRET bearer-token pattern as every other cron in this
 * repo. See app/api/cron/stale-conversations/route.ts for reference.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runReferenceHealthCheck } from '@/lib/agent/reference-health/check'

export async function GET(req: NextRequest) {
  // Bearer-token check (same as other crons in this repo).
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Find every agent with at least one calendar or workflow ID set.
  // We use a single OR-query rather than fetching all agents to keep this
  // cheap on accounts with hundreds of agents most of which aren't booking.
  const candidates = await db.agent.findMany({
    where: {
      OR: [
        { calendarId: { not: null } },
        { stopConditions: { some: { enrollWorkflowId: { not: null } } } },
        { stopConditions: { some: { removeWorkflowId: { not: null } } } },
      ],
    },
    select: { id: true, name: true, workspaceId: true },
  })

  let processed = 0, broken = 0, healthy = 0, errors = 0
  for (const agent of candidates) {
    try {
      const result = await runReferenceHealthCheck(agent.id, { throttleMinutes: 30 })
      processed++
      broken += result.broken
      healthy += result.healthy
    } catch (err: any) {
      errors++
      console.error(`[cron ref-health] ${agent.id}: ${err?.message}`)
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    processed, broken, healthy, errors,
    totalCandidates: candidates.length,
  })
}
```

- [ ] **Step 3: Add the cron schedule to `vercel.json`**

Open `vercel.json`. Find the existing `crons` array (the project has other crons — append to it). Add this entry:

```json
{
  "path": "/api/cron/agent-reference-health",
  "schedule": "0 * * * *"
}
```

If `vercel.json` doesn't yet have a `crons` array (unlikely — there's a `stale-conversations` cron already), structure the file like:

```json
{
  "crons": [
    { "path": "/api/cron/agent-reference-health", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/ vercel.json
git commit -m "reference-health: hourly cron + vercel.json schedule"
```

---

## Task 12: Runtime tool-disable in `runAgent`

**Files:**
- Modify: `lib/ai-agent.ts`

- [ ] **Step 1: Locate the tool-list construction in `runAgent`**

In `lib/ai-agent.ts`, find where the `tools` array is built and passed to `client.messages.create({...createParams, tools, ...})`. This is the point we hook into. The `enabledTools` array from the agent record drives the tool list — we'll filter it.

- [ ] **Step 2: Load broken references + workspace mode**

Near the top of `runAgent` (after `agent` is loaded), add:

```ts
// ─── Reference health gating ───────────────────────────────────────
// Drop tools that depend on a broken reference (mode = 'tool_disable'),
// or skip the run entirely (mode = 'agent_pause'). 'warn_only' is a
// no-op — the runtime fallback shipped 2026-05-28 handles failures.
let toolsToHide = new Set<string>()
let brokenLabelsForPrompt: string[] = []
if (!isSandbox && agentId) {
  try {
    const broken = await db.agentReferenceHealth.findMany({
      where: { agentId, status: 'broken' },
      select: { resourceType: true, resourceId: true },
    })
    if (broken.length > 0 && workspaceId) {
      const ws = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { brokenReferenceMode: true },
      })
      const mode = ws?.brokenReferenceMode ?? 'tool_disable'

      if (mode === 'agent_pause') {
        console.log(`[Agent] ${agentId}: skipping run, ${broken.length} broken refs, mode=agent_pause`)
        return {
          reply: null,
          actions: [],
          toolCallTrace: [],
          inputTokens: 0,
          outputTokens: 0,
          skipped: 'broken_references' as const,
        }
      }

      if (mode === 'tool_disable') {
        const { VALIDATORS } = await import('@/lib/agent/reference-health/validators')
        for (const ref of broken) {
          const v = VALIDATORS[ref.resourceType]
          if (!v) continue
          for (const t of v.dependentTools) toolsToHide.add(t)
          brokenLabelsForPrompt.push(`${v.label} ${ref.resourceId}`)
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Agent] reference health gating failed for ${agentId}:`, err?.message)
  }
}
```

(Inspect the actual return shape of `runAgent` and match the `skipped` field's surrounding object exactly — if `runAgent` returns a different shape, replicate that shape with the minimum required fields.)

- [ ] **Step 3: Filter `enabledTools` before tool list assembly**

Find where `enabledTools` is used to build the tools array. Just before that line, add:

```ts
if (toolsToHide.size > 0) {
  enabledTools = enabledTools.filter(t => !toolsToHide.has(t))
}
```

- [ ] **Step 4: Inject the prompt note for missing tools**

Find where the system prompt is assembled (`systemPrompt` variable). After the base prompt is finalized but before it's passed to `client.messages.create`, add:

```ts
if (brokenLabelsForPrompt.length > 0) {
  systemPrompt += `\n\nIMPORTANT: The following CRM resources are temporarily unavailable due to a configuration issue: ${brokenLabelsForPrompt.join(', ')}. The associated tools (booking, workflow enrolment, etc.) have been removed from your tool list for this conversation. If the contact asks about scheduling, workflow actions, or anything that requires these resources, acknowledge their request and tell them a teammate will follow up shortly. Do not pretend to attempt these actions.`
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/ai-agent.ts
git commit -m "ai-agent: drop tools + inject prompt note for broken references"
```

---

## Task 13: Skip stop conditions with broken workflows

**Files:**
- Modify: `lib/conversation-state.ts`

- [ ] **Step 1: Filter broken workflowIds in `executeStopConditionActions`**

Find `executeStopConditionActions` in `lib/conversation-state.ts`. Wrap the `matched.enrollWorkflowId` and `matched.removeWorkflowId` blocks with a check that the referenced workflow is healthy. Right above the `if (matched.enrollWorkflowId)` block, add:

```ts
// Skip workflow side-effects when the referenced workflow has been flagged
// broken by reference-health. The pause + tag-needs-attention still fires;
// only the workflow enrol/remove is suppressed. Prevents the agent from
// repeatedly attempting to enrol contacts into a workflow that no longer
// exists in the CRM.
const brokenWorkflowIds = new Set<string>()
try {
  const rows = await db.agentReferenceHealth.findMany({
    where: {
      agent: { stopConditions: { some: { id: matched.id } } },
      resourceType: 'workflow',
      status: 'broken',
    },
    select: { resourceId: true },
  })
  for (const row of rows) brokenWorkflowIds.add(row.resourceId)
} catch (err: any) {
  console.warn(`[StopCond] reference-health lookup failed: ${err?.message}`)
}
```

Then guard the enrol/remove blocks:

```ts
if (matched.enrollWorkflowId && !brokenWorkflowIds.has(matched.enrollWorkflowId)) {
  // ... existing enrol logic
}

if (matched.removeWorkflowId && !brokenWorkflowIds.has(matched.removeWorkflowId)) {
  // ... existing remove logic
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/conversation-state.ts
git commit -m "conversation-state: skip broken workflow side-effects on stop conditions"
```

---

## Task 14: `agent_pause` mode short-circuit in routing

**Files:**
- Modify: `lib/routing.ts`

- [ ] **Step 1: Add a broken-reference check inside `findMatchingAgent`**

Find `findMatchingAgent` in `lib/routing.ts`. The function iterates candidate agents. Inside the loop, after the channel-scope check but before the rule-evaluation logic, add:

```ts
// Reference-health gate. When the workspace is in 'agent_pause' mode and
// this agent has any broken references, skip the agent entirely. Other
// modes (tool_disable, warn_only) are handled at runtime in runAgent.
if (agent.workspace?.brokenReferenceMode === 'agent_pause') {
  try {
    const brokenCount = await db.agentReferenceHealth.count({
      where: { agentId: agent.id, status: 'broken' },
    })
    if (brokenCount > 0) {
      console.log(`[routing] skipping agent ${agent.id}: ${brokenCount} broken refs (mode=agent_pause)`)
      continue
    }
  } catch (err: any) {
    console.warn(`[routing] reference-health check failed for agent ${agent.id}: ${err?.message}`)
    // Fail open — don't block routing on a transient DB hiccup.
  }
}
```

For this to work, the agent query at the top of `findMatchingAgent` must include `workspace: { select: { brokenReferenceMode: true } }`. Find the existing `include` / `select` on that query and append `workspace: { select: { brokenReferenceMode: true } }` to it.

- [ ] **Step 2: Commit**

```bash
git add lib/routing.ts
git commit -m "routing: agent_pause mode skips agents with any broken reference"
```

---

## Task 15: Banner component

**Files:**
- Create: `components/dashboard/AgentReferenceHealthBanner.tsx`

- [ ] **Step 1: Create the banner component**

```tsx
'use client'

import { useEffect, useState } from 'react'

interface ReferenceRow {
  resourceType: string
  resourceId: string
  sourceField: string
  status: string
  lastError: string | null
  lastCheckedAt: string
  firstBrokenAt: string | null
}

/**
 * Top-of-page banner shown on every agent sub-page when the agent has
 * any references in the 'broken' state. Polls /reference-health on
 * mount and after manual re-check.
 */
export function AgentReferenceHealthBanner({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [refs, setRefs] = useState<ReferenceRow[] | null>(null)
  const [rechecking, setRechecking] = useState(false)

  async function load() {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/reference-health`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const data = await res.json()
      setRefs(data.references ?? [])
    } catch {}
  }

  useEffect(() => { void load() }, [workspaceId, agentId])

  const broken = (refs ?? []).filter(r => r.status === 'broken')
  if (broken.length === 0) return null

  async function recheck() {
    setRechecking(true)
    try {
      await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/reference-health/recheck`,
        { method: 'POST' },
      )
      await load()
    } finally {
      setRechecking(false)
    }
  }

  return (
    <div
      role="alert"
      style={{
        background: 'var(--accent-red-bg, #fef2f2)',
        border: '1px solid var(--accent-red, #ef4444)',
        color: 'var(--accent-red, #b91c1c)',
        borderRadius: 8,
        padding: 16,
        margin: '0 0 16px',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {broken.length === 1
          ? '1 broken reference — affected tools have been disabled.'
          : `${broken.length} broken references — affected tools have been disabled.`}
      </div>
      <ul style={{ margin: '8px 0', paddingLeft: 20, fontSize: 13 }}>
        {broken.map(r => (
          <li key={`${r.resourceType}:${r.resourceId}:${r.sourceField}`}>
            <strong>{r.resourceType}</strong> <code>{r.resourceId}</code>
            {' · '}
            <span style={{ opacity: 0.8 }}>{r.sourceField}</span>
            {r.lastError ? <div style={{ opacity: 0.7, fontSize: 12 }}>{r.lastError}</div> : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={recheck}
        disabled={rechecking}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          background: 'var(--accent-red, #ef4444)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: rechecking ? 'wait' : 'pointer',
          border: 'none',
        }}
      >
        {rechecking ? 'Re-checking…' : 'Re-check now'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Mount the banner in the agent layout**

Find the agent-page layout (probably `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx`). At the top of the JSX body — above the existing nav/content — add:

```tsx
<AgentReferenceHealthBanner workspaceId={workspaceId} agentId={agentId} />
```

with an import:

```tsx
import { AgentReferenceHealthBanner } from '@/components/dashboard/AgentReferenceHealthBanner'
```

If the layout is a server component, this import works because the banner is a client component (`'use client'` at top).

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/AgentReferenceHealthBanner.tsx app/dashboard/
git commit -m "ui: AgentReferenceHealthBanner + mount in agent layout"
```

---

## Task 16: Tools page status badges

**Files:**
- Modify: `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx`

- [ ] **Step 1: Fetch reference health on the tools page**

Open `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx`. Find where the page already fetches agent data (server component data fetch, or a client-side useEffect). Add a parallel fetch for reference health rows:

If the page is a server component:

```ts
const referenceHealth = await db.agentReferenceHealth.findMany({
  where: { agentId },
  select: { resourceType: true, resourceId: true, status: true, lastError: true },
})
```

If client-side:

```ts
const [referenceHealth, setReferenceHealth] = useState<Array<{...}>>([])
useEffect(() => {
  fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/reference-health`)
    .then(r => r.json())
    .then(d => setReferenceHealth(d.references ?? []))
}, [workspaceId, agentId])
```

- [ ] **Step 2: Add a badge next to the calendarId field**

Find the calendar config UI block (search for `calendarId` in the page). Adjacent to the field, render:

```tsx
{(() => {
  const broken = referenceHealth.find(
    r => r.resourceType === 'calendar' && r.status === 'broken'
  )
  if (!broken) return null
  return (
    <div style={{
      marginTop: 4,
      padding: '4px 8px',
      background: 'var(--accent-red-bg, #fef2f2)',
      color: 'var(--accent-red, #b91c1c)',
      border: '1px solid var(--accent-red, #ef4444)',
      borderRadius: 4,
      fontSize: 12,
    }}>
      ⚠ This calendar no longer exists in your CRM. {broken.lastError ?? ''}
    </div>
  )
})()}
```

- [ ] **Step 3: Add equivalent badges for workflow fields**

For each StopCondition row's `enrollWorkflowId` / `removeWorkflowId` input, render the same pattern keyed on `resourceType === 'workflow' && resourceId === <the workflow id>`. Adjust the matching filter to the specific reference.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/
git commit -m "ui: per-field broken-reference badges on agent Tools page"
```

---

## Task 17: Workspace setting for broken-reference mode

**Files:**
- Modify: `app/dashboard/[workspaceId]/settings/page.tsx` (or wherever workspace-level settings live; check the sidebar to confirm)
- Modify: `app/api/workspaces/[workspaceId]/route.ts` (or the existing PATCH endpoint for workspace updates)

- [ ] **Step 1: Find the workspace settings page**

Run `find /Users/ryan/Documents/conversationalAI/ghl-agent/app/dashboard/[workspaceId] -type d -name "settings"` to locate the actual settings page. It may be `app/dashboard/[workspaceId]/settings/page.tsx` or a sub-route.

- [ ] **Step 2: Add the picker UI section**

Inside the settings page, in a section titled "Advanced", add (matching the page's existing form patterns):

```tsx
<div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
  <h3>Broken-reference behaviour</h3>
  <p style={{ fontSize: 13, opacity: 0.8 }}>
    When an agent references a calendar, workflow, or other CRM resource
    that no longer exists, choose what should happen.
  </p>
  <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
    <input
      type="radio"
      name="brokenReferenceMode"
      value="tool_disable"
      checked={brokenReferenceMode === 'tool_disable'}
      onChange={() => setBrokenReferenceMode('tool_disable')}
    />
    <div>
      <strong>Disable affected tools only</strong> (recommended) — the
      agent keeps running but the broken tools are dropped.
    </div>
  </label>
  <label style={{ display: 'flex', gap: 8, marginTop: 8 }}>
    <input
      type="radio"
      name="brokenReferenceMode"
      value="agent_pause"
      checked={brokenReferenceMode === 'agent_pause'}
      onChange={() => setBrokenReferenceMode('agent_pause')}
    />
    <div>
      <strong>Pause the entire agent</strong> — no inbounds match the
      agent until you fix the reference.
    </div>
  </label>
  <label style={{ display: 'flex', gap: 8, marginTop: 8 }}>
    <input
      type="radio"
      name="brokenReferenceMode"
      value="warn_only"
      checked={brokenReferenceMode === 'warn_only'}
      onChange={() => setBrokenReferenceMode('warn_only')}
    />
    <div>
      <strong>Warn only</strong> — agent keeps trying, runtime fallback
      handles individual failures.
    </div>
  </label>
</div>
```

Wire the state into the existing save handler so PATCH `/api/workspaces/[workspaceId]` includes `brokenReferenceMode` in the body.

- [ ] **Step 3: Update the workspace PATCH endpoint**

In `app/api/workspaces/[workspaceId]/route.ts`, in the PATCH handler, accept `brokenReferenceMode`:

```ts
const allowedModes = ['tool_disable', 'agent_pause', 'warn_only']
const updates: Record<string, unknown> = {}
if (typeof body.brokenReferenceMode === 'string' && allowedModes.includes(body.brokenReferenceMode)) {
  updates.brokenReferenceMode = body.brokenReferenceMode
}
// ... existing field handling, then:
await db.workspace.update({ where: { id: workspaceId }, data: updates })
```

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/ app/api/workspaces/
git commit -m "workspace settings: broken-reference mode picker"
```

---

## Task 18: Manual verification

- [ ] **Step 1: Save-time happy path**

Open an agent's Tools page, set `calendarId` to a known-valid calendar from the connected CRM, save. Confirm:
- Response payload includes `referenceHealth: [{ resourceType: 'calendar', status: 'healthy', ... }]`
- No banner appears
- DB row exists with `status='healthy'`

- [ ] **Step 2: Save-time broken path**

Set the agent's `calendarId` to an obviously-invalid value (e.g. `bad-id-123`). Save. Confirm:
- Response payload includes `referenceHealth` with the bad row marked `broken`
- Banner appears at the top of every agent sub-page
- DB row has `status='broken'`, `lastError` populated
- An email arrives at the operator's address (per per-user notification fan-out)

- [ ] **Step 3: Cron drift detection**

With a healthy calendar configured, delete the calendar in the CRM. Trigger the cron manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://app.xovera.io/api/cron/agent-reference-health
```

Confirm: response shows `broken: 1`, DB row flips to broken, email + banner appear.

- [ ] **Step 4: tool_disable runtime behaviour**

With the broken calendar from step 3, send an inbound message asking for a booking. Confirm:
- The agent responds (no silent failure)
- The model didn't call any calendar tool (check the tool-call trace in logs / inbox UI)
- The reply doesn't promise a booking (it should say a teammate will follow up)

- [ ] **Step 5: agent_pause mode**

In workspace settings, flip mode to `agent_pause`. Send the same inbound. Confirm:
- The agent is skipped entirely by routing
- No reply is sent by the agent (workspace fallback or silence)
- Log shows `[routing] skipping agent ... broken refs (mode=agent_pause)`

- [ ] **Step 6: warn_only mode**

Flip to `warn_only`. Repeat. Confirm:
- The agent tries the tool
- The tool returns the structured 404 hint
- The runtime fallback shipped 2026-05-28 sends the graceful reply, pauses the conversation, and emails

- [ ] **Step 7: Manual re-check**

With a broken state, restore the calendar in the CRM. From the banner, click "Re-check now". Confirm:
- The button shows "Re-checking…"
- After completion, banner disappears
- `reference_fixed` notification fires (web_push by default)
- Subsequent inbound for booking works normally — tools are re-enabled

- [ ] **Step 8: Auto-resume via cron**

Repeat step 3 to get a broken state. Restore the calendar in the CRM. Wait for the next cron tick OR trigger manually as in step 3. Confirm the row flips to healthy and `reference_fixed` notification fires.

- [ ] **Step 9: Workflow broken in stop condition**

Set a stop condition's `enrollWorkflowId` to a known-bad value. Trigger the stop condition (match its criteria via an inbound). Confirm:
- The pause + tag-needs-attention side effects DO fire
- The enrol-into-workflow side effect is SKIPPED
- The agent's `add_to_workflow` tool is still in the tool list for other (healthy) workflowIds

- [ ] **Step 10: Throttle protection**

Trigger the manual re-check button twice in quick succession. Confirm the second one runs (throttle = 0 for manual). Then trigger cron immediately. Confirm the cron's throttle skips this agent's references (lastCheckedAt < 30min) — the response shows `skipped > 0`.

---

## Self-Review

### Spec coverage

- Default to `tool_disable` with workspace override → Tasks 1, 12, 14, 17 ✓
- Save + cron + manual re-check → Tasks 8, 11, 9 ✓
- Auto-resume on cron + manual button → Tasks 6, 11, 9 ✓
- Declarative validator framework, calendar + workflow registered → Tasks 3, 4 ✓
- Schema (`AgentReferenceHealth` + `Workspace.brokenReferenceMode`) → Task 1 ✓
- Two notification events with deep links → Task 7 ✓
- UI surfaces: banner, tools-page badges, workspace setting → Tasks 15, 16, 17 ✓
- Runtime tool-disable + prompt injection → Task 12 ✓
- Skip broken workflow side effects → Task 13 ✓
- `agent_pause` mode in routing → Task 14 ✓
- Workspace integrations page aggregate count → **GAP — adding as Task 19 below**
- Verification → Task 18 ✓

### Placeholder scan

No "TBD"s. All code blocks are complete. The one forward-declared helper (`fireReferenceTransitionNotification` in Task 6) is implemented in Task 7 as documented.

### Type consistency

`AgentReference` shape consistent across collect.ts, check.ts, validators.ts. `EvaluationResult.transition` enum (`'healthy_to_broken' | 'broken_to_healthy' | null`) matches the `fireReferenceTransitionNotification` signature. `brokenReferenceMode` enum (`'tool_disable' | 'agent_pause' | 'warn_only'`) consistent across schema, runtime, settings UI, and PATCH endpoint.

---

## Task 19: Workspace integrations page aggregate count (gap fix)

**Files:**
- Modify: `app/dashboard/[workspaceId]/integrations/page.tsx`

- [ ] **Step 1: Fetch the aggregate count**

In the integrations page server component (or its data API), add:

```ts
const brokenRefAgentCount = await db.agent.count({
  where: {
    workspaceId,
    referenceHealth: { some: { status: 'broken' } },
  },
})
```

- [ ] **Step 2: Surface in the page header**

When `brokenRefAgentCount > 0`, render at the top of the page (above the integration cards):

```tsx
{brokenRefAgentCount > 0 ? (
  <a
    href={`/dashboard/${workspaceId}/agents?filter=broken-refs`}
    style={{
      display: 'block',
      padding: 12,
      marginBottom: 16,
      background: 'var(--accent-red-bg, #fef2f2)',
      color: 'var(--accent-red, #b91c1c)',
      border: '1px solid var(--accent-red, #ef4444)',
      borderRadius: 8,
      textDecoration: 'none',
      fontSize: 14,
    }}
  >
    {brokenRefAgentCount === 1
      ? '1 agent has broken references'
      : `${brokenRefAgentCount} agents have broken references`}
    {' →'}
  </a>
) : null}
```

(The `?filter=broken-refs` query param is a forward hook — implementing the filter on the agents list is out of scope for Phase A but the link is in place.)

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/
git commit -m "integrations page: aggregate broken-reference count at top"
```

---

## Execution Notes

- After Task 1 step 2 (SQL run by Ryan), the implementing agent should wait for confirmation from Ryan before proceeding to Task 1 step 3.
- Tasks 4 and 5 are tested via vitest (`npm test`); other tasks are verified via Task 18.
- The runtime change in Task 12 has the highest blast radius — if it goes wrong, every inbound is affected. Lean on warn_only mode for the first deploy: ship Tasks 1-11 + 15-17 with the default mode set to `warn_only` in `prisma/schema.prisma` step 5 (`@default("warn_only")`), then flip to `@default("tool_disable")` in a follow-up commit once Task 18 step 4 has been verified in production. **Action for implementer: change step 5 of Task 1 to `@default("warn_only")` if doing a staged rollout; otherwise leave as `@default("tool_disable")`.**
- Phase B (per-tool "use when" + agent presets) is the next spec. It reuses `validators.ts` `dependentTools` directly.
