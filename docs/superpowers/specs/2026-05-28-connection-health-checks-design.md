# Connection Health Checks (Phase A)

**Status:** Approved design, ready for implementation plan
**Date:** 2026-05-28
**Author:** Ryan + Claude
**Phase:** A of a 3-phase agent-control redesign

## Context

The WhatsApp test on 2026-05-28 surfaced a class of bug we had no protection against. The agent was configured with a `calendarId` that no longer resolved in LeadConnector — the calendar had been deleted, renamed, or come from a different sub-account. When the model called `get_available_slots`, GHL returned 404. We shipped same-day a runtime fallback (graceful reply to the contact + pause conversation + email operator), but the underlying problem stands: **we had no way to know the agent's calendar reference was stale until a contact triggered the failure**.

This phase adds proactive detection — validate the resources an agent references on save, periodically via cron, and on-demand. When a reference goes stale, surface it to the operator before a contact ever sees the agent fumble.

Phase B (per-tool "use when" conditioning + agent presets) and Phase C (LLM-enforced gating for high-stakes tools) are separate specs.

## Goals

- Detect broken GHL resource references before they cause an inbound-message failure
- Surface broken state to the operator with enough context to fix it
- Default to gracefully degrading the agent (drop the affected tools, keep the rest running) rather than disabling the whole agent
- Make adding new validators a 10-line addition, not a redesign — the same framework will cover HubSpot, Shopify, and future CRMs as those grow agent-referenced IDs

## Non-goals

- Validating tags, custom field values, or other string-keyed references (different failure class — they don't 404, they just don't match)
- Replacing the runtime fallback shipped 2026-05-28 — that stays as the last-mile safety net for the rare window between cron runs
- Fixing the operator's CRM for them (we detect + alert, they fix in GHL)

## Architecture decisions (chosen during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Default reaction to a broken reference | **Tool-level disable** — drop the affected tools, keep the rest of the agent running | Surgical, preserves agent value, the only option where one broken calendar doesn't kill SMS/CRM replies. |
| Other reaction modes available? | Yes, workspace-admin can override to `agent_pause` (skip the agent entirely) or `warn_only` (current behaviour) | Different teams have different tolerance for partial degradation. |
| When does validation run? | **Save + cron + on-demand button** | Save catches typos, cron catches drift, button removes "did my fix work?" friction. |
| Cron interval | Hourly | Cheap, and the existing runtime fallback covers the worst-case 60-minute window. |
| Validation scope at ship | Calendar + Workflow, but built on a registry so adding more is a config entry | Two highest-risk types covered, framework pays off architecture cost immediately. |
| Resume flow | **Auto-resume on cron + manual "Re-check now"** | Operator doesn't need to remember to acknowledge; they can also force-resume after a fix without waiting. |
| Re-enable behaviour when auto-detected fixed | Silent — tool re-enables, `reference_fixed` notification fires | Cron is operator-trusted; an ack gate would just add a step. |

## Schema changes

One new table:

```prisma
model AgentReferenceHealth {
  id            String    @id @default(cuid())
  agentId       String
  agent         Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  resourceType  String    // 'calendar' | 'workflow' | (future)
  resourceId    String    // the GHL ID
  sourceField   String    // 'Agent.calendarId' | 'StopCondition[<id>].enrollWorkflowId' | …
  status        String    // 'healthy' | 'broken' | 'transient_error'
  lastCheckedAt DateTime
  lastError     String?
  firstBrokenAt DateTime?
  
  @@unique([agentId, resourceType, resourceId, sourceField])
  @@index([agentId, status])
}
```

One column on Workspace:

```prisma
model Workspace {
  // …existing fields…
  brokenReferenceMode String @default("tool_disable")  
  // 'tool_disable' | 'agent_pause' | 'warn_only'
}
```

### Manual SQL (Ryan runs by hand per memory:feedback_migration_sql_first)

Saved to `prisma/migrations-legacy/manual_agent_reference_health.sql`:

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

## Validator framework

### Registry

`lib/agent/reference-health/validators.ts`:

```ts
interface Validator {
  /** Returns null if healthy, error message string if broken, throws for transient. */
  fetch: (adapter: CrmAdapter, id: string) => Promise<null | string>
  /** Human-friendly type name for the UI ("Calendar", "Workflow"). */
  label: string
  /** Tools that should be disabled when ANY reference of this type is broken on an agent. */
  dependentTools: string[]
}

const VALIDATORS: Record<string, Validator> = {
  calendar: {
    label: 'Calendar',
    fetch: async (adapter, id) => {
      try {
        await adapter.getCalendar(id)
        return null
      } catch (err: any) {
        if (/\b404\b|not\s*found/i.test(err?.message ?? '')) return err.message
        throw err  // transient — propagate
      }
    },
    dependentTools: [
      'get_available_slots', 'book_appointment', 'cancel_appointment',
      'reschedule_appointment', 'get_calendar_events',
    ],
  },
  workflow: {
    label: 'Workflow',
    fetch: async (adapter, id) => {
      // GHL doesn't have a single-workflow GET — list and find.
      const workflows = await adapter.listWorkflows()
      if (!workflows.some(w => w.id === id)) return `workflow ${id} not found`
      return null
    },
    // Workflow tools are per-call rather than per-agent — one broken workflow
    // doesn't block all workflow operations. The StopCondition row referencing
    // the broken workflow is what gets disabled (see runtime section), not the
    // tools themselves. We still list the tools here so the UI can flag them.
    dependentTools: ['add_to_workflow', 'remove_from_workflow'],
  },
}
```

### Reference collector

`lib/agent/reference-health/collect.ts`:

```ts
interface AgentReference {
  resourceType: string
  resourceId: string
  sourceField: string
}

function collectAgentReferences(agent: Agent & {
  stopConditions: StopCondition[]
  triggers: AgentTrigger[]
}): AgentReference[] {
  const refs: AgentReference[] = []
  if (agent.calendarId) {
    refs.push({ resourceType: 'calendar', resourceId: agent.calendarId, sourceField: 'Agent.calendarId' })
  }
  for (const sc of agent.stopConditions) {
    if (sc.enrollWorkflowId) {
      refs.push({ resourceType: 'workflow', resourceId: sc.enrollWorkflowId, sourceField: `StopCondition[${sc.id}].enrollWorkflowId` })
    }
    if (sc.removeWorkflowId) {
      refs.push({ resourceType: 'workflow', resourceId: sc.removeWorkflowId, sourceField: `StopCondition[${sc.id}].removeWorkflowId` })
    }
  }
  return refs
}
```

### Check + upsert

`lib/agent/reference-health/check.ts`:

```ts
async function runReferenceHealthCheck(agentId: string): Promise<{
  healthy: number
  broken: number
  transient: number
}> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { stopConditions: true, triggers: true, location: true },
  })
  if (!agent) return { healthy: 0, broken: 0, transient: 0 }

  const refs = collectAgentReferences(agent)
  const adapter = await getCrmAdapter(agent.locationId)
  
  let healthy = 0, broken = 0, transient = 0
  const previousStatusById = new Map<string, string>()  // for transition detection
  
  // Load previous status before upserting so we can detect healthy->broken
  // and broken->healthy transitions for notifications.
  const existing = await db.agentReferenceHealth.findMany({ where: { agentId } })
  for (const e of existing) {
    previousStatusById.set(`${e.resourceType}:${e.resourceId}:${e.sourceField}`, e.status)
  }
  
  for (const ref of refs) {
    const validator = VALIDATORS[ref.resourceType]
    if (!validator) continue
    
    let status: 'healthy' | 'broken' | 'transient_error' = 'healthy'
    let lastError: string | null = null
    
    try {
      const err = await validator.fetch(adapter, ref.resourceId)
      if (err) { status = 'broken'; lastError = err }
    } catch (err: any) {
      // Transient — don't flip to broken, just leave existing status alone.
      // We log lastError so operators investigating can see what happened.
      status = 'transient_error'
      lastError = err?.message ?? 'unknown'
    }
    
    const key = `${ref.resourceType}:${ref.resourceId}:${ref.sourceField}`
    const previousStatus = previousStatusById.get(key)
    
    // For transient errors, preserve the previous healthy/broken status so
    // a GHL outage doesn't clobber a known-broken or known-healthy state.
    const writeStatus = status === 'transient_error' && previousStatus
      ? previousStatus
      : status
    
    await db.agentReferenceHealth.upsert({
      where: {
        agentId_resourceType_resourceId_sourceField: {
          agentId, resourceType: ref.resourceType,
          resourceId: ref.resourceId, sourceField: ref.sourceField,
        },
      },
      create: {
        agentId, resourceType: ref.resourceType, resourceId: ref.resourceId,
        sourceField: ref.sourceField, status: writeStatus,
        lastCheckedAt: new Date(), lastError,
        firstBrokenAt: writeStatus === 'broken' ? new Date() : null,
      },
      update: {
        status: writeStatus, lastCheckedAt: new Date(), lastError,
        firstBrokenAt: writeStatus === 'broken'
          ? (previousStatus === 'broken' ? undefined : new Date())
          : null,
      },
    })
    
    // Transition notifications
    if (previousStatus !== 'broken' && writeStatus === 'broken') {
      await fireReferenceBrokenNotification(agent, ref, lastError ?? '')
    } else if (previousStatus === 'broken' && writeStatus === 'healthy') {
      await fireReferenceFixedNotification(agent, ref)
    }
    
    if (writeStatus === 'healthy') healthy++
    else if (writeStatus === 'broken') broken++
    else transient++
  }
  
  return { healthy, broken, transient }
}
```

## Detection paths

### Save validation
`PATCH /api/workspaces/[wsId]/agents/[agentId]` calls `runReferenceHealthCheck(agentId)` after the update completes. The save isn't blocked — the response simply includes a `references` array the UI uses to show inline errors. (Blocking the save would prevent users from fixing other fields when one reference is broken.)

### Cron
New route: `app/api/cron/agent-reference-health/route.ts`. Vercel cron entry: hourly. Iterates every Agent that has at least one reference (skip empty ones to save cost). Throttling: when checking a given reference, skip if its `AgentReferenceHealth.lastCheckedAt` is < 30min old — protects against accidental double-runs and against the manual "Re-check now" button triggering immediate cron-redundant work.

### Manual re-check
`POST /api/workspaces/[wsId]/agents/[agentId]/reference-health/recheck` — operator-triggered. Inline button next to the broken banner. Calls the same `runReferenceHealthCheck` function. No throttling on manual.

## Runtime — what `brokenReferenceMode` actually does

Inside `runAgent`, before the tool list is built:

```ts
const brokenRefs = await db.agentReferenceHealth.findMany({
  where: { agentId: agent.id, status: 'broken' },
})

const mode = workspace.brokenReferenceMode ?? 'tool_disable'

if (mode === 'agent_pause' && brokenRefs.length > 0) {
  // Don't even build the agent run — let the workspace's fallback handle it.
  return { reply: null, skipped: 'broken_references' }
}

if (mode === 'tool_disable') {
  const toolsToHide = new Set<string>()
  const brokenLabels: string[] = []
  for (const ref of brokenRefs) {
    const validator = VALIDATORS[ref.resourceType]
    if (!validator) continue
    for (const t of validator.dependentTools) toolsToHide.add(t)
    brokenLabels.push(`${validator.label} ${ref.resourceId}`)
  }
  enabledTools = enabledTools.filter(t => !toolsToHide.has(t))
  if (brokenLabels.length > 0) {
    systemPrompt += `\n\nIMPORTANT: The following references are temporarily unavailable due to a configuration issue: ${brokenLabels.join(', ')}. The associated tools have been removed. If the contact asks about scheduling or workflow actions, acknowledge their request and say a teammate will follow up shortly. Do not pretend to attempt these actions.`
  }
}

// mode === 'warn_only' — no runtime change; existing fallback handles failures.
```

For workflow refs specifically, the broken StopCondition (the one whose `enrollWorkflowId` is broken) is skipped in `executeStopConditionActions` — its side-effect doesn't run, but the pause + tag-needs-attention still does. This is implemented in `lib/conversation-state.ts` as a small filter inside `executeStopConditionActions`.

## UI surfaces

### Agent list (workspace dashboard)
Red dot indicator on agents with `≥1` broken reference. Tooltip lists count and types ("1 calendar, 1 workflow"). Implementation: extend the existing agent-list query to include `_count` of `agentReferenceHealth where status='broken'`.

### Agent page top banner (every sub-page)
Persistent banner on `app/dashboard/[wsId]/agents/[agentId]/*` when refs are broken. Shows:
- Resource type + ID + source field
- "Open in CRM" link (uses existing GHL URL pattern from `lib/handover-link.ts`)
- "Re-check now" button → calls the manual re-check API and refreshes

Component: `components/dashboard/AgentReferenceHealthBanner.tsx`. Imported into the agent layout so it appears on every agent sub-page.

### Agent Tools page
Per-tool red status badge next to the calendarId / workflowId field that's broken. Inline error message from `AgentReferenceHealth.lastError`.

### Workspace integrations page
Aggregate count at the top: "3 agents have broken references" → clickable, filters the agent list.

## Notifications

Two new entries in `lib/notification-events.ts`:

```ts
{
  id: 'reference_broken',
  label: 'Agent reference broken',
  description: 'An agent\'s calendar, workflow, or other CRM resource no longer resolves.',
  defaultUserChannels: ['email', 'web_push'],
},
{
  id: 'reference_fixed',
  label: 'Agent reference recovered',
  description: 'A previously broken reference is healthy again.',
  defaultUserChannels: ['web_push'],
},
```

Title shape: *"Calendar abc123xyz broken on agent 'After-hours booker'"*. Body names the resource + agent + the runtime impact (which tools are disabled) + deep link to the agent Tools page.

## Critical files

**New:**
- `prisma/migrations-legacy/manual_agent_reference_health.sql`
- `lib/agent/reference-health/validators.ts`
- `lib/agent/reference-health/collect.ts`
- `lib/agent/reference-health/check.ts`
- `app/api/cron/agent-reference-health/route.ts`
- `app/api/workspaces/[wsId]/agents/[agentId]/reference-health/recheck/route.ts`
- `components/dashboard/AgentReferenceHealthBanner.tsx`

**Modified:**
- `prisma/schema.prisma` — `AgentReferenceHealth` model, `Workspace.brokenReferenceMode`, relation on `Agent`
- `lib/notification-events.ts` — two new events
- `lib/ai-agent.ts` — runtime tool-disable + system prompt injection
- `lib/conversation-state.ts` — skip stop conditions referencing broken workflows
- `lib/routing.ts` — `agent_pause` mode early-out
- `app/api/workspaces/[wsId]/agents/[agentId]/route.ts` — call health check after PATCH, include refs in response
- Agent layout — mount the banner
- `app/dashboard/[wsId]/agents/[agentId]/tools/page.tsx` — per-field status badges
- `vercel.json` — cron entry for the new route
- `lib/crm/ghl/adapter.ts` — add `getCalendar(id)` method if not already there (likely is — `fetchCalendarMetadata`)

## Verification

1. **Save validation** — open an agent, set `calendarId` to a known-bad value, save. Confirm response includes `references: [{ status: 'broken', resourceType: 'calendar', … }]` and the agent page banner appears.
2. **Save validation, healthy** — set `calendarId` to a real calendar, save. Confirm no banner, no `AgentReferenceHealth` row marked broken.
3. **Cron drift detection** — set agent up with a healthy calendar, then delete the calendar in GHL, wait for or manually trigger the cron. Confirm row transitions to `status='broken'`, email fires, banner appears.
4. **Tool-disable mode** — confirm the runtime drops `get_available_slots` etc. from the model's tool list when calendar is broken. Send an inbound asking for a booking; agent should respond ("a teammate will follow up") without trying to call the missing tool. Verify in the tool-call trace that the calendar tools were never even available.
5. **Agent-pause mode** — flip `Workspace.brokenReferenceMode='agent_pause'`, repeat (4). Inbound should not trigger the agent at all.
6. **Warn-only mode** — flip to `warn_only`, repeat (4). Agent should try the tool, hit the 404, fall through to the runtime fallback we shipped 2026-05-28.
7. **Auto-resume** — with a broken reference, restore the calendar in GHL, trigger cron. Confirm row flips to `healthy`, `reference_fixed` notification fires, banner clears, tools re-enable.
8. **Manual re-check** — broken state → click "Re-check now" → confirm validator runs inline, state updates, no waiting for cron.
9. **Workflow broken in a StopCondition** — set a stop condition's `enrollWorkflowId` to a known-bad value, confirm:
   - Cron flags the workflow as broken
   - `add_to_workflow` and `remove_from_workflow` tools stay enabled (other workflows still callable)
   - The specific stop-condition side-effect is skipped when triggered
   - The conversation still pauses if the stop condition's other criteria match
10. **Multi-workspace cron** — runs across all workspaces, doesn't leak between them (sanity check on workspace scoping).

## Open questions deliberately not resolved here

- HubSpot validators — defer until HubSpot adapter parity is on the roadmap. Framework handles it when needed.
- Pipeline-stage validation in `RoutingRule.conditions` — defer to Phase B (per-tool/per-rule "use when" makes this orthogonal).
- Custom-field validation — defer. Failure mode is silent ("field never matches") rather than 404-loud, different incident class.
- Cron frequency tuning — start hourly, revisit if operators complain about either too-slow detection or too-noisy notifications.

## Sequencing into Phase B

Phase B (per-tool "use when" + agent presets) reuses this validator framework directly:
- The framework's `dependentTools` mapping is the same shape Phase B needs for "this tool isn't available right now, here's why."
- Phase B's "Booking Bot" preset can wire the calendarId field with inline save-time validation already.
- Phase B's per-tool "on failure" UX gains a fourth dropdown option: `auto_disable_until_resource_healthy` — which is exactly what Phase A's `tool_disable` mode does at the workspace level.

Phase A doesn't block Phase B starting; both can be in flight if needed.
