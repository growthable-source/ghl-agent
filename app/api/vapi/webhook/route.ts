import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildKnowledgeBlock } from '@/lib/rag'
import { searchContacts } from '@/lib/crm-client'

const VAPI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book an appointment for the caller',
      parameters: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: 'ISO datetime for the appointment' },
          name: { type: 'string', description: 'Caller name for the booking' },
        },
        required: ['startTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Get available appointment slots for booking',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check in YYYY-MM-DD format' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tag_contact',
      description: 'Tag the caller contact with a label',
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Tag to apply to the contact' },
        },
        required: ['tag'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms_followup',
      description: 'Send an SMS follow-up message to the caller after the call',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The SMS message to send after the call' },
        },
        required: ['message'],
      },
    },
  },
]

async function findAgentByPhoneNumber(phoneNumber: string) {
  const vapiConfig = await db.vapiConfig.findFirst({
    where: { phoneNumber, isActive: true },
    include: {
      agent: {
        include: { knowledgeEntries: true },
      },
    },
  })
  return vapiConfig
}

async function buildVoiceSystemPrompt(
  agent: { systemPrompt: string; instructions: string | null; agentPersonaName: string | null },
  knowledgeEntries: { id: string; agentId: string; title: string; content: string; source: string; sourceUrl: string | null; tokenEstimate: number; createdAt: Date; updatedAt: Date }[],
  callerPhone: string,
  locationId: string
): Promise<string> {
  let contactContext = ''
  try {
    const contacts = await searchContacts(locationId, callerPhone)
    if (contacts && contacts.length > 0) {
      const c = contacts[0] as any
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
      contactContext = `\n\n## Caller Info\nName: ${name || 'Unknown'}\nPhone: ${callerPhone}\nContact ID: ${c.id}`
      if (c.tags?.length) contactContext += `\nTags: ${c.tags.join(', ')}`
    }
  } catch {}

  const knowledgeBlock = buildKnowledgeBlock(knowledgeEntries)

  return `${agent.systemPrompt}

## VOICE CALL INSTRUCTIONS
You are on a live phone call. Follow these rules strictly:
- Speak naturally and conversationally — no bullet points, no markdown, no lists
- Keep responses SHORT — 1-3 sentences max unless the caller asks for detail
- Don't read out URLs, email addresses, or long codes
- If you need to check something, say "Let me look that up for you" or "One moment"
- When the caller wants to book, use get_available_slots first, then book_appointment
- After booking, offer to send an SMS confirmation using send_sms_followup
- If you can't help, offer to have someone call them back
${contactContext}
${agent.instructions ? `\n## Additional Instructions\n${agent.instructions}` : ''}
${knowledgeBlock}`
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const message = body.message || body

  const messageType = message.type

  // ── Assistant request — return agent config for this call ──
  if (messageType === 'assistant-request') {
    const call = message.call
    const callerPhone: string = call?.customer?.number || ''
    const toPhone: string = call?.phoneNumber?.number || ''

    const vapiConfig = await findAgentByPhoneNumber(toPhone)

    if (!vapiConfig) {
      return NextResponse.json({
        assistant: {
          model: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            messages: [{ role: 'system', content: 'You are a helpful assistant. This number is not configured yet.' }],
          },
          voice: { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
          firstMessage: 'Hello! This line is not configured yet.',
        },
      })
    }

    const agent = vapiConfig.agent
    const locationId = agent.locationId
    const systemPrompt = await buildVoiceSystemPrompt(agent, agent.knowledgeEntries, callerPhone, locationId)

    return NextResponse.json({
      assistant: {
        name: agent.name,
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'system', content: systemPrompt }],
          tools: VAPI_TOOLS,
        },
        voice: {
          provider: '11labs',
          voiceId: vapiConfig.voiceId,
          stability: vapiConfig.stability,
          similarityBoost: vapiConfig.similarityBoost,
          speed: vapiConfig.speed,
          style: vapiConfig.style,
          ...(vapiConfig.language ? { language: vapiConfig.language } : {}),
        },
        firstMessage: vapiConfig.firstMessage || `Hi there! This is ${agent.agentPersonaName || agent.name}. How can I help you today?`,
        endCallMessage: vapiConfig.endCallMessage || 'Thanks for calling. Have a great day!',
        maxDurationSeconds: vapiConfig.maxDurationSecs,
        recordingEnabled: vapiConfig.recordCalls,
        ...(vapiConfig.backgroundSound ? { backgroundSound: vapiConfig.backgroundSound } : {}),
        ...(vapiConfig.endCallPhrases?.length ? { endCallPhrases: vapiConfig.endCallPhrases } : {}),
        serverUrl: `${process.env.APP_URL}/api/vapi/webhook`,
        serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,
      },
      assistantOverrides: {
        variableValues: {
          locationId,
          agentId: agent.id,
          callerPhone,
        },
      },
    })
  }

  // ── Function call — execute tool ──
  if (messageType === 'function-call') {
    const call = message.call
    const functionCall = message.functionCall
    const functionName: string = functionCall?.name
    const params = functionCall?.parameters || {}

    const locationId: string = call?.assistantOverrides?.variableValues?.locationId || call?.metadata?.locationId
    const agentId: string = call?.assistantOverrides?.variableValues?.agentId
    const callerPhone: string = call?.assistantOverrides?.variableValues?.callerPhone || call?.customer?.number

    try {
      switch (functionName) {
        case 'get_available_slots': {
          if (!locationId) return NextResponse.json({ result: 'Sorry, I cannot check availability right now.' })
          const { getFreeSlots } = await import('@/lib/crm-client')
          const agent = agentId ? await db.agent.findUnique({ where: { id: agentId } }) : null
          if (!agent?.calendarId) return NextResponse.json({ result: 'No calendar configured for this agent.' })
          const startDate: string = params.date || new Date().toISOString().split('T')[0]
          const endDate = startDate
          const slots = await getFreeSlots(locationId, agent.calendarId, startDate, endDate)
          if (!slots || (slots as any[]).length === 0) return NextResponse.json({ result: 'No available slots on that date. Would you like to try a different day?' })
          const formatted = (slots as any[]).slice(0, 5).map((s: any) => {
            const d = new Date(s.startTime)
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          }).join(', ')
          return NextResponse.json({ result: `Available times: ${formatted}` })
        }

        case 'book_appointment': {
          if (!locationId) return NextResponse.json({ result: 'Sorry, I cannot book right now.' })
          const { bookAppointment, searchContacts: sc } = await import('@/lib/crm-client')
          const agent = agentId ? await db.agent.findUnique({ where: { id: agentId } }) : null
          if (!agent?.calendarId) return NextResponse.json({ result: 'No calendar configured.' })
          let contactId = ''
          try {
            const contacts = await sc(locationId, callerPhone)
            if (contacts && contacts.length > 0) contactId = contacts[0].id
          } catch {}
          if (!contactId) return NextResponse.json({ result: 'I could not find your contact record. I will have someone follow up.' })
          await bookAppointment(locationId, {
            calendarId: agent.calendarId,
            contactId,
            startTime: params.startTime,
            endTime: '',
            title: params.name ? `Call with ${params.name}` : 'Appointment',
          })
          return NextResponse.json({ result: 'Done! Your appointment has been booked. You will receive a confirmation shortly.' })
        }

        case 'tag_contact': {
          if (!locationId || !callerPhone) return NextResponse.json({ result: 'Could not tag contact.' })
          const { searchContacts: sc2, addTagsToContact } = await import('@/lib/crm-client')
          const contacts = await sc2(locationId, callerPhone)
          if (contacts && contacts.length > 0) {
            await addTagsToContact(locationId, contacts[0].id, [params.tag])
          }
          return NextResponse.json({ result: 'Done.' })
        }

        case 'send_sms_followup': {
          if (!locationId || !callerPhone) return NextResponse.json({ result: 'Could not send SMS.' })
          const { searchContacts: sc3, sendMessage } = await import('@/lib/crm-client')
          const contacts = await sc3(locationId, callerPhone)
          if (contacts && contacts.length > 0) {
            await sendMessage(locationId, {
              type: 'SMS',
              contactId: contacts[0].id,
              message: params.message,
            })
          }
          return NextResponse.json({ result: 'SMS sent.' })
        }

        default:
          return NextResponse.json({ result: 'Function not found.' })
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ result: `Error: ${errMsg}` })
    }
  }

  // ── End of call report — save transcript and call log ──
  if (messageType === 'end-of-call-report') {
    const call = message.call
    const transcript: string = message.transcript || ''
    const summary: string = message.summary || ''
    const recordingUrl: string = message.recordingUrl || ''
    const durationSecs = Math.round((call?.endedAt && call?.startedAt)
      ? (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      : 0)

    const locationId: string = call?.assistantOverrides?.variableValues?.locationId
    const agentId: string = call?.assistantOverrides?.variableValues?.agentId
    const callerPhone: string = call?.assistantOverrides?.variableValues?.callerPhone || call?.customer?.number

    if (locationId) {
      try {
        await db.callLog.create({
          data: {
            locationId,
            agentId: agentId || null,
            contactPhone: callerPhone,
            vapiCallId: call?.id,
            direction: 'inbound',
            status: call?.endedReason === 'customer-ended-call' ? 'completed' : (call?.endedReason || 'completed'),
            durationSecs,
            transcript,
            summary,
            recordingUrl,
            endedReason: call?.endedReason,
          },
        })

        if (summary && agentId && callerPhone) {
          try {
            const { searchContacts: sc4 } = await import('@/lib/crm-client')
            const contacts = await sc4(locationId, callerPhone)
            if (contacts && contacts.length > 0) {
              const contactId = contacts[0].id
              await db.contactMemory.upsert({
                where: { agentId_contactId: { agentId, contactId } },
                create: { agentId, locationId, contactId, summary: `[Call] ${summary}` },
                update: { summary: `[Last call] ${summary}` },
              })
            }
          } catch {}
        }
      } catch (err) {
        console.error('[Vapi] Error saving call log:', err)
      }
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
