import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { runSimulation, VALID_STYLES, VALID_CHANNELS } from '@/lib/simulator'

export const dynamic = 'force-dynamic'
// Synchronous run takes up to ~60s for a multi-turn sim + auto-review.
// Vercel's hard cap for the Pro plan is 300s, so we stay well under it.
export const maxDuration = 120

type Params = { params: Promise<{ workspaceId: string }> }

// Per-workspace daily cap. Each sim is ~10-20 Claude calls, so this
// bounds cost. Raise per-workspace via a column if a customer asks.
const DAILY_SIM_CAP = 50

/**
 * Customer-facing: create a new simulation and run it synchronously.
 *
 * Returns once the sim is complete (or failed). The client can then
 * redirect to the detail page. If you want fire-and-forget instead,
 * queue via the swarm flow.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({} as any))
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
  const personaContext = typeof body.personaContext === 'string' ? body.personaContext.trim().slice(0, 4000) : ''
  const channel = typeof body.channel === 'string' ? body.channel : ''
  const style = typeof body.style === 'string' ? body.style : ''
  const goal = typeof body.goal === 'string' ? body.goal.trim().slice(0, 1000) : null
  const maxTurns = typeof body.maxTurns === 'number' ? Math.max(2, Math.min(20, body.maxTurns)) : 8

  if (!agentId || !personaContext || !VALID_CHANNELS.includes(channel as any) || !VALID_STYLES.includes(style as any)) {
    return NextResponse.json({
      error: 'agentId, personaContext, channel (SMS/Email/WhatsApp/Live_Chat), and style required',
    }, { status: 400 })
  }

  // Workspace-scope the agent — can't simulate someone else's agent.
  const agent = await db.agent.findFirst({
    where: {
      id: agentId,
      OR: [
        { workspaceId },
        { location: { workspaceId } },
      ],
    },
    select: { id: true, locationId: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found in this workspace' }, { status: 404 })
  }

  // Rate limit per workspace per 24h. A rolling window is simpler than
  // calendar-day buckets and prevents abuse from batching at midnight.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentCount = await db.simulation.count({
    where: { workspaceId, createdAt: { gte: since } },
  })
  if (recentCount >= DAILY_SIM_CAP) {
    return NextResponse.json({
      error: `Daily simulation cap reached (${DAILY_SIM_CAP}/24h). Contact support to raise.`,
    }, { status: 429 })
  }

  const sim = await db.simulation.create({
    data: {
      agentId,
      workspaceId,
      personaContext,
      channel,
      style,
      goal: goal || null,
      maxTurns,
      status: 'running',   // we run synchronously below
      startedAt: new Date(),
      createdByType: 'user',
      createdByEmail: session.user.email,
    },
    select: { id: true },
  })

  try {
    await runSimulation(sim.id)
  } catch (err: any) {
    // runSimulation marks failed internally; this catch is belt-and-braces.
    return NextResponse.json({
      error: `Simulation failed: ${err?.message ?? 'unknown'}`,
      simulationId: sim.id,
    }, { status: 500 })
  }

  return NextResponse.json({ simulationId: sim.id })
}

/**
 * List simulations for this workspace. Paginated by most-recent 50.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const sims = await db.simulation.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      agent: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ simulations: sims })
}
