import { NextRequest, NextResponse, after } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'
import { sendTicketingEmail, isTransientSendFailure } from '@/lib/ticketing-send'
import { notify } from '@/lib/notifications'
import { computeReplyDiff } from '@/lib/tickets/reply-diff'
import { stageTicketResolutionLearning } from '@/lib/tickets/brand-knowledge'

type Params = { params: Promise<{ draftId: string }> }

/**
 * POST { action: 'approve' | 'reject', note?, body? } — decide a pending
 * reply draft for a ticket on one of the reviewer's brands.
 *
 * `body` (optional) is the reviewer's EDITED version of the reply. When it
 * differs from the submitted text it's stored on the draft (editedBody), and
 * the edited text — not the original — is what's sent. "Approved with changes"
 * is derived from editedBody being present.
 *
 * On every decision we, best-effort (never blocking the decision):
 *   - drop an internal note on the ticket so the activity feed shows the
 *     outcome + any diff + the reject reason;
 *   - notify the reply's author (the submitter) of the outcome;
 *   - on approve, stage a brand-knowledge learning from the released reply.
 *
 * Approve = send. The email goes out through the same Resend path a direct
 * dashboard reply uses; a TicketMessage is recorded with the original
 * submitter as author. If Resend fails, the message is still recorded and the
 * error surfaced (matching /messages behaviour).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { draftId } = await params

  const payload = await req.json().catch(() => ({}))
  const action = payload.action === 'approve' || payload.action === 'reject' ? payload.action : null
  if (!action) return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 2000) : null
  const editedRaw = typeof payload.body === 'string' ? payload.body.trim() : null

  const draft = await db.ticketReplyDraft.findUnique({
    where: { id: draftId },
    select: {
      id: true,
      body: true,
      status: true,
      submittedByUserId: true,
      ticket: {
        select: {
          id: true, workspaceId: true, brandId: true,
          ticketNumber: true, subject: true, contactEmail: true, contactName: true, status: true,
          brand: { select: { name: true } },
          messages: {
            where: { direction: 'inbound' },
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: { body: true },
          },
        },
      },
    },
  }).catch(() => null)
  if (!draft || !draft.ticket.brandId || !session.brandIds.includes(draft.ticket.brandId)) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `This draft was already ${draft.status}.` }, { status: 409 })
  }

  const now = new Date()
  // Admin-preview sessions have no PortalUser row — record email only.
  const reviewerId = session.userId === 'admin-preview' ? null : session.userId
  const reviewerLabel = session.name || session.email || 'a reviewer'
  const reviewFields = {
    reviewedByPortalUserId: reviewerId,
    reviewedByEmail: session.email,
    reviewedAt: now,
    reviewNote: note,
  }

  // ── Reject ──────────────────────────────────────────────────────────
  if (action === 'reject') {
    // Status-guarded claim: only the request that flips pending→rejected does
    // the side effects, so a double-submit can't post two rejection notes.
    const claimed = await db.ticketReplyDraft.updateMany({
      where: { id: draft.id, status: 'pending' },
      data: { status: 'rejected', ...reviewFields },
    })
    if (claimed.count === 0) {
      return NextResponse.json({ error: 'This draft was already decided.' }, { status: 409 })
    }

    await recordActivityNote(draft.ticket.id, {
      fromEmail: session.email, fromName: session.name, portalUserId: reviewerId,
      body: `⛔ Reply rejected by ${reviewerLabel}.${note ? `\nReason: ${note}` : ''}`,
    })
    notifyAuthor(draft.submittedByUserId, draft.ticket.workspaceId, {
      title: `Your reply for #${draft.ticket.ticketNumber} was rejected`,
      body: note ? `Reason: ${note}` : 'No reason given.',
      link: dashLink(draft.ticket.workspaceId, draft.ticket.id),
    })

    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  // ── Approve (optionally with edits) ─────────────────────────────────
  const editedBody = editedRaw && editedRaw !== draft.body ? editedRaw : null
  const sentText = editedBody ?? draft.body
  const diff = editedBody ? computeReplyDiff(draft.body, editedBody) : null

  // Claim the draft atomically BEFORE sending. A status-guarded write is the
  // compare-and-swap that stops a concurrent approve (two reviewers, or a
  // network/proxy retry) from emailing the customer a second copy: only the
  // request that actually flips pending→approved goes on to send.
  const claimed = await claimApproved(draft.id, editedBody, reviewFields)
  if (claimed.count === 0) {
    return NextResponse.json({ error: 'This draft was already decided.' }, { status: 409 })
  }

  const send = await sendTicketingEmail({
    workspaceId: draft.ticket.workspaceId,
    to: draft.ticket.contactEmail,
    subject: draft.ticket.subject,
    text: sentText,
    ticketRef: { id: draft.ticket.id, number: draft.ticket.ticketNumber },
    includeSignature: true,
  })
  const emailError = send.ok ? null : send.reason

  if (!send.ok) {
    // The draft is already marked 'approved' (claimed above) — the reviewer's
    // decision stands — but the send failure must not vanish: tell the team.
    const willRetry = isTransientSendFailure(send)
    notify({
      workspaceId: draft.ticket.workspaceId,
      event: 'agent_error',
      title: `Ticket #${draft.ticket.ticketNumber}: approved reply failed to send`,
      body: willRetry ? `${send.reason} Retrying automatically.` : send.reason,
      link: dashLink(draft.ticket.workspaceId, draft.ticket.id),
      severity: 'error',
    }).catch(() => {})
  }

  const baseData = {
    ticketId: draft.ticket.id,
    direction: 'outbound',
    body: sentText,
    sentByUserId: draft.submittedByUserId,
    sentAt: send.ok ? now : null,
    messageId: send.messageId,
  }
  let message: { id: string }
  try {
    message = await db.ticketMessage.create({
      data: {
        ...baseData,
        ...(emailError
          ? {
              emailError,
              emailAttempts: 1,
              emailNextRetryAt: isTransientSendFailure(send) ? new Date(now.getTime() + 2 * 60_000) : null,
            }
          : {}),
      },
      select: { id: true },
    })
  } catch (err: any) {
    // Pre-migration DB (failure-tracking columns not applied yet).
    if (emailError && (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? ''))) {
      message = await db.ticketMessage.create({ data: baseData, select: { id: true } })
    } else {
      throw err
    }
  }

  await Promise.all([
    // status / editedBody / review fields were written by claimApproved above;
    // just link the sent message now that it exists.
    db.ticketReplyDraft.update({
      where: { id: draft.id },
      data: { sentMessageId: message.id },
    }),
    db.ticket.update({
      where: { id: draft.ticket.id },
      data: { lastActivityAt: now, lastOutboundAt: now },
    }),
  ])

  // ── Side effects (best-effort, never fail the decision) ─────────────
  const activityBody = editedBody && diff
    ? `✅ Approved with changes by ${reviewerLabel} and sent.\n\nChanges to the drafted reply:\n${diff.unified}`
    : `✅ Reply approved by ${reviewerLabel} and sent as drafted.`
  await recordActivityNote(draft.ticket.id, {
    fromEmail: session.email, fromName: session.name, portalUserId: reviewerId,
    body: activityBody,
  })

  // notify + learning are best-effort AND do post-response async work (the
  // learning runs a Haiku distill + DB writes). Wrap in after() so Vercel
  // keeps the runtime alive past the JSON response instead of tearing the
  // detached promises down mid-flight.
  const question = draft.ticket.messages[0]?.body ?? draft.ticket.subject
  after(async () => {
    notifyAuthor(draft.submittedByUserId, draft.ticket.workspaceId, {
      title: editedBody
        ? `Your reply for #${draft.ticket.ticketNumber} was approved with edits`
        : `Your reply for #${draft.ticket.ticketNumber} was approved & sent`,
      body: editedBody && diff
        ? `The reviewer edited it before sending (+${diff.addedLines}/-${diff.removedLines} lines). Open the ticket to see what changed.`
        : 'It was approved and sent as drafted.',
      link: dashLink(draft.ticket.workspaceId, draft.ticket.id),
    })
    // Learn from the released reply — stage a brand-knowledge candidate.
    await stageTicketResolutionLearning({
      ticket: { id: draft.ticket.id, brandId: draft.ticket.brandId, workspaceId: draft.ticket.workspaceId },
      question,
      answer: sentText,
      brandName: draft.ticket.brand?.name ?? null,
    }).catch(() => {})
  })

  return NextResponse.json({
    ok: true,
    status: 'approved',
    withChanges: !!editedBody,
    emailSent: send.ok,
    emailError,
  })
}

// ── helpers ───────────────────────────────────────────────────────────

/**
 * Compare-and-swap the draft from pending→approved, stamping the reviewer's
 * fields + editedBody. Returns { count } — count===0 means another request
 * already decided it (so the caller must NOT send). Falls back to a write
 * without editedBody on a pre-migration DB (column not yet added).
 */
async function claimApproved(
  id: string,
  editedBody: string | null,
  reviewFields: Record<string, unknown>,
): Promise<{ count: number }> {
  try {
    return await db.ticketReplyDraft.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', editedBody, ...reviewFields },
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return await db.ticketReplyDraft.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'approved', ...reviewFields },
      })
    }
    throw err
  }
}

function dashLink(workspaceId: string, ticketId: string): string {
  return `/dashboard/${workspaceId}/tickets/${ticketId}`
}

/**
 * Append a team-only note to the ticket thread (the dashboard activity feed).
 * Portal provenance (fromEmail/fromName + sentByPortalUserId) matches how a
 * portal reply is attributed. Best-effort — a note failure never blocks the
 * decision that already happened.
 */
async function recordActivityNote(
  ticketId: string,
  opts: { fromEmail: string | null; fromName: string | null; portalUserId: string | null; body: string },
): Promise<void> {
  try {
    await db.ticketMessage.create({
      data: {
        ticketId,
        direction: 'internal_note',
        body: opts.body,
        fromEmail: opts.fromEmail,
        fromName: opts.fromName,
        sentByPortalUserId: opts.portalUserId,
      },
    })
  } catch {
    /* pre-migration column / transient — ignore */
  }
}

/** Personal notification to the reply's author. Skipped for FK-less / deleted
 *  submitters. Fire-and-forget. */
function notifyAuthor(
  submittedByUserId: string | null,
  workspaceId: string,
  n: { title: string; body: string; link: string },
): void {
  if (!submittedByUserId) return
  notify({
    workspaceId,
    event: 'ticket.approval_decided',
    title: n.title,
    body: n.body,
    link: n.link,
    severity: 'info',
    targetUserId: submittedByUserId,
  }).catch(() => {})
}
