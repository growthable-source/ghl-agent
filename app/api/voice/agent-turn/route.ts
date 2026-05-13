/**
 * POST /api/voice/agent-turn — STREAMING hybrid voice pipeline.
 *
 * End-to-end stream from Claude tokens through XAI PCM16 audio to the
 * browser, with sentence-boundary chunking so playback starts BEFORE
 * Claude finishes generating. Time-to-first-audio drops from
 * ~1000ms (batch wait) to ~200ms (first sentence as soon as it lands).
 *
 * Wire format: newline-delimited JSON. Each event is one of:
 *
 *   {"type":"tool_call","name":"search_shopify_products","ms":412}
 *     A tool fired during the Claude loop. Used by the UI to render
 *     "🔧 tool · 412ms" lines.
 *
 *   {"type":"reply_delta","text":"Yes, we have wool socks "}
 *     A streamed chunk of the final assistant text. The UI accumulates
 *     these into the transcript bubble.
 *
 *   {"type":"audio","b64":"<base64 PCM16 24kHz>"}
 *     A chunk of PCM16 audio bytes from XAI TTS, base64-encoded for
 *     JSON safety. The browser decodes and queues into the playhead.
 *
 *   {"type":"done"}
 *     End of turn. Browser stops listening.
 *
 *   {"type":"error","message":"..."}
 *     Soft error. Stream terminates.
 *
 * Architecture: Claude is streamed; text deltas accumulate in a buffer;
 * a sentence-boundary scan flushes whole sentences (or a max-length
 * fallback) into a sequential TTS queue. XAI streams PCM16 chunks
 * back; we re-emit them as audio events. Tool loop iterations are
 * processed normally — text and tool_use blocks interleave within a
 * Claude response, so we naturally TTS the "let me check that" prelude
 * before pausing for the tool call.
 *
 * Auth: dashboard session + agent-workspace membership.
 */

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'
import { executeTool } from '@/lib/agent/execute-tool'
import { getCrmAdapter } from '@/lib/crm/factory'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'
import { VOICE_SAFE_TOOL_NAMES } from '@/lib/voice/tools'
import { buildVoiceCommerceBlock } from '@/lib/commerce/shopify/voice-prompt'
import { buildPersonaBlock } from '@/lib/persona'

const MAX_TOOL_ITERATIONS = 6
const MODEL = 'claude-sonnet-4-20250514'
// Flush the text buffer to TTS once we hit a sentence boundary OR we've
// accumulated this many chars without one. The fallback stops a long
// run-on phrase from delaying playback for the whole reply.
const TTS_FLUSH_MAX_CHARS = 90

const client = new Anthropic()

interface HistoryTurn { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return jsonError(401, 'not_authenticated')

  let body: { agentId?: string; transcript?: string; history?: HistoryTurn[]; voiceId?: string } = {}
  try { body = await req.json() } catch {}
  const { agentId, transcript, voiceId } = body
  const history = Array.isArray(body.history) ? body.history.slice(-12) : []
  if (!agentId || !transcript || !voiceId) return jsonError(400, 'agentId, transcript, voiceId required')

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true, name: true, locationId: true, workspaceId: true,
      systemPrompt: true, instructions: true, enabledTools: true,
      agentPersonaName: true, responseLength: true, formalityLevel: true,
      useEmojis: true, neverSayList: true, simulateTypos: true,
      typingDelayEnabled: true, typingDelayMinMs: true, typingDelayMaxMs: true,
      languages: true,
      workspace: { select: { members: { where: { userId: session.user.id }, select: { userId: true } } } },
    },
  })
  if (!agent) return jsonError(404, 'agent_not_found')
  if (!agent.workspaceId || agent.workspace?.members.length === 0) return jsonError(403, 'forbidden')

  const enabled = new Set(agent.enabledTools)
  const tools = AGENT_TOOLS.filter(t => enabled.has(t.name) && VOICE_SAFE_TOOL_NAMES.has(t.name))

  // Build system prompt — same shape as the non-streaming version.
  let systemPrompt = agent.systemPrompt || 'You are a helpful voice assistant.'
  if (agent.instructions) systemPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemPrompt += buildPersonaBlock(agent as any)
  } catch {}
  try {
    const commerce = await buildVoiceCommerceBlock({ workspaceId: agent.workspaceId })
    if (commerce) systemPrompt += commerce
  } catch {}
  systemPrompt += `\n\n## VOICE CALL INSTRUCTIONS\nYou are on a live voice call. Speak naturally and conversationally — no markdown, no lists, no URLs. Keep replies short (1-3 sentences) unless the caller asks for detail. Before calling a tool, say a single short beat aloud ("let me check that for you") so the caller hears something while you query. Spell out codes letter-by-letter ("H, E, L, L, O") rather than as words. Use natural sentence pauses (periods, commas) — your speech is generated sentence-by-sentence, so each sentence becomes its own audio chunk.`

  const messages: Anthropic.MessageParam[] = [
    ...history.map(h => ({ role: h.role, content: h.content } as Anthropic.MessageParam)),
    { role: 'user', content: transcript },
  ]

  // ─── Streaming response: NDJSON events ────────────────────────────
  const encoder = new TextEncoder()
  const xai = new XaiVoiceAdapter()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }

      // Sequential TTS queue: each sentence enters as it's flushed
      // from the text buffer, gets TTS'd, and chunks stream out.
      // We chain promises so audio events arrive in spoken order even
      // when sentence-N TTS completes before sentence-N+1's text is
      // ready.
      let ttsChain: Promise<void> = Promise.resolve()
      const ttsSentence = (sentence: string) => {
        if (!sentence.trim()) return
        ttsChain = ttsChain.then(async () => {
          try {
            const audioStream = await xai.speakStream!(sentence, voiceId, { codec: 'pcm', sampleRate: 24000 })
            const reader = audioStream.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value && value.byteLength > 0) {
                sendEvent({ type: 'audio', b64: bufferToBase64(value) })
              }
            }
          } catch (err: any) {
            console.error('[voice agent-turn] TTS chunk failed:', err?.message)
          }
        })
      }

      // Accumulator for tokens between sentence flushes. Lifted to the
      // try-scope so the flush helpers below can close over it (they're
      // hoisted out of the for-loop body).
      let textBuffer = ''

      try {
        let crm: Awaited<ReturnType<typeof getCrmAdapter>> | null = null
        try { crm = await getCrmAdapter(agent.locationId) } catch { /* ignore */ }

        // ─── Tool loop with streamed Claude responses ──────────────
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          textBuffer = ''           // reset between iterations
          const assistantBlocks: Anthropic.ContentBlock[] = []

          // Stream the response. SDK exposes both event-based handlers
          // and an async iterator over events; we use the iterator
          // since we want fine-grained control over flushing.
          const responseStream = client.messages.stream({
            model: MODEL,
            max_tokens: 600,
            system: systemPrompt,
            tools: tools.length > 0 ? tools : undefined,
            messages,
          })

          for await (const event of responseStream) {
            if (event.type === 'content_block_start') {
              const block = event.content_block as Anthropic.ContentBlock
              if (block.type === 'tool_use') {
                // Flush any pending text BEFORE the tool call so the
                // "let me check" beat plays before the pause.
                flushTextBuffer()
                assistantBlocks.push({ ...block, input: {} } as Anthropic.ContentBlock)
              } else if (block.type === 'text') {
                assistantBlocks.push({ ...block, text: '' } as Anthropic.ContentBlock)
              } else {
                assistantBlocks.push(block)
              }
            } else if (event.type === 'content_block_delta') {
              const delta = event.delta
              if (delta.type === 'text_delta') {
                textBuffer += delta.text
                sendEvent({ type: 'reply_delta', text: delta.text })
                // Patch the last text block as we go for the final messages
                const last = assistantBlocks[assistantBlocks.length - 1]
                if (last && last.type === 'text') last.text += delta.text
                // Try to flush completed sentences out of the buffer.
                flushSentences()
              } else if (delta.type === 'input_json_delta') {
                const last = assistantBlocks[assistantBlocks.length - 1]
                if (last && last.type === 'tool_use') {
                  // Accumulate the streaming JSON args. We'll parse at
                  // content_block_stop.
                  const raw = ((last as { _raw?: string })._raw ?? '') + (delta as { partial_json: string }).partial_json
                  ;(last as { _raw?: string })._raw = raw
                }
              }
            } else if (event.type === 'content_block_stop') {
              const last = assistantBlocks[assistantBlocks.length - 1]
              if (last && last.type === 'tool_use') {
                const raw = (last as { _raw?: string })._raw ?? '{}'
                try { last.input = JSON.parse(raw) } catch { last.input = {} }
                delete (last as { _raw?: string })._raw
              }
            }
          }
          // Drain any remaining text into TTS (no trailing punctuation).
          flushTextBuffer()

          // Look for tool_use blocks. If none, we're done.
          const toolUses = assistantBlocks.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          )
          if (toolUses.length === 0) break

          // Persist assistant blocks + execute tool calls + append results.
          messages.push({ role: 'assistant', content: assistantBlocks })
          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const tu of toolUses) {
            const start = Date.now()
            let result = '{}'
            try {
              result = await executeTool(
                tu.name,
                tu.input as Record<string, unknown>,
                agent.locationId,
                false,
                agent.id,
                'Voice',
                undefined,
                crm ?? undefined,
                undefined,
                undefined,
                undefined,
                agent.workspaceId,
              )
            } catch (err: any) {
              result = JSON.stringify({ error: err?.message || 'tool_dispatch_failed' })
            }
            sendEvent({ type: 'tool_call', name: tu.name, ms: Date.now() - start })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
          }
          messages.push({ role: 'user', content: toolResults })
        }

        // Final flush — any sentence tail still in the buffer + drain
        // the TTS queue so 'done' truly means "audio is finished."
        await ttsChain
        sendEvent({ type: 'done' })
        controller.close()
        return

        // ─── Helpers ────────────────────────────────────────────────
        function flushSentences() {
          while (true) {
            const idx = findSentenceBoundary(textBuffer)
            if (idx < 0) {
              // No boundary. If we're past the max buffer length,
              // flush anyway so playback doesn't stall on long runs.
              if (textBuffer.length >= TTS_FLUSH_MAX_CHARS) {
                ttsSentence(textBuffer)
                textBuffer = ''
              }
              return
            }
            const sentence = textBuffer.slice(0, idx + 1).trim()
            textBuffer = textBuffer.slice(idx + 1)
            ttsSentence(sentence)
          }
        }
        function flushTextBuffer() {
          if (textBuffer.trim().length > 0) {
            ttsSentence(textBuffer)
            textBuffer = ''
          }
        }
      } catch (err: any) {
        console.error('[voice agent-turn] stream failed:', err)
        sendEvent({ type: 'error', message: err?.message || 'turn_failed' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      // Disable buffering at CDN / proxy boundaries so chunks reach
      // the browser as fast as we can write them.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Find the index of the LAST sentence-terminating character that has a
 * following whitespace or end-of-buffer. Returns -1 when no boundary
 * is present. Conservative on abbreviations — we don't try to detect
 * "Dr." vs "Dr. Smith"; agents writing voice replies rarely use
 * abbreviations, and the max-length fallback handles the edge.
 */
function findSentenceBoundary(s: string): number {
  // Scan backwards for the last [.!?] followed by whitespace.
  for (let i = s.length - 2; i >= 0; i--) {
    const c = s[i]
    const next = s[i + 1]
    if ((c === '.' || c === '!' || c === '?') && /\s/.test(next)) return i
  }
  return -1
}

function bufferToBase64(bytes: Uint8Array): string {
  // Node Buffer is available in Next route handlers; this is faster than
  // a JS loop for typical TTS chunk sizes (~4-16KB).
  return Buffer.from(bytes).toString('base64')
}
