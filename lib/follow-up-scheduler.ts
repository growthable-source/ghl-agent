import { db } from './db'
import { sendMessage } from './crm-client'
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
  const scheduledAt = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000)

  await db.followUpJob.create({
    data: { sequenceId, locationId, contactId, conversationId, channel, currentStep: 1, scheduledAt },
  })
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

      await sendMessage(job.locationId, {
        type: (job.channel || 'SMS') as MessageChannelType,
        contactId: job.contactId,
        conversationId: job.conversationId ?? undefined,
        message: step.message,
      })

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
    } catch {
      await db.followUpJob.update({ where: { id: job.id }, data: { status: 'FAILED' } })
    }
  }

  return processed
}
