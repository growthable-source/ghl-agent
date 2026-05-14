/**
 * POST /api/voice/agent-turn
 *
 * Hybrid voice architecture: XAI handles speech-to-text on the
 * browser side and we receive the transcript here. The "brain" is
 * Claude with the agent's full tool catalog (same tools the text
 * agent uses, executed through the same dispatcher). We send the
 * reply text to XAI's batch TTS and return the audio bytes so the
 * browser can play them.
 *
 * Why not XAI realtime function-calling? Tried it — XAI's docs only
 * cover function calling for chat completions, not realtime, and
 * empirically the realtime model wasn't invoking tools even when
 * we sent the OpenAI-shaped tool list. Routing the brain through
 * Claude removes the gamble and gives us 100% of our tools today.
 *
 * Auth: workspace session, agent membership verified.
 *
 * Body: {
 *   agentId,
 *   transcript,                       // what the user just said
 *   history?: [{role,content}, ...],  // last N turns for continuity
 *   voiceId,                          // XAI voice id for the reply
 * }
 *
 * Returns: { reply, audioBase64, mimeType, toolCalls: [{name, ms}] }
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'
import { executeTool } from '@/lib/agent/execute-tool'
import { getCrmAdapter } from '@/lib/crm/factory'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'
import { buildVoiceCommerceBlock } from '@/lib/commerce/shopify/voice-prompt'
import { buildPersonaBlock } from '@/lib/persona'
import { VOICE_SAFE_TOOL_NAMES } from '@/lib/voice/tools'

const MAX_TOOL_ITERATIONS = 6
const MODEL = 'claude-sonnet-4-20250514'

const client = new Anthropic()

interface HistoryTurn { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  let body: { agentId?: string; transcript?: string; history?: HistoryTurn[]; voiceId?: string } = {}
  try { body = await req.json() } catch {}
  const { agentId, transcript, voiceId } = body
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [] // last 12 turns
  if (!agentId || !transcript || !voiceId) {
    return NextResponse.json({ error: 'agentId, transcript, voiceId required' }, { status: 400 })
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      locationId: true,
      workspaceId: true,
      systemPrompt: true,
      instructions: true,
      enabledTools: true,
      agentPersonaName: true,
      responseLength: true,
      formalityLevel: true,
      useEmojis: true,
      neverSayList: true,
      simulateTypos: true,
      typingDelayEnabled: true,
      typingDelayMinMs: true,
      typingDelayMaxMs: true,
      languages: true,
      workspace: { select: { members: { where: { userId: session.user.id }, select: { userId: true } } } },
    },
  })
  if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
  if (!agent.workspaceId || agent.workspace?.members.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // ─── Filter tools to voice-safe ∩ agent.enabledTools ─────────────
  const enabled = new Set(agent.enabledTools)
  const tools = AGENT_TOOLS.filter(t => enabled.has(t.name) && VOICE_SAFE_TOOL_NAMES.has(t.name))

  // ─── Build system prompt ─────────────────────────────────────────
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

  systemPrompt += `\n\n## VOICE CALL INSTRUCTIONS
You are on a live voice call. Speak naturally and conversationally — no markdown, no lists, no URLs. Keep replies short (1-3 sentences) unless the caller asks for detail. Spell out codes letter-by-letter ("H, E, L, L, O") rather than reading them as words.

## CRITICAL — AVOID DEAD AIR ON TOOL CALLS
Tool calls (looking up inventory, contacts, calendars, order status, etc.) can take 1-3 seconds. The caller WILL hear silence if you don't speak first.

ALWAYS emit a short, natural FILLER SENTENCE in the SAME turn as a tool_use. The filler should:
  - Be ONE short sentence (max 8 words), in your voice
  - Acknowledge what you're doing without robotic phrasing
  - Vary so it doesn't sound canned ("One sec, checking that", "Let me pull that up", "Quick look at your order", "Hold on, finding that for you")
  - NOT say "let me check the database" or similar internal-system language

Examples of CORRECT turns:
  text: "Sure, one moment — pulling up our running shoes."
  tool_use: search_shopify_products({...})

  text: "Let me check what we have left in your size."
  tool_use: check_shopify_inventory({...})

NEVER call a tool with NO text. Silence on tool calls is the #1 reason voice agents feel broken.`

  // ─── Tool loop ─ streamed NDJSON ─────────────────────────────────
  // Stream chunks back to the browser so the visitor hears the filler
  // sentence the moment Claude returns it, while we run the tool in
  // parallel. Without this, audio only plays AFTER the entire loop
  // finishes — which is the "dead air during inventory lookup"
  // complaint that started this work.
  //
  // Event shapes (one JSON per line):
  //   {"type":"filler","text":"...","audioBase64":"...","mimeType":"audio/mpeg"}
  //   {"type":"tool","name":"search_shopify_products","ms":1240}
  //   {"type":"final","reply":"...","audioBase64":"...","mimeType":"audio/mpeg","toolCalls":[...]}
  //   {"type":"error","message":"..."}
  const messages: Anthropic.MessageParam[] = [
    ...history.map(h => ({ role: h.role, content: h.content } as Anthropic.MessageParam)),
    { role: 'user', content: transcript },
  ]

  const tts = new XaiVoiceAdapter()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')) } catch {}
      }
      const speakChunk = async (text: string): Promise<{ audioBase64: string; mimeType: string }> => {
        try {
          const buf = await tts.speak!(text, voiceId, { codec: 'mp3' })
          return { audioBase64: Buffer.from(buf).toString('base64'), mimeType: 'audio/mpeg' }
        } catch (err: any) {
          console.error('[voice agent-turn] TTS failed:', err?.message)
          return { audioBase64: '', mimeType: '' }
        }
      }

      const toolCalls: Array<{ name: string; ms: number }> = []
      let crm: Awaited<ReturnType<typeof getCrmAdapter>> | null = null
      try { crm = await getCrmAdapter(agent.locationId) } catch { /* ignore — adapter resolved fresh per tool */ }

      let finalText = ''
      try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const response = await client.messages.create({
            model: MODEL,
            max_tokens: 600,
            system: systemPrompt,
            tools: tools.length > 0 ? tools : undefined,
            messages,
          })

          const toolUses: Anthropic.ToolUseBlock[] = []
          let textOut = ''
          for (const block of response.content) {
            if (block.type === 'text') textOut += block.text
            else if (block.type === 'tool_use') toolUses.push(block)
          }

          if (toolUses.length === 0) {
            // Pure text reply — final.
            finalText = textOut.trim()
            break
          }

          // We have tool_use(s) in this turn. Persist the assistant
          // message so Claude sees its own calls in the next loop.
          messages.push({ role: 'assistant', content: response.content })

          // Race the filler TTS against the tool execution so the
          // browser starts playing audio while the tool runs. Whichever
          // finishes first streams first; the tool result is appended
          // when both are done.
          const fillerText = textOut.trim()
          const fillerPromise: Promise<{ audioBase64: string; mimeType: string } | null> = fillerText
            ? speakChunk(fillerText)
            : Promise.resolve(null)

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          const toolPromises = toolUses.map(async (tu) => {
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
            const elapsed = Date.now() - start
            toolCalls.push({ name: tu.name, ms: elapsed })
            send({ type: 'tool', name: tu.name, ms: elapsed })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
          })

          // As soon as the filler audio is ready, ship it — even if
          // the tools are still running. That's the whole point: the
          // visitor hears "let me check" while the lookup happens.
          const filler = await fillerPromise
          if (filler && filler.audioBase64) {
            send({ type: 'filler', text: fillerText, audioBase64: filler.audioBase64, mimeType: filler.mimeType })
          }
          // Now wait for the tools to finish before the next Claude call.
          await Promise.all(toolPromises)
          messages.push({ role: 'user', content: toolResults })
        }

        if (!finalText) {
          finalText = "Sorry, I'm having trouble with that right now. Let me come back to you on it."
        }
        const finalAudio = await speakChunk(finalText)
        send({
          type: 'final',
          reply: finalText,
          audioBase64: finalAudio.audioBase64,
          mimeType: finalAudio.mimeType,
          toolCalls,
        })
      } catch (err: any) {
        console.error('[voice agent-turn] stream failed:', err)
        send({ type: 'error', message: err?.message || 'agent_turn_failed' })
      } finally {
        try { controller.close() } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
