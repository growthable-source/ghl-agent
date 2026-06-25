import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { GEMINI_NATIVE_VOICE_IDS } from '@/lib/voice/gemini-native-voices'
import { synthesizeVoicePreview, isGeminiTtsEnabled, VOICE_AGENT_PREVIEW_TEXT } from '@/lib/voice/gemini-tts'

/**
 * GET /api/voices/preview?voice=Puck
 *
 * Returns a short WAV sample of a Gemini prebuilt voice so an operator can
 * hear it before pinning it to a voice agent. Gemini voices have no
 * pre-recorded sample URL (no public one-shot CDN clip), so the picker
 * synthesizes one on demand here instead of leaving the play button dead.
 *
 * Guard rails mirror the co-pilot preview route: signed-in user, the voice
 * must be one of the fixed native names, and the sample text is fixed — so
 * there are only ~8 possible responses, which the CDN caches. Generation
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
  // Empty → Gemini's default voice. Otherwise must be a known native voice.
  if (raw && !GEMINI_NATIVE_VOICE_IDS.some(id => id === raw)) {
    return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })
  }
  const voiceName = raw || null

  const wav = await synthesizeVoicePreview(voiceName, VOICE_AGENT_PREVIEW_TEXT)
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
