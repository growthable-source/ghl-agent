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
