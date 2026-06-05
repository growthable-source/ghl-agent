/**
 * GET /api/voice/preview?engine=xai|elevenlabs&voiceId=<id>&text=<optional>
 *
 * Engine-agnostic preview endpoint. Returns an audio/mpeg stream the
 * browser can drop into <audio src=...>. Replaces the deleted
 * /api/voice/xai/preview route.
 *
 * - engine=elevenlabs: ElevenLabs voices already ship a public
 *   preview_url alongside their voice metadata, so we redirect there
 *   instead of synthesising. Callers should prefer using preview_url
 *   directly; this branch is for completeness / fallback.
 * - engine=xai: synthesises a fresh sample by POSTing to xAI's
 *   /v1/tts endpoint. xAI doesn't return preview URLs with its
 *   voice catalogue, so a per-click synthesis is the only way.
 *
 * Auth: dashboard session — TTS is read-only synthesis, no agent
 * gating needed (matches the deleted /api/voice/tts behaviour).
 *
 * Optional ?text= overrides the default "Hi, this is <voice> from
 * Voxility — give me a try." sample line.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const DEFAULT_PREVIEW_TEXT = 'Hi, this is Voxility. Give me a try.'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const engine = (req.nextUrl.searchParams.get('engine') || 'elevenlabs').toLowerCase()
  const voiceId = req.nextUrl.searchParams.get('voiceId') || ''
  const text = (req.nextUrl.searchParams.get('text') || DEFAULT_PREVIEW_TEXT).slice(0, 280)

  if (!voiceId) {
    return NextResponse.json({ error: 'voiceId is required' }, { status: 400 })
  }

  if (engine === 'xai') {
    return synthesiseXai(voiceId, text)
  }

  // ElevenLabs: preview URLs ship with the voice metadata, so this
  // route should rarely run for them. Return a hint instead of
  // synthesising — calling code should use voice.preview_url directly.
  return NextResponse.json(
    { error: 'ElevenLabs voices ship preview URLs alongside their metadata — use voice.preview_url directly.' },
    { status: 400 },
  )
}

async function synthesiseXai(voiceId: string, text: string): Promise<Response> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'XAI_API_KEY env var is not set on this deployment.' },
      { status: 503 },
    )
  }

  const res = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      language: 'en',
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `xAI /v1/tts failed (${res.status}): ${body.slice(0, 200)}` },
      { status: res.status },
    )
  }

  // Pass the audio through with the right Content-Type so <audio>
  // picks it up directly. xAI returns audio/mpeg by default.
  const buf = await res.arrayBuffer()
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'audio/mpeg',
      // Short cache so repeat clicks on the same voice are instant
      // but the file still rotates when xAI tweaks the voice.
      'Cache-Control': 'private, max-age=300',
    },
  })
}
