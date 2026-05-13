/**
 * POST /api/voice/tts — STREAMING text-to-speech.
 *
 * Used by the voice test panel for fixed text we don't want to route
 * through the LLM (greetings, canned messages). Same wire format as
 * /api/voice/agent-turn so the client uses a single chunk handler for
 * both paths:
 *
 *   {"type":"audio","b64":"<base64 PCM16 24kHz>"}
 *   {"type":"done"}
 *
 * Auth: dashboard session.
 * Body: { text, voiceId }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'not_authenticated' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { text?: string; voiceId?: string } = {}
  try { body = await req.json() } catch {}
  const { text, voiceId } = body
  if (!text || !voiceId) {
    return new Response(JSON.stringify({ error: 'text and voiceId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const xai = new XaiVoiceAdapter()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }
      try {
        const audioStream = await xai.speakStream!(text, voiceId, { codec: 'pcm', sampleRate: 24000 })
        const reader = audioStream.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) {
            sendEvent({ type: 'audio', b64: Buffer.from(value).toString('base64') })
          }
        }
        sendEvent({ type: 'done' })
      } catch (err: any) {
        sendEvent({ type: 'error', message: err?.message || 'tts_failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
