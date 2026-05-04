/**
 * Native CRM contacts: bulk operations and dedupe helpers used above the
 * adapter (imports, list seeding, manual create-many flows). Per-contact
 * CRUD lives in NativeAdapter — anything here is for working with sets.
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normalizeEmail, normalizePhone } from './normalize'
import { isSuppressed } from './suppression'

export interface NormalisedContactRow {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  tags?: string[]
  source?: string | null
  customFields?: Record<string, unknown> | null
  assignedToUserId?: string | null
}

export interface CreateContactsResult {
  created: string[] // contact ids inserted this call
  skippedDuplicates: number // matched an existing email/phone in the workspace
  skippedSuppressed: number // matched the suppression list
  skippedInvalid: number // no email AND no phone after normalisation
}

/**
 * Bulk insert contacts with workspace-scoped dedupe and suppression
 * filtering. Existing matches are *not* updated — callers wanting upsert
 * semantics should fetch + merge themselves so they can decide what
 * "merge" means (e.g. tag union vs. overwrite).
 */
export async function createContactsBulk(
  workspaceId: string,
  rows: NormalisedContactRow[],
): Promise<CreateContactsResult> {
  const result: CreateContactsResult = {
    created: [],
    skippedDuplicates: 0,
    skippedSuppressed: 0,
    skippedInvalid: 0,
  }

  // Pre-normalise so we can build dedupe keys before hitting the DB.
  const prepared = rows.map((row) => ({
    ...row,
    email: normalizeEmail(row.email),
    phone: normalizePhone(row.phone),
  }))

  const emails = Array.from(new Set(prepared.map((r) => r.email).filter((v): v is string => !!v)))
  const phones = Array.from(new Set(prepared.map((r) => r.phone).filter((v): v is string => !!v)))

  // One round-trip to find every existing email+phone match in the workspace.
  const existing = (emails.length || phones.length)
    ? await db.nativeContact.findMany({
      where: {
        workspaceId,
        OR: [
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(phones.length ? [{ phone: { in: phones } }] : []),
        ],
      },
      select: { email: true, phone: true },
    })
    : []
  const existingEmails = new Set(existing.map((e) => e.email).filter((v): v is string => !!v))
  const existingPhones = new Set(existing.map((e) => e.phone).filter((v): v is string => !!v))

  // Same idea for the suppression list — pull every match in one shot.
  const suppressionHits = (emails.length || phones.length)
    ? await db.nativeSuppression.findMany({
      where: {
        workspaceId,
        OR: [
          ...(emails.length ? [{ type: 'email', value: { in: emails } }] : []),
          ...(phones.length ? [{ type: 'phone', value: { in: phones } }] : []),
        ],
      },
      select: { type: true, value: true },
    })
    : []
  const suppressedEmails = new Set(suppressionHits.filter((s) => s.type === 'email').map((s) => s.value))
  const suppressedPhones = new Set(suppressionHits.filter((s) => s.type === 'phone').map((s) => s.value))

  // Within-batch dedupe: if the same email appears twice in the same CSV,
  // only the first row wins. Tracked per identifier so a row with phone
  // but no email still counts.
  const seenEmails = new Set<string>()
  const seenPhones = new Set<string>()

  const toCreate: Array<NormalisedContactRow & { workspaceId: string }> = []
  for (const row of prepared) {
    if (!row.email && !row.phone) {
      result.skippedInvalid += 1
      continue
    }
    if (
      (row.email && (existingEmails.has(row.email) || seenEmails.has(row.email))) ||
      (row.phone && (existingPhones.has(row.phone) || seenPhones.has(row.phone)))
    ) {
      result.skippedDuplicates += 1
      continue
    }
    if (
      (row.email && suppressedEmails.has(row.email)) ||
      (row.phone && suppressedPhones.has(row.phone))
    ) {
      result.skippedSuppressed += 1
      continue
    }
    if (row.email) seenEmails.add(row.email)
    if (row.phone) seenPhones.add(row.phone)
    toCreate.push({ ...row, workspaceId })
  }

  if (toCreate.length === 0) return result

  // createMany doesn't return inserted ids on Postgres, so we use a
  // transaction of individual creates when callers need ids back. For
  // now we don't — list membership is added in a separate step that
  // re-queries by email/phone. If perf becomes an issue, switch to
  // INSERT ... RETURNING via $queryRaw.
  const created = await db.$transaction(
    toCreate.map((row) =>
      db.nativeContact.create({
        data: {
          workspaceId,
          firstName: row.firstName ?? null,
          lastName: row.lastName ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          tags: row.tags ?? [],
          source: row.source ?? null,
          customFields: row.customFields
            ? (row.customFields as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          assignedToUserId: row.assignedToUserId ?? null,
        },
        select: { id: true },
      }),
    ),
  )
  result.created = created.map((c) => c.id)
  return result
}

/**
 * Returns the contact id for an email/phone pair within a workspace, or
 * null when neither matches. Used by the import pipeline to attach list
 * membership after a row is processed.
 */
export async function findContactIdByIdentifier(
  workspaceId: string,
  args: { email?: string | null; phone?: string | null },
): Promise<string | null> {
  const email = normalizeEmail(args.email)
  const phone = normalizePhone(args.phone)
  if (!email && !phone) return null

  const match = await db.nativeContact.findFirst({
    where: {
      workspaceId,
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
    select: { id: true },
  })
  return match?.id ?? null
}

/**
 * Convenience for the agent / outbound enqueue path: returns true when
 * this contact can still be reached on at least one channel. Wraps the
 * suppression-list check + the per-contact `isSuppressed` flag.
 */
export async function isContactReachable(workspaceId: string, contactId: string): Promise<boolean> {
  const contact = await db.nativeContact.findFirst({
    where: { id: contactId, workspaceId },
    select: { email: true, phone: true, isSuppressed: true },
  })
  if (!contact) return false
  if (contact.isSuppressed) return false
  return isSuppressed({
    workspaceId,
    email: contact.email,
    phone: contact.phone,
  }).then((s) => !s)
}
