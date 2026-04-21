import { db } from './db'
import { sendMessage } from './crm-client'
import { shiftToWorkingHours } from './working-hours'
import type { MessageChannelType } from '@/types'

export async function scheduleFollowUp(
  agentId: string,
  locationId: string,
  contactId: string,
  conversationId: string,
  sequenceId: string,
  channel: string = 'SMS'
) {
  const sequence = await db.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  })
  if (!sequence?.isActive || sequence.steps.length === 0) return

  const firstStep = sequence.steps[0]
  let scheduledAt = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000)

  // Apply agent working hours if configured
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: {
        workingHoursEnabled: true, workingHoursStart: true, workingHoursEnd: true,
        workingDays: true, timezone: true,
      },
    }) as any
    if (agent?.workingHoursEnabled) {
      scheduledAt = shiftToWorkingHours({
        workingHoursEnabled: true,
        workingHoursStart: agent.workingHoursStart,
        workingHoursEnd: agent.workingHoursEnd,
        workingDays: agent.workingDays,
        timezone: agent.timezone,
      }, scheduledAt)
    }
  } catch {}

  await db.followUpJob.create({
    data: { sequenceId, locationId, contactId, conversationId, channel, currentStep: 1, scheduledAt },
  })

  // Fire webhook for follow_up.scheduled
  try {
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } })
    if (agent?.workspaceId) {
      const { fireWebhook } = await import('./webhooks')
      fireWebhook({
        workspaceId: agent.workspaceId,
        event: 'follow_up.scheduled',
        payload: { agentId, contactId, conversationId, channel, scheduledAt, sequenceId },
      }).catch(() => {})
    }
  } catch {}
}

export async function cancelFollowUpsForContact(locationId: string, contactId: string) {
  await db.followUpJob.updateMany({
    where: { locationId, contactId, status: 'SCHEDULED' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })
}

export async function processDueFollowUps(): Promise<number> {
  const dueJobs = await db.followUpJob.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    include: { sequence: { include: { steps: { orderBy: { stepNumber: 'asc' } } } } },
    take: 50,
  })

  let processed = 0

  for (const job of dueJobs) {
    try {
      const triggerType = (job.sequence as any).triggerType ?? 'always'

      // For no_reply triggers: check if the contact replied since this job was scheduled
      // If they did, cancel the follow-up — the conversation is active again
      if (triggerType === 'no_reply') {
        const recentInbound = await db.conversationMessage.findFirst({
          where: {
            contactId: job.contactId,
            role: 'user',
            createdAt: { gt: job.createdAt },
          },
          orderBy: { createdAt: 'desc' },
        })
        if (recentInbound) {
          await db.followUpJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
          continue
        }
      }

      const step = job.sequence.steps.find(s => s.stepNumber === job.currentStep)
      if (!step) {
        await db.followUpJob.update({ where: { id: job.id }, data: { status: 'SENT' } })
        continue
      }

      // Re-check agent working hours at send time — if outside window, bump scheduledAt forward
      try {
        const agent = await db.agent.findUnique({
          where: { id: job.sequence.agentId },
          select: {
            workingHoursEnabled: true, workingHoursStart: true, workingHoursEnd: true,
            workingDays: true, timezone: true, isPaused: true, workspaceId: true,
          },
        }) as any
        if (agent?.isPaused) {
          await db.followUpJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
          continue
        }
        if (agent?.workingHoursEnabled) {
          const { isWithinWorkingHours, shiftToWorkingHours } = await import('./working-hours')
          const cfg = {
            workingHoursEnabled: true,
            workingHoursStart: agent.workingHoursStart,
            workingHoursEnd: agent.workingHoursEnd,
            workingDays: agent.workingDays,
            timezone: agent.timezone,
          }
          if (!isWithinWorkingHours(cfg)) {
            const next = shiftToWorkingHours(cfg, new Date())
            await db.followUpJob.update({ where: { id: job.id }, data: { scheduledAt: next } })
            continue
          }
        }
        // Workspace pause check
        if (agent?.workspaceId) {
          const ws = await db.workspace.findUnique({ where: { id: agent.workspaceId }, select: { isPaused: true } }).catch(() => null)
          if ((ws as any)?.isPaused) {
            // Bump forward 1 hour — try again later
            await db.followUpJob.update({ where: { id: job.id }, data: { scheduledAt: new Date(Date.now() + 60 * 60 * 1000) } })
            continue
          }
        }
      } catch {}

      // Render merge fields against the live contact + agent. Templates are
      // authored with {{contact.first_name|there}} etc. — they'd be sent
      // verbatim without this step.
      const { renderMergeFields, resolveAssignedUser, hydrateContactCustomFields } = await import('./merge-fields')
      const { getContact } = await import('./crm-client')
      let contact: Awaited<ReturnType<typeof getContact>> | null = null
      try { contact = await getContact(job.locationId, job.contactId) } catch { /* non-fatal */ }
      const agentForMerge = await db.agent.findUnique({
        where: { id: job.sequence.agentId },
        select: { name: true, timezone: true },
      }).catch(() => null)
      // Pre-resolve the assigned user so {{user.*}} tokens render, and
      // hydrate custom field keys so {{custom.*}} tokens actually match.
      // Both best-effort — degrade to empty merges on any failure.
      const { GhlAdapter } = await import('./crm/ghl/adapter')
      const adapter = new GhlAdapter(job.locationId)
      const [assignedUser, hydratedContact] = await Promise.all([
        resolveAssignedUser(adapter, contact),
        hydrateContactCustomFields(adapter, contact),
      ])
      const renderedMessage = renderMergeFields(step.message, {
        contact: hydratedContact ?? null,
        agent: agentForMerge ? { name: agentForMerge.name } : null,
        user: assignedUser,
        timezone: agentForMerge?.timezone ?? null,
      })

      await sendMessage(job.locationId, {
        type: (job.channel || 'SMS') as MessageChannelType,
        contactId: job.contactId,
        message: renderedMessage,
      })

      // Fire follow_up.sent webhook
      try {
        const agentForWebhook = await db.agent.findUnique({
          where: { id: job.sequence.agentId }, select: { workspaceId: true },
        })
        if (agentForWebhook?.workspaceId) {
          const { fireWebhook } = await import('./webhooks')
          fireWebhook({
            workspaceId: agentForWebhook.workspaceId,
            event: 'follow_up.sent',
            payload: { agentId: job.sequence.agentId, contactId: job.contactId, channel: job.channel, step: job.currentStep },
          }).catch(() => {})
        }
      } catch {}

      const nextStep = job.sequence.steps.find(s => s.stepNumber === job.currentStep + 1)

      if (nextStep) {
        const nextScheduledAt = new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000)
        await db.followUpJob.update({
          where: { id: job.id },
          data: { currentStep: job.currentStep + 1, lastSentAt: new Date(), scheduledAt: nextScheduledAt },
        })
      } else {
        await db.followUpJob.update({
          where: { id: job.id },
          data: { status: 'SENT', lastSentAt: new Date() },
        })
      }
      processed++
    } catch (err: any) {
      console.error(`[FollowUp] Job ${job.id} failed for contact ${job.contactId}:`, err.message)
      await db.followUpJob.update({ where: { id: job.id }, data: { status: 'FAILED' } }).catch(() => {})
    }
  }

  return processed
}
