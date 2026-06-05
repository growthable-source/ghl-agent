/**
 * GET /api/voice/preview?voiceId=<id>&engine=vapi|elevenlabs
 *
 * Preview affordance for the wizard's voice grid. ElevenLabs voices
 * ship preview URLs in their catalogue (callers should prefer those
 * directly) and Vapi-native voices ship preview URLs in
 * lib/voice/vapi-native-voices.ts. This route is a fallback for
 * cases where the catalogue's preview URL is missing.
 *
 * Auth: dashboard session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getVapiNativeVoice } from '@/lib/voice/vapi-native-voices'

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
    const voice = getVapiNativeVoice(voiceId)
    if (!voice?.previewUrl) {
      return NextResponse.json({ error: 'Unknown Vapi-native voice or no preview' }, { status: 404 })
    }
    // 302 to Vapi's public CDN sample.
    return NextResponse.redirect(voice.previewUrl)
  }

  // ElevenLabs voices ship preview URLs alongside their metadata —
  // callers should use voice.preview_url directly. This branch is
  // for completeness only.
  return NextResponse.json(
    { error: 'ElevenLabs voices ship preview URLs alongside their metadata — use voice.preview_url directly.' },
    { status: 400 },
  )
}
