/**
 * Shared ticket creation — the single write path behind every way a
 * ticket comes into existence (chat promote, visitor follow-up request,
 * manual dashboard entry, inbound email, co-pilot escalation).
 *
 * Before this helper each entry point inlined its own copy of the
 * MAX(ticketNumber)+1 transaction, which meant there was nowhere to hang
 * auto-assignment or notifications — three of the five paths just left
 * tickets unassigned in the generic pile. Now:
 *
 *   1. Assignment resolves per the caller's directive: 'explicit' (the
 *      caller already knows the owner — e.g. manual create claims the
 *      creator) or 'auto' (brand/workspace routing via
 *      lib/ticket-routing.ts, with an optional fallback owner so
 *      promote-initiated tickets are never ownerless).
 *   2. Number allocation, ticket + seed messages, lastInboundAt /
 *      lastOutboundAt stamping, and the round-robin cursor advance all
 *      commit in ONE transaction — concurrent creates cycle the pool
 *      correctly. (Worst case under a read-race is a duplicated pick,
 *      same accepted stance as the MAX+1 number idiom.)
 *   3. Post-commit, the auto-picked assignee gets a personal notify()
 *      ("Ticket #N assigned to you") — best-effort, never throws.
 *      Explicit assignments skip it: claiming a ticket yourself or
 *      inheriting the chat you were already on isn't news.
 */

import type { Ticket } from '@prisma/client'
import { db } from './db'
import { notify } from './notifications'
import { resolveTicketAssignee, type TicketAssignmentReason } from './ticket-routing'

export type TicketAssignDirective =
  | { mode: 'explicit'; userId: string; assignedAt?: Date }
  | { mode: 'auto'; fallbackUserId?: string }

export interface TicketSeedMessage {
  direction: 'inbound' | 'outbound' | 'internal_note'
  body: string
  bodyHtml?: string | null
  fromEmail?: string | null
  fromName?: string | null
  // Preserved when backfilling a chat transcript so audit timestamps
  // survive the promote.
  createdAt?: Date
}

export interface CreateTicketInput {
  workspaceId: string
  brandId?: string | null
  conversationId?: string | null
  contactEmail: string
  contactName?: string | null
  contactPhone?: string | null
  crmContactId?: string | null
  // Caller pre-validates/derives; helper only enforces the 255 cap.
  subject: string
  priority?: string
  summary?: string | null
  createdByUserId?: string | null
  assign: TicketAssignDirective
  seedMessages?: TicketSeedMessage[]
  // For paths that count the triggering event as an inbound touch
  // without seeding a message (visitor follow-up request).
  lastInboundAt?: Date | null
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  // Resolve assignment BEFORE the transaction — routing reads config +
  // membership, no reason to hold the txn open for it.
  let assignedUserId: string | null = null
  let assignedAt: Date | null = null
  let autoPick: { userId: string; reason: TicketAssignmentReason; cursor: { kind: 'brand'; brandId: string } | { kind: 'workspace' } } | null = null

  if (input.assign.mode === 'explicit') {
    assignedUserId = input.assign.userId
    assignedAt = input.assign.assignedAt ?? new Date()
  } else {
    autoPick = await resolveTicketAssignee(input.workspaceId, input.brandId ?? null)
      .catch(() => null) // routing must never block ticket creation
    if (autoPick) {
      assignedUserId = autoPick.userId
      assignedAt = new Date()
    } else if (input.assign.fallbackUserId) {
      assignedUserId = input.assign.fallbackUserId
      assignedAt = new Date()
    }
  }

  const ticket = await db.$transaction(async (tx) => {
    // Workspace-scoped sequential number. Cheap enough at our volume;
    // if it ever becomes a hotspot, migrate to a sequence.
    const last = await tx.ticket.findFirst({
      where: { workspaceId: input.workspaceId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    })

    const created = await tx.ticket.create({
      data: {
        workspaceId: input.workspaceId,
        ticketNumber: (last?.ticketNumber ?? 0) + 1,
        conversationId: input.conversationId ?? null,
        brandId: input.brandId ?? null,
        contactEmail: input.contactEmail,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        crmContactId: input.crmContactId ?? null,
        subject: input.subject.slice(0, 255),
        priority: input.priority ?? 'normal',
        status: 'open',
        assignedUserId,
        assignedAt,
        createdByUserId: input.createdByUserId ?? null,
        summary: input.summary ?? null,
        lastActivityAt: new Date(),
      },
    })

    // Seed the thread (chat transcript backfill, escalation summary…)
    // and stamp the activity cursors off the seeds.
    let lastInbound: Date | null = input.lastInboundAt ?? null
    let lastOutbound: Date | null = null
    const seeds = input.seedMessages ?? []
    if (seeds.length > 0) {
      await tx.ticketMessage.createMany({
        data: seeds.map(m => ({
          ticketId: created.id,
          direction: m.direction,
          body: m.body,
          bodyHtml: m.bodyHtml ?? null,
          fromEmail: m.fromEmail ?? null,
          fromName: m.fromName ?? null,
          ...(m.createdAt ? { createdAt: m.createdAt } : {}),
        })),
      })
      for (const m of seeds) {
        const at = m.createdAt ?? new Date()
        if (m.direction === 'inbound' && (!lastInbound || at > lastInbound)) lastInbound = at
        if (m.direction === 'outbound' && (!lastOutbound || at > lastOutbound)) lastOutbound = at
      }
    }
    const updated = (lastInbound || lastOutbound)
      ? await tx.ticket.update({
          where: { id: created.id },
          data: { lastInboundAt: lastInbound, lastOutboundAt: lastOutbound },
        })
      : created

    // Advance the round-robin cursor in the SAME transaction as the
    // ticket write so concurrent creates rotate instead of piling onto
    // one person.
    if (autoPick?.reason === 'pool_round_robin') {
      if (autoPick.cursor.kind === 'brand') {
        await tx.brand.update({
          where: { id: autoPick.cursor.brandId },
          data: { ticketRoutingLastAssignedUserId: autoPick.userId },
        })
      } else {
        await tx.ticketingSettings.update({
          where: { workspaceId: input.workspaceId },
          data: { defaultTicketRoutingLastAssignedUserId: autoPick.userId },
        })
      }
    }

    return updated
  })

  // Routed assignee gets a personal heads-up — the whole point of brand
  // routing is that the right person finds out without watching the pile.
  if (autoPick) {
    try {
      await notify({
        workspaceId: input.workspaceId,
        event: 'ticket.assigned',
        title: `Ticket #${ticket.ticketNumber} assigned to you: ${ticket.subject}`,
        body: autoPick.reason === 'single'
          ? 'You are the designated ticket owner for this brand.'
          : 'Round-robin routing landed this ticket with you.',
        link: `/dashboard/${input.workspaceId}/tickets/${ticket.id}`,
        severity: 'info',
        targetUserId: autoPick.userId,
      })
    } catch (err) {
      console.warn('[ticket-create] assignment notify failed:', err instanceof Error ? err.message : String(err))
    }
  }

  return ticket
}
