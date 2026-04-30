import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { runAgent } from '@/lib/ai-agent'
import type { Message } from '@/types'

// Replay reruns the full agent loop against a real conversation. Long
// timeline = many tool calls; cap at the Pro maximum so the request
// doesn't get clipped.
export const maxDuration = 300

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET /api/workspaces/:wsId/agents/:agentId/replay
 * Returns recent inbound MessageLog rows for this agent, grouped by
 * conversationId, so the replay UI can list "what could I rerun?".
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const logs = await db.messageLog.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, conversationId: true, contactId: true,
      inboundMessage: true, outboundReply: true,
      actionsPerformed: true, status: true, createdAt: true,
    },
  })

  return NextResponse.json({ logs })
}

/**
 * POST /api/workspaces/:wsId/agents/:agentId/replay
 * Body: {
 *   messageLogId: string,
 *   overrides?: {
 *     systemPrompt?: string         // override the agent's system prompt
 *     appendInstructions?: string   // additional text appended to the prompt
 *     enabledTools?: string[]       // override the agent's tool selection
 *   }
 * }
 *
 * Reconstructs the conversation up to the target inbound, then re-runs the
 * agent in pure-sandbox mode (no CRM writes, no SMS sends, no MessageLog
 * persistence). Returns the original reply alongside the new reply so the
 * operator can diff them.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { messageLogId, overrides } = body
  if (!messageLogId) return NextResponse.json({ error: 'messageLogId required' }, { status: 400 })

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: {
      id: true, locationId: true, systemPrompt: true, instructions: true, enabledTools: true,
      agentPersonaName: true, responseLength: true, formalityLevel: true, useEmojis: true,
      neverSayList: true, simulateTypos: true, typingDelayEnabled: true,
      typingDelayMinMs: true, typingDelayMaxMs: true,
      fallbackBehavior: true, fallbackMessage: true,
    },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const targetLog = await db.messageLog.findFirst({
    where: { id: messageLogId, agentId },
    select: {
      id: true, conversationId: true, contactId: true, locationId: true,
      inboundMessage: true, outboundReply: true,
      actionsPerformed: true, createdAt: true,
    },
  })
  if (!targetLog) return NextResponse.json({ error: 'MessageLog not found' }, { status: 404 })

  // Reconstruct prior conversation from earlier MessageLog rows in the same
  // conversation. The replay treats each as an inbound/outbound pair.
  const priorLogs = await db.messageLog.findMany({
    where: {
      conversationId: targetLog.conversationId,
      createdAt: { lt: targetLog.createdAt },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, inboundMessage: true, outboundReply: true, locationId: true, contactId: true },
  })

  const messageHistory: Message[] = []
  for (const log of priorLogs) {
    if (log.inboundMessage) {
      messageHistory.push({
        id: `${log.id}-in`,
        conversationId: targetLog.conversationId,
        locationId: log.locationId,
        contactId: log.contactId,
        body: log.inboundMessage,
        direction: 'inbound',
      })
    }
    if (log.outboundReply) {
      messageHistory.push({
        id: `${log.id}-out`,
        conversationId: targetLog.conversationId,
        locationId: log.locationId,
        contactId: log.contactId,
        body: log.outboundReply,
        direction: 'outbound',
      })
    }
  }

  // Build the system prompt to use during replay.
  let systemPrompt = overrides?.systemPrompt ?? agent.systemPrompt ?? ''
  if (overrides?.appendInstructions && overrides.appendInstructions.trim()) {
    systemPrompt = `${systemPrompt}\n\n${overrides.appendInstructions.trim()}`
  } else if (agent.instructions && !overrides?.systemPrompt) {
    systemPrompt = `${systemPrompt}\n\n${agent.instructions}`
  }

  const enabledTools = overrides?.enabledTools ?? agent.enabledTools ?? undefined

  // Force the contactId into a sandbox-safe form so write tools no-op.
  // (runAgent treats anything starting with "playground-" as sandbox.)
  const sandboxContactId = `playground-replay-${targetLog.contactId.slice(0, 8)}`

  const startedAt = Date.now()
  let response: any
  try {
    response = await runAgent({
      locationId: targetLog.locationId,
      agentId,
      contactId: sandboxContactId,
      conversationId: targetLog.conversationId,
      channel: 'SMS',
      incomingMessage: targetLog.inboundMessage,
      messageHistory,
      systemPrompt,
      enabledTools,
      sandbox: true,
      deferSend: true,
      persona: {
        agentPersonaName: agent.agentPersonaName ?? null,
        responseLength: agent.responseLength,
        formalityLevel: agent.formalityLevel,
        useEmojis: agent.useEmojis,
        neverSayList: agent.neverSayList ?? [],
        simulateTypos: agent.simulateTypos ?? false,
        typingDelayEnabled: agent.typingDelayEnabled ?? false,
        typingDelayMinMs: agent.typingDelayMinMs ?? 0,
        typingDelayMaxMs: agent.typingDelayMaxMs ?? 0,
      } as any,
      fallback: {
        behavior: agent.fallbackBehavior ?? 'summarize',
        message: agent.fallbackMessage ?? null,
      } as any,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Replay failed' }, { status: 500 })
  }
  const durationMs = Date.now() - startedAt

  const newReply: string | null = response.deferredCapture?.message ?? response.reply ?? null

  return NextResponse.json({
    original: {
      reply: targetLog.outboundReply,
      actionsPerformed: targetLog.actionsPerformed,
      inbound: targetLog.inboundMessage,
    },
    replay: {
      reply: newReply,
      actionsPerformed: response.actionsPerformed,
      toolCallTrace: response.toolCallTrace,
      durationMs,
      tokensUsed: response.tokensUsed,
    },
  })
}
