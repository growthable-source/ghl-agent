/**
 * Workspace setup state — the co-pilot's read-only live-state tool
 * (P0-6, `get_workspace_setup_state`).
 *
 * This is what stops the model confidently describing menus and
 * options the workspace doesn't have: before asserting "you already
 * have an agent" or "connect your CRM first", it reads the actual
 * state. Also feeds workflow step predicates (lib/copilot/workflows)
 * and the auto task_success eval at session end.
 *
 * Read-only by construction — a single function that SELECTs. New
 * fields are cheap; add them here rather than minting new tools, so
 * the model has one coherent state snapshot instead of five partial
 * ones.
 */

import { db } from '@/lib/db'

export interface WorkspaceSetupState {
  workspaceName: string
  plan: string
  /** Total agents (any type). */
  agentCount: number
  /** Agents with isActive=true. */
  activeAgentCount: number
  /** Voice-typed agents. */
  voiceAgentCount: number
  /** Distinct channels with an active ChannelDeployment across all agents. */
  deployedChannels: string[]
  /** Workspace-wide knowledge entries. */
  knowledgeEntryCount: number
  /** Knowledge collections in the workspace. */
  knowledgeCollectionCount: number
  /** CRM locations linked to the workspace, by provider. */
  crmLocations: Array<{ provider: string }>
  /** Voice agents with a provisioned phone number. */
  phoneNumberCount: number
}

export async function getWorkspaceSetupState(workspaceId: string): Promise<WorkspaceSetupState> {
  const [workspace, agents, deployments, knowledgeEntryCount, knowledgeCollectionCount, locations, phoneNumberCount] =
    await Promise.all([
      db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, plan: true } }),
      db.agent.findMany({
        where: { workspaceId },
        select: { id: true, isActive: true, agentType: true },
      }),
      db.channelDeployment.findMany({
        where: { isActive: true, agent: { workspaceId } },
        select: { channel: true },
      }),
      db.knowledgeEntry.count({ where: { workspaceId } }),
      db.knowledgeCollection.count({ where: { workspaceId } }),
      db.location.findMany({
        where: { workspaceId },
        select: { crmProvider: true },
      }),
      db.vapiConfig.count({
        where: { agent: { workspaceId }, phoneNumber: { not: null } },
      }),
    ])

  return {
    workspaceName: workspace?.name ?? 'Unknown workspace',
    plan: workspace?.plan ?? 'trial',
    agentCount: agents.length,
    activeAgentCount: agents.filter(a => a.isActive).length,
    voiceAgentCount: agents.filter(a => a.agentType === 'VOICE').length,
    deployedChannels: [...new Set(deployments.map(d => d.channel))],
    knowledgeEntryCount,
    knowledgeCollectionCount,
    crmLocations: locations.map(l => ({ provider: l.crmProvider })),
    phoneNumberCount,
  }
}

/** Compact text rendering for system prompts and tool results. */
export function describeSetupState(s: WorkspaceSetupState): string {
  const crm =
    s.crmLocations.length === 0
      ? 'no CRM location connected'
      : `${s.crmLocations.length} location(s) connected (${[...new Set(s.crmLocations.map(l => l.provider))].join(', ')})`
  return [
    `Workspace: ${s.workspaceName} (plan: ${s.plan})`,
    `Agents: ${s.agentCount} total, ${s.activeAgentCount} active, ${s.voiceAgentCount} voice`,
    `Channels deployed: ${s.deployedChannels.length ? s.deployedChannels.join(', ') : 'none'}`,
    `Knowledge: ${s.knowledgeEntryCount} entries across ${s.knowledgeCollectionCount} collections`,
    `CRM: ${crm}`,
    `Voice phone numbers: ${s.phoneNumberCount}`,
  ].join('\n')
}
