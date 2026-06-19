/**
 * Provider-agnostic LLM layer — canonical types.
 *
 * The internal format is the ANTHROPIC shape the codebase already builds
 * (separate `system`, content-block `messages`, `tools` with
 * `input_schema`, `tool_choice`, `stop_reason`, `usage`). Claude calls are
 * pass-through; OpenAI-compatible providers (Western-hosted DeepSeek)
 * translate to/from this shape in lib/llm/openai-translate.ts.
 *
 * Goal of this whole module: reduce inference cost by routing work to a
 * cheaper model by default while Claude silently covers what the cheaper
 * model can't (vision, server-side MCP tools, outright failure).
 */

/** Logical model the caller asks for. `auto` resolves to DEFAULT_AGENT_MODEL. */
export type LlmModelKey =
  | 'auto'
  | 'claude-opus'
  | 'claude-sonnet'
  | 'claude-haiku'
  | 'deepseek-flash'
  | 'deepseek-pro'
  // Generic OpenRouter passthrough. vendorModelId comes from OPENROUTER_MODEL
  // (any OpenRouter model id, e.g. 'deepseek/deepseek-chat'). Used for
  // cost-sensitive background work (conversation mining) that must stay off
  // Anthropic. openai-compat provider.
  | 'openrouter'

export type ResolvedKey = Exclude<LlmModelKey, 'auto'>

export type ProviderKind = 'anthropic' | 'openai-compat'

export interface ModelCapabilities {
  /** Accepts image content blocks. DeepSeek vision is unconfirmed → false. */
  vision: boolean
  /** Supports Anthropic server-side MCP tool execution (`mcp_servers`). */
  mcpServers: boolean
  /** Rough confidence for deep multi-tool agent loops. */
  toolReliability: 'high' | 'medium'
}

export interface ResolvedModel {
  key: ResolvedKey
  provider: ProviderKind
  vendorModelId: string
  /** Non-default base URL (first-party DeepSeek `/anthropic`, or a Western host). */
  baseURL?: string
  apiKeyEnv: string
  capabilities: ModelCapabilities
}

// ─── Canonical (Anthropic-shaped) request/response ────────────────────────
// Loose structural types: they match what lib/ai-agent.ts already passes and
// what the Anthropic SDK returns, so Claude is a pass-through and the loop
// needs no shape changes.

export interface LlmContentBlock {
  type: string
  // text | tool_use | tool_result | image — fields vary by type.
  [k: string]: unknown
}

export interface LlmMessageParam {
  role: 'user' | 'assistant'
  content: string | LlmContentBlock[]
}

export interface LlmTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
  cache_control?: unknown
}

export interface LlmCreateParams {
  model?: string
  max_tokens: number
  system?: string | LlmContentBlock[]
  tools?: LlmTool[]
  tool_choice?: { type: string; name?: string }
  messages: LlmMessageParam[]
  mcp_servers?: unknown[]
  temperature?: number
}

export interface LlmResponse {
  /** {type:'text',text} | {type:'tool_use',id,name,input} blocks. */
  content: LlmContentBlock[]
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    /** Anthropic prompt-cache accounting (absent on openai-compat providers). */
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  model?: string
}
