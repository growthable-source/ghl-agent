/**
 * Agent Self-Experimentation runtime.
 *
 * - resolveExperimentVariant() — for an agent + contactId, returns the
 *   appended-prompt for whichever variant the contact lands in. Idempotent
 *   per (experiment, contact) and writes an "exposed" event the first time.
 * - recordExperimentConversion() — called from recordGoalAchievements when
 *   a contact achieves a goal. Looks up any "exposed" events for that
 *   contact and writes matching "converted" events.
 *
 * Bucketing is a deterministic hash of contactId + experimentId. A given
 * contact always lands in the same bucket for a given experiment, so the
 * exposure stays consistent across multiple inbounds.
 */

import { createHash } from 'node:crypto'
import { db } from './db'

export interface ResolvedVariant {
  experimentId: string
  variant: 'A' | 'B'
  appendPrompt: string | null
}

/**
 * Pick a stable bucket [0,99] for (contactId, experimentId).
 * Uses MD5 → first 4 bytes → mod 100. MD5 is fine here; not security-critical.
 */
function bucket(contactId: string, experimentId: string): number {
  const h = createHash('md5').update(`${experimentId}:${contactId}`).digest()
  return h.readUInt32BE(0) % 100
}

/**
 * Returns variant assignments for every running experiment on this agent
 * applied to this contact. Writes an "exposed" event the first time we see
 * (experiment, contact) so we can compute denominators later.
 *
 * Multiple concurrent experiments on the same agent stack: variants append
 * their prompt fragments together. Operators should normally only run one
 * at a time; we don't enforce that.
 */
export async function resolveExperimentVariants(
  agentId: string | undefined,
  contactId: string,
): Promise<ResolvedVariant[]> {
  if (!agentId || !contactId) return []
  let experiments: any[]
  try {
    experiments = await (db as any).agentExperiment.findMany({
      where: { agentId, status: 'running' },
    })
  } catch (err: any) {
    if (
      err?.code === 'P2021'
      || err?.code === 'P2022'
      || /relation .* does not exist/i.test(err?.message ?? '')
    ) return []
    throw err
  }
  if (experiments.length === 0) return []

  const out: ResolvedVariant[] = []
  for (const exp of experiments) {
    const b = bucket(contactId, exp.id)
    const split = Math.max(0, Math.min(100, exp.splitPercent ?? 50))
    const variant: 'A' | 'B' = b < split ? 'B' : 'A'
    const appendPrompt = variant === 'B' ? exp.variantBPrompt : (exp.variantAPrompt || null)
    out.push({ experimentId: exp.id, variant, appendPrompt })

    // Record exposure idempotently
    await (db as any).agentExperimentEvent.upsert({
      where: {
        experimentId_contactId_outcome: {
          experimentId: exp.id, contactId, outcome: 'exposed',
        },
      },
      create: { experimentId: exp.id, contactId, variant, outcome: 'exposed' },
      update: { variant }, // keep variant in sync if splitPercent ever changes (rare)
    }).catch(() => {})
  }
  return out
}

/**
 * Build the system-prompt suffix for the resolved variants. Empty string
 * if no variants append anything.
 */
export function buildExperimentBlock(variants: ResolvedVariant[]): string {
  const fragments = variants
    .map(v => v.appendPrompt?.trim())
    .filter((s): s is string => !!s)
  if (fragments.length === 0) return ''
  return '\n\n## Active experiment instructions\n' + fragments.join('\n\n')
}

/**
 * Called when a contact achieves a goal. Looks up any "exposed" events
 * for this contact across this agent's running experiments and writes
 * "converted" events. Idempotent via the unique (experiment, contact,
 * outcome) constraint.
 *
 * `metricKey` examples: "any_goal", "appointment_booked", "tag_added:hot".
 * If an experiment's metric matches the achieved goal, we record the
 * conversion; non-matching experiments are skipped.
 */
export async function recordExperimentConversion(params: {
  agentId: string
  contactId: string
  metricKey: string
  goalEventId?: string | null
}) {
  try {
    const exposures = await (db as any).agentExperimentEvent.findMany({
      where: {
        contactId: params.contactId,
        outcome: 'exposed',
        experiment: { agentId: params.agentId, status: 'running' },
      },
      include: { experiment: { select: { metric: true } } },
    })
    for (const e of exposures) {
      const metric = e.experiment?.metric || 'any_goal'
      const matches = metric === 'any_goal' || metric === params.metricKey
      if (!matches) continue
      await (db as any).agentExperimentEvent.upsert({
        where: {
          experimentId_contactId_outcome: {
            experimentId: e.experimentId, contactId: params.contactId, outcome: 'converted',
          },
        },
        create: {
          experimentId: e.experimentId,
          contactId: params.contactId,
          variant: e.variant,
          outcome: 'converted',
          goalEventId: params.goalEventId ?? null,
        },
        update: {},
      }).catch(() => {})
    }
  } catch (err: any) {
    // Non-fatal — never block the conversation flow on experiment bookkeeping.
    console.warn('[Experiments] conversion record failed:', err.message)
  }
}

/**
 * Aggregate exposures + conversions for an experiment, returning per-variant
 * counts and a simple lift number. Used by the dashboard.
 */
export async function getExperimentStats(experimentId: string) {
  let rows: any[]
  try {
    rows = await (db as any).agentExperimentEvent.groupBy({
      by: ['variant', 'outcome'],
      where: { experimentId },
      _count: { _all: true },
    })
  } catch { return null }
  const exposures: Record<'A' | 'B', number> = { A: 0, B: 0 }
  const conversions: Record<'A' | 'B', number> = { A: 0, B: 0 }
  for (const r of rows) {
    const v = (r.variant === 'A' ? 'A' : 'B') as 'A' | 'B'
    if (r.outcome === 'exposed') exposures[v] = r._count._all
    else if (r.outcome === 'converted') conversions[v] = r._count._all
  }
  const rateA = exposures.A > 0 ? conversions.A / exposures.A : 0
  const rateB = exposures.B > 0 ? conversions.B / exposures.B : 0
  const liftPct = rateA > 0 ? ((rateB - rateA) / rateA) * 100 : 0
  return { exposures, conversions, rateA, rateB, liftPct }
}
