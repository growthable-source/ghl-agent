import { NextRequest, NextResponse } from 'next/server'
import { getVoiceAdapter } from '@/lib/voice/factory'

/**
 * GET /api/voices?provider=vapi|xai&search=…
 *
 * Lists voices from the requested provider. Defaults to Vapi when no
 * provider is specified so existing callers keep working unchanged.
 *
 * Response shape is the legacy ElevenLabs-style { voice_id, name,
 * preview_url, labels } so the voice page UI doesn't need to branch
 * per provider. VoiceOption.id → voice_id, etc. capabilities are
 * returned alongside so the UI can gate phone-specific sections.
 */
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') || 'vapi'
  const search = req.nextUrl.searchParams.get('search') || undefined

  try {
    const adapter = getVoiceAdapter(provider)
    const voices = await adapter.listVoices(search)
    return NextResponse.json({
      provider: adapter.provider,
      capabilities: adapter.capabilities,
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
