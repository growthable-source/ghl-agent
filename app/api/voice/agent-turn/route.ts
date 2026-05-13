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

  systemPrompt += `\n\n## VOICE CALL INSTRUCTIONS\nYou are on a live voice call. Speak naturally and conversationally — no markdown, no lists, no URLs. Keep replies short (1-3 sentences) unless the caller asks for detail. Before calling a tool, say a single short beat aloud ("let me check that for you") so the caller hears something, then call the tool. Spell out codes letter-by-letter ("H, E, L, L, O") rather than reading them as words.`

  // ─── Tool loop ───────────────────────────────────────────────────
  // Conversation: history + new user turn. Claude messages are
  // {role, content}; tool results require a specific content-block
  // shape so we use the structured form throughout.
  const messages: Anthropic.MessageParam[] = [
    ...history.map(h => ({ role: h.role, content: h.content } as Anthropic.MessageParam)),
    { role: 'user', content: transcript },
  ]

  const toolCalls: Array<{ name: string; ms: number }> = []
  let crm: Awaited<ReturnType<typeof getCrmAdapter>> | null = null
  try { crm = await getCrmAdapter(agent.locationId) } catch { /* ignore — adapter resolved fresh per tool below */ }

  let finalText = ''
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages,
    })

    // Pull text + tool_use blocks out of the assistant turn.
    const toolUses: Anthropic.ToolUseBlock[] = []
    let textOut = ''
    for (const block of response.content) {
      if (block.type === 'text') textOut += block.text
      else if (block.type === 'tool_use') toolUses.push(block)
    }

    if (toolUses.length === 0) {
      // Pure text reply — we're done.
      finalText = textOut.trim()
      break
    }

    // Persist the assistant turn (text + tool_use blocks) so Claude
    // can see its own tool calls in the next iteration.
    messages.push({ role: 'assistant', content: response.content })

    // Execute every tool_use block, append tool_result.
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const start = Date.now()
      let result = '{}'
      try {
        result = await executeTool(
          tu.name,
          tu.input as Record<string, unknown>,
          agent.locationId,
          /* sandbox */ false,
          agent.id,
          /* channel */ 'Voice',
          /* conversationProviderId */ undefined,
          crm ?? undefined,
          /* deferredSend */ undefined,
          /* fieldOverwriteMap */ undefined,
          /* handoverCapture */ undefined,
          agent.workspaceId,
        )
      } catch (err: any) {
        result = JSON.stringify({ error: err?.message || 'tool_dispatch_failed' })
      }
      toolCalls.push({ name: tu.name, ms: Date.now() - start })
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  if (!finalText) {
    finalText = "Sorry, I'm having trouble with that right now. Let me come back to you on it."
  }

  // ─── Generate TTS audio via XAI batch ────────────────────────────
  // The browser will base64-decode and play this. Keeping MP3 for
  // payload size; the realtime PCM path needs PCM16, but for a
  // batch reply MP3 is fine and a tenth the size.
  const tts = new XaiVoiceAdapter()
  let audioBase64 = ''
  let mimeType = 'audio/mpeg'
  try {
    const audioBuf = await tts.speak!(finalText, voiceId, { codec: 'mp3' })
    audioBase64 = Buffer.from(audioBuf).toString('base64')
  } catch (err: any) {
    console.error('[voice agent-turn] TTS failed:', err?.message)
    // Fail soft — return the text without audio so the client can
    // still display it (and we don't 500 the whole turn).
    mimeType = ''
  }

  return NextResponse.json({ reply: finalText, audioBase64, mimeType, toolCalls })
}
