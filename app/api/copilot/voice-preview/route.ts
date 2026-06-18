import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { COPILOT_VOICES } from '@/lib/copilot/voices'
import { synthesizeVoicePreview, isGeminiTtsEnabled } from '@/lib/voice/gemini-tts'

/**
 * GET /api/copilot/voice-preview?voice=Kore
 *
 * Returns a short WAV sample of the requested Gemini prebuilt voice so an
 * operator can hear it before pinning it. Omit `voice` (or pass empty) to
 * preview Gemini's default voice.
 *
 * Guard rails: requires a signed-in user; `voice` must be one of the
 * curated pool (never an arbitrary string); the sample text is fixed. So
 * there are only ~9 possible responses, which the CDN caches — generation
 * cost is bounded regardless of traffic.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isGeminiTtsEnabled()) {
    return NextResponse.json({ error: 'Voice preview is not configured on this deployment.' }, { status: 503 })
  }

  const raw = req.nextUrl.searchParams.get('voice') ?? ''
  // Empty → default voice. Otherwise must be a known pool voice.
  if (raw && !COPILOT_VOICES.some(v => v.id === raw)) {
    return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })
  }
  const voiceName = raw || null

  const wav = await synthesizeVoicePreview(voiceName)
  if (!wav) {
    return NextResponse.json({ error: 'Could not generate a sample. Try again.' }, { status: 502 })
  }

  return new NextResponse(new Uint8Array(wav), {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      // Fixed text + bounded voice set → safe to cache hard at the CDN.
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    },
  })
}
