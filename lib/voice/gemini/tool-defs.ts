/**
 * Map the agent's enabled CRM tools to RealtimeToolDef[] — the JSON-Schema
 * subset Gemini Live (and the Copilot provider) consume. Single source of
 * truth: the agent tool catalogue (lib/agent/tool-catalog.ts), the same
 * list the text/Vapi runtimes use. No parallel tool state.
 *
 * Pure + runtime-agnostic (no next/prisma) so Plan 2's Fly bridge can
 * import it too.
 */

import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'
import type { RealtimeToolDef } from '@/lib/copilot/types'

export function agentToolsToRealtimeDefs(enabledTools: string[]): RealtimeToolDef[] {
  const enabled = new Set(enabledTools)
  const out: RealtimeToolDef[] = []
  for (const tool of AGENT_TOOLS) {
    if (!enabled.has(tool.name)) continue
    const schema = tool.input_schema
    const srcProps = (schema?.properties ?? {}) as Record<
      string,
      { type?: unknown; description?: unknown; enum?: unknown }
    >
    const properties: RealtimeToolDef['parameters']['properties'] = {}
    for (const [key, raw] of Object.entries(srcProps)) {
      const type = typeof raw?.type === 'string' ? raw.type : String(raw?.type ?? 'string')
      properties[key] = {
        type,
        ...(typeof raw?.description === 'string' ? { description: raw.description } : {}),
        ...(Array.isArray(raw?.enum) ? { enum: raw.enum.map(String) } : {}),
      }
    }
    const required = Array.isArray(schema?.required)
      ? (schema.required as unknown[]).filter((r): r is string => typeof r === 'string')
      : undefined
    out.push({
      name: tool.name,
      description: tool.description ?? '',
      parameters: {
        type: 'object',
        properties,
        ...(required && required.length ? { required } : {}),
      },
    })
  }
  return out
}
