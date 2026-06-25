/**
 * One-shot Cartesia (Sonic) text-to-speech — used to PREVIEW a voice in the
 * picker before pinning it. Cartesia voices have no public pre-recorded
 * sample URL, so the ▶ synthesizes a short fixed clip on demand (mirrors
 * the Gemini preview path in gemini-tts.ts).
 *
 * Returns MP3 bytes (browsers play it directly), or null on any failure so
 * the caller degrades gracefully. Needs CARTESIA_API_KEY.
 */

const CARTESIA_API_BASE = process.env.CARTESIA_API_BASE ?? 'https://api.cartesia.ai'
const CARTESIA_API_VERSION = process.env.CARTESIA_API_VERSION ?? '2025-04-16'
const CARTESIA_TTS_MODEL = process.env.CARTESIA_MODEL || 'sonic-2'

/** The line every Cartesia preview speaks. Fixed → cacheable, short. */
export const CARTESIA_PREVIEW_TEXT =
  "Hi there — thanks for calling. This is how I'll sound when I answer. How can I help you today?"

export function isCartesiaTtsEnabled(): boolean {
  return !!process.env.CARTESIA_API_KEY
}

/** Synthesize the fixed preview line in `voiceId`. MP3 bytes, or null on failure. */
export async function synthesizeCartesiaPreview(voiceId: string): Promise<Buffer | null> {
  const apiKey = process.env.CARTESIA_API_KEY
  if (!apiKey || !voiceId) return null

  try {
    const res = await fetch(`${CARTESIA_API_BASE}/tts/bytes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Cartesia-Version': CARTESIA_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: CARTESIA_TTS_MODEL,
        transcript: CARTESIA_PREVIEW_TEXT,
        voice: { mode: 'id', id: voiceId },
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      }),
    })
    if (!res.ok) {
      console.warn('[cartesia-tts] preview failed:', res.status, (await res.text()).slice(0, 300))
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (err: any) {
    console.warn('[cartesia-tts] preview error:', err?.message)
    return null
  }
}
