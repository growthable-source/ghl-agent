import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminActionAfter, roleHas } from '@/lib/admin-auth'
import { VALID_STYLES, VALID_CHANNELS } from '@/lib/simulator'

export const dynamic = 'force-dynamic'

// Hard cap on swarm size so a mis-click doesn't queue a thousand sims.
const MAX_SWARM_SIZE = 500

interface PersonaInput {
  context?: string
  style?: string
  channel?: string
  goal?: string | null
  maxTurns?: number
}

/**
 * Create a new SimulationSwarm and queue N Simulation rows for it.
 * Status starts at 'queued'; the cron worker processes them one-per-tick.
 */
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!roleHas(session.role, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const agentIds: string[] = Array.isArray(body.agentIds) ? body.agentIds.filter((x: any) => typeof x === 'string') : []
  const runsPerAgent = typeof body.runsPerAgent === 'number'
    ? Math.max(1, Math.min(20, Math.floor(body.runsPerAgent)))
    : 1
  const rawPersonas: PersonaInput[] = Array.isArray(body.personaProfiles) ? body.personaProfiles : []

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (agentIds.length === 0) return NextResponse.json({ error: 'at least one agent required' }, { status: 400 })

  // Validate + normalise personas. Drop ones with empty context.
  const personas = rawPersonas
    .map(p => {
      if (typeof p.context !== 'string' || !p.context.trim()) return null
      const style = typeof p.style === 'string' && (VALID_STYLES as readonly string[]).includes(p.style) ? p.style : 'friendly'
      const channel = typeof p.channel === 'string' && (VALID_CHANNELS as readonly string[]).includes(p.channel) ? p.channel : 'SMS'
      const goal = typeof p.goal === 'string' && p.goal.trim() ? p.goal.trim().slice(0, 1000) : null
      const maxTurns = typeof p.maxTurns === 'number' ? Math.max(2, Math.min(20, Math.floor(p.maxTurns))) : 8
      return {
        context: p.context.trim().slice(0, 4000),
        style,
        channel,
        goal,
        maxTurns,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (personas.length === 0) {
    return NextResponse.json({ error: 'at least one persona with context required' }, { status: 400 })
  }

  const totalPlanned = agentIds.length * personas.length * runsPerAgent
  if (totalPlanned > MAX_SWARM_SIZE) {
    return NextResponse.json({
      error: `Would queue ${totalPlanned} simulations — cap is ${MAX_SWARM_SIZE}.`,
    }, { status: 400 })
  }

  // Look up each agent's workspace so we can denormalise it onto each
  // Simulation (the runtime needs it for learning scope resolution).
  const agents = await db.agent.findMany({
    where: { id: { in: agentIds }, isActive: true },
    select: {
      id: true, workspaceId: true,
      location: { select: { workspaceId: true } },
    },
  })
  const workspaceByAgent = new Map(
    agents.map(a => [a.id, a.workspaceId ?? a.location?.workspaceId ?? null] as const),
  )
  // Drop agentIds that didn't resolve (inactive or deleted between
  // form-load and submit).
  const activeAgentIds = agentIds.filter(id => workspaceByAgent.has(id))
  if (activeAgentIds.length === 0) {
    return NextResponse.json({ error: 'No active agents resolved from the selection' }, { status: 400 })
  }

  const swarm = await db.$transaction(async (tx) => {
    const s = await tx.simulationSwarm.create({
      data: {
        name,
        agentIds: activeAgentIds,
        personaProfiles: personas as unknown as object,
        runsPerAgent,
        status: 'queued',
        createdByEmail: session.email,
        totalPlanned: activeAgentIds.length * personas.length * runsPerAgent,
      },
      select: { id: true },
    })

    // createMany is fastest here — one round trip. Skip duplicates isn't
    // needed (no unique constraints), but we want the IDs back so we use
    // createManyAndReturn in Prisma 7 if available — otherwise
    // individual creates are fine since the loop is small (≤500).
    const rows: Array<{
      agentId: string
      workspaceId: string | null
      personaContext: string
      channel: string
      style: string
      goal: string | null
      maxTurns: number
      status: string
      createdByType: string
      createdByEmail: string
      swarmId: string
    }> = []
    for (const agentId of activeAgentIds) {
      for (const p of personas) {
        for (let i = 0; i < runsPerAgent; i++) {
          rows.push({
            agentId,
            workspaceId: workspaceByAgent.get(agentId) ?? null,
            personaContext: p.context,
            channel: p.channel,
            style: p.style,
            goal: p.goal,
            maxTurns: p.maxTurns,
            status: 'queued',
            createdByType: 'swarm',
            createdByEmail: session.email,
            swarmId: s.id,
          })
        }
      }
    }
    await tx.simulation.createMany({ data: rows })
    return s
  })

  logAdminActionAfter({
    admin: session,
    action: 'simulation_swarm_create',
    target: swarm.id,
    meta: { agents: activeAgentIds.length, personas: personas.length, runsPerAgent, totalPlanned },
  })

  return NextResponse.json({ swarmId: swarm.id })
}
