/**
 * Minimal MCP client — HTTP transport only.
 *
 * At runtime, the Anthropic API is responsible for *calling* MCP tools
 * (via the `mcp_servers` parameter on messages.create). We only need our
 * own client for one thing: **discovery** — listing the tools an MCP
 * server exposes so the user can configure a per-tool "whenToUse" rule.
 *
 * MCP spec: JSON-RPC 2.0 over HTTP. We POST to the server URL with
 * `{ method: "tools/list" }` and parse the result.
 */

import { decryptSecret } from './secrets'

export interface DiscoveredTool {
  name: string
  description: string
  inputSchema: unknown
}

export interface McpServerConfig {
  url: string
  authType: 'bearer' | 'header' | 'none'
  authSecretEnc: string | null
  headers?: Record<string, string> | null
}

function buildHeaders(cfg: McpServerConfig): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  if (cfg.headers) Object.assign(h, cfg.headers)
  if (cfg.authType === 'bearer' && cfg.authSecretEnc) {
    try { h['Authorization'] = `Bearer ${decryptSecret(cfg.authSecretEnc)}` } catch {}
  } else if (cfg.authType === 'header' && cfg.authSecretEnc) {
    // The decrypted value is expected to be in the form "Header-Name: value"
    try {
      const decrypted = decryptSecret(cfg.authSecretEnc)
      const idx = decrypted.indexOf(':')
      if (idx > 0) h[decrypted.slice(0, idx).trim()] = decrypted.slice(idx + 1).trim()
    } catch {}
  }
  return h
}

export async function discoverTools(cfg: McpServerConfig, signal?: AbortSignal): Promise<DiscoveredTool[]> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: buildHeaders(cfg),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`MCP server returned ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json().catch(() => ({} as any))
  if (data.error) {
    throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`)
  }
  const tools = data.result?.tools
  if (!Array.isArray(tools)) throw new Error('MCP server returned no tools list')
  return tools.map((t: any) => ({
    name: String(t.name),
    description: String(t.description || ''),
    inputSchema: t.inputSchema || {},
  }))
}

/** Build the headers an Anthropic `mcp_servers` entry needs for upstream auth. */
export function buildAnthropicMcpHeaders(cfg: McpServerConfig): Record<string, string> {
  const h: Record<string, string> = {}
  if (cfg.headers) Object.assign(h, cfg.headers)
  if (cfg.authType === 'bearer' && cfg.authSecretEnc) {
    try { h['Authorization'] = `Bearer ${decryptSecret(cfg.authSecretEnc)}` } catch {}
  } else if (cfg.authType === 'header' && cfg.authSecretEnc) {
    try {
      const decrypted = decryptSecret(cfg.authSecretEnc)
      const idx = decrypted.indexOf(':')
      if (idx > 0) h[decrypted.slice(0, idx).trim()] = decrypted.slice(idx + 1).trim()
    } catch {}
  }
  return h
}
