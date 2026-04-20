import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'

/**
 * POST /api/voice/xai/client-secret
 *
 * Mints a short-lived XAI realtime client secret so a browser can open
 * wss://api.x.ai/v1/realtime directly without exposing the server-side
 * XAI_API_KEY. The secret is tied to a single realtime session and
 * expires quickly (default 300s).
 *
 * Auth: must be a signed-in dashboard user. This isn't a public endpoint
 * — anyone with the returned token can burn your XAI quota until it
 * expires, so we gate by session. Widget voice (public visitors) uses a
 * different path that will issue tokens via the widget's validation flow.
 *
 * Body: { expiresInSeconds?: number }  — clamped 30..3600
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: { expiresInSeconds?: number } = {}
  try { body = await req.json() } catch {}

  try {
    const adapter = new XaiVoiceAdapter()
    const token = await adapter.getRealtimeToken!({ expiresInSeconds: body.expiresInSeconds })
    return NextResponse.json(token)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'client-secret failed' }, { status: 500 })
  }
}
