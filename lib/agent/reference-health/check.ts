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
 *                            (Added in a later task — declared as
 *                            stub below until then.)
 */

import type { CrmAdapter } from '@/lib/crm/types'
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
    if (!validator) continue

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

  const existing = await db.agentReferenceHealth.findMany({ where: { agentId } })
  const previousStatusByKey = new Map<string, string>()
  const lastCheckedByKey = new Map<string, Date>()
  for (const e of existing) {
    const key = `${e.resourceType}:${e.resourceId}:${e.sourceField}`
    previousStatusByKey.set(key, e.status)
    lastCheckedByKey.set(key, e.lastCheckedAt)
  }

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
        ...(isBrokenTransition ? { firstBrokenAt: new Date() } : {}),
        ...(r.transition === 'broken_to_healthy' ? { firstBrokenAt: null } : {}),
      },
    })

    if (r.transition) {
      // Background notify — implemented in Task 7. Until then, log.
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
