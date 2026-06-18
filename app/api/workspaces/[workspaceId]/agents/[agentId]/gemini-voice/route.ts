import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET — load the agent's GeminiVoiceConfig, creating a default row if
 * none exists (so the UI always has something to bind to). Also returns
 * the agent's current voiceRuntime + whether GEMINI_API_KEY is set.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, name: true, voiceRuntime: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let config = await db.geminiVoiceConfig.findUnique({ where: { agentId } })
  if (!config) {
    config = await db.geminiVoiceConfig.create({
      data: { agentId, model: geminiVoiceModel() },
    })
  }

  const geminiReady = !!process.env.GEMINI_API_KEY
  return NextResponse.json({
    config,
    voiceRuntime: agent.voiceRuntime ?? 'vapi',
    agentName: agent.name,
    geminiReady,
  })
}

/**
 * PUT — upsert the GeminiVoiceConfig and set Agent.voiceRuntime to
 * 'gemini' when isActive, else 'vapi'. The body is the editable subset
 * of the config; server controls agentId + timestamps.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Whitelist editable fields — never trust client-supplied agentId/ids.
  const data = {
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    voiceName: typeof body.voiceName === 'string' || body.voiceName === null ? (body.voiceName as string | null) : undefined,
    model: typeof body.model === 'string' && body.model ? body.model : undefined,
    firstMessage: typeof body.firstMessage === 'string' || body.firstMessage === null ? (body.firstMessage as string | null) : undefined,
    endCallMessage: typeof body.endCallMessage === 'string' || body.endCallMessage === null ? (body.endCallMessage as string | null) : undefined,
    maxDurationSecs: typeof body.maxDurationSecs === 'number' && body.maxDurationSecs > 0 ? Math.round(body.maxDurationSecs) : undefined,
    recordCalls: typeof body.recordCalls === 'boolean' ? body.recordCalls : undefined,
    language: typeof body.language === 'string' || body.language === null ? (body.language as string | null) : undefined,
  }
  // Drop undefined keys so Prisma update doesn't null-out unspecified columns.
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))

  const config = await db.geminiVoiceConfig.upsert({
    where: { agentId },
    create: { agentId, model: geminiVoiceModel(), ...clean },
    update: clean,
  })

  // Flip the runtime discriminator off this save. Activating Gemini sets
  // the agent's runtime to 'gemini'; deactivating returns it to 'vapi'.
  await db.agent.update({
    where: { id: agentId },
    data: { voiceRuntime: config.isActive ? 'gemini' : 'vapi' },
  })

  return NextResponse.json({ config, voiceRuntime: config.isActive ? 'gemini' : 'vapi' })
}
