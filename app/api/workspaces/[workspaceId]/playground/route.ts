import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getTokens } from '@/lib/token-store'
import { buildKnowledgeBlock } from '@/lib/rag'
import { runAgent } from '@/lib/ai-agent'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildObjectivesBlockForAgent } from '@/lib/agent-objectives'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const { agentId, message, contactId, messageHistory } = await req.json()

  if (!agentId || !message) {
    return NextResponse.json({ error: 'agentId and message are required' }, { status: 400 })
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { knowledgeEntries: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Use the agent's locationId for CRM token lookup
  const locationId = agent.locationId
  const tokens = await getTokens(locationId)
  if (!tokens) return NextResponse.json({ error: 'Location not connected' }, { status: 401 })

  // Use a test contact ID if not provided
  const testContactId = contactId || `playground-${Date.now()}`

  let fullPrompt = agent.systemPrompt
  fullPrompt += await buildObjectivesBlockForAgent(agent.id, message)
  if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, message)

  if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
    fullPrompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: ${testContactId}

BOOKING PROCEDURE — when the contact wants to schedule:
1. Call get_available_slots with this Calendar ID.
2. Propose ONE specific slot in your reply.
3. On confirmation, IMMEDIATELY call book_appointment in the same turn using the EXACT startTime from get_available_slots.
4. Only say "I've booked" AFTER book_appointment returns success.`
  }

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
