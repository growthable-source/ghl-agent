import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { GEMINI_NATIVE_VOICE_IDS } from '@/lib/voice/gemini-native-voices'
import { synthesizeVoicePreview, isGeminiTtsEnabled, VOICE_AGENT_PREVIEW_TEXT } from '@/lib/voice/gemini-tts'
import { getCartesiaVoice } from '@/lib/voice/cartesia-voices'
import { synthesizeCartesiaPreview, isCartesiaTtsEnabled } from '@/lib/voice/cartesia-tts'

/**
 * GET /api/voices/preview?provider=cartesia&voice=<id>
 *
 * Returns a short synthesized sample of a voice so the picker ▶ actually
 * plays something — Cartesia and Gemini voices have no pre-recorded CDN
 * sample, so we synth one on demand. Fixed sample text + bounded voice set
 * → only a handful of distinct responses, which the CDN caches.
 *
 * provider=cartesia (default, our most-human engine) → MP3 via Cartesia TTS
 * provider=gemini                                     → WAV via Gemini TTS
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = req.nextUrl.searchParams.get('provider') || 'cartesia'
  const raw = req.nextUrl.searchParams.get('voice') ?? ''

  const cacheHeaders = {
    // Fixed text + bounded voice set → safe to cache hard at the CDN.
    'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
  }

  if (provider === 'gemini') {
    if (!isGeminiTtsEnabled()) {
      return NextResponse.json({ error: 'Voice preview is not configured on this deployment.' }, { status: 503 })
    }
    if (raw && !GEMINI_NATIVE_VOICE_IDS.some(id => id === raw)) {
      return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })
    }
    const wav = await synthesizeVoicePreview(raw || null, VOICE_AGENT_PREVIEW_TEXT)
    if (!wav) return NextResponse.json({ error: 'Could not generate a sample. Try again.' }, { status: 502 })
    return new NextResponse(new Uint8Array(wav), {
      status: 200,
      headers: { 'Content-Type': 'audio/wav', ...cacheHeaders },
    })
  }

  // Cartesia (default) — most-human engine.
  if (!isCartesiaTtsEnabled()) {
    return NextResponse.json({ error: 'Voice preview is not configured on this deployment.' }, { status: 503 })
  }
  if (!raw || !getCartesiaVoice(raw)) {
    return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })
  }
  const mp3 = await synthesizeCartesiaPreview(raw)
  if (!mp3) return NextResponse.json({ error: 'Could not generate a sample. Try again.' }, { status: 502 })
  return new NextResponse(new Uint8Array(mp3), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', ...cacheHeaders },
  })
}
