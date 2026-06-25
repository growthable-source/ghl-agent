/**
 * One-shot Gemini text-to-speech — used to PREVIEW a prebuilt voice before
 * an operator pins it to a co-pilot agent.
 *
 * Why one-shot REST (not the Live socket the runtime uses): a preview is a
 * fixed, ~3-second sample of a fixed sentence. A full Live session is
 * overkill and can't be cached. Here we hit the TTS generateContent
 * endpoint, get back raw PCM, wrap it in a WAV header (browsers won't play
 * bare L16), and let the CDN cache the result — the sample text is fixed,
 * so there are only ~8 distinct clips ever.
 *
 * Mirrors lib/image-gen-gemini.ts: raw fetch, GEMINI_API_KEY, null on
 * failure so the caller degrades gracefully.
 */

const GEMINI_API_BASE = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts'

/** The line every voice preview speaks. Fixed → cacheable, and short. */
export const VOICE_PREVIEW_TEXT =
  "Hi — I'm your Voxility co-pilot. I'll guide you through it, one step at a time."

/**
 * Neutral preview line for a phone/voice AGENT (vs the co-pilot). Used by
 * the generic /api/voices/preview endpoint so the sample sounds like a
 * call agent, not a screen-share guide. Fixed → cacheable.
 */
export const VOICE_AGENT_PREVIEW_TEXT =
  "Hi there — thanks for calling. This is how I'll sound when I answer. How can I help you today?"

export function isGeminiTtsEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/** Wrap raw little-endian 16-bit mono PCM in a minimal WAV (RIFF) header. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1
  const bitsPerSample = 16
  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** Parse "audio/L16;codec=pcm;rate=24000" → 24000. Defaults to 24000. */
function rateFromMime(mime: string | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? '')
  return m ? parseInt(m[1], 10) : 24000
}

/**
 * Synthesize the fixed preview line in `voiceName` (null/omitted → Gemini's
 * default voice). Returns WAV bytes, or null on any failure.
 */
export async function synthesizeVoicePreview(
  voiceName: string | null,
  text: string = VOICE_PREVIEW_TEXT,
): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const speechConfig = voiceName
    ? { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
    : {}

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig,
          },
        }),
      },
    )
    if (!res.ok) {
      console.warn('[gemini-tts] preview failed:', res.status, (await res.text()).slice(0, 300))
      return null
    }
    const data = await res.json()
    const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data)
    const b64 = part?.inlineData?.data
    if (!b64) return null
    const pcm = Buffer.from(b64, 'base64')
    return pcmToWav(pcm, rateFromMime(part.inlineData.mimeType))
  } catch (err: any) {
    console.warn('[gemini-tts] preview error:', err?.message)
    return null
  }
}
