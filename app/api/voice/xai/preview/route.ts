import { NextRequest } from 'next/server'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'

/**
 * GET /api/voice/xai/preview?voice=<id>&text=<optional>
 *
 * Generates a short preview clip for an XAI voice on demand. Unlike
 * ElevenLabs (which publishes preview URLs in its catalogue), XAI's
 * voices list doesn't carry one — we have to synthesise a sample each
 * time someone hits play. The voice page calls this lazily when the
 * user clicks preview, not on every voice card render.
 *
 * Returns raw mp3 bytes with audio/mpeg content-type so <audio src=…>
 * can consume it directly.
 */

const DEFAULT_SAMPLE = "Hi there — this is how I sound. Hope you like my voice."

export async function GET(req: NextRequest) {
  const voice = req.nextUrl.searchParams.get('voice') || 'eve'
  const text = (req.nextUrl.searchParams.get('text') || DEFAULT_SAMPLE).slice(0, 200)

  try {
    const adapter = new XaiVoiceAdapter()
    const audio = await adapter.speak!(text, voice, { codec: 'mp3', sampleRate: 24000, bitRate: 128000 })
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        // Short cache — most users preview the same voice twice in a row.
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (err: any) {
    return new Response(err.message || 'preview failed', { status: 500 })
  }
}
