/**
 * POST /api/voice/tts
 *
 * Server-side XAI batch text-to-speech. Used by the voice test panel
 * for fixed text we don't want to route through the LLM (greetings,
 * canned messages). The user-turn path uses /api/voice/agent-turn
 * which TTS's its own Claude-generated reply.
 *
 * Auth: dashboard session (no agent gating needed — TTS is read-only
 * synthesis, not a state change).
 *
 * Body: { text, voiceId }
 * Returns: { audioBase64, mimeType }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  let body: { text?: string; voiceId?: string } = {}
  try { body = await req.json() } catch {}
  const { text, voiceId } = body
  if (!text || !voiceId) return NextResponse.json({ error: 'text and voiceId required' }, { status: 400 })

  try {
    const adapter = new XaiVoiceAdapter()
    const audioBuf = await adapter.speak!(text, voiceId, { codec: 'mp3' })
    return NextResponse.json({
      audioBase64: Buffer.from(audioBuf).toString('base64'),
      mimeType: 'audio/mpeg',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'tts_failed' }, { status: 500 })
  }
}
