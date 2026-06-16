/**
 * Translation between the canonical Anthropic shape (what the codebase
 * builds) and the OpenAI Chat Completions shape (what Western-hosted
 * DeepSeek and other OpenAI-compatible endpoints speak).
 *
 * Pure functions, no I/O — unit-tested in openai-translate.test.ts.
 */

import type { LlmContentBlock, LlmCreateParams } from './types'

// ─── OpenAI Chat Completions (loose) ──────────────────────────────────────
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<Record<string, unknown>> | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface OpenAIRequest {
  model?: string
  max_tokens: number
  temperature?: number
  messages: OpenAIMessage[]
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters: unknown } }>
  tool_choice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
}

export interface OpenAIResponse {
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }
    finish_reason: string | null
  }>
  usage: { prompt_tokens: number; completion_tokens: number }
  model?: string
}

function blockText(b: LlmContentBlock): string {
  return typeof b.text === 'string' ? b.text : ''
}

function flattenSystem(system: LlmCreateParams['system']): string | undefined {
  if (system == null) return undefined
  if (typeof system === 'string') return system
  return system.map(blockText).filter(Boolean).join('\n')
}

/** Anthropic-shaped request → OpenAI Chat Completions request. */
export function anthropicToOpenAIRequest(params: LlmCreateParams, supportsVision: boolean): OpenAIRequest {
  const messages: OpenAIMessage[] = []

  const sys = flattenSystem(params.system)
  if (sys) messages.push({ role: 'system', content: sys })

  for (const m of params.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content })
      continue
    }

    // tool_result blocks (only ever on user turns) become tool-role messages.
    const toolResults = m.content.filter(b => b.type === 'tool_result')
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        const c = (tr as LlmContentBlock).content
        messages.push({
          role: 'tool',
          tool_call_id: String((tr as LlmContentBlock).tool_use_id ?? ''),
          content: typeof c === 'string' ? c : JSON.stringify(c ?? ''),
        })
      }
      continue
    }

    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(blockText).join('\n')
      const toolUses = m.content.filter(b => b.type === 'tool_use')
      const msg: OpenAIMessage = { role: 'assistant', content: text || null }
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map(t => ({
          id: String(t.id ?? ''),
          type: 'function',
          function: { name: String(t.name ?? ''), arguments: JSON.stringify((t as LlmContentBlock).input ?? {}) },
        }))
      }
      messages.push(msg)
      continue
    }

    // user turn with mixed text/image blocks
    const parts: Array<Record<string, unknown>> = []
    for (const b of m.content) {
      if (b.type === 'image') {
        if (!supportsVision) continue
        const src = (b.source ?? {}) as Record<string, unknown>
        const url = src.type === 'url' ? src.url
          : src.type === 'base64' ? `data:${src.media_type};base64,${src.data}`
          : undefined
        if (url) parts.push({ type: 'image_url', image_url: { url } })
      } else if (b.type === 'text') {
        parts.push({ type: 'text', text: blockText(b) })
      }
    }
    // Collapse to a plain string when there's a single text part (or vision
    // stripped everything to text) — keeps the wire payload simple.
    if (parts.every(p => p.type === 'text')) {
      messages.push({ role: 'user', content: parts.map(p => p.text as string).join('\n') })
    } else {
      messages.push({ role: 'user', content: parts })
    }
  }

  const out: OpenAIRequest = { max_tokens: params.max_tokens, messages }
  if (params.temperature != null) out.temperature = params.temperature

  if (params.tools && params.tools.length > 0) {
    out.tools = params.tools.map(t => ({
      type: 'function',
      function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.input_schema },
    }))
  }

  if (params.tool_choice) {
    const tc = params.tool_choice
    if (tc.type === 'any') out.tool_choice = 'required'
    else if (tc.type === 'tool' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } }
    else if (tc.type === 'auto') out.tool_choice = 'auto'
  }

  return out
}

const FINISH_REASON_MAP: Record<string, string> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'end_turn',
}

/** OpenAI Chat Completions response → Anthropic-shaped message. */
export function openAIToAnthropicResponse(resp: OpenAIResponse) {
  const choice = resp.choices?.[0]
  const msg = choice?.message
  const content: LlmContentBlock[] = []

  if (msg?.content && msg.content.trim()) {
    content.push({ type: 'text', text: msg.content })
  }
  for (const tc of msg?.tool_calls ?? []) {
    let input: unknown = {}
    try { input = JSON.parse(tc.function.arguments || '{}') } catch { input = {} }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
  }

  const finish = choice?.finish_reason ?? 'stop'
  return {
    content,
    stop_reason: FINISH_REASON_MAP[finish] ?? finish,
    usage: { input_tokens: resp.usage?.prompt_tokens ?? 0, output_tokens: resp.usage?.completion_tokens ?? 0 },
    model: resp.model,
  }
}
