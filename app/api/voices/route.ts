import { NextRequest, NextResponse } from 'next/server'
import { VapiVoiceAdapter } from '@/lib/voice/vapi-adapter'
import { VAPI_NATIVE_VOICES } from '@/lib/voice/vapi-native-voices'

/**
 * GET /api/voices?provider=vapi|elevenlabs&search=…
 *
 * Lists voices for the wizard / voice-config UI.
 *
 *   provider=vapi  (default) → Vapi-native voices (Elliot et al.)
 *   provider=elevenlabs       → ElevenLabs 5000+ catalogue (via Vapi proxy)
 *
 * Response shape stays the same for both: { voice_id, name,
 * preview_url, labels, language, category } — the UI doesn't branch.
 */
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') || 'vapi'
  const search = req.nextUrl.searchParams.get('search') || undefined

  try {
    if (provider === 'elevenlabs' || provider === '11labs') {
      const adapter = new VapiVoiceAdapter()
      const voices = await adapter.listVoices(search)
      return NextResponse.json({
        provider: 'elevenlabs',
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

    // Default: Vapi-native catalogue (Elliot, Cole, …). Hardcoded
    // list — see lib/voice/vapi-native-voices.ts.
    const filtered = search
      ? VAPI_NATIVE_VOICES.filter(v =>
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          (v.labels?.description ?? '').toLowerCase().includes(search.toLowerCase()),
        )
      : VAPI_NATIVE_VOICES
    return NextResponse.json({
      provider: 'vapi',
      voices: filtered.map(v => ({
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
