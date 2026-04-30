import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runAgent } from '@/lib/ai-agent'
import { buildKnowledgeBlock } from '@/lib/rag'
import { findMatchingAgent } from '@/lib/routing'
import { getOrCreateConversationState } from '@/lib/conversation-state'

// SMS webhook triggers a full agent loop. Vercel's default would kill
// it after 10–15s, dropping the reply silently. 300s is the Pro cap.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const from = formData.get('From') as string
  const to = formData.get('To') as string
  const body = formData.get('Body') as string

  if (!from || !body) return new NextResponse('', { status: 200 })

  try {
    // Find integration by phone number
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

    const locationId = integration.locationId
    const contactId = `twilio-${from.replace(/\D/g, '')}`
    const conversationId = `twilio-conv-${from.replace(/\D/g, '')}`

    // Hard pre-filter: refuse to respond to any inbound if NO agent on
    // this location has any routing rules. Prevents silent replies from
    // rule-less agents (the "why is my agent answering everything?"
    // footgun). Same guard as /api/webhooks/events.
    const agentsWithRules = await db.agent.count({
      where: { locationId, isActive: true, routingRules: { some: {} } },
    })
    if (agentsWithRules === 0) {
      console.log(`[Twilio] ✗ No active agent on ${locationId} has any Deploy rules — dropping inbound from ${from}`)
      return new NextResponse('', { status: 200 })
    }

    // Find matching agent. No implicit fallback — agents with zero rules
    // don't match by design.
    const agent = await findMatchingAgent(locationId, contactId, body)
    if (!agent) return new NextResponse('', { status: 200 })
    // Defensive: reject any agent that slipped through without rules.
    if (!(agent as any).routingRules || (agent as any).routingRules.length === 0) {
      console.error(`[Twilio] ✗ Refusing to run agent "${agent.name}" — returned with zero routing rules`)
      return new NextResponse('', { status: 200 })
    }

    // Check conversation state
    const state = await getOrCreateConversationState(agent.id, locationId, contactId, conversationId)
    if (state.state === 'PAUSED') return new NextResponse('', { status: 200 })

    // Build prompt
    let systemPrompt = agent.systemPrompt
    if (agent.instructions) systemPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
    systemPrompt += buildKnowledgeBlock(agent.knowledgeEntries, body)
    systemPrompt += `\n\n## Channel Info\nThis is a direct SMS conversation. Caller phone: ${from}`

    const result = await runAgent({
      locationId,
      contactId,
      conversationId,
      incomingMessage: body,
      systemPrompt,
      enabledTools: ['send_sms'],
      sandbox: false,
    })

    // Send reply via Twilio API
    const credentials = integration.credentials as { accountSid: string; authToken: string }
    const twilioFrom = to

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
      if (!twilioRes.ok) console.error('[Twilio] Send failed:', await twilioRes.text())
    }

    return new NextResponse('', { status: 200 })
  } catch (err: unknown) {
    console.error('[Twilio SMS]', err)
    return new NextResponse('', { status: 200 })
  }
}
