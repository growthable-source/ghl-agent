/**
 * Public Voice-AI web demo — mint an ephemeral Gemini Live token so a
 * landing-page visitor can talk to the demo agent in the browser (mic →
 * Gemini Live, no Twilio, no bridge). Mirrors the dashboard token route but:
 *   - serves a single fixed demo agent (VOICE_DEMO_AGENT_ID)
 *   - strips tools (a public demo never books/writes a real CRM)
 *   - hard-caps the session length (VOICE_DEMO_MAX_SECS, default 120s)
 *   - soft per-browser cooldown cookie so one visitor can't loop it
 *
 * Gated (503) until GEMINI_API_KEY + VOICE_DEMO_AGENT_ID are set.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
import { mintGeminiVoiceToken, GeminiVoiceNotConfiguredError, GeminiVoiceTokenMintError } from '@/lib/voice/gemini/mint'
import { normalizeGeminiVoiceModel } from '@/lib/voice/gemini/voice-config'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const COOLDOWN_COOKIE = 'xv_voice_demo'
const DEMO_MAX_SECS = Number(process.env.VOICE_DEMO_MAX_SECS) || 120
const COOLDOWN_SECS = Number(process.env.VOICE_DEMO_COOLDOWN_SECS) || 300

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const demoAgentId = process.env.VOICE_DEMO_AGENT_ID
  if (!demoAgentId) {
    return NextResponse.json({ error: 'The live voice demo isn’t available right now.', code: 'NO_DEMO_AGENT' }, { status: 503, headers: CORS })
  }

  // Soft per-browser cooldown — the real cost guard is the per-session cap below.
  if (req.cookies.get(COOLDOWN_COOKIE)) {
    return NextResponse.json({ error: 'You just tried the demo — give it a minute and try again.', code: 'COOLDOWN' }, { status: 429, headers: CORS })
  }

  const agent = await db.agent.findFirst({
    where: { id: demoAgentId },
    select: { id: true, name: true, systemPrompt: true, instructions: true, locationId: true, workspaceId: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'The live voice demo isn’t available right now.', code: 'NO_DEMO_AGENT' }, { status: 503, headers: CORS })
  }

  const config = await db.geminiVoiceConfig.findUnique({ where: { agentId: demoAgentId } })

  const session = buildGeminiVoiceSession(
    {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      instructions: agent.instructions,
      enabledTools: [], // public demo: conversational only, no real actions
      locationId: agent.locationId,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
    },
    {
      voiceName: config?.voiceName ?? null,
      model: normalizeGeminiVoiceModel(config?.model),
      firstMessage: config?.firstMessage ?? null,
      endCallMessage: config?.endCallMessage ?? null,
      language: config?.language ?? null,
      // Cap hard for a public demo regardless of the agent's own setting.
      maxDurationSecs: Math.min(config?.maxDurationSecs ?? DEMO_MAX_SECS, DEMO_MAX_SECS),
    },
  )

  try {
    const minted = await mintGeminiVoiceToken(session)
    const res = NextResponse.json(
      {
        connection: { token: minted.token, vendorModelId: minted.vendorModelId, provider: 'gemini-live' as const, maxSessionSecs: minted.maxSessionSecs, frameFpsCap: 0 },
        tools: [],
        vendorConfig: session.liveConfig,
        maxSessionSecs: minted.maxSessionSecs,
      },
      { headers: CORS },
    )
    res.cookies.set(COOLDOWN_COOKIE, '1', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: COOLDOWN_SECS })
    return res
  } catch (err) {
    if (err instanceof GeminiVoiceNotConfiguredError) {
      return NextResponse.json({ error: 'The live voice demo isn’t available right now.', code: 'GEMINI_NOT_CONFIGURED' }, { status: 503, headers: CORS })
    }
    if (err instanceof GeminiVoiceTokenMintError) {
      return NextResponse.json({ error: 'Couldn’t start the voice session — try again in a moment.', code: 'MINT_FAILED' }, { status: 502, headers: CORS })
    }
    throw err
  }
}
