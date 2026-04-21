import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'
import type { MessageChannelType } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * Resume a paused conversation and hand it back to the agent.
 *
 * Two outcomes, depending on `sendFollowUpNow`:
 *
 *   1. (default) Unpause + save handoff note → agent responds only when
 *      the contact's next inbound arrives. Good when the human finished
 *      the exchange and just wants the agent available for future.
 *
 *   2. `sendFollowUpNow=true` → unpause + save note + immediately run
 *      the agent to compose and send an outbound follow-up message,
 *      picking up where the human left off. Mirrors the AI_GENERATE
 *      trigger path so behaviour is consistent across outbound entry
 *      points (triggers, follow-up scheduler, manual resume).
 *
 * Body:
 *   {
 *     agentId: string,
 *     contactId: string,
 *     note?: string,               // goes into ContactMemory.handoff_context
 *     sendFollowUpNow?: boolean,   // default false
 *     channel?: 'SMS'|'Email'|...  // required only when sendFollowUpNow; defaults to SMS
 *   }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const agentId = String(body?.agentId ?? '').trim()
  const contactId = String(body?.contactId ?? '').trim()
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  const sendFollowUpNow = !!body?.sendFollowUpNow
  const channel = (typeof body?.channel === 'string' && body.channel) || 'SMS'
  if (!agentId || !contactId) {
    return NextResponse.json({ error: 'agentId and contactId required' }, { status: 400 })
  }

  // Load the agent with everything runAgent will need downstream. Cheap
  // vs the two round-trips we'd do if we only fetched scalar fields now
  // and re-queried for the follow-up run below.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    include: {
      knowledgeEntries: true,
      channelDeployments: true,
    },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const now = new Date()

  // 1. Flip the conversation state back to ACTIVE and clear pauseReason.
  //    updateMany so we don't 404 when there's no existing record (rare
  //    but possible if the record got pruned).
  await db.conversationStateRecord.updateMany({
    where: { agentId, contactId },
    data: { state: 'ACTIVE', pauseReason: null, resumedAt: now },
  })

  // 2. End any open LiveTakeover for this contact+agent so the human's
  //    ownership is released. Silent no-op if there wasn't one.
  try {
    await db.liveTakeover.updateMany({
      where: { agentId, contactId, endedAt: null },
      data: { endedAt: now },
    })
  } catch {
    // LiveTakeover table may not exist on older migrations — non-fatal.
  }

  // 3. If the operator left a handoff note, drop it into ContactMemory
  //    so the next agent turn sees it. Keep only the most recent note —
  //    categories JSON is a flat key/value, we don't want this to grow.
  if (note) {
    try {
      const existing = await db.contactMemory.findUnique({
        where: { agentId_contactId: { agentId, contactId } },
        select: { summary: true, categories: true },
      })
      const nextCategories = {
        ...((existing?.categories as Record<string, string> | null) ?? {}),
        handoff_context: `A human just handed this conversation back to you. Their note: "${note}". Treat this as essential context for your next reply; do not re-open topics the human has already addressed.`,
      }
      await db.contactMemory.upsert({
        where: { agentId_contactId: { agentId, contactId } },
        create: {
          agentId,
          contactId,
          locationId: agent.locationId,
          summary: existing?.summary ?? null,
          categories: nextCategories,
        },
        update: { categories: nextCategories },
      })
    } catch (err) {
      console.warn('[resume] writing handoff_context failed:', err)
    }
  }

  // 4. If the operator asked for a follow-up now, kick the agent so it
  //    composes + sends an outbound message using the handoff context.
  //    Reuses the AI_GENERATE trigger pattern so behaviour matches
  //    triggers and follow-ups — same prompt scaffold, same logging.
  let followUpResult: { reply: string | null; sent: boolean; skipReason?: string } | null = null
  if (sendFollowUpNow) {
    followUpResult = await sendFollowUp({
      agent,
      contactId,
      note,
      channel: channel as MessageChannelType,
    })
  }

  await audit({
    workspaceId,
    actorId: access.session.user.id,
    action: 'conversation.resume',
    targetType: 'contact',
    targetId: contactId,
    metadata: {
      agentId,
      hasNote: !!note,
      sentFollowUp: !!followUpResult?.sent,
      followUpSkipReason: followUpResult?.skipReason ?? null,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    followUp: followUpResult,
  })
}

/**
 * Build the AI_GENERATE prompt, call runAgent, send the outbound, and
 * log it. Kept as a local helper rather than shared-with-triggers.ts
 * because the inputs are different shape — could be extracted later if
 * a third outbound entry point shows up.
 */
async function sendFollowUp(params: {
  agent: any
  contactId: string
  note: string
  channel: MessageChannelType
}): Promise<{ reply: string | null; sent: boolean; skipReason?: string }> {
  const { agent, contactId, note, channel } = params

  // Working hours — same contract as triggers. Out of window → skip.
  if (agent.workingHoursEnabled) {
    try {
      const { isWithinWorkingHours } = await import('@/lib/working-hours')
      const whCfg = {
        workingHoursEnabled: true,
        workingHoursStart: agent.workingHoursStart ?? 0,
        workingHoursEnd: agent.workingHoursEnd ?? 24,
        workingDays: agent.workingDays ?? ['mon','tue','wed','thu','fri','sat','sun'],
        timezone: agent.timezone ?? null,
      }
      if (!isWithinWorkingHours(whCfg)) {
        console.log(`[Resume] outside working hours for agent ${agent.id} — follow-up skipped`)
        return { reply: null, sent: false, skipReason: 'outside_working_hours' }
      }
    } catch {}
  }

  try {
    const { runAgent } = await import('@/lib/ai-agent')
    const { buildKnowledgeBlock } = await import('@/lib/rag')
    const { buildPersonaBlock } = await import('@/lib/persona')

    // Prompt scaffold — same structure as AI_GENERATE triggers.
    let fullPrompt = agent.systemPrompt
    if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
    fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries ?? [], '')

    fullPrompt += `\n\n## Handoff Context`
    fullPrompt += `\nThis is an OUTBOUND follow-up. A human was handling this conversation and has just handed it back to you.`
    if (note) fullPrompt += `\nTheir note: "${note}"`
    fullPrompt += `\n\nIMPORTANT: Compose a single brief follow-up message using the send_reply tool that picks up naturally from where the human left off. Don't re-greet the contact, don't restart the conversation, don't repeat topics the human has already addressed. Keep it short.`

    fullPrompt += buildPersonaBlock({
      agentPersonaName: agent.agentPersonaName,
      responseLength: agent.responseLength,
      formalityLevel: agent.formalityLevel,
      useEmojis: agent.useEmojis,
      neverSayList: agent.neverSayList,
      simulateTypos: agent.simulateTypos,
      typingDelayEnabled: agent.typingDelayEnabled,
      typingDelayMinMs: agent.typingDelayMinMs,
      typingDelayMaxMs: agent.typingDelayMaxMs,
      languages: agent.languages,
    })

    // Synthetic "inbound" so the agent-loop has something to respond to.
    // The prompt already says it's outbound; the synthetic message just
    // kicks the model off.
    const syntheticInbound = note
      ? `[System: Human handed conversation back. Context: "${note}". Send the follow-up now.]`
      : `[System: Human handed conversation back. Send the follow-up now.]`

    const result = await runAgent({
      locationId: agent.locationId,
      agentId: agent.id,
      contactId,
      channel,
      incomingMessage: syntheticInbound,
      messageHistory: [],
      systemPrompt: fullPrompt,
      enabledTools: agent.enabledTools,
      workflowPicks: {
        addTo: (agent.addToWorkflowsPick ?? undefined) as any,
        removeFrom: (agent.removeFromWorkflowsPick ?? undefined) as any,
      },
      persona: {
        agentPersonaName: agent.agentPersonaName,
        responseLength: agent.responseLength,
        formalityLevel: agent.formalityLevel,
        useEmojis: agent.useEmojis,
        neverSayList: agent.neverSayList,
        simulateTypos: agent.simulateTypos,
        typingDelayEnabled: agent.typingDelayEnabled,
        typingDelayMinMs: agent.typingDelayMinMs,
        typingDelayMaxMs: agent.typingDelayMaxMs,
        languages: agent.languages,
      },
    })

    await db.messageLog.create({
      data: {
        locationId: agent.locationId,
        agentId: agent.id,
        contactId,
        conversationId: '',
        inboundMessage: `[Resume: human handoff follow-up]`,
        outboundReply: result.reply,
        actionsPerformed: ['resume_follow_up', ...(result.actionsPerformed ?? [])],
        tokensUsed: result.tokensUsed,
        status: 'SUCCESS',
      },
    }).catch(() => {})

    return { reply: result.reply ?? null, sent: true }
  } catch (err: any) {
    console.error('[Resume] follow-up send failed:', err)
    return { reply: null, sent: false, skipReason: err?.message ?? 'send_failed' }
  }
}
