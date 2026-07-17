/**
 * POST /api/public/try/[slug]/web-token — mint an ephemeral Gemini Live
 * token for a prospect's personalized voice demo. Parameterized sibling
 * of /api/public/voice-demo/web-token with cold-email-scale guards:
 *   - per-IP: one call per DEMO_TRY_IP_COOLDOWN_SECS (default 120)
 *   - global: DEMO_TRY_MAX_CONCURRENT active calls (default 15)
 *   - per-browser cookie cooldown (soft)
 *   - hard per-session cap DEMO_TRY_MAX_SECS baked into the token (the
 *     real cost guard — a call cannot outlive it)
 * Injects retrieval from the prospect's own crawled knowledge domain as
 * ragContext. Tools stripped; nothing writes or self-trains.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
import { mintGeminiVoiceToken, GeminiVoiceNotConfiguredError, GeminiVoiceTokenMintError } from '@/lib/voice/gemini/mint'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'
import { retrieveChunks } from '@/lib/ingest/retrieve'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'

const MAX_SECS = Number(process.env.DEMO_TRY_MAX_SECS) || 180
const MAX_CONCURRENT = Number(process.env.DEMO_TRY_MAX_CONCURRENT) || 15
const IP_COOLDOWN_SECS = Number(process.env.DEMO_TRY_IP_COOLDOWN_SECS) || 120
const COOLDOWN_COOKIE = 'xv_try_demo'

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

const UNAVAILABLE = { error: 'This demo isn’t available right now.', code: 'UNAVAILABLE' }

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const workspaceId = demoWorkspaceId()
  if (!workspaceId) return NextResponse.json(UNAVAILABLE, { status: 503 })

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect || prospect.status !== 'ready' || !prospect.agentId) {
    return NextResponse.json(UNAVAILABLE, { status: 503 })
  }
  if (prospect.expiresAt && prospect.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This demo has expired.', code: 'EXPIRED' }, { status: 410 })
  }

  // ── Guards ─────────────────────────────────────────────────────────
  if (req.cookies.get(COOLDOWN_COOKIE)) {
    return NextResponse.json(
      { error: 'You just tried a call — give it a minute and try again.', code: 'COOLDOWN' },
      { status: 429 },
    )
  }
  const ip = clientIp(req)
  const now = Date.now()
  const [ipRecent, activeCalls] = await Promise.all([
    db.demoTryCall.count({
      where: { ip, startedAt: { gt: new Date(now - IP_COOLDOWN_SECS * 1000) } },
    }),
    db.demoTryCall.count({
      where: { startedAt: { gt: new Date(now - MAX_SECS * 1000) }, endedAt: null },
    }),
  ])
  if (ipRecent > 0) {
    return NextResponse.json(
      { error: 'You just tried a call — give it a minute and try again.', code: 'IP_COOLDOWN' },
      { status: 429 },
    )
  }
  if (activeCalls >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: 'The demo line is busy right now — try again in a couple of minutes.', code: 'BUSY' },
      { status: 429 },
    )
  }

  // ── Agent + knowledge ──────────────────────────────────────────────
  const agent = await db.agent.findFirst({
    where: { id: prospect.agentId, workspaceId },
    select: { id: true, name: true, systemPrompt: true, instructions: true, locationId: true, workspaceId: true },
  })
  if (!agent) return NextResponse.json(UNAVAILABLE, { status: 503 })
  const config = await db.geminiVoiceConfig.findUnique({ where: { agentId: agent.id } })

  let ragContext = ''
  if (prospect.knowledgeDomainId) {
    const chunks = await retrieveChunks(
      workspaceId,
      `about ${prospect.businessName}: services, opening hours, location, pricing, contact`,
      { knowledgeDomainIds: [prospect.knowledgeDomainId], scopeToDomains: true, limit: 8 },
    )
    ragContext = chunks.map(c => c.content).join('\n\n')
  }

  const session = buildGeminiVoiceSession(
    {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      instructions: agent.instructions,
      enabledTools: [], // demo: conversational only
      locationId: agent.locationId,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
    },
    {
      voiceName: config?.voiceName ?? null,
      model: config?.model || geminiVoiceModel(),
      firstMessage: config?.firstMessage ?? null,
      endCallMessage: config?.endCallMessage ?? null,
      language: config?.language ?? null,
      maxDurationSecs: Math.min(config?.maxDurationSecs ?? MAX_SECS, MAX_SECS),
    },
    { ragContext },
  )

  try {
    const minted = await mintGeminiVoiceToken(session)

    // Record the call (server-side truth for callCount) and free the slot
    // via call-end / the time-window ageing in the guard queries.
    const call = await db.demoTryCall.create({
      data: { prospectId: prospect.id, ip },
      select: { id: true },
    })
    await db.demoProspect.update({
      where: { id: prospect.id },
      data: { callCount: { increment: 1 }, firstCallAt: prospect.firstCallAt ?? new Date() },
    }).catch(() => {})

    const res = NextResponse.json({
      callId: call.id,
      connection: {
        token: minted.token,
        vendorModelId: minted.vendorModelId,
        provider: 'gemini-live' as const,
        maxSessionSecs: minted.maxSessionSecs,
        frameFpsCap: 0,
      },
      tools: [],
      vendorConfig: session.liveConfig,
      maxSessionSecs: minted.maxSessionSecs,
    })
    res.cookies.set(COOLDOWN_COOKIE, '1', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
      maxAge: IP_COOLDOWN_SECS,
    })
    return res
  } catch (err) {
    if (err instanceof GeminiVoiceNotConfiguredError) {
      return NextResponse.json(UNAVAILABLE, { status: 503 })
    }
    if (err instanceof GeminiVoiceTokenMintError) {
      return NextResponse.json(
        { error: 'Couldn’t start the voice session — try again in a moment.', code: 'MINT_FAILED' },
        { status: 502 },
      )
    }
    throw err
  }
}
