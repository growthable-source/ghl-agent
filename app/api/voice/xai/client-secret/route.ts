import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { XaiVoiceAdapter } from '@/lib/voice/xai-adapter'
import { buildVoiceTools, type XaiRealtimeTool } from '@/lib/voice/tools'

/**
 * POST /api/voice/xai/client-secret
 *
 * Mints a short-lived XAI realtime client secret so a browser can open
 * wss://api.x.ai/v1/realtime directly without exposing the server-side
 * XAI_API_KEY. The secret is tied to a single realtime session and
 * expires quickly (default 300s).
 *
 * If `agentId` is included in the body, we ALSO return the agent's
 * voice-safe tool list (XAI/OpenAI realtime tool envelope) so the
 * browser can pass it in the very first session.update without a
 * second round-trip.
 *
 * Auth: must be a signed-in dashboard user. This isn't a public endpoint
 * — anyone with the returned token can burn your XAI quota until it
 * expires, so we gate by session. Widget voice (public visitors) uses a
 * different path that will issue tokens via the widget's validation flow.
 *
 * Body: { expiresInSeconds?: number; agentId?: string }
 *   - expiresInSeconds clamped 30..3600
 *   - agentId optional; when present, member access is verified and
 *     tools are returned. When absent, tools is [].
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: { expiresInSeconds?: number; agentId?: string } = {}
  try { body = await req.json() } catch {}

  // Optional agent context. We don't 404 if missing — voice can run
  // without tools (just chitchat + system prompt). Only enforce
  // workspace membership when an agent IS supplied.
  let tools: XaiRealtimeTool[] = []
  if (body.agentId) {
    const agent = await db.agent.findUnique({
      where: { id: body.agentId },
      select: {
        enabledTools: true,
        workspaceId: true,
        workspace: {
          select: {
            members: { where: { userId: session.user.id }, select: { userId: true } },
          },
        },
      },
    })
    if (!agent) {
      return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
    }
    if (!agent.workspaceId || agent.workspace?.members.length === 0) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    tools = buildVoiceTools(agent.enabledTools)
  }

  try {
    const adapter = new XaiVoiceAdapter()
    const token = await adapter.getRealtimeToken!({ expiresInSeconds: body.expiresInSeconds })
    return NextResponse.json({ ...token, tools })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'client-secret failed' }, { status: 500 })
  }
}
