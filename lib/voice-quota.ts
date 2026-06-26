/**
 * Voice-minute quota gates.
 *
 * Every voice agent on the platform draws from a single shared voice
 * provider (Xovera manages it; users never see the vendor). Without
 * quotas, one workspace could burn unlimited international minutes
 * overnight. This module gates calls at the start (in-progress calls
 * are never killed mid-call — user-hostile) and surfaces the 80%
 * warning threshold for the email layer.
 *
 * Data layer (already in place):
 *   - lib/plans.ts          PLAN_FEATURES[plan].voiceMinutes
 *   - lib/usage.ts          trackVoiceUsage / getCurrentUsage
 *   - Workspace.voiceMinuteUsage    (seconds, atomic increment per call)
 *   - Workspace.voiceMinuteLimit    (minutes, set from plan)
 *
 * This module adds:
 *   - checkVoiceQuota(workspaceId)  → pass / fail with a brand-neutral message
 *   - shouldSendVoiceQuotaWarning(usedSec, limitMin)  → boolean for the 80% trigger
 *
 * Callers (gates):
 *   - lib/outbound-call.ts:initiateOutboundCall  — blocks the dial
 *   - /api/workspaces/.../agents/.../vapi GET     — surfaces a flag the
 *     browser test panel reads before calling vapi.start
 *
 * Warning trigger:
 *   - lib/usage.ts:trackVoiceUsage — after the increment, fire an email
 *     if the workspace just crossed the warn threshold and no warning
 *     has been sent for this billing period.
 */

import { db } from '@/lib/db'
import { getPlanFeatures, currentBillingPeriod, effectiveVoiceMinuteLimit } from '@/lib/plans'

/**
 * Send a warning when ≥ 80 % of the included voice minutes have been
 * used. Earlier than this and the email is noise; later than this and
 * the customer has no time to upgrade before they hit the wall.
 */
export const VOICE_QUOTA_WARN_FRACTION = 0.8

export type VoiceQuotaResult =
  | { ok: true; used: number; limit: number; remaining: number; planLabel: string }
  | {
      ok: false
      code: 'VOICE_QUOTA_EXCEEDED' | 'VOICE_NOT_ON_PLAN'
      /** Brand-neutral, customer-safe message. */
      message: string
      used: number
      limit: number
      planLabel: string
    }

/**
 * Decide whether a workspace is allowed to start a new voice call.
 * Reads workspace.voiceMinuteUsage (seconds) and workspace.voiceMinuteLimit
 * (minutes). When the limit is 0, the plan doesn't include voice at
 * all — return VOICE_NOT_ON_PLAN so the UI can prompt for an upgrade
 * to a voice-enabled plan, not a higher-minute plan.
 */
export async function checkVoiceQuota(workspaceId: string): Promise<VoiceQuotaResult> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      voiceMinuteUsage: true,
      voiceMinuteLimit: true,
      plan: true,
    },
  })
  if (!ws) {
    return {
      ok: false,
      code: 'VOICE_QUOTA_EXCEEDED',
      message: 'We couldn\'t resolve your workspace. Contact support if this keeps happening.',
      used: 0,
      limit: 0,
      planLabel: 'Unknown',
    }
  }

  const features = getPlanFeatures(ws.plan)
  const usedMinutes = Math.ceil((ws.voiceMinuteUsage ?? 0) / 60)
  // Entitlement is driven by the PLAN, not the denormalized column — see
  // effectiveVoiceMinuteLimit. This is what stops a voice-enabled
  // workspace whose column was never backfilled from being told "voice
  // isn't on your plan".
  const limitMinutes = effectiveVoiceMinuteLimit(ws.plan, ws.voiceMinuteLimit)

  // Plan doesn't include voice at all.
  if (limitMinutes <= 0) {
    return {
      ok: false,
      code: 'VOICE_NOT_ON_PLAN',
      message:
        'Voice calls aren\'t included on your current plan. Upgrade to enable inbound and outbound phone calls for this workspace.',
      used: usedMinutes,
      limit: 0,
      planLabel: features.label,
    }
  }

  // Hard quota reached. Note: we do NOT block when the workspace has
  // a `voiceOveragePrice` configured AND we have overage billing wired
  // up — currently we don't auto-bill overages, so we treat the limit
  // as hard. When overage billing ships, swap this for a soft warning.
  if (usedMinutes >= limitMinutes) {
    return {
      ok: false,
      code: 'VOICE_QUOTA_EXCEEDED',
      message:
        `You've used ${usedMinutes} of ${limitMinutes} voice minutes for this billing period. Upgrade your plan to keep making calls — your existing agents and configuration carry over.`,
      used: usedMinutes,
      limit: limitMinutes,
      planLabel: features.label,
    }
  }

  return {
    ok: true,
    used: usedMinutes,
    limit: limitMinutes,
    remaining: limitMinutes - usedMinutes,
    planLabel: features.label,
  }
}

/**
 * After a call ends and we've incremented usage, decide whether to
 * send the 80 % warning email.
 *
 * Idempotency: we record a `voice_quota_warning_sent` UsageRecord row
 * tagged with the current billing period. Re-running this function
 * within the same period is a no-op. The records also roll into the
 * monthly reset along with the rest of UsageRecord, so warnings re-arm
 * automatically next period.
 */
export async function maybeSendVoiceQuotaWarning(
  workspaceId: string,
  usedSecondsAfter: number,
): Promise<void> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { voiceMinuteLimit: true, plan: true, name: true },
  })
  if (!ws) return
  const limitMinutes = effectiveVoiceMinuteLimit(ws.plan, ws.voiceMinuteLimit)
  if (limitMinutes <= 0) return // no warn for "not on plan"

  const usedMinutes = Math.ceil(usedSecondsAfter / 60)
  const threshold = Math.floor(limitMinutes * VOICE_QUOTA_WARN_FRACTION)
  if (usedMinutes < threshold) return
  if (usedMinutes >= limitMinutes) return // hard-block handles it via the dial gate; no warning needed

  // Idempotency check: did we already warn this period?
  const period = currentBillingPeriod()
  const existing = await db.usageRecord.findFirst({
    where: { workspaceId, billingPeriod: period, type: 'voice_quota_warning_sent' },
    select: { id: true },
  })
  if (existing) return

  // Mark before send so a slow email transport doesn't double-fire on
  // concurrent updates. If the email then fails the user gets the
  // warning next period — better than spamming them.
  await db.usageRecord.create({
    data: {
      workspaceId,
      billingPeriod: period,
      type: 'voice_quota_warning_sent',
      quantity: 1,
    },
  })

  try {
    const { sendVoiceQuotaWarningEmail } = await import('@/lib/voice-quota-email')
    await sendVoiceQuotaWarningEmail({
      workspaceId,
      workspaceName: ws.name,
      usedMinutes,
      limitMinutes,
      planLabel: getPlanFeatures(ws.plan).label,
    })
  } catch (err: any) {
    console.warn(`[VoiceQuota] Warning email send failed for workspace ${workspaceId}:`, err?.message)
  }
}
