/**
 * Runtime glue: load an agent's MCP tool attachments, gate by keywords,
 * build the Anthropic `mcp_servers` parameter, and render the
 * "Connected Integrations" system-prompt block.
 *
 * Why two surfaces (mcp_servers param + prompt block)?
 *   - `mcp_servers` is what actually exposes the tools to Claude. Claude's
 *     backend connects, lists, and calls them — we don't run the tool
 *     ourselves. This is the "Anthropic-managed MCP" path.
 *   - The prompt block is *our* steering layer. The MCP server's stock tool
 *     description tells Claude how to call it; our `whenToUse` text tells
 *     Claude *when we want it called*. The block is per-tool plain English
 *     written by the user in the dashboard.
 *
 * mustIncludeKeywords gates per-attachment: if any keywords are configured
 * and none appear in the incoming message, the attachment is dropped before
 * the model sees it. If a server has no surviving attachments, the whole
 * server is skipped (no point exposing tools we don't want called).
 *
 * requireApproval is currently a soft constraint — we add a stern
 * "REQUIRES HUMAN APPROVAL — do not call until approved" line to the prompt
 * block. Hard approval-queue routing requires moving these tools out of
 * `mcp_servers` and onto our local `tools[]` array so we can intercept the
 * call; that's a follow-up.
 */

import { db } from './db'
import { decryptSecret } from './secrets'

export interface AgentMcpAttachment {
  attachmentId: string
  serverId: string
  serverName: string
  serverUrl: string
  authType: string
  authSecretEnc: string | null
  toolName: string
  whenToUse: string | null
  mustIncludeKeywords: string[]
  requireApproval: boolean
  defaultDescription: string | null
}

export async function loadAgentMcpAttachments(agentId: string | undefined): Promise<AgentMcpAttachment[]> {
  if (!agentId) return []
  let rows: any[]
  try {
    rows = await (db as any).agentMcpTool.findMany({
      where: { agentId, enabled: true, mcpServer: { isActive: true } },
      include: { mcpServer: true },
    })
  } catch (err: any) {
    if (
      err?.code === 'P2021'
      || err?.code === 'P2022'
      || /relation .* does not exist/i.test(err?.message ?? '')
      || /column .* does not exist/i.test(err?.message ?? '')
    ) {
      // Migration not applied — degrade silently
      return []
    }
    throw err
  }
  return rows.map(r => {
    const tools = Array.isArray(r.mcpServer.discoveredTools) ? r.mcpServer.discoveredTools : []
    const tool = tools.find((t: any) => t?.name === r.toolName)
    return {
      attachmentId: r.id,
      serverId: r.mcpServer.id,
      serverName: r.mcpServer.name,
      serverUrl: r.mcpServer.url,
      authType: r.mcpServer.authType,
      authSecretEnc: r.mcpServer.authSecretEnc,
      toolName: r.toolName,
      whenToUse: r.whenToUse,
      mustIncludeKeywords: r.mustIncludeKeywords || [],
      requireApproval: r.requireApproval,
      defaultDescription: tool?.description ?? null,
    }
  })
}

export function filterByKeywords(
  attachments: AgentMcpAttachment[],
  incomingMessage: string | undefined,
): AgentMcpAttachment[] {
  const lower = (incomingMessage || '').toLowerCase()
  return attachments.filter(a => {
    if (!a.mustIncludeKeywords.length) return true
    return a.mustIncludeKeywords.some(k => lower.includes(k.toLowerCase()))
  })
}

/** Sanitize a name for Anthropic's mcp_servers.name (alphanumeric + dash/underscore). */
function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64) || 'mcp-server'
}

export interface AnthropicMcpServer {
  type: 'url'
  url: string
  name: string
  authorization_token?: string
}

export function buildMcpServersParam(attachments: AgentMcpAttachment[]): AnthropicMcpServer[] {
  const seen = new Map<string, AgentMcpAttachment>()
  for (const a of attachments) if (!seen.has(a.serverId)) seen.set(a.serverId, a)
  return Array.from(seen.values()).map(a => {
    const out: AnthropicMcpServer = {
      type: 'url',
      url: a.serverUrl,
      name: safeName(a.serverName),
    }
    if (a.authType === 'bearer' && a.authSecretEnc) {
      try { out.authorization_token = decryptSecret(a.authSecretEnc) } catch {}
    }
    return out
  })
}

export function buildConnectedIntegrationsBlock(attachments: AgentMcpAttachment[]): string {
  if (attachments.length === 0) return ''

  const byServer = new Map<string, AgentMcpAttachment[]>()
  for (const a of attachments) {
    const list = byServer.get(a.serverName) || []
    list.push(a)
    byServer.set(a.serverName, list)
  }

  const groups = Array.from(byServer.entries()).map(([serverName, atts]) => {
    const tools = atts.map(a => {
      const desc = (a.whenToUse || a.defaultDescription || '(no usage rule provided)').trim()
      const approval = a.requireApproval
        ? '\n    ⚠ REQUIRES HUMAN APPROVAL — before calling, tell the contact you\'re checking with the team and stop. Do NOT invoke this tool until the team has confirmed.'
        : ''
      return `  • ${a.toolName} — ${desc}${approval}`
    }).join('\n')
    return `### ${serverName}\n${tools}`
  }).join('\n\n')

  return `

## Connected Integrations
You have access to the following external tools via connected MCP servers.
Each tool below has a "when to use" rule the operator wrote — follow it
literally. If nothing in the conversation matches a tool's rule, do NOT
call that tool.

${groups}`
}

/** For logging: detect MCP tool calls in a Claude response and return short labels. */
export function extractMcpActions(content: any[]): string[] {
  const actions: string[] = []
  for (const block of content || []) {
    if (block?.type === 'mcp_tool_use') {
      const name = block.name || 'unknown'
      const server = block.server_name || 'mcp'
      actions.push(`mcp:${server}:${name}`)
    }
  }
  return actions
}
