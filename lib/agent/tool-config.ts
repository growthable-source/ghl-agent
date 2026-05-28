/**
 * Resolution layer for AgentToolConfig.
 *
 * The DB stores per-(agent, tool) overrides. The tool catalog stores
 * sensible defaults. This file merges them into a single ResolvedToolConfig
 * the runtime and UI consume. Empty / null overrides fall through to
 * catalog defaults; explicit values win.
 *
 * `resolveAgentToolConfig(agentId)` is the integration entry point — fetches
 * rows from the DB + catalog, returns a Map keyed by tool name.
 *
 * `mergeToolConfig(...)` is the pure logic — easy to unit-test.
 */

import { db } from '@/lib/db'
import { AGENT_TOOLS } from './tool-catalog'

export type OnFailureMode =
  | 'default'
  | 'transfer_to_human'
  | 'canned_message'
  | 'silent_skip'

export interface ResolvedToolConfig {
  toolName: string
  enabled: boolean
  /** Resolved rule. Empty string if neither row nor catalog provides one. */
  useWhen: string
  onFailure: OnFailureMode
  onFailureMessage: string | null
}

interface RowShape {
  enabled: boolean
  useWhen: string | null
  onFailure: string
  onFailureMessage: string | null
}

interface CatalogDefaultShape {
  useWhen?: string
  onFailure?: OnFailureMode
}

export function mergeToolConfig(opts: {
  toolName: string
  row: RowShape | null
  catalogDefault: CatalogDefaultShape
}): ResolvedToolConfig {
  const { toolName, row, catalogDefault } = opts

  const useWhen = (row?.useWhen && row.useWhen.length > 0)
    ? row.useWhen
    : (catalogDefault.useWhen ?? '')

  const onFailureRaw = row?.onFailure ?? catalogDefault.onFailure ?? 'default'
  const onFailure = isOnFailureMode(onFailureRaw) ? onFailureRaw : 'default'

  return {
    toolName,
    enabled: row?.enabled ?? true,
    useWhen,
    onFailure,
    onFailureMessage: row?.onFailureMessage ?? null,
  }
}

function isOnFailureMode(s: string): s is OnFailureMode {
  return s === 'default' || s === 'transfer_to_human' || s === 'canned_message' || s === 'silent_skip'
}

/**
 * DB-integrated resolver. Returns a Map keyed by tool name with every
 * tool in AGENT_TOOLS resolved (defaults applied where no override).
 *
 * Tools not in AGENT_TOOLS are skipped — we don't return resolutions for
 * tools the agent can't physically call.
 */
export async function resolveAgentToolConfig(
  agentId: string,
): Promise<Map<string, ResolvedToolConfig>> {
  const rows = await db.agentToolConfig.findMany({
    where: { agentId },
    select: { toolName: true, enabled: true, useWhen: true, onFailure: true, onFailureMessage: true },
  })
  const rowByName = new Map(rows.map(r => [r.toolName, r]))

  const out = new Map<string, ResolvedToolConfig>()
  for (const tool of AGENT_TOOLS) {
    const t = tool as any
    out.set(
      tool.name,
      mergeToolConfig({
        toolName: tool.name,
        row: rowByName.get(tool.name) ?? null,
        catalogDefault: {
          useWhen: t.defaultUseWhen,
          onFailure: t.defaultOnFailure,
        },
      }),
    )
  }
  return out
}

/**
 * Read-only resolver for a single tool — used by execute-tool's onFailure
 * dispatch, which only needs the one tool that just errored.
 */
export async function resolveOneToolConfig(
  agentId: string,
  toolName: string,
): Promise<ResolvedToolConfig> {
  const row = await db.agentToolConfig.findUnique({
    where: { agentId_toolName: { agentId, toolName } },
    select: { enabled: true, useWhen: true, onFailure: true, onFailureMessage: true },
  })
  const catalogEntry = (AGENT_TOOLS as any[]).find(t => t.name === toolName)
  return mergeToolConfig({
    toolName,
    row,
    catalogDefault: {
      useWhen: catalogEntry?.defaultUseWhen,
      onFailure: catalogEntry?.defaultOnFailure,
    },
  })
}
