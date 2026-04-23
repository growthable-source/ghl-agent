import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { VALID_STYLES, VALID_CHANNELS } from '@/lib/simulator'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

// Hard cap on customer swarm size so a runaway click can't queue hundreds.
// Admin swarms allow up to 500 — customers get a tighter ceiling because
// each sim is real Anthropic spend and the customer doesn't pay per call.
const MAX_CUSTOMER_SWARM_SIZE = 30

// Default turn ceiling for each sim in a swarm. The form can override,
// but this matches the single-sim default.
const DEFAULT_MAX_TURNS = 8

/**
 * Customer-facing swarm creator.
 *
 * Simpler contract than the admin path: ONE agent × N personas × M
 * runs-per-persona. The scenario (basic prompt) gets applied to every
 * persona — each one then reacts in its own style. Each persona's
 * simulator-level system prompt is already tuned for how it should
 * behave, so our only job here is to fan out the scenario.
 *
 * Sims land as status=queued, createdByType=user so the normal
 * auto-apply path runs when each one completes. The existing
 * /api/cron/process-simulations worker picks them up one per minute.
 *
 * Returns the swarm id; caller redirects to the detail page.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const { session } = access

  if (!session.user?.email) {
    return NextResponse.json({ error: 'Session missing email' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
  const scenario = typeof body.scenario === 'string' ? body.scenario.trim().slice(0, 4000) : ''
  const channel = typeof body.channel === 'string' ? body.channel : ''
  const personasInput: string[] = Array.isArray(body.personas) ? body.personas.filter((p: any) => typeof p === 'string') : []
  const runsPerPersona = typeof body.runsPerPersona === 'number'
    ? Math.max(1, Math.min(3, Math.floor(body.runsPerPersona)))
    : 1
  const maxTurns = typeof body.maxTurns === 'number'
    ? Math.max(2, Math.min(20, Math.floor(body.maxTurns)))
    : DEFAULT_MAX_TURNS

  if (!agentId || !scenario) {
    return NextResponse.json({ error: 'agentId and scenario required' }, { status: 400 })
  }
  if (!(VALID_CHANNELS as readonly string[]).includes(channel)) {
    return NextResponse.json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` }, { status: 400 })
  }

  // Validate personas. Filter to known styles and deduplicate.
  const validStyles = new Set(VALID_STYLES as readonly string[])
  const personas = Array.from(new Set(personasInput.filter(p => validStyles.has(p))))
  if (personas.length === 0) {
    return NextResponse.json({ error: 'At least one known persona required' }, { status: 400 })
  }

  const total = personas.length * runsPerPersona
  if (total > MAX_CUSTOMER_SWARM_SIZE) {
    return NextResponse.json({
      error: `${total} simulations exceeds the per-swarm cap (${MAX_CUSTOMER_SWARM_SIZE}). Drop a persona or reduce runs.`,
    }, { status: 400 })
  }

  // Tenancy check on the agent. Same pattern as the single-sim path.
  const agent = await db.agent.findFirst({
    where: {
      id: agentId,
      OR: [{ workspaceId }, { location: { workspaceId } }],
    },
    select: { id: true, workspaceId: true, location: { select: { workspaceId: true } } },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found in this workspace' }, { status: 404 })
  }
  const resolvedWorkspaceId = agent.workspaceId ?? agent.location?.workspaceId ?? workspaceId

  // Persona profiles — one per style, all sharing the same scenario.
  // These land in personaProfiles JSON on the swarm row for the
  // detail page to read back without re-deriving.
  const personaProfiles = personas.map(style => ({
    context: scenario,
    style,
    channel,
    goal: null,
    maxTurns,
  }))

  const swarmName = `Scenario swarm · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`

  const swarm = await db.$transaction(async (tx) => {
    const s = await tx.simulationSwarm.create({
      data: {
        name: swarmName,
        workspaceId,
        agentIds: [agentId],
        personaProfiles: personaProfiles as unknown as object,
        runsPerAgent: runsPerPersona,
        status: 'queued',
        createdByEmail: session.user!.email!,
        totalPlanned: total,
      },
      select: { id: true },
    })

    // Fan out the simulations. createMany is one round-trip, IDs are
    // auto-generated. Each sim is createdByType='user' so the existing
    // auto-apply flow in lib/auto-review.ts will kick in when the sim
    // completes — just like an individually-triggered user sim.
    const rows = personaProfiles.flatMap(p =>
      Array.from({ length: runsPerPersona }, () => ({
        agentId,
        workspaceId: resolvedWorkspaceId,
        personaContext: p.context,
        channel: p.channel,
        style: p.style,
        goal: null,
        maxTurns: p.maxTurns,
        status: 'queued',
        createdByType: 'user',
        createdByEmail: session.user!.email!,
        swarmId: s.id,
      })),
    )
    await tx.simulation.createMany({ data: rows })
    return s
  })

  return NextResponse.json({ swarmId: swarm.id })
}
