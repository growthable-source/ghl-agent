/**
 * Agent snapshot + restore.
 *
 * Two UX surfaces use the same underlying plumbing:
 *
 *   - Save as template → snapshotAgent() → stored on AgentTemplate.config
 *   - Duplicate agent  → snapshotAgent() → restoreAgent() immediately,
 *                        skipping the template step
 *
 * The "snapshot" captures everything that defines an agent's behaviour.
 * We deliberately do NOT capture runtime state (conversation history,
 * message logs, contact memories, channel deployments, vapi phone
 * numbers) — those belong to the original agent and would be confusing
 * to clone.
 */

import { db } from './db'

export interface AgentSnapshot {
  version: 1
  // Core
  name: string
  systemPrompt: string
  instructions: string | null
  enabledTools: string[]
  calendarId: string | null
  qualifyingStyle: string
  fallbackBehavior: string
  fallbackMessage: string | null
  // Persona
  agentPersonaName: string | null
  responseLength: string
  formalityLevel: string
  useEmojis: boolean
  neverSayList: string[]
  simulateTypos: boolean
  typingDelayEnabled: boolean
  typingDelayMinMs: number
  typingDelayMaxMs: number
  languages: string[]
  // Working hours
  workingHoursEnabled: boolean
  workingHoursStart: number
  workingHoursEnd: number
  workingDays: string[]
  timezone: string | null
  // Workflow picker (legacy — superseded by rules but kept for fidelity)
  addToWorkflowsPick: any
  removeFromWorkflowsPick: any
  // Approval
  requireApproval: boolean
  approvalRules: any
  // Advanced-context agent profile (Simple vs Advanced + business glossary)
  agentType: string
  businessContext: string | null
  // Relations — serialisable shapes. IDs / FKs stripped before save.
  knowledgeEntries: Array<any>
  routingRules: Array<any>
  detectionRules: Array<any>
  listeningRules: Array<any>
  stopConditions: Array<any>
  qualifyingQuestions: Array<any>
  followUpSequences: Array<any>
  triggers: Array<any>
  // Voice config (one-to-one)
  vapiConfig: any | null
}

/** Strip fields that are meaningless in a snapshot (ids, FKs, timestamps). */
function strip(row: any) {
  const { id, agentId, createdAt, updatedAt, ...rest } = row
  return rest
}

export async function snapshotAgent(agentId: string): Promise<AgentSnapshot> {
  const a = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      knowledgeEntries: true,
      routingRules: true,
      detectionRules: true,
      listeningRules: true,
      stopConditions: true,
      qualifyingQuestions: { orderBy: { order: 'asc' } },
      followUpSequences: { include: { steps: { orderBy: { stepNumber: 'asc' } } } },
      triggers: true,
      vapiConfig: true,
    },
  })
  if (!a) throw new Error(`Agent ${agentId} not found`)

  return {
    version: 1,
    name: a.name,
    systemPrompt: a.systemPrompt,
    instructions: a.instructions,
    enabledTools: a.enabledTools,
    calendarId: a.calendarId,
    qualifyingStyle: a.qualifyingStyle,
    fallbackBehavior: a.fallbackBehavior,
    fallbackMessage: a.fallbackMessage,
    agentPersonaName: a.agentPersonaName,
    responseLength: a.responseLength,
    formalityLevel: a.formalityLevel,
    useEmojis: a.useEmojis,
    neverSayList: a.neverSayList,
    simulateTypos: a.simulateTypos,
    typingDelayEnabled: a.typingDelayEnabled,
    typingDelayMinMs: a.typingDelayMinMs,
    typingDelayMaxMs: a.typingDelayMaxMs,
    languages: a.languages,
    workingHoursEnabled: a.workingHoursEnabled,
    workingHoursStart: a.workingHoursStart,
    workingHoursEnd: a.workingHoursEnd,
    workingDays: a.workingDays,
    timezone: a.timezone,
    addToWorkflowsPick: (a as any).addToWorkflowsPick ?? null,
    removeFromWorkflowsPick: (a as any).removeFromWorkflowsPick ?? null,
    requireApproval: a.requireApproval,
    approvalRules: a.approvalRules,
    agentType: (a as any).agentType ?? 'SIMPLE',
    businessContext: (a as any).businessContext ?? null,

    knowledgeEntries: a.knowledgeEntries.map(k => ({
      title: k.title, content: k.content, source: k.source, sourceUrl: k.sourceUrl,
      tokenEstimate: k.tokenEstimate,
    })),
    routingRules: a.routingRules.map(strip),
    detectionRules: a.detectionRules.map(strip),
    listeningRules: a.listeningRules.map(strip),
    stopConditions: a.stopConditions.map(strip),
    qualifyingQuestions: a.qualifyingQuestions.map(strip),
    // Nested — steps live on FollowUpSequence and need their ids stripped too
    followUpSequences: a.followUpSequences.map(s => ({
      ...strip(s),
      steps: s.steps.map(st => ({
        stepNumber: st.stepNumber, delayHours: st.delayHours, message: st.message,
      })),
    })),
    triggers: a.triggers.map(strip),
    // Voice config — one row. Intentionally DROP phoneNumberId /
    // phoneNumber on restore: the clone shouldn't inherit the source's
    // provisioned number. Everything else (voice id, tuning, prompts) is
    // copied. isActive forced false so cloned voice agents don't
    // accidentally start taking calls.
    vapiConfig: a.vapiConfig ? (() => {
      const { id, agentId, createdAt, updatedAt, phoneNumberId, phoneNumber, isActive, ...rest } = a.vapiConfig as any
      return { ...rest, phoneNumberId: null, phoneNumber: null, isActive: false }
    })() : null,
  }
}

/**
 * Create a brand-new agent from a snapshot. Used by:
 *   - /duplicate (direct path, skipping template storage)
 *   - /templates/:id/install when the template has a config blob
 *
 * The caller picks name + workspaceId + locationId so a single helper
 * covers both "duplicate into same workspace" and "install template
 * into target workspace." Returns the created agent id.
 */
export async function restoreAgent(params: {
  snapshot: AgentSnapshot
  workspaceId: string
  locationId: string
  /** New agent name. Caller usually appends " (Copy)" or uses the template name. */
  name: string
}): Promise<string> {
  const { snapshot: s, workspaceId, locationId, name } = params

  const agent = await db.agent.create({
    data: {
      workspaceId,
      locationId,
      name,
      systemPrompt: s.systemPrompt,
      instructions: s.instructions,
      enabledTools: s.enabledTools,
      calendarId: s.calendarId,
      qualifyingStyle: s.qualifyingStyle,
      fallbackBehavior: s.fallbackBehavior,
      fallbackMessage: s.fallbackMessage,
      agentPersonaName: s.agentPersonaName,
      responseLength: s.responseLength as any,
      formalityLevel: s.formalityLevel as any,
      useEmojis: s.useEmojis,
      neverSayList: s.neverSayList,
      simulateTypos: s.simulateTypos,
      typingDelayEnabled: s.typingDelayEnabled,
      typingDelayMinMs: s.typingDelayMinMs,
      typingDelayMaxMs: s.typingDelayMaxMs,
      languages: s.languages,
      workingHoursEnabled: s.workingHoursEnabled,
      workingHoursStart: s.workingHoursStart,
      workingHoursEnd: s.workingHoursEnd,
      workingDays: s.workingDays,
      timezone: s.timezone,
      addToWorkflowsPick: s.addToWorkflowsPick ?? undefined,
      removeFromWorkflowsPick: s.removeFromWorkflowsPick ?? undefined,
      requireApproval: s.requireApproval,
      approvalRules: s.approvalRules ?? undefined,
      agentType: s.agentType ?? 'SIMPLE',
      businessContext: s.businessContext ?? null,
      // Cloned agents land DISABLED by default. Users should re-review
      // channel deployments and voice config before going live again —
      // especially for templates installed into a fresh workspace.
      isActive: false,
    },
  })

  // Recreate every related row. Each block is independent so partial
  // failure on one type doesn't kill the rest of the restore.
  try {
    for (const k of s.knowledgeEntries || []) {
      await db.knowledgeEntry.create({ data: { ...k, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] knowledge failed:', err.message) }

  try {
    for (const r of s.routingRules || []) {
      await db.routingRule.create({ data: { ...r, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] routingRules failed:', err.message) }

  try {
    for (const r of s.detectionRules || []) {
      await (db as any).agentRule.create({ data: { ...r, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] detectionRules failed:', err.message) }

  try {
    for (const r of s.listeningRules || []) {
      await (db as any).agentListeningRule.create({ data: { ...r, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] listeningRules failed:', err.message) }

  try {
    for (const sc of s.stopConditions || []) {
      await db.stopCondition.create({ data: { ...sc, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] stopConditions failed:', err.message) }

  try {
    for (const q of s.qualifyingQuestions || []) {
      await db.qualifyingQuestion.create({ data: { ...q, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] qualifyingQuestions failed:', err.message) }

  try {
    for (const seq of s.followUpSequences || []) {
      const { steps, ...seqRest } = seq
      const created = await db.followUpSequence.create({
        data: { ...seqRest, agentId: agent.id },
      })
      for (const st of (steps || [])) {
        await db.followUpStep.create({ data: { ...st, sequenceId: created.id } })
      }
    }
  } catch (err: any) { console.warn('[restoreAgent] followUpSequences failed:', err.message) }

  try {
    for (const t of s.triggers || []) {
      await db.agentTrigger.create({ data: { ...t, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] triggers failed:', err.message) }

  try {
    if (s.vapiConfig) {
      await db.vapiConfig.create({ data: { ...s.vapiConfig, agentId: agent.id } })
    }
  } catch (err: any) { console.warn('[restoreAgent] vapiConfig failed:', err.message) }

  return agent.id
}
