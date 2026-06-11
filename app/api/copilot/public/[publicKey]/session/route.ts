/**
 * Public Co-Pilot agent launch — the API behind the shareable link,
 * the button, and the JS snippet. Auth = the agent's publicKey (same
 * trust model as ChatWidget.publicKey); only published agents answer.
 *
 *   GET  — agent display info for the launch page (name, type)
 *   POST — create a session { locale? } → realtime token etc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createPublicAgentSession,
  CopilotNotConfiguredError,
  CopilotTokenMintError,
  CopilotSopNotFoundError,
} from '@/lib/copilot/session-service'

type Params = { params: Promise<{ publicKey: string }> }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { publicKey } = await params
  const agent = await db.copilotAgent.findFirst({
    where: { publicKey, published: true },
    select: { name: true, type: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: CORS })
  return NextResponse.json({ name: agent.name, type: agent.type }, { headers: CORS })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { publicKey } = await params
  const body = (await req.json().catch(() => ({}))) as { locale?: string }
  try {
    const result = await createPublicAgentSession(publicKey, { locale: body.locale })
    return NextResponse.json(result, { headers: CORS })
  } catch (err) {
    if (err instanceof CopilotSopNotFoundError) {
      return NextResponse.json({ error: 'This co-pilot link is invalid or unpublished.' }, { status: 404, headers: CORS })
    }
    if (err instanceof CopilotNotConfiguredError) {
      return NextResponse.json({ error: 'Live help is not available right now.' }, { status: 503, headers: CORS })
    }
    if (err instanceof CopilotTokenMintError) {
      return NextResponse.json({ error: 'Could not start a session right now.' }, { status: 502, headers: CORS })
    }
    throw err
  }
}
