/**
 * Co-Pilot session service — the shared core behind BOTH surfaces:
 *
 *   - staff/dashboard routes (/api/copilot/sessions/*) — NextAuth +
 *     workspace membership, onboarding-workflow persona, full tool set
 *   - widget/visitor routes (/api/widget/[widgetId]/copilot/*) —
 *     publicKey auth, business-expert persona, knowledge tool only
 *
 * The routes own AUTH; this module owns everything else (token mint,
 * prompt assembly, persistence, tool execution, session end + Haiku
 * analysis + ticketing). One source of truth so the two surfaces
 * can't drift.
 */

import { GoogleGenAI, Modality, Behavior, Type, MediaResolution } from '@google/genai'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { retrieveChunks } from '@/lib/ingest/retrieve'
import { COPILOT_DEFAULTS } from './config'
import { getWorkspaceSetupState } from './setup-state'
import { getWorkflow, DEFAULT_WORKFLOW_KEY } from './workflows'
import { buildCopilotSystemPrompt, buildWidgetCopilotPrompt } from './prompt'
import { coerceCopilotVoiceName, readPinnedCopilotVoice, resolveCopilotVoice } from './voices'
import { readPinnedCopilotLanguage, resolveCopilotLanguage } from './language'
import { normalizeBlocks } from './blocks'
import { COPILOT_TOOL_DEFS, WIDGET_TOOL_DEFS, executeCopilotTool } from './tools'
import { analyzeSessionAndFollowUp, type SessionAnalysis } from './analyze'
import type { CopilotSessionDTO, RealtimeToolDef } from './types'
import type {
  CopilotLatencyEvent,
  CopilotLatencyStage,
  CopilotParticipationState,
} from './turn-lifecycle'
import {
  persistTelemetryBatchAtomically,
  type TelemetryDatabase,
} from './telemetry-persistence'

// ─── DTO ────────────────────────────────────────────────────────────

interface SessionRowForDTO {
  id: string
  workspaceId: string
  channel: string
  status: string
  model: string | null
  roomId: string | null
  locale: string
  workflowKey: string | null
  startedAt: Date
  endedAt: Date | null
  durationSecs: number | null
  endedReason: string | null
  toolCallCount: number
}

export function toCopilotSessionDTO(row: SessionRowForDTO): CopilotSessionDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channel: row.channel as CopilotSessionDTO['channel'],
    status: row.status as CopilotSessionDTO['status'],
    model: row.model as CopilotSessionDTO['model'],
    roomId: row.roomId,
    locale: row.locale,
    workflowKey: row.workflowKey,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    durationSecs: row.durationSecs,
    endedReason: row.endedReason,
    toolCallCount: row.toolCallCount,
  }
}

// ─── Ephemeral token mint ───────────────────────────────────────────

function toGeminiFunctionDeclarations(defs: RealtimeToolDef[]) {
  return defs.map(d => ({
    name: d.name,
    description: d.description,
    behavior: Behavior.NON_BLOCKING,
    ...(Object.keys(d.parameters.properties).length > 0
      ? {
          parameters: {
            type: Type.OBJECT,
            properties: Object.fromEntries(
              Object.entries(d.parameters.properties).map(([k, v]) => [
                k,
                {
                  type: v.type.toUpperCase() as Type,
                  ...(v.description ? { description: v.description } : {}),
                  ...(v.enum ? { enum: v.enum } : {}),
                },
              ]),
            ),
            ...(d.parameters.required?.length ? { required: d.parameters.required } : {}),
          },
        }
      : {}),
  }))
}

export class CopilotNotConfiguredError extends Error {}
export class CopilotTokenMintError extends Error {}
export class CopilotSopNotFoundError extends Error {}

async function mintEphemeralToken(
  systemPrompt: string,
  toolDefs: RealtimeToolDef[],
  maxSessionSecsOverride?: number,
  /** Hard ceiling for this session class. Defaults to the in-app cap;
   *  meeting-bot sessions pass a higher one (meetings run long). */
  ceilingSecs?: number,
  /** Per-session voice (already resolved from the agent's setting /
   *  rotation, or a session pin). Coerced to a catalog id — omitting
   *  speechConfig is what lets native-audio drift mid-call. */
  voiceOverride?: string | null,
) {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new CopilotNotConfiguredError('missing GEMINI_API_KEY')

  const { vendorModelId, frameFpsCap } = COPILOT_DEFAULTS
  const ceiling = ceilingSecs && ceilingSecs > 60 ? ceilingSecs : COPILOT_DEFAULTS.maxSessionSecs
  const maxSessionSecs = Math.min(
    ceiling,
    maxSessionSecsOverride && maxSessionSecsOverride > 60 ? maxSessionSecsOverride : ceiling,
  )

  // Always a catalog voice. Native-audio changes timbre when this is
  // absent; 'rotate' is resolved by the caller before we get here.
  const voiceName = coerceCopilotVoiceName(voiceOverride)

  const liveConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(toolDefs) }],
    // Without this the Live API defaults to LOW (64 tokens/frame) and
    // the model cannot read UI text — it "sees" an impressionist blur
    // and answers from the playbook instead of the screen.
    mediaResolution:
      (MediaResolution as Record<string, MediaResolution>)[COPILOT_DEFAULTS.mediaResolution] ??
      MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
  }

  const now = Date.now()
  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey })
    const token = await ai.authTokens.create({
      config: {
        // >1 use: the WS connection drops ~10 min in and the client
        // reconnects with its sessionResumption handle.
        uses: 10,
        expireTime: new Date(now + (maxSessionSecs + 300) * 1000).toISOString(),
        newSessionExpireTime: new Date(now + maxSessionSecs * 1000).toISOString(),
        liveConnectConstraints: { model: vendorModelId, config: liveConfig },
        httpOptions: { apiVersion: 'v1alpha' },
      },
    })
    if (!token.name) throw new Error('token response missing name')
    return {
      realtime: {
        token: token.name,
        vendorModelId,
        provider: 'gemini-live' as const,
        maxSessionSecs,
        frameFpsCap,
      },
      liveConfig,
    }
  } catch (err) {
    if (err instanceof CopilotNotConfiguredError) throw err
    console.error('[Copilot] ephemeral token mint failed:', err)
    throw new CopilotTokenMintError(err instanceof Error ? err.message : String(err))
  }
}

function normalizeLocale(locale: unknown): string {
  return typeof locale === 'string' && /^[a-zA-Z-]{2,16}$/.test(locale) ? locale : 'en-AU'
}

// ─── Create: staff (dashboard) ──────────────────────────────────────

export type StaffCopilotMode = 'onboarding' | 'general' | 'sop'

export async function createStaffSession(opts: {
  workspaceId: string
  userId: string
  locale?: string
  workflowKey?: string | null
  /** 'onboarding' (default, built-in workflow), 'general' (fix
   *  anything), or 'sop' (run a workspace-authored procedure). */
  mode?: StaffCopilotMode
  sopId?: string | null
  /** Run AS a workspace-created Co-Pilot agent (overrides mode). */
  agentId?: string | null
}) {
  const locale = normalizeLocale(opts.locale)
  const mode: StaffCopilotMode = opts.mode === 'general' || opts.mode === 'sop' ? opts.mode : 'onboarding'

  const setupState = await getWorkspaceSetupState(opts.workspaceId)

  let systemPrompt: string
  let workflowKey: string | null = null
  let maxSecsOverride: number | undefined
  let copilotAgentId: string | null = null
  let voiceOverride: string | null = null

  if (opts.agentId) {
    // Run as a workspace-created Co-Pilot agent: persona + optional
    // procedure + recording-distilled playbook + scoped knowledge.
    const agent = await db.copilotAgent.findFirst({ where: { id: opts.agentId, workspaceId: opts.workspaceId } })
    if (!agent) throw new CopilotSopNotFoundError('Co-Pilot agent not found')
    copilotAgentId = agent.id
    const steps = Array.isArray(agent.steps) ? (agent.steps as string[]).filter(s => typeof s === 'string') : []
    const domainIds = agent.knowledgeDomainIds ?? []
    const ragChunks = await retrieveChunks(opts.workspaceId, `${agent.name} ${steps.join(' ')}`.slice(0, 400) || agent.name, {
      limit: 4,
      knowledgeDomainIds: domainIds.length ? domainIds : undefined,
    })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    const { voiceName, displayName } = resolveCopilotVoice(agent.voice, agent.name)
    voiceOverride = voiceName
    const spoken = resolveCopilotLanguage(agent.language)
    const { buildAgentPrompt } = await import('./prompt')
    systemPrompt = buildAgentPrompt({
      agent: { name: displayName, type: agent.type, persona: agent.persona, goal: null, openingLine: agent.openingLine, collectInfo: agent.collectInfo, steps, blocks: normalizeBlocks(agent.blocks), timeboxMinutes: agent.timeboxMinutes, playbook: agent.playbook, uiMap: agent.uiMap, appContext: agent.appContext },
      workspaceName: setupState.workspaceName,
      ragContext,
      locale,
      language: spoken.code,
    })
    const blocksLen = normalizeBlocks(agent.blocks).length
    if (steps.length > 0 || blocksLen > 0) maxSecsOverride = (agent.timeboxMinutes + 5) * 60
  } else if (mode === 'sop') {
    const sop = opts.sopId
      ? await db.copilotSop.findFirst({
          where: { id: opts.sopId, workspaceId: opts.workspaceId },
        })
      : null
    if (!sop) throw new CopilotSopNotFoundError('SOP not found')
    const steps = Array.isArray(sop.steps) ? (sop.steps as string[]).filter(s => typeof s === 'string') : []
    const ragChunks = await retrieveChunks(opts.workspaceId, `${sop.title} — ${sop.goal}`, { limit: 4 })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    const { buildSopPrompt } = await import('./prompt')
    systemPrompt = buildSopPrompt({
      sop: { title: sop.title, goal: sop.goal, timeboxMinutes: sop.timeboxMinutes, steps },
      workspaceName: setupState.workspaceName,
      ragContext,
      locale,
    })
    // The timebox IS the session ceiling (+5 min of grace to wrap up).
    maxSecsOverride = (sop.timeboxMinutes + 5) * 60
  } else if (mode === 'general') {
    const ragChunks = await retrieveChunks(opts.workspaceId, 'product overview, common problems, troubleshooting and setup how-tos', { limit: 4 })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    const { buildGeneralStaffPrompt } = await import('./prompt')
    systemPrompt = buildGeneralStaffPrompt({ workspaceName: setupState.workspaceName, ragContext, locale })
  } else {
    workflowKey = typeof opts.workflowKey === 'string' ? opts.workflowKey.slice(0, 64) : DEFAULT_WORKFLOW_KEY
    const workflow = getWorkflow(workflowKey)
    const ragChunks = await retrieveChunks(opts.workspaceId, `${workflow.title} — how to set up agents, channels and knowledge`, { limit: 4 })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    systemPrompt = buildCopilotSystemPrompt({ setupState, workflow, ragContext, locale })
  }

  const { realtime, liveConfig } = await mintEphemeralToken(systemPrompt, COPILOT_TOOL_DEFS, maxSecsOverride, undefined, voiceOverride)

  const created = await db.copilotSession.create({
    data: {
      workspaceId: opts.workspaceId,
      startedByUserId: opts.userId,
      channel: 'in_app_webrtc',
      locale,
      workflowKey,
      model: 'gemini-live',
      metadata: { mode: 'staff', copilotMode: copilotAgentId ? 'agent' : mode, sopId: opts.sopId ?? null, copilotAgentId, vendorModelId: realtime.vendorModelId },
    },
  })

  return { session: toCopilotSessionDTO(created), realtime, liveConfig, tools: COPILOT_TOOL_DEFS }
}

// ─── Create: widget (visitor) ───────────────────────────────────────

export async function createWidgetSession(opts: {
  workspaceId: string
  widgetId: string
  businessTitle: string
  agentId: string | null
  visitorId: string | null
  locale?: string
}) {
  const locale = normalizeLocale(opts.locale)

  // Knowledge scope follows the widget's agent — empty array means
  // workspace-wide, same semantics the text-agent runtime uses.
  let knowledgeDomainIds: string[] = []
  let agentPersona: string | null = null
  if (opts.agentId) {
    const agent = await db.agent.findFirst({
      where: { id: opts.agentId, workspaceId: opts.workspaceId },
      select: { knowledgeDomainIds: true, systemPrompt: true },
    })
    knowledgeDomainIds = agent?.knowledgeDomainIds ?? []
    agentPersona = agent?.systemPrompt ?? null
  }

  const ragChunks = await retrieveChunks(
    opts.workspaceId,
    `${opts.businessTitle} product overview, common questions and how-tos`,
    { limit: 4, knowledgeDomainIds },
  )
  const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)

  const systemPrompt = buildWidgetCopilotPrompt({
    businessTitle: opts.businessTitle,
    agentPersona,
    ragContext,
    locale,
  })

  const { realtime, liveConfig } = await mintEphemeralToken(systemPrompt, WIDGET_TOOL_DEFS)

  const created = await db.copilotSession.create({
    data: {
      workspaceId: opts.workspaceId,
      channel: 'in_app_webrtc',
      locale,
      workflowKey: null,
      model: 'gemini-live',
      metadata: {
        mode: 'widget',
        widgetId: opts.widgetId,
        visitorId: opts.visitorId,
        agentId: opts.agentId,
        knowledgeDomainIds,
        vendorModelId: realtime.vendorModelId,
      },
    },
  })

  return { session: toCopilotSessionDTO(created), realtime, liveConfig, tools: WIDGET_TOOL_DEFS }
}

// ─── Liveness ───────────────────────────────────────────────────────

export interface ActiveSession {
  id: string
  workspaceId: string
  workflowKey: string | null
  startedAt: Date
  status: string
  metadata: Record<string, unknown>
}

export type LoadResult =
  | { ok: true; session: ActiveSession }
  | { ok: false; reason: 'not_found' | 'ended' | 'expired' }

/**
 * Load a session and enforce the active + max-duration invariants
 * (P0-11). Authorization is the CALLER's job — dashboard routes check
 * workspace membership, widget routes check the widgetId binding.
 */
export async function loadActiveSession(sessionId: string): Promise<LoadResult> {
  const row = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true, status: true, metadata: true },
  })
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status !== 'active') return { ok: false, reason: 'ended' }

  // Per-session ceiling: meeting-bot sessions store their own budget
  // in metadata (meetings outlive the 30-min in-app cap).
  const metaMax = Number((row.metadata as Record<string, unknown> | null)?.maxSessionSecs)
  const sessionMaxSecs = Number.isFinite(metaMax) && metaMax > 60 ? metaMax : COPILOT_DEFAULTS.maxSessionSecs

  const ageSecs = (Date.now() - row.startedAt.getTime()) / 1000
  if (ageSecs > sessionMaxSecs) {
    await db.copilotSession.update({
      where: { id: row.id },
      data: { status: 'ended', endedAt: new Date(), endedReason: 'max_duration', durationSecs: Math.round(ageSecs) },
    })
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    session: { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> },
  }
}

// ─── Tool execution ─────────────────────────────────────────────────

export async function runSessionTool(
  session: ActiveSession,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: string; latencyMs: number }> {
  const mode = session.metadata.mode === 'widget' ? 'widget' : 'staff'
  const knowledgeDomainIds = Array.isArray(session.metadata.knowledgeDomainIds)
    ? (session.metadata.knowledgeDomainIds as string[])
    : undefined

  const startedAt = Date.now()
  const result = await executeCopilotTool(name, args, {
    workspaceId: session.workspaceId,
    workflowKey: session.workflowKey,
    mode,
    knowledgeDomainIds,
  })
  const latencyMs = Date.now() - startedAt

  await Promise.all([
    db.copilotToolCall.create({
      data: {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        toolName: name,
        args: args as object,
        resultSummary: result.slice(0, 2000),
        latencyMs,
      },
    }),
    db.copilotSession.update({
      where: { id: session.id },
      data: { toolCallCount: { increment: 1 } },
    }),
  ]).catch(err => console.error('[Copilot tool] logging failed:', err))

  return { result, latencyMs }
}

// ─── Event sink ─────────────────────────────────────────────────────

export interface EventBatch {
  batchId?: string
  turns?: Array<{ role?: string; text?: string; tokens?: number; ts?: string }>
  screenEvents?: Array<{ visionSummary?: string; detectedContext?: Record<string, unknown>; ts?: string }>
  latencyEvents?: CopilotLatencyEvent[]
  counters?: { audioInSecs?: number; audioOutSecs?: number; videoFrames?: number }
}

const VALID_ROLES = new Set(['user', 'agent', 'system', 'tool'])
const VALID_LATENCY_STAGES = new Set<CopilotLatencyStage>([
  'input_vad_end',
  'response_audio_received',
  'playback_scheduled',
  'tool_call_started',
  'tool_call_completed',
  'screen_frame_received',
  'interrupted',
  'turn_complete',
  'self_echo_suppressed',
])
const VALID_PARTICIPATION_STATES = new Set<CopilotParticipationState>([
  'PASSIVE',
  'ADDRESSED',
  'RESPONDING',
  'INTERRUPTED',
])

function parseTs(ts: string | undefined): Date {
  const d = ts ? new Date(ts) : new Date()
  return isNaN(d.getTime()) ? new Date() : d
}

export async function recordSessionEvents(session: ActiveSession, batch: EventBatch) {
  const batchId =
    typeof batch.batchId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(batch.batchId)
      ? batch.batchId
      : `legacy-${createHash('sha256')
          .update(`${session.id}:${JSON.stringify(batch)}`)
          .digest('hex')
          .slice(0, 32)}`

  const earliestAt = session.startedAt.getTime() - 60_000
  const latestAt = Date.now() + 60_000
  const timestampInRange = (ts: string | undefined) => {
    if (!ts) return false
    const value = new Date(ts).getTime()
    return Number.isFinite(value) && value >= earliestAt && value <= latestAt
  }
  let lastTurnAt = earliestAt
  const turns = (batch.turns ?? [])
    .filter(t => t.text && VALID_ROLES.has(t.role ?? '') && timestampInRange(t.ts))
    .filter(t => {
      const at = new Date(t.ts as string).getTime()
      if (at < lastTurnAt) return false
      lastTurnAt = at
      return true
    })
    .slice(0, 200)
  let lastScreenAt = earliestAt
  const screenEvents = (batch.screenEvents ?? [])
    .filter(e => (e.visionSummary || e.detectedContext) && timestampInRange(e.ts))
    .filter(e => {
      const at = new Date(e.ts as string).getTime()
      if (at < lastScreenAt) return false
      lastScreenAt = at
      return true
    })
    .slice(0, 200)
  const latencyEvents = (batch.latencyEvents ?? [])
    .filter(
      event =>
        typeof event.traceId === 'string' &&
        /^[a-zA-Z0-9-]{8,80}$/.test(event.traceId) &&
        VALID_LATENCY_STAGES.has(event.stage) &&
        VALID_PARTICIPATION_STATES.has(event.state) &&
        Number.isFinite(event.atMs) &&
        Number.isFinite(event.elapsedMs) &&
        event.atMs >= earliestAt &&
        event.atMs <= latestAt &&
        event.elapsedMs >= 0 &&
        event.elapsedMs <= event.atMs - earliestAt &&
        ['en', 'es', 'code-switch', 'unknown'].includes(event.language) &&
        ['direct', 'follow_up', 'one_to_one'].includes(event.activation),
    )
    .filter((event, index, events) => {
      const previous = events.slice(0, index).filter(item => item.traceId === event.traceId).at(-1)
      return !previous || (event.atMs >= previous.atMs && event.elapsedMs >= previous.elapsedMs)
    })
    .slice(0, 500)
  const counters = batch.counters ?? {}

  const audioIn = Number(counters.audioInSecs) || 0
  const audioOut = Number(counters.audioOutSecs) || 0
  const frames = Math.max(0, Math.round(Number(counters.videoFrames) || 0))
  const persistence = await persistTelemetryBatchAtomically(
    db as unknown as TelemetryDatabase,
    {
      sessionId: session.id,
      batchId,
      turns: turns.map(t => ({
        sessionId: session.id,
        workspaceId: session.workspaceId,
        role: t.role as string,
        text: (t.text as string).slice(0, 8000),
        tokens: typeof t.tokens === 'number' ? t.tokens : null,
        ts: parseTs(t.ts),
      })),
      screenEvents: screenEvents.map(e => ({
        sessionId: session.id,
        workspaceId: session.workspaceId,
        visionSummary: e.visionSummary ? e.visionSummary.slice(0, 4000) : null,
        detectedContext: (e.detectedContext ?? {}) as object,
        ts: parseTs(e.ts),
      })),
      counters: { audioIn, audioOut, frames },
    },
  )

  if (persistence.accepted && latencyEvents.length > 0) {
    let platform = 'in_app'
    if (session.metadata.copilotMode === 'meeting') {
      try {
        const host = new URL(String(session.metadata.meetingUrl ?? '')).hostname
        platform = host.includes('zoom') ? 'zoom' : host.includes('meet.google') ? 'google_meet' : 'other_meeting'
      } catch {
        platform = 'other_meeting'
      }
    }
    for (const event of latencyEvents) {
      // Intentionally content-free: no transcript, audio, tool args, URL,
      // participant name, or screen material belongs in latency logs.
      console.info(
        '[Copilot latency]',
        JSON.stringify({
          sessionCorrelation: createHash('sha256')
            .update(`${process.env.COPILOT_TRACE_SALT || 'copilot'}:${session.id}`)
            .digest('hex')
            .slice(0, 16),
          traceId: event.traceId,
          platform,
          model: session.metadata.vendorModelId ?? COPILOT_DEFAULTS.vendorModelId,
          stage: event.stage,
          state: event.state,
          language: event.language,
          activation: event.activation,
          atMs: Math.round(event.atMs),
          elapsedMs: Math.max(0, Math.round(event.elapsedMs)),
        }),
      )
    }
  }
  return {
    turns: persistence.accepted ? turns.length : 0,
    screenEvents: persistence.accepted ? screenEvents.length : 0,
    latencyEvents: persistence.accepted ? latencyEvents.length : 0,
    duplicate: persistence.duplicate,
  }
}

// ─── End ────────────────────────────────────────────────────────────

export interface EndResult {
  alreadyEnded: boolean
  durationSecs: number
  taskSuccess: boolean | null
  analysis: SessionAnalysis | null
}

/**
 * End a session: flip the row, run the staff workflow-goal eval, then
 * the Haiku transcript analysis (which opens a ticket when the issue
 * went unresolved). Idempotent — racing PATCH vs sendBeacon vs the
 * stale sweep is a no-op for the losers.
 */
export async function endCopilotSession(sessionId: string, endedReason: string): Promise<EndResult> {
  const session = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true, status: true, metadata: true },
  })
  if (!session) return { alreadyEnded: true, durationSecs: 0, taskSuccess: null, analysis: null }
  if (session.status !== 'active') {
    return { alreadyEnded: true, durationSecs: 0, taskSuccess: null, analysis: null }
  }

  const endedAt = new Date()
  const durationSecs = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
  await db.copilotSession.update({
    where: { id: session.id },
    data: { status: 'ended', endedAt, durationSecs, endedReason: endedReason.slice(0, 64) },
  })

  const meta = (session.metadata ?? {}) as Record<string, unknown>
  const mode = meta.mode === 'widget' ? 'widget' : 'staff'

  // Staff sessions: workflow-goal auto-eval (P0-10). Widget sessions
  // have no workflow — their resolution signal comes from the Haiku
  // analysis below.
  let taskSuccess: boolean | null = null
  if (mode === 'staff' && session.workflowKey) {
    try {
      const state = await getWorkspaceSetupState(session.workspaceId)
      const workflow = getWorkflow(session.workflowKey)
      taskSuccess = workflow.goalReached(state)
      await db.copilotEvalRecord.create({
        data: {
          sessionId: session.id,
          workspaceId: session.workspaceId,
          scope: 'session',
          taskSuccess,
          notes: `auto: workflow=${workflow.key} goal ${taskSuccess ? 'reached' : 'not reached'} at session end`,
        },
      })
    } catch (err) {
      console.error('[Copilot] workflow eval failed:', err)
    }
  }

  // Public "Try Now" demos are throwaway: skip the Haiku analysis +
  // auto-ticket/follow-up so a random visitor's call never spends tokens or
  // drops a ticket into the workspace.
  const analysis = meta.demo === true ? null : await analyzeSessionAndFollowUp(session.id)
  if (taskSuccess === null && analysis) taskSuccess = analysis.issueResolved

  return { alreadyEnded: false, durationSecs, taskSuccess, analysis }
}


// ─── Create: public launch (link / button / JS snippet) ─────────────
//
// No NextAuth — the agent's publicKey IS the credential, same trust
// model as ChatWidget.publicKey. Only published agents launch; tools
// are the visitor set (query_knowledge scoped to the agent's domains
// + take_a_closer_look) — never internal workspace state.
export async function createPublicAgentSession(publicKey: string, opts: { locale?: string } = {}) {
  const agent = await db.copilotAgent.findFirst({
    where: { publicKey, published: true },
  })
  if (!agent) throw new CopilotSopNotFoundError('agent not found or unpublished')

  const workspace = await db.workspace.findUnique({ where: { id: agent.workspaceId }, select: { plan: true, name: true } })
  const { canUseCopilot } = await import('@/lib/plans')
  if (!workspace || !canUseCopilot(workspace.plan, agent.workspaceId)) {
    throw new CopilotNotConfiguredError('copilot not enabled for this workspace')
  }

  const locale = normalizeLocale(opts.locale)
  const steps = Array.isArray(agent.steps) ? (agent.steps as string[]).filter(s => typeof s === 'string') : []
  const domainIds = agent.knowledgeDomainIds ?? []
  const ragChunks = await retrieveChunks(agent.workspaceId, `${agent.name} ${steps.join(' ')}`.slice(0, 400) || agent.name, {
    limit: 4,
    knowledgeDomainIds: domainIds.length ? domainIds : undefined,
  })
  const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
  const { voiceName, displayName } = resolveCopilotVoice(agent.voice, agent.name)
  const spoken = resolveCopilotLanguage(agent.language)
  const { buildAgentPrompt } = await import('./prompt')
  const systemPrompt = buildAgentPrompt({
    agent: { name: displayName, type: agent.type, persona: agent.persona, goal: null, openingLine: agent.openingLine, collectInfo: agent.collectInfo, steps, blocks: normalizeBlocks(agent.blocks), timeboxMinutes: agent.timeboxMinutes, playbook: agent.playbook, uiMap: agent.uiMap, appContext: agent.appContext },
    workspaceName: workspace.name ?? 'this workspace',
    ragContext,
    locale,
    language: spoken.code,
  })

  const maxSecs = (steps.length > 0 || normalizeBlocks(agent.blocks).length > 0) ? (agent.timeboxMinutes + 5) * 60 : undefined
  const { realtime, liveConfig } = await mintEphemeralToken(systemPrompt, WIDGET_TOOL_DEFS, maxSecs, undefined, voiceName)

  const created = await db.copilotSession.create({
    data: {
      workspaceId: agent.workspaceId,
      channel: 'in_app_webrtc',
      locale,
      workflowKey: null,
      model: 'gemini-live',
      metadata: {
        mode: 'widget', // visitor-grade tool gating in runSessionTool
        copilotMode: 'public-agent',
        copilotAgentId: agent.id,
        publicKey,
        knowledgeDomainIds: domainIds,
        vendorModelId: realtime.vendorModelId,
      },
    },
  })

  return {
    session: toCopilotSessionDTO(created),
    realtime,
    liveConfig,
    tools: WIDGET_TOOL_DEFS,
    agent: { name: agent.name, type: agent.type },
  }
}

// ─── Create: meeting bot (Zoom / Meet / Teams via Recall) ───────────
//
// Two-phase lifecycle, because the bot may sit in a waiting room for
// minutes before anyone admits it:
//
//   createMeetingSession — staff action. Creates the session row
//     (channel 'recall_meeting_bot', Recall bot id in roomId, a random
//     capability token in metadata.botToken) and dispatches the Recall
//     bot, whose camera is our /copilot/bot/[botToken] page.
//
//   connectMeetingSession — called BY that page when the bot's browser
//     loads it inside the call. Only then do we build the prompt and
//     mint the Gemini ephemeral token, so waiting-room time doesn't
//     burn the token's validity window.

const MEETING_CEILING_SECS = Number(process.env.COPILOT_MEETING_MAX_SECS) || 3600

/**
 * Voice + language locked for one meeting. Resolved at dispatch and
 * stored on the session so connect (and a bot-page reload) cannot
 * roll a new voice. 'rotate' rolls here, once.
 *
 * The agent's language wins over any request locale. A browser
 * language used to be written into the prompt ("spoken conversation
 * in en-AU"), which neither pinned the voice nor selected Spanish.
 */
function meetingSpeechPin(agent: {
  voice: string | null
  name: string
  language: string | null
  addressAliases?: string[]
}) {
  const voice = resolveCopilotVoice(agent.voice, agent.name)
  const language = resolveCopilotLanguage(agent.language)
  const addressNames = [...new Set([
    agent.name.trim(),
    voice.displayName.trim(),
    ...(agent.addressAliases ?? []).map(alias => alias.trim()),
  ].filter(Boolean))]
  return {
    locale: language.locale,
    pinnedVoice: voice.voiceName,
    pinnedDisplayName: voice.displayName,
    pinnedLanguage: language.code,
    addressNames,
  }
}

function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3000'
}

export async function createMeetingSession(opts: {
  workspaceId: string
  userId: string
  agentId: string
  meetingUrl: string
  locale?: string
}) {
  const { isRecallConfigured, createMeetingBot } = await import('./recall')
  if (!isRecallConfigured()) {
    throw new CopilotNotConfiguredError('Meeting bots are not configured yet (missing RECALL_API_KEY).')
  }

  const agent = await db.copilotAgent.findFirst({ where: { id: opts.agentId, workspaceId: opts.workspaceId } })
  if (!agent) throw new CopilotSopNotFoundError('Co-Pilot agent not found')

  let meetingUrl: string
  try {
    const parsed = new URL(opts.meetingUrl)
    if (parsed.protocol !== 'https:') throw new Error('not https')
    meetingUrl = parsed.toString()
  } catch {
    throw new CopilotSopNotFoundError('That does not look like a meeting link — paste the full https:// invite URL.')
  }

  // Budget = timebox + waiting-room/teardown slack, never under 30 min
  // (the clock starts at dispatch, not admission).
  const maxSessionSecs = Math.min(MEETING_CEILING_SECS, Math.max(1800, (agent.timeboxMinutes + 10) * 60))
  const { randomBytes } = await import('crypto')
  const botToken = randomBytes(24).toString('base64url')
  const pin = meetingSpeechPin(agent)

  const created = await db.copilotSession.create({
    data: {
      workspaceId: opts.workspaceId,
      startedByUserId: opts.userId,
      channel: 'recall_meeting_bot',
      locale: pin.locale,
      workflowKey: null,
      model: 'gemini-live',
      metadata: {
        mode: 'widget', // visitor-grade tool gating — the bot page is token-auth, not staff-auth
        copilotMode: 'meeting',
        copilotAgentId: agent.id,
        botToken,
        meetingUrl,
        knowledgeDomainIds: agent.knowledgeDomainIds ?? [],
        maxSessionSecs,
        // Self-learning loop: after the call, the cron pulls Recall's
        // recording into the agent's learn-from-recordings pipeline.
        recordingPending: true,
        pinnedVoice: pin.pinnedVoice,
        pinnedDisplayName: pin.pinnedDisplayName,
        pinnedLanguage: pin.pinnedLanguage,
        addressNames: pin.addressNames,
      },
    },
  })

  try {
    const bot = await createMeetingBot({
      meetingUrl,
      botName: agent.name,
      webpageUrl: `${appOrigin()}/copilot/bot/${botToken}`,
      botToken,
    })
    const updated = await db.copilotSession.update({
      where: { id: created.id },
      data: {
        roomId: bot.id,
        metadata: {
          mode: 'widget',
          copilotMode: 'meeting',
          copilotAgentId: agent.id,
          botToken,
          meetingUrl,
          knowledgeDomainIds: agent.knowledgeDomainIds ?? [],
          maxSessionSecs,
          recordingPending: true,
          pinnedVoice: pin.pinnedVoice,
          pinnedDisplayName: pin.pinnedDisplayName,
          pinnedLanguage: pin.pinnedLanguage,
          addressNames: pin.addressNames,
          botId: bot.id,
        },
      },
    })
    return { session: toCopilotSessionDTO(updated), bot }
  } catch (err) {
    await db.copilotSession.update({
      where: { id: created.id },
      data: { status: 'error', endedAt: new Date(), durationSecs: 0, endedReason: 'bot_create_failed' },
    })
    throw err
  }
}

// ─── Public "Try Now" demo meeting bot ──────────────────────────────
//
// Unauthenticated: the agent's publicKey is the only credential (same
// trust model as the screen-share launch). Because every dispatch spends
// real Recall minutes, three guards bound the cost: a hard time cap
// (DEMO_MAX_SECS, also enforced by the per-minute copilot-demo-reaper
// cron), a global concurrency cap, and a per-IP cooldown.

/** Hard wall-clock cap for a public demo bot, seconds (from dispatch). */
export const DEMO_MAX_SECS = Number(process.env.COPILOT_DEMO_MAX_SECS) || 600
/** Max demo bots running across ALL visitors at once — the cost ceiling.
 *  Sized so a social/email burst rarely hits "busy"; worst-case spend is
 *  still bounded (this many bots × DEMO_MAX_SECS). */
const DEMO_MAX_CONCURRENT = Number(process.env.COPILOT_DEMO_MAX_CONCURRENT) || 15
/** Short anti-double-click window, seconds. NOT a long lockout — combined
 *  with the one-live-demo-per-IP rule below, a visitor whose demo just
 *  ended can start another right away. */
const DEMO_IP_COOLDOWN_SECS = Number(process.env.COPILOT_DEMO_COOLDOWN_SECS) || 120

/** A demo launch was refused by a rate/concurrency guard (→ HTTP 429). */
export class CopilotDemoLimitError extends Error {
  constructor(message: string, readonly kind: 'busy' | 'cooldown') {
    super(message)
  }
}

const DEMO_MEETING_HOST = /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/i

/**
 * Dispatch the published demo agent (resolved by publicKey) into a visitor's
 * meeting, capped + rate-limited for public use. Mirrors createMeetingSession
 * but: no workspace auth / no userId, a 10-minute budget, demo-tagged
 * metadata (so the reaper + analysis-skip treat it as throwaway), and
 * recordingPending:false (never self-learn from random public calls).
 */
export async function createPublicMeetingSession(publicKey: string, opts: {
  meetingUrl: string
  ip: string | null
  locale?: string
}) {
  const { isRecallConfigured, createMeetingBot } = await import('./recall')
  if (!isRecallConfigured()) {
    throw new CopilotNotConfiguredError('Live demos are not available right now.')
  }

  const agent = await db.copilotAgent.findFirst({ where: { publicKey, published: true } })
  if (!agent) throw new CopilotSopNotFoundError('This demo link is invalid or unpublished.')

  const workspace = await db.workspace.findUnique({ where: { id: agent.workspaceId }, select: { plan: true, name: true } })
  const { canUseCopilot } = await import('@/lib/plans')
  if (!workspace || !canUseCopilot(workspace.plan, agent.workspaceId)) {
    throw new CopilotNotConfiguredError('Live demos are not available right now.')
  }

  // Only real, https meeting links from the supported platforms.
  let meetingUrl: string
  try {
    const parsed = new URL(opts.meetingUrl)
    if (parsed.protocol !== 'https:' || !DEMO_MEETING_HOST.test(parsed.hostname)) throw new Error('bad url')
    meetingUrl = parsed.toString()
  } catch {
    throw new CopilotSopNotFoundError('Paste a full Google Meet, Zoom, or Teams link (https://…).')
  }

  // Concurrency cap = the hard cost ceiling, independent of who's calling.
  const liveDemos = await db.copilotSession.count({
    where: { channel: 'recall_meeting_bot', status: 'active', metadata: { path: ['demo'], equals: true } },
  })
  if (liveDemos >= DEMO_MAX_CONCURRENT) {
    throw new CopilotDemoLimitError('Our live demo is busy right now — please try again in a few minutes.', 'busy')
  }

  // Per-IP guard: one demo per IP at a time. Blocks while this IP already
  // has a LIVE demo (no stacking — the real per-source cost risk) plus a
  // short anti-double-click window. Deliberately NOT a long lockout, so a
  // genuine evaluator whose demo just ended can start another immediately.
  if (opts.ip) {
    const since = new Date(Date.now() - DEMO_IP_COOLDOWN_SECS * 1000)
    const fromIp = await db.copilotSession.count({
      where: {
        channel: 'recall_meeting_bot',
        metadata: { path: ['demoIp'], equals: opts.ip },
        OR: [{ status: 'active' }, { startedAt: { gt: since } }],
      },
    })
    if (fromIp > 0) {
      throw new CopilotDemoLimitError('You already have a demo running — it’ll wrap up shortly, then you can start another.', 'cooldown')
    }
  }

  const { randomBytes } = await import('crypto')
  const botToken = randomBytes(24).toString('base64url')
  const pin = meetingSpeechPin(agent)
  const baseMeta = {
    mode: 'widget', // visitor-grade tool gating — the bot page is token-auth
    copilotMode: 'meeting',
    copilotAgentId: agent.id,
    botToken,
    meetingUrl,
    knowledgeDomainIds: agent.knowledgeDomainIds ?? [],
    maxSessionSecs: DEMO_MAX_SECS, // drives the token cap in connectMeetingSession
    demo: true,
    demoIp: opts.ip ?? null,
    recordingPending: false, // never train on random public demos
    pinnedVoice: pin.pinnedVoice,
    pinnedDisplayName: pin.pinnedDisplayName,
    pinnedLanguage: pin.pinnedLanguage,
    addressNames: pin.addressNames,
  }

  const created = await db.copilotSession.create({
    data: {
      workspaceId: agent.workspaceId,
      channel: 'recall_meeting_bot',
      locale: pin.locale,
      model: 'gemini-live',
      metadata: baseMeta,
    },
  })

  try {
    const bot = await createMeetingBot({
      meetingUrl,
      botName: `${agent.name} (demo)`,
      webpageUrl: `${appOrigin()}/copilot/bot/${botToken}`,
      botToken,
    })
    await db.copilotSession.update({
      where: { id: created.id },
      data: { roomId: bot.id, metadata: { ...baseMeta, botId: bot.id } },
    })
    return { sessionId: created.id, botId: bot.id, status: bot.status }
  } catch (err) {
    await db.copilotSession.update({
      where: { id: created.id },
      data: { status: 'error', endedAt: new Date(), durationSecs: 0, endedReason: 'bot_create_failed' },
    })
    throw err
  }
}

/** Locate an active meeting session by its bot capability token. */
export async function findMeetingSessionByToken(botToken: string): Promise<LoadResult> {
  if (!botToken || botToken.length < 16) return { ok: false, reason: 'not_found' }
  const row = await db.copilotSession.findFirst({
    where: {
      channel: 'recall_meeting_bot',
      status: 'active',
      metadata: { path: ['botToken'], equals: botToken },
    },
    select: { id: true },
  })
  if (!row) return { ok: false, reason: 'not_found' }
  return loadActiveSession(row.id)
}

export async function connectMeetingSession(botToken: string) {
  const loaded = await findMeetingSessionByToken(botToken)
  if (!loaded.ok) throw new CopilotSopNotFoundError(`meeting session ${loaded.reason}`)
  const session = loaded.session
  const meta = session.metadata

  const agentId = typeof meta.copilotAgentId === 'string' ? meta.copilotAgentId : ''
  const agent = await db.copilotAgent.findFirst({ where: { id: agentId, workspaceId: session.workspaceId } })
  if (!agent) throw new CopilotSopNotFoundError('agent no longer exists')
  const workspace = await db.workspace.findUnique({ where: { id: session.workspaceId }, select: { name: true } })

  const row = await db.copilotSession.findUnique({ where: { id: session.id }, select: { locale: true } })
  const locale = normalizeLocale(row?.locale)

  const steps = Array.isArray(agent.steps) ? (agent.steps as string[]).filter(s => typeof s === 'string') : []
  const domainIds = agent.knowledgeDomainIds ?? []
  const ragChunks = await retrieveChunks(session.workspaceId, `${agent.name} ${steps.join(' ')}`.slice(0, 400) || agent.name, {
    limit: 4,
    knowledgeDomainIds: domainIds.length ? domainIds : undefined,
  })
  const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)

  // Prefer the pin written at dispatch. Falling back to a fresh resolve
  // only covers sessions created before pinning existed; we write the
  // result back below so a second connect cannot roll again.
  const pinnedVoice = readPinnedCopilotVoice(meta)
  const resolvedVoice = pinnedVoice
    ? { voiceName: pinnedVoice.voiceName, displayName: pinnedVoice.displayName ?? agent.name }
    : resolveCopilotVoice(agent.voice, agent.name)
  const languageCode = readPinnedCopilotLanguage(meta) ?? resolveCopilotLanguage(agent.language).code
  const addressNames = [...new Set([
    agent.name.trim(),
    resolvedVoice.displayName.trim(),
    ...(Array.isArray(meta.addressNames) ? meta.addressNames : []),
    ...agent.addressAliases,
  ].filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map(name => name.trim()))]
  const { buildMeetingPrompt } = await import('./prompt')
  const systemPrompt = buildMeetingPrompt({
    agent: { name: resolvedVoice.displayName, type: agent.type, persona: agent.persona, goal: null, openingLine: agent.openingLine, collectInfo: agent.collectInfo, steps, blocks: normalizeBlocks(agent.blocks), timeboxMinutes: agent.timeboxMinutes, playbook: agent.playbook, uiMap: agent.uiMap, appContext: agent.appContext },
    workspaceName: workspace?.name ?? 'this workspace',
    ragContext,
    locale,
    language: languageCode,
  })

  // Remaining budget after waiting-room time; refuse a connect with
  // almost nothing left rather than minting a token that dies mid-greeting.
  const sessionMax = Number(meta.maxSessionSecs) > 60 ? Number(meta.maxSessionSecs) : COPILOT_DEFAULTS.maxSessionSecs
  const ageSecs = Math.round((Date.now() - session.startedAt.getTime()) / 1000)
  const remaining = sessionMax - ageSecs
  if (remaining < 120) throw new CopilotSopNotFoundError('meeting session expired')

  const { MEETING_TOOL_DEFS } = await import('./tools')
  const { realtime, liveConfig } = await mintEphemeralToken(systemPrompt, MEETING_TOOL_DEFS, remaining, remaining, resolvedVoice.voiceName)

  await db.copilotSession.update({
    where: { id: session.id },
    data: {
      metadata: {
        ...meta,
        vendorModelId: realtime.vendorModelId,
        connectedAt: new Date().toISOString(),
        pinnedVoice: resolvedVoice.voiceName,
        pinnedDisplayName: resolvedVoice.displayName,
        pinnedLanguage: languageCode,
      },
    },
  })

  const videoRelayHost = process.env.RECALL_VIDEO_WORKER_WS_HOST
  const videoRelayUrl = videoRelayHost ? `wss://${videoRelayHost}/agent/${botToken}` : null

  return {
    sessionId: session.id,
    realtime,
    liveConfig,
    tools: MEETING_TOOL_DEFS,
    display: {
      agentName: agent.name,
      pinnedDisplayName: resolvedVoice.displayName,
      addressNames,
      workspaceName: workspace?.name ?? '',
    },
    videoRelayUrl,
  }
}
