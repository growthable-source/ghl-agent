import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getTokens } from '@/lib/token-store'
import { buildKnowledgeBlock } from '@/lib/rag'
import { runAgent } from '@/lib/ai-agent'
import { requireLocationAccess } from '@/lib/require-access'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const { agentId, message, contactId, messageHistory } = await req.json()

  if (!agentId || !message) {
    return NextResponse.json({ error: 'agentId and message are required' }, { status: 400 })
  }

  const tokens = await getTokens(locationId)
  if (!tokens) return NextResponse.json({ error: 'Location not connected' }, { status: 401 })

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { knowledgeEntries: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let fullPrompt = agent.systemPrompt
  if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, message)

  if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
    fullPrompt += `\n\n## Calendar Configuration\nCalendar ID for booking: ${agent.calendarId}`
  }

  // Use a test contact ID if not provided
  const testContactId = contactId || `playground-${Date.now()}`

  try {
    const result = await runAgent({
      locationId,
      agentId,
      contactId: testContactId,
      incomingMessage: message,
      messageHistory: messageHistory ?? [],
      systemPrompt: fullPrompt,
      enabledTools: agent.enabledTools,
      sandbox: true,
    })

    return NextResponse.json({
      reply: result.reply,
      actionsPerformed: result.actionsPerformed,
      tokensUsed: result.tokensUsed,
      toolCallTrace: result.toolCallTrace,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
