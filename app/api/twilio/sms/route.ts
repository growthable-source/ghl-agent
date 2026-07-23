import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runAgent } from '@/lib/ai-agent'
import { buildKnowledgeBlock } from '@/lib/rag'
import { retrieveAndFormatForAgent, normaliseConditions } from '@/lib/agent/retrieve-for-agent'
import { findMatchingAgent } from '@/lib/routing'
import { getOrCreateConversationState, incrementMessageCount } from '@/lib/conversation-state'
import { saveMessages, getMessageHistory } from '@/lib/conversation-memory'
import { trackMessageUsage } from '@/lib/usage'
import { normalizePhone } from '@/lib/crm/native/normalize'
import { addSuppression } from '@/lib/crm/native/suppression'

// SMS webhook triggers a full agent loop. Vercel's default would kill
// it after 10–15s, dropping the reply silently. 300s is the Pro cap.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const from = formData.get('From') as string
  const to = formData.get('To') as string
  const body = formData.get('Body') as string

  if (!from || !body) return new NextResponse('', { status: 200 })

  // Stable per-phone-number identifiers so the same number's messages
  // accumulate into one threaded conversation across days/weeks.
  const contactId = `twilio-${from.replace(/\D/g, '')}`
  const conversationId = `twilio-conv-${from.replace(/\D/g, '')}`

  // Resolve location FIRST — every persistence row needs locationId.
  const integration = await db.integration.findFirst({
    where: {
      type: 'twilio',
      isActive: true,
      config: { path: ['phoneNumber'], equals: to },
    },
  })

  if (!integration) {
    console.log(`[Twilio] No integration found for ${to}`)
    return new NextResponse('', { status: 200 })
  }

  let locationId = integration.locationId

  // ─── Native CRM branch ─────────────────────────────────────────────
  // For native workspaces we use the real NativeContact.id as the
  // agent's contactId, persist the inbound to NativeMessage, and handle
  // STOP keywords inline (auto-suppression) before the agent ever sees
  // the message. The rest of the flow continues unchanged — runAgent
  // reads/writes through CrmAdapter, which routes to NativeAdapter for
  // native locations automatically.
  let nativeContactId: string | null = null
  if (locationId.startsWith('native:')) {
    const workspaceId = locationId.slice('native:'.length)
    const phone = normalizePhone(from) ?? from

    // STOP-keyword auto-suppression. Twilio also handles this at the
    // carrier level for opted-in numbers, but doing it ourselves is
    // belt-and-suspenders and lets us record a reason in our own
    // suppression list — so re-imports don't accidentally re-message.
    const stopMatch = /\b(stop|stopall|unsubscribe|cancel|end|quit)\b/i.test(body.trim())
    if (stopMatch) {
      await addSuppression({ workspaceId, type: 'phone', value: phone, reason: 'stop_reply' })
      // Twilio sends an auto-confirmation by default; we don't reply
      // ourselves to avoid double-acks. Just log and exit cleanly.
      console.log(`[Twilio] STOP from ${from} on workspace ${workspaceId} — phone suppressed`)
      return new NextResponse('', { status: 200 })
    }

    // Find or create the NativeContact. Phone is the keying identifier
    // since SMS doesn't carry email. If the contact already exists from
    // a prior import or widget visit, we attach the message to it.
    let nc = await db.nativeContact.findFirst({
      where: { workspaceId, phone },
      select: { id: true, isSuppressed: true },
    })
    if (!nc) {
      nc = await db.nativeContact.create({
        data: { workspaceId, phone, source: 'twilio-sms-inbound' },
        select: { id: true, isSuppressed: true },
      })
    }
    if (nc.isSuppressed) {
      // Suppressed contact — record the inbound for audit but don't run
      // the agent. The operator can review in /suppressions.
      console.log(`[Twilio] Inbound from suppressed ${from} dropped`)
      return new NextResponse('', { status: 200 })
    }
    nativeContactId = nc.id

    // Find or create the NativeConversation for this (contact, sms) pair.
    // Same logic as NativeAdapter.findOrCreateConversationId — duplicating
    // here avoids spinning up an adapter just for the lookup.
    let conv = await db.nativeConversation.findFirst({
      where: { workspaceId, contactId: nc.id, channel: 'sms' },
      select: { id: true },
    })
    if (!conv) {
      conv = await db.nativeConversation.create({
        data: { workspaceId, contactId: nc.id, channel: 'sms' },
        select: { id: true },
      })
    }

    // Persist inbound. Status='received' marks it as ingested, distinct
    // from outbound's queued/sent/delivered/failed lifecycle.
    await db.nativeMessage.create({
      data: {
        workspaceId,
        conversationId: conv.id,
        contactId: nc.id,
        direction: 'inbound',
        channel: 'sms',
        body,
        status: 'received',
        providerMessageId: (formData.get('MessageSid') as string) || null,
      },
    })
    await db.nativeConversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    })
  }
  // ─────────────────────────────────────────────────────────────────────

  const effectiveContactId = nativeContactId ?? contactId

  // Persist the inbound IMMEDIATELY — even if the agent never runs (paused
  // conversation, no matching agent, errors), the inbound is preserved so
  // operators can read history in the inbox and the agent gets context on
  // the next turn. Without this, a Twilio conversation has no record at
  // all between turns and the agent re-introduces itself every reply.
  let log: { id: string } | null = null
  try {
    log = await db.messageLog.create({
      data: {
        locationId,
        contactId: effectiveContactId,
        conversationId,
        inboundMessage: body,
        status: 'PENDING',
      },
      select: { id: true },
    })
  } catch (err: any) {
    console.warn('[Twilio] failed to create MessageLog (continuing):', err?.message)
  }

  try {
    // Hard pre-filter: refuse to respond to any inbound if NO agent on
    // this location has any routing rules. Prevents silent replies from
    // rule-less agents (the "why is my agent answering everything?"
    // footgun). Same guard as /api/webhooks/events.
    const agentsWithRules = await db.agent.count({
      where: { locationId, isActive: true, routingRules: { some: {} } },
    })
    if (agentsWithRules === 0) {
      console.log(`[Twilio] ✗ No active agent on ${locationId} has any Deploy rules — dropping inbound from ${from}`)
      if (log) {
        await db.messageLog.update({
          where: { id: log.id },
          data: { status: 'SKIPPED', errorMessage: 'No active agents with routing rules on this location' },
        }).catch(() => {})
      }
      return new NextResponse('', { status: 200 })
    }

    // Find matching agent. No implicit fallback — agents with zero rules
    // don't match by design.
    const agent = await findMatchingAgent(locationId, effectiveContactId, body)
    if (!agent) {
      if (log) {
        await db.messageLog.update({
          where: { id: log.id },
          data: { status: 'SKIPPED', errorMessage: 'No agent matched the inbound' },
        }).catch(() => {})
      }
      return new NextResponse('', { status: 200 })
    }
    if (!(agent as any).routingRules || (agent as any).routingRules.length === 0) {
      console.error(`[Twilio] ✗ Refusing to run agent "${agent.name}" — returned with zero routing rules`)
      if (log) {
        await db.messageLog.update({
          where: { id: log.id },
          data: { status: 'SKIPPED', errorMessage: 'Matched agent had zero routing rules' },
        }).catch(() => {})
      }
      return new NextResponse('', { status: 200 })
    }

    // Tag the log row with the agent now that we know which one is handling it.
    if (log) {
      await db.messageLog.update({
        where: { id: log.id },
        data: { agentId: agent.id },
      }).catch(() => {})
    }

    // Check conversation state
    const state = await getOrCreateConversationState(agent.id, locationId, effectiveContactId, conversationId)
    if (state.state === 'PAUSED') {
      if (log) {
        await db.messageLog.update({
          where: { id: log.id },
          data: { status: 'SKIPPED', errorMessage: 'Conversation paused' },
        }).catch(() => {})
      }
      return new NextResponse('', { status: 200 })
    }

    // Load prior conversation history so day-7 sees day-1. Without this
    // every Twilio turn is a fresh introduction with no memory of prior
    // exchanges — a "human can see history but the agent can't" gap.
    const dbHistory = await getMessageHistory(agent.id, effectiveContactId, 20)
    const messageHistory: import('@/types').Message[] = dbHistory.map(m => ({
      id: m.id,
      conversationId: m.conversationId,
      locationId: m.locationId,
      contactId: m.contactId,
      body: m.content,
      direction: m.role === 'user' ? 'inbound' as const : 'outbound' as const,
      // createdAt powers the relative-time tags ("[2 days ago]") that
      // the runAgent prompt builder prepends to historical turns.
      createdAt: m.createdAt.toISOString(),
    }))

    // Build prompt
    let systemPrompt = agent.systemPrompt
    if (agent.instructions) systemPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
    const knowledgeConditions = normaliseConditions((agent as any).knowledgeConditions)
    systemPrompt += buildKnowledgeBlock(agent.knowledgeEntries, body, knowledgeConditions)
    // Phase 2 retrieval — pgvector chunk search over ingested sources.
    // Without this, an agent answering an SMS can't see anything from
    // KnowledgeSource ingestion, only legacy KnowledgeEntry rows.
    const { block: phase2Block } = await retrieveAndFormatForAgent(
      { id: agent.id, workspaceId: (agent as any).workspaceId, knowledgeScopeAll: (agent as any).knowledgeScopeAll, knowledgeConditions },
      body,
    )
    systemPrompt += phase2Block
    systemPrompt += `\n\n## Channel Info\nThis is a direct SMS conversation. Caller phone: ${from}`

    const result = await runAgent({
      agentId: agent.id,
      locationId,
      contactId: effectiveContactId,
      conversationId,
      channel: 'SMS',
      incomingMessage: body,
      messageHistory,
      systemPrompt,
      enabledTools: ['send_sms'],
      sandbox: false,
    })

    // Send reply via Twilio API
    const credentials = integration.credentials as { accountSid: string; authToken: string }
    const twilioFrom = to
    let twilioOk = true

    if (result.reply) {
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: from,
            From: twilioFrom,
            Body: result.reply,
          }),
        }
      )
      if (!twilioRes.ok) {
        twilioOk = false
        const errText = await twilioRes.text().catch(() => '')
        console.error('[Twilio] Send failed:', errText)
        if (log) {
          await db.messageLog.update({
            where: { id: log.id },
            data: { status: 'ERROR', errorMessage: `Twilio send failed: ${errText.slice(0, 500)}`, outboundReply: result.reply },
          }).catch(() => {})
        }
      }
    }

    // Persist inbound + outbound to ConversationMessage so the next run
    // (and the inbox UI) can replay this exchange. We log the inbound
    // unconditionally; we only log the outbound if a reply was actually
    // generated AND the Twilio send succeeded. A failed-to-send outbound
    // would otherwise mislead the agent into thinking the contact saw it.
    try {
      const toSave: Array<{ role: string; content: string }> = [
        { role: 'user', content: body },
      ]
      if (result.reply && twilioOk) {
        toSave.push({ role: 'assistant', content: result.reply })
      }
      await saveMessages(agent.id, locationId, effectiveContactId, conversationId, toSave)
    } catch (err: any) {
      console.warn('[Twilio] saveMessages failed (non-fatal):', err?.message)
    }

    await incrementMessageCount(agent.id, effectiveContactId).catch(() => {})

    // Bill metered usage on successful sends, mirroring the GHL webhook
    // path. Without this, Twilio-direct conversations were uncounted —
    // workspaces could blow past their plan limits silently. Fire-and-
    // forget; billing failures should never abort an SMS reply.
    if (result.reply && twilioOk && agent.workspaceId) {
      trackMessageUsage(agent.workspaceId, agent.id).catch(err =>
        console.error('[Twilio] trackMessageUsage failed:', err?.message)
      )
    }

    // Mark the log row complete with the outbound + token usage.
    if (log && twilioOk) {
      await db.messageLog.update({
        where: { id: log.id },
        data: {
          status: 'SUCCESS',
          outboundReply: result.reply ?? null,
          actionsPerformed: result.actionsPerformed ?? [],
          tokensUsed: result.tokensUsed ?? 0,
        },
      }).catch(() => {})
    }

    // Native CRM: the agent's send_sms tool wrote a queued NativeMessage
    // through NativeAdapter, but THIS route also fired Twilio synchronously
    // for a faster reply. Mark the queued row as 'sent' so the cron
    // drainer doesn't pick it up and double-send. Match by (contactId,
    // direction='outbound', status='queued') most-recent, which is safe
    // because runAgent only queues one outbound per turn.
    if (locationId.startsWith('native:') && result.reply && twilioOk) {
      try {
        const queued = await db.nativeMessage.findFirst({
          where: {
            workspaceId: locationId.slice('native:'.length),
            contactId: effectiveContactId,
            direction: 'outbound',
            status: 'queued',
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        if (queued) {
          await db.nativeMessage.update({
            where: { id: queued.id },
            data: { status: 'sent' },
          })
        }
      } catch (err: any) {
        console.warn('[Twilio] Failed to dedupe native queued message (non-fatal):', err?.message)
      }
    }

    return new NextResponse('', { status: 200 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Twilio SMS]', err)
    if (log) {
      await db.messageLog.update({
        where: { id: log.id },
        data: { status: 'ERROR', errorMessage: msg.slice(0, 500) },
      }).catch(() => {})
    }
    return new NextResponse('', { status: 200 })
  }
}
