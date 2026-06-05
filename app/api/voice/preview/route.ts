/**
 * GET /api/voice/preview?voiceId=<id>&engine=vapi|elevenlabs
 *
 * Preview affordance for the wizard's voice grid.
 *
 *   • ElevenLabs voices ship `preview_url` inline with their catalogue
 *     entries — the UI uses those directly. This endpoint is only here
 *     so the route exists; callers that hit it for ElevenLabs get a
 *     400 telling them to use the catalogue preview_url instead.
 *
 *   • Vapi-native voices have NO public preview endpoint. Vapi's
 *     `vapi-ai/web` SDK is WebRTC-only; there is no documented REST
 *     TTS-proxy that returns a one-shot MP3. We could spin up a
 *     transient assistant + start a WebRTC call just to hear the
 *     voice, but that's expensive and slow. For now we return 404
 *     with a friendly message; the UI hides the preview button when
 *     it knows the engine is 'vapi'.
 *
 *     If Vapi ever ships a /tts or /generate/audio endpoint, replace
 *     the 404 branch with a server-side proxy and the UI will pick
 *     it up via the same URL — no UI change required.
 *
 * Auth: dashboard session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const engine = (req.nextUrl.searchParams.get('engine') || 'vapi').toLowerCase()
  const voiceId = req.nextUrl.searchParams.get('voiceId') || ''
  if (!voiceId) {
    return NextResponse.json({ error: 'voiceId is required' }, { status: 400 })
  }

  if (engine === 'vapi') {
    return NextResponse.json(
      {
        error:
          'Vapi-native voices do not currently have a one-shot preview endpoint. Use the in-browser Test Call panel to hear the voice live.',
      },
      { status: 404 },
    )
  }

  // ElevenLabs voices ship preview URLs alongside their metadata —
  // callers should use voice.preview_url directly. This branch is for
  // completeness only.
  return NextResponse.json(
    {
      error:
        'ElevenLabs voices ship preview URLs alongside their metadata — use voice.preview_url directly.',
    },
    { status: 400 },
  )
}
