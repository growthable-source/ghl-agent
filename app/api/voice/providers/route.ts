import { NextResponse } from 'next/server'
import { listVoiceProviders, getVoiceAdapter } from '@/lib/voice/factory'

/**
 * GET /api/voice/providers
 *
 * Lightweight metadata endpoint for the voice page. Returns every known
 * provider's id, name, description, capabilities, and whether the server
 * thinks it's configured (env vars present). The UI uses this to render
 * the provider dropdown with capability badges and a configuration hint
 * when the required env var is missing.
 */
export async function GET() {
  const providers = listVoiceProviders().map(p => {
    const adapter = getVoiceAdapter(p.id)
    // Cheap "is the key plausibly set?" probe — we don't call the API
    // here, just check the env. Full validity only surfaces on first use.
    const configured = !!process.env[p.envVar]
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      envVar: p.envVar,
      configured,
      capabilities: adapter.capabilities,
    }
  })

  return NextResponse.json({ providers })
}
