import { NextRequest, NextResponse } from 'next/server'
import { VapiVoiceAdapter } from '@/lib/voice/vapi-adapter'
import { listXaiVoices } from '@/lib/voice/xai-voices'

/**
 * GET /api/voices?provider=vapi|xai&search=…
 *
 * Lists voices for the wizard / voice-config UI. There's only one
 * runtime provider (Vapi — phone bridge), but two engines live inside
 * Vapi's assistant config: ElevenLabs (via the Vapi catalogue) and
 * Grok (via xAI's voice list, accepted natively by Vapi as
 * `voice.provider: 'xai'`).
 *
 *   provider=vapi  → ElevenLabs voices via Vapi's proxy
 *   provider=xai   → Grok voices via xAI's /v1/tts/voices
 *
 * Response shape stays the same for both: { voice_id, name,
 * preview_url, labels, language, category } — the UI doesn't branch.
 */
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') || 'vapi'
  const search = req.nextUrl.searchParams.get('search') || undefined

  try {
    if (provider === 'xai') {
      const voices = await listXaiVoices()
      return NextResponse.json({
        provider: 'xai',
        voices: voices.map(v => ({
          voice_id: v.id,
          name: v.name,
          preview_url: v.previewUrl ?? null,
          labels: v.labels ?? {},
          language: v.language ?? null,
          category: 'premade',
        })),
      })
    }

    // Default: ElevenLabs catalogue via Vapi.
    const adapter = new VapiVoiceAdapter()
    const voices = await adapter.listVoices(search)
    return NextResponse.json({
      provider: 'vapi',
      voices: voices.map(v => ({
        voice_id: v.id,
        name: v.name,
        preview_url: v.previewUrl ?? null,
        labels: v.labels ?? {},
        language: v.language ?? null,
        category: 'premade',
      })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to list voices' }, { status: 500 })
  }
}
