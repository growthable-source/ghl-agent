/**
 * Hard-coded agent presets (Phase B2).
 *
 * Applied at agent creation (via the wizard) or post-hoc (via the
 * "Apply preset" button on the /tools page). Application writes
 * Agent.toolAutonomyMode + Agent.presetId, and upserts AgentToolConfig
 * rows for every delta. Tools not listed in a preset are left at catalog
 * defaults (no AgentToolConfig row written).
 *
 * Presets are TEMPLATES, not live links: once applied, agent config is
 * decoupled from the preset definition. Editing this file affects future
 * applications, not existing agents.
 */

import { db } from '@/lib/db'

type OnFailureMode = 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'

export interface PresetToolDelta {
  toolName: string
  enabled?: boolean
  /** Overrides catalog default if set. Leave undefined to use the catalog. */
  useWhen?: string
  onFailure?: OnFailureMode
  onFailureMessage?: string
}

export interface AgentPreset {
  id: string
  label: string
  description: string
  autonomyMode: 'guided' | 'autonomous'
  tools: PresetToolDelta[]
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'conversational',
    label: 'Conversational Bot',
    description: 'Answers questions, qualifies, takes notes. Does NOT book, send email, or move money. Calendar + opportunity writes + commerce tools are disabled.',
    autonomyMode: 'guided',
    tools: [
      // Calendar — all off
      { toolName: 'get_available_slots', enabled: false },
      { toolName: 'book_appointment', enabled: false },
      { toolName: 'cancel_appointment', enabled: false },
      { toolName: 'reschedule_appointment', enabled: false },
      { toolName: 'get_calendar_events', enabled: false },
      { toolName: 'create_appointment_note', enabled: false },
      // Email off — chat-only
      { toolName: 'send_email', enabled: false },
      // Opportunity writes — off
      { toolName: 'move_opportunity_stage', enabled: false },
      { toolName: 'mark_opportunity_won', enabled: false },
      { toolName: 'mark_opportunity_lost', enabled: false },
      { toolName: 'upsert_opportunity', enabled: false },
      // Workflows — off (consequential enrolment for a chat-only bot)
      { toolName: 'add_to_workflow', enabled: false },
      { toolName: 'remove_from_workflow', enabled: false },
      // Commerce — off
      { toolName: 'search_shopify_products', enabled: false },
      { toolName: 'check_shopify_inventory', enabled: false },
      { toolName: 'lookup_shopify_customer', enabled: false },
      { toolName: 'check_shopify_order_status', enabled: false },
      { toolName: 'create_shopify_checkout', enabled: false },
      { toolName: 'create_shopify_discount', enabled: false },
      { toolName: 'record_back_in_stock_interest', enabled: false },
    ],
  },
  {
    id: 'booking',
    label: 'Booking Bot',
    description: 'Built around scheduling. Calendar tools on with strict catalog defaults ("only after slots picked"). Disables commerce + opportunity writes. Transfers to human if booking fails.',
    autonomyMode: 'guided',
    tools: [
      // Calendar — all on by default (no deltas needed for enable)
      // Opportunity writes — off
      { toolName: 'move_opportunity_stage', enabled: false },
      { toolName: 'mark_opportunity_won', enabled: false },
      { toolName: 'mark_opportunity_lost', enabled: false },
      { toolName: 'upsert_opportunity', enabled: false },
      // Commerce — off
      { toolName: 'search_shopify_products', enabled: false },
      { toolName: 'check_shopify_inventory', enabled: false },
      { toolName: 'lookup_shopify_customer', enabled: false },
      { toolName: 'check_shopify_order_status', enabled: false },
      { toolName: 'create_shopify_checkout', enabled: false },
      { toolName: 'create_shopify_discount', enabled: false },
      { toolName: 'record_back_in_stock_interest', enabled: false },
      // Email off — booking bots typically live on SMS/WA
      { toolName: 'send_email', enabled: false },
      // Booking failure → escalate to human directly
      { toolName: 'book_appointment', onFailure: 'transfer_to_human' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'No defaults applied — all tools enabled with catalog rules. Start here when you want to configure everything yourself.',
    autonomyMode: 'guided',
    tools: [],
  },
]

export function getPreset(id: string): AgentPreset | null {
  return AGENT_PRESETS.find(p => p.id === id) ?? null
}

/**
 * Apply a preset to an agent. Writes Agent.toolAutonomyMode +
 * Agent.presetId and upserts AgentToolConfig rows for every delta.
 * Tools not in the preset are NOT touched — they keep whatever config
 * they already had (catalog defaults if no row exists).
 *
 * Idempotent: re-applying produces the same final state.
 *
 * Returns the applied preset (for caller convenience) or null if the id
 * wasn't found in the registry.
 */
export async function applyPreset(
  agentId: string,
  presetId: string,
): Promise<AgentPreset | null> {
  const preset = getPreset(presetId)
  if (!preset) return null
  return applyPresetInternal(agentId, preset)
}

/**
 * Same as applyPreset, but also checks the WorkspacePreset table
 * (workspace-scoped custom presets) when the id isn't in the hardcoded
 * registry. Lookup order:
 *   1. Hardcoded AGENT_PRESETS by id (always wins — built-in ids are
 *      reserved).
 *   2. WorkspacePreset rows scoped to this workspaceId.
 *
 * Used by the apply-preset endpoint so a single id space covers both
 * sources. Returns the applied preset shape or null if not found.
 */
export async function applyPresetWithWorkspaceLookup(
  agentId: string,
  workspaceId: string,
  presetId: string,
): Promise<AgentPreset | null> {
  // 1. Hardcoded first.
  const hardcoded = getPreset(presetId)
  if (hardcoded) {
    return applyPresetInternal(agentId, hardcoded)
  }

  // 2. Workspace preset by id, scoped to this workspace.
  const row = await db.workspacePreset.findFirst({
    where: { id: presetId, workspaceId },
    select: {
      id: true,
      name: true,
      description: true,
      autonomyMode: true,
      toolDeltas: true,
    },
  })
  if (!row) return null

  const preset: AgentPreset = {
    id: row.id,
    label: row.name,
    description: row.description ?? '',
    autonomyMode: (row.autonomyMode === 'autonomous' ? 'autonomous' : 'guided'),
    tools: Array.isArray(row.toolDeltas) ? (row.toolDeltas as unknown as PresetToolDelta[]) : [],
  }
  return applyPresetInternal(agentId, preset)
}

/**
 * Shared writer used by both applyPreset (hardcoded) and
 * applyPresetWithWorkspaceLookup (DB-backed). Writes
 * Agent.toolAutonomyMode + Agent.presetId, CLEARS any existing
 * AgentToolConfig rows, then writes the preset's deltas.
 *
 * Wrapped in a transaction so either all of "set autonomy + preset
 * id + tool deltas" lands or nothing does. Previously a mid-loop DB
 * failure left agents in a half-applied state (new presetId stamped
 * but only some AgentToolConfig rows updated, which the runtime then
 * applied as a Frankenstein config).
 *
 * The clear-then-rewrite step is the bug fix for "switching from
 * Conversational → Booking leaves book_appointment disabled because
 * Booking has no explicit re-enable delta." Now every preset apply
 * starts from a clean slate (catalog defaults) and only writes rows
 * that genuinely diverge from catalog.
 */
async function applyPresetInternal(
  agentId: string,
  preset: AgentPreset,
): Promise<AgentPreset> {
  await db.$transaction(async (tx: any) => {
    await tx.agent.update({
      where: { id: agentId },
      data: {
        toolAutonomyMode: preset.autonomyMode,
        presetId: preset.id,
      },
    })

    // Wipe existing rows — the next loop writes only the deltas the
    // chosen preset wants. Tools omitted from the preset fall back to
    // catalog defaults at runtime (resolveAgentToolConfig handles the
    // "no row" case).
    await tx.agentToolConfig.deleteMany({ where: { agentId } })

    for (const delta of preset.tools) {
      const data: any = {}
      if (typeof delta.enabled === 'boolean') data.enabled = delta.enabled
      if (typeof delta.useWhen === 'string') data.useWhen = delta.useWhen
      if (delta.onFailure) data.onFailure = delta.onFailure
      if (delta.onFailureMessage !== undefined) data.onFailureMessage = delta.onFailureMessage
      if (Object.keys(data).length === 0) continue

      await tx.agentToolConfig.create({
        data: { agentId, toolName: delta.toolName, ...data },
      })
    }
  })

  return preset
}
