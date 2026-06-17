import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getDecryptedBotToken } from '@/lib/slack/connection'
import { listChannels } from '@/lib/slack/client'

type Ctx = { params: Promise<{ workspaceId: string }> }

/** Channels the bot can see, for the default-channel + per-agent pickers. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const token = await getDecryptedBotToken(workspaceId)
  if (!token) return NextResponse.json({ channels: [] })

  try {
    const channels = await listChannels(token)
    return NextResponse.json({ channels })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'failed to list channels'
    return NextResponse.json({ error: message, channels: [] }, { status: 502 })
  }
}
