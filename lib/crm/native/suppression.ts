/**
 * Native CRM suppression list. Workspace-wide opt-out store consulted at
 * import time and at send time. Email/phone arrive normalised — callers
 * are expected to run them through ./normalize first.
 */

import { db } from '@/lib/db'
import { normalizeEmail, normalizePhone } from './normalize'

export type SuppressionType = 'email' | 'phone'

export interface SuppressionInput {
  workspaceId: string
  type: SuppressionType
  /** Raw value — will be normalised before insert. */
  value: string
  reason?: string
}

/**
 * Idempotent insert. Re-suppressing an already-suppressed address with a
 * new reason updates the reason; this is what you want when STOP arrives
 * after a manual block — the latest reason wins.
 */
export async function addSuppression(input: SuppressionInput): Promise<void> {
  const value = normaliseValue(input.type, input.value)
  if (!value) return

  await db.nativeSuppression.upsert({
    where: {
      workspaceId_type_value: {
        workspaceId: input.workspaceId,
        type: input.type,
        value,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      type: input.type,
      value,
      reason: input.reason ?? null,
    },
    update: input.reason ? { reason: input.reason } : {},
  })

  // Mark every contact with this email/phone as suppressed so list views
  // can surface it without joining the suppression table on every render.
  await db.nativeContact.updateMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.type === 'email' ? { email: value } : { phone: value }),
    },
    data: { isSuppressed: true },
  })
}

export async function removeSuppression(input: SuppressionInput): Promise<void> {
  const value = normaliseValue(input.type, input.value)
  if (!value) return

  await db.nativeSuppression.deleteMany({
    where: { workspaceId: input.workspaceId, type: input.type, value },
  })

  // Only clear the flag if no other suppression rule still applies. A
  // contact with both an email- and phone-level suppression should stay
  // suppressed when only one is removed.
  const remaining = await db.nativeSuppression.count({
    where: {
      workspaceId: input.workspaceId,
      OR: [
        { type: 'email', value: input.type === 'email' ? value : undefined },
        { type: 'phone', value: input.type === 'phone' ? value : undefined },
      ],
    },
  })
  if (remaining === 0) {
    await db.nativeContact.updateMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.type === 'email' ? { email: value } : { phone: value }),
      },
      data: { isSuppressed: false },
    })
  }
}

/**
 * True if any of the contact's reachable identifiers (email, phone) sits
 * on the suppression list. Returns false when both are missing — there's
 * nothing to suppress.
 */
export async function isSuppressed(args: {
  workspaceId: string
  email?: string | null
  phone?: string | null
}): Promise<boolean> {
  const email = normalizeEmail(args.email)
  const phone = normalizePhone(args.phone)
  if (!email && !phone) return false

  const hit = await db.nativeSuppression.findFirst({
    where: {
      workspaceId: args.workspaceId,
      OR: [
        ...(email ? [{ type: 'email', value: email }] : []),
        ...(phone ? [{ type: 'phone', value: phone }] : []),
      ],
    },
    select: { id: true },
  })
  return hit !== null
}

function normaliseValue(type: SuppressionType, value: string): string | null {
  return type === 'email' ? normalizeEmail(value) : normalizePhone(value)
}
