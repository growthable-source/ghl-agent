import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyBridgeParams } from '@/lib/voice/gemini/signing'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'

/**
 * Bridge → control-plane handshake. The Fly bridge presents the signed
 * params blob it received in the Twilio <Parameter>; we verify the HMAC
 * (no session cookie — the signature IS the auth), then return the
 * locked GeminiVoiceSession the bridge opens against Gemini Live.
 *
 * This is approach (B) from the plan: the bridge stays decoupled from
 * Prisma/Next; buildGeminiVoiceSession remains the single source of truth.
 */
export async function POST(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const parsed = verifyBridgeParams(String(body?.params ?? ''))
  if (!parsed) {
    return NextResponse.json({ error: 'invalid or expired params' }, { status: 401 })
  }

  const agent = await db.agent.findUnique({
    where: { id: parsed.agentId },
    include: { geminiVoiceConfig: true },
  })
  if (!agent || !agent.geminiVoiceConfig || !agent.geminiVoiceConfig.isActive) {
    return NextResponse.json({ error: 'agent or Gemini voice config not found' }, { status: 404 })
  }

  const cfg = agent.geminiVoiceConfig
  const session = buildGeminiVoiceSession(
    {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      instructions: agent.instructions,
      enabledTools: agent.enabledTools,
      locationId: agent.locationId,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
    },
    {
      voiceName: cfg.voiceName,
      model: cfg.model || geminiVoiceModel(),
      firstMessage: cfg.firstMessage,
      endCallMessage: cfg.endCallMessage,
      language: cfg.language,
      maxDurationSecs: cfg.maxDurationSecs,
    },
  )

  return NextResponse.json({
    session,
    agentId: agent.id,
    locationId: agent.locationId,
    workspaceId: agent.workspaceId,
  })
}
