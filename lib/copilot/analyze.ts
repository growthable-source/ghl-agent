/**
 * Post-session analysis — a text agent (Haiku) reads the finished
 * Co-Pilot transcript and produces a structured verdict:
 *
 *   summary        — 2-3 sentence recap for the session history UI
 *   issueResolved  — did the user get what they came for?
 *   sentiment      — how the user seemed by the end
 *   topics         — what the session was about (for later aggregation)
 *   ticketSubject  — proposed subject line when unresolved
 *
 * The verdict is stored in CopilotSession.metadata.analysis (JSONB —
 * no schema migration) and mirrored into CopilotEvalRecord so the
 * §12 task-success metric covers widget sessions too (staff sessions
 * already get the workflow-goal auto-eval; widget sessions have no
 * workflow, so the analysis IS their resolution signal).
 *
 * When the issue is NOT resolved, we open a Ticket through the same
 * transaction pattern the promote-from-conversation route uses
 * (sequential per-workspace ticketNumber, inbound TicketMessage with
 * the context) — gated on getTicketingStatus().active exactly like
 * every other ticket entry point. No email on file → no ticket; we
 * record why so the UI can say so instead of failing silently.
 */

import { db } from '@/lib/db'
import { createMessage } from '@/lib/llm'
import { getTicketingStatus } from '@/lib/ticketing-access'

const ANALYSIS_MODEL = 'claude-haiku'
const MAX_TRANSCRIPT_CHARS = 24_000

export interface SessionAnalysis {
  summary: string
  issueResolved: boolean
  sentiment: 'positive' | 'neutral' | 'frustrated'
  topics: string[]
  ticketSubject: string | null
}

/**
 * Parse the model's JSON verdict, tolerating fenced code blocks and
 * leading prose. Pure — unit-tested. Returns null when nothing
 * usable can be extracted (caller skips analysis rather than storing
 * garbage).
 */
export function parseAnalysisJson(raw: string): SessionAnalysis | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>
    if (typeof obj.summary !== 'string' || typeof obj.issueResolved !== 'boolean') return null
    const sentiment =
      obj.sentiment === 'positive' || obj.sentiment === 'frustrated' ? obj.sentiment : 'neutral'
    return {
      summary: obj.summary.slice(0, 1000),
      issueResolved: obj.issueResolved,
      sentiment,
      topics: Array.isArray(obj.topics)
        ? obj.topics.filter((t): t is string => typeof t === 'string').slice(0, 8)
        : [],
      ticketSubject:
        typeof obj.ticketSubject === 'string' && obj.ticketSubject.trim()
          ? obj.ticketSubject.slice(0, 200)
          : null,
    }
  } catch {
    return null
  }
}

/**
 * Analyze a finished session and open a ticket if unresolved.
 * Never throws — session end must not fail because analysis did.
 * Returns the analysis (or null) so callers can include it in their
 * response.
 */
export async function analyzeSessionAndFollowUp(sessionId: string): Promise<SessionAnalysis | null> {
  try {
    const session = await db.copilotSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        workspaceId: true,
        startedByUserId: true,
        metadata: true,
        durationSecs: true,
        turns: { orderBy: { ts: 'asc' }, select: { role: true, text: true } },
      },
    })
    if (!session || session.turns.length < 2) return null

    const transcript = session.turns
      .filter(t => t.role === 'user' || t.role === 'agent')
      .map(t => `${t.role === 'user' ? 'USER' : 'COPILOT'}: ${t.text ?? ''}`)
      .join('\n')
      .slice(0, MAX_TRANSCRIPT_CHARS)
    if (!transcript.trim()) return null

    const completion = await createMessage(ANALYSIS_MODEL, {
      max_tokens: 500,
      system:
        'You analyze transcripts of live screen-share support sessions between a user and an AI co-pilot. ' +
        'Output ONLY a JSON object, no prose, with exactly these keys: ' +
        '"summary" (2-3 sentences, what the user wanted and what happened), ' +
        '"issueResolved" (boolean — true only if the user clearly accomplished their goal or got their answer by the end), ' +
        '"sentiment" ("positive" | "neutral" | "frustrated" — how the user seemed at the END), ' +
        '"topics" (array of 1-5 short topic strings), ' +
        '"ticketSubject" (when issueResolved is false: a concise support-ticket subject line written from the user\'s perspective; otherwise null). ' +
        'Judge resolution conservatively: an abruptly ended session mid-problem is NOT resolved.',
      messages: [{ role: 'user', content: `Transcript:\n\n${transcript}\n\nAnalyze.` }],
    }, { surface: 'copilot_analysis' })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const analysis = block ? parseAnalysisJson(block.text) : null
    if (!analysis) {
      console.warn(`[Copilot analyze] unparseable verdict for ${sessionId}`)
      return null
    }

    const meta = (session.metadata ?? {}) as Record<string, unknown>
    let ticketInfo: { ticketId: string; ticketNumber: number } | { skipped: string } | null = null
    if (!analysis.issueResolved) {
      ticketInfo = await maybeCreateTicket(session, analysis)
    }

    await Promise.all([
      db.copilotSession.update({
        where: { id: session.id },
        data: {
          metadata: JSON.parse(
            JSON.stringify({ ...meta, analysis, ...(ticketInfo ? { ticket: ticketInfo } : {}) }),
          ),
        },
      }),
      db.copilotEvalRecord.create({
        data: {
          sessionId: session.id,
          workspaceId: session.workspaceId,
          scope: 'session',
          taskSuccess: analysis.issueResolved,
          groundingFaithfulness: null,
          notes: `haiku analysis: ${analysis.summary.slice(0, 400)}`,
        },
      }),
    ])

    return analysis
  } catch (err) {
    console.error(`[Copilot analyze] failed for ${sessionId}:`, err)
    return null
  }
}

interface AnalyzableSession {
  id: string
  workspaceId: string
  startedByUserId: string | null
  metadata: unknown
  durationSecs: number | null
  turns: Array<{ role: string; text: string | null }>
}

async function maybeCreateTicket(
  session: AnalyzableSession,
  analysis: SessionAnalysis,
): Promise<{ ticketId: string; ticketNumber: number } | { skipped: string }> {
  const status = await getTicketingStatus(session.workspaceId)
  if (!status.active) return { skipped: 'ticketing_not_active' }

  // Contact identity: widget sessions carry visitor info in metadata;
  // staff sessions fall back to the dashboard user's account email.
  const meta = (session.metadata ?? {}) as Record<string, unknown>
  let contactEmail: string | null = null
  let contactName: string | null = null

  const visitorId = typeof meta.visitorId === 'string' ? meta.visitorId : null
  if (visitorId) {
    const visitor = await db.widgetVisitor.findUnique({
      where: { id: visitorId },
      select: { email: true, name: true },
    })
    contactEmail = visitor?.email ?? null
    contactName = visitor?.name ?? null
  }
  if (!contactEmail && session.startedByUserId) {
    const user = await db.user.findUnique({
      where: { id: session.startedByUserId },
      select: { email: true, name: true },
    })
    contactEmail = user?.email ?? null
    contactName = contactName ?? user?.name ?? null
  }
  if (!contactEmail) return { skipped: 'no_contact_email' }

  const subject = analysis.ticketSubject || `Unresolved co-pilot session: ${analysis.topics[0] ?? 'support request'}`
  const transcriptExcerpt = session.turns
    .filter(t => t.role === 'user' || t.role === 'agent')
    .map(t => `${t.role === 'user' ? 'User' : 'Co-pilot'}: ${t.text ?? ''}`)
    .join('\n')
    .slice(0, 6000)

  const ticket = await db.$transaction(async tx => {
    const last = await tx.ticket.findFirst({
      where: { workspaceId: session.workspaceId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    })
    const created = await tx.ticket.create({
      data: {
        workspaceId: session.workspaceId,
        ticketNumber: (last?.ticketNumber ?? 0) + 1,
        contactEmail: contactEmail!,
        contactName,
        subject: subject.slice(0, 255),
        priority: analysis.sentiment === 'frustrated' ? 'high' : 'normal',
        status: 'open',
        lastActivityAt: new Date(),
        lastInboundAt: new Date(),
      },
    })
    await tx.ticketMessage.create({
      data: {
        ticketId: created.id,
        direction: 'inbound',
        fromEmail: contactEmail,
        fromName: contactName,
        body:
          `Auto-created from an unresolved Co-Pilot live session (${Math.round((session.durationSecs ?? 0) / 60)} min).\n\n` +
          `Summary: ${analysis.summary}\n\n` +
          `--- Transcript ---\n${transcriptExcerpt}`,
      },
    })
    return created
  })

  console.log(`[Copilot analyze] opened ticket #${ticket.ticketNumber} for unresolved session ${session.id}`)
  return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber }
}
