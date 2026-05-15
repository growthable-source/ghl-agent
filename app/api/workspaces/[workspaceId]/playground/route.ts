import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getTokens } from '@/lib/token-store'
import { buildKnowledgeBlock } from '@/lib/rag'
import { runAgent } from '@/lib/ai-agent'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildObjectivesBlockForAgent } from '@/lib/agent-objectives'
import { retrieveAndFormatForAgent, summariseRetrievedChunks, debugRetrieveForAgent } from '@/lib/agent/retrieve-for-agent'

// Playground waits for the full agent reply before responding (single
// turn but with tool loops). 120s covers worst case.
export const maxDuration = 120

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

  const agent: any = await db.agent.findUnique({ where: { id: agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  // Hydrate workspace-stacked knowledge via the junction.
  const { bulkLoadKnowledgeForAgents } = await import('@/lib/knowledge')
  const map = await bulkLoadKnowledgeForAgents([agent.id])
  agent.knowledgeEntries = map.get(agent.id) ?? []

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

  // Phase 2 — pgvector retrieval over ingested KnowledgeSource chunks.
  // The block lands in the system prompt the same as it does for real
  // SMS/widget traffic. We ALSO run the debug query in parallel — the
  // playground UI shows that diagnostic so operators see chunk counts,
  // top similarity, and a reason code instead of a binary "no match."
  const agentForRetrieval = {
    id: agent.id,
    workspaceId: agent.workspaceId,
    knowledgeDomainIds: agent.knowledgeDomainIds,
  }
  const [phase2, retrievalDebug] = await Promise.all([
    retrieveAndFormatForAgent(agentForRetrieval, message),
    debugRetrieveForAgent(agentForRetrieval, message),
  ])
  fullPrompt += phase2.block

  if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
    fullPrompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: ${testContactId}

BOOKING PROCEDURE — when the contact wants to schedule:
1. Call get_available_slots with this Calendar ID.
2. Propose ONE specific slot in your reply.
3. On confirmation, IMMEDIATELY call book_appointment in the same turn using the EXACT startTime from get_available_slots.
4. Only say "I've booked" AFTER book_appointment returns success.

CANCEL/RESCHEDULE:
- To cancel: get_calendar_events → cancel_appointment(appointmentId). Never say "cancelled" without calling the tool.
- To reschedule: get_calendar_events → get_available_slots → reschedule_appointment(appointmentId, new startTime).`
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
      workflowPicks: {
        addTo: ((agent as any).addToWorkflowsPick ?? undefined) as any,
        removeFrom: ((agent as any).removeFromWorkflowsPick ?? undefined) as any,
      },
      sandbox: true,
    })

    return NextResponse.json({
      reply: result.reply,
      actionsPerformed: result.actionsPerformed,
      tokensUsed: result.tokensUsed,
      toolCallTrace: result.toolCallTrace,
      // What actually made it into the agent prompt (above threshold).
      knowledgeUsed: summariseRetrievedChunks(phase2.chunks),
      // Full diagnostic — chunk counts, top similarity, reason code,
      // top matches regardless of threshold. UI uses this to say
      // *why* nothing matched (or to show "top hit was 28%, threshold
      // was 25%, here it is").
      retrievalDebug,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
