import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { VAPI_TOOLS, buildVoiceSystemPrompt } from '@/lib/voice-prompt'

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
    const systemPrompt = await buildVoiceSystemPrompt(agent, agent.knowledgeEntries, callerPhone, locationId, vapiConfig.voiceTools as any[])

    // Resolve the caller to a contact so merge fields in first/end messages
    // can render. Inbound voice calls often come from unknown numbers — if
    // the lookup fails we pass null and fallback syntax kicks in.
    let voiceContact: any = null
    try {
      const { searchContacts } = await import('@/lib/crm-client')
      const matches = callerPhone ? await searchContacts(locationId, callerPhone) : []
      voiceContact = matches.find(c => c.phone === callerPhone) ?? matches[0] ?? null
    } catch { /* non-fatal */ }
    const { renderMergeFields } = await import('@/lib/merge-fields')
    const mergeCtx = {
      contact: voiceContact,
      agent: { name: agent.agentPersonaName || agent.name },
      timezone: (agent as any).timezone ?? null,
    }

    return NextResponse.json({
      assistant: {
        name: agent.name,
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'system', content: systemPrompt }],
          tools: [
            ...VAPI_TOOLS,
            ...((vapiConfig.voiceTools as any[]) || []).map(({ condition, ...rest }: any) => rest),
          ],
        },
        voice: {
          provider: '11labs' as any,
          voiceId: vapiConfig.voiceId,
          stability: vapiConfig.stability,
          similarityBoost: vapiConfig.similarityBoost,
          speed: vapiConfig.speed,
          style: vapiConfig.style,
          ...(vapiConfig.language ? { language: vapiConfig.language } : {}),
        } as any,
        firstMessage: renderMergeFields(
          vapiConfig.firstMessage || `Hi there! This is ${agent.agentPersonaName || agent.name}. How can I help you today?`,
          mergeCtx,
        ),
        endCallMessage: renderMergeFields(
          vapiConfig.endCallMessage || 'Thanks for calling. Have a great day!',
          mergeCtx,
        ),
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
          // Check the requested day plus the next 2 days to give more options
          const endDateObj = new Date(startDate)
          endDateObj.setDate(endDateObj.getDate() + 2)
          const endDate = endDateObj.toISOString().split('T')[0]
          const timezone = params.timezone || 'America/New_York'
          const slots = await getFreeSlots(locationId, agent.calendarId, startDate, endDate, timezone)
          if (!slots || slots.length === 0) return NextResponse.json({ result: 'No available slots in the next few days. Would you like to try a different date?' })
          // Group by day for natural reading
          const byDay: Record<string, string[]> = {}
          for (const s of slots.slice(0, 15)) {
            const dt = new Date(s.startTime)
            const dayKey = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
            const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            if (!byDay[dayKey]) byDay[dayKey] = []
            byDay[dayKey].push(time)
          }
          const formatted = Object.entries(byDay).map(([day, times]) => `${day}: ${times.join(', ')}`).join('. ')
          return NextResponse.json({ result: `Here are the available times. ${formatted}` })
        }

        case 'book_appointment': {
          if (!locationId) return NextResponse.json({ result: 'Sorry, I cannot book right now.' })
          const { bookAppointment, searchContacts: sc } = await import('@/lib/crm-client')
          const agentForBook = agentId ? await db.agent.findUnique({ where: { id: agentId } }) : null
          if (!agentForBook?.calendarId) return NextResponse.json({ result: 'No calendar configured.' })
          let contactId = ''
          try {
            const contacts = await sc(locationId, callerPhone)
            if (contacts && contacts.length > 0) contactId = contacts[0].id
          } catch {}
          if (!contactId) return NextResponse.json({ result: 'I could not find your contact record. I will have someone follow up.' })
          // Calculate endTime (30 min default if not provided)
          const startTime = params.startTime
          let endTime = params.endTime || ''
          if (!endTime && startTime) {
            const end = new Date(startTime)
            end.setMinutes(end.getMinutes() + 30)
            endTime = end.toISOString()
          }
          const result = await bookAppointment(locationId, {
            calendarId: agentForBook.calendarId,
            contactId,
            startTime,
            endTime,
            title: params.name ? `Call with ${params.name}` : 'Appointment',
            selectedTimezone: params.timezone || 'America/New_York',
          })
          const bookedTime = new Date(startTime).toLocaleString('en-US', {
            weekday: 'long', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
          return NextResponse.json({ result: `Done! Your appointment is booked for ${bookedTime}. You will receive a confirmation shortly.` })
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
    const direction: string = call?.assistantOverrides?.variableValues?.direction || 'inbound'

    if (locationId) {
      try {
        const callStatus = call?.endedReason === 'customer-ended-call' ? 'completed' : (call?.endedReason || 'completed')

        if (direction === 'outbound' && call?.id) {
          // Outbound calls have a pre-created CallLog — update it
          const existing = await db.callLog.findUnique({ where: { vapiCallId: call.id } })
          if (existing) {
            await db.callLog.update({
              where: { vapiCallId: call.id },
              data: { status: callStatus, durationSecs, transcript, summary, recordingUrl, endedReason: call?.endedReason },
            })
          } else {
            await db.callLog.create({
              data: {
                locationId, agentId: agentId || null, contactPhone: callerPhone,
                vapiCallId: call.id, direction: 'outbound', status: callStatus,
                durationSecs, transcript, summary, recordingUrl, endedReason: call?.endedReason,
              },
            })
          }
        } else {
          await db.callLog.create({
            data: {
              locationId, agentId: agentId || null, contactPhone: callerPhone,
              vapiCallId: call?.id, direction: 'inbound', status: callStatus,
              durationSecs, transcript, summary, recordingUrl, endedReason: call?.endedReason,
            },
          })
        }

        // Track voice usage for billing
        if (durationSecs > 0 && agentId) {
          try {
            const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } })
            if (agent?.workspaceId) {
              const { trackVoiceUsage } = await import('@/lib/usage')
              await trackVoiceUsage(agent.workspaceId, agentId, durationSecs)
            }
          } catch (usageErr) {
            console.error('[Vapi] Error tracking voice usage:', usageErr)
          }
        }

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
