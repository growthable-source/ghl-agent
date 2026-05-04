/**
 * Native CRM lists. Static lists own their members via
 * NativeContactListMember; smart lists carry a JSON filter and resolve
 * at read time. Smart-list resolution is intentionally narrow for now
 * (tag membership only) — broaden as real customer needs land.
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export interface SmartListFilter {
  /** Contact must have ALL of these tags. */
  tagsAll?: string[]
  /** Contact must have AT LEAST ONE of these tags. */
  tagsAny?: string[]
  /** Substring match (case-insensitive) against firstName + lastName. */
  nameContains?: string
  /** "all" = include suppressed too; default excludes them. */
  includeSuppressed?: boolean
}

export async function createList(args: {
  workspaceId: string
  name: string
  description?: string
  type?: 'static' | 'smart'
  filter?: SmartListFilter
  createdBy?: string
}) {
  return db.nativeContactList.create({
    data: {
      workspaceId: args.workspaceId,
      name: args.name,
      description: args.description ?? null,
      type: args.type ?? 'static',
      filter: args.filter
        ? (args.filter as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      createdBy: args.createdBy ?? null,
    },
  })
}

export async function deleteList(workspaceId: string, listId: string): Promise<void> {
  // Scope by workspaceId in addition to id so a stolen/leaked id from
  // one tenant can't delete another tenant's list.
  await db.nativeContactList.deleteMany({ where: { id: listId, workspaceId } })
}

/**
 * Add contacts to a static list. Idempotent — duplicates are silently
 * ignored via the (listId, contactId) unique constraint. Returns the
 * count actually inserted (i.e. excluding pre-existing members).
 */
export async function addContactsToList(args: {
  workspaceId: string
  listId: string
  contactIds: string[]
}): Promise<number> {
  if (args.contactIds.length === 0) return 0

  // Confirm the list belongs to this workspace before mutating membership.
  const list = await db.nativeContactList.findFirst({
    where: { id: args.listId, workspaceId: args.workspaceId },
    select: { id: true, type: true },
  })
  if (!list) throw new Error(`List not found in workspace: ${args.listId}`)
  if (list.type !== 'static') {
    throw new Error('Cannot add members directly to a smart list — edit its filter instead')
  }

  // Same workspace check on the contact side. Cross-workspace contact ids
  // are dropped silently rather than raising; this matches the "best
  // effort" import path where some ids might already be deleted.
  const validContactIds = (
    await db.nativeContact.findMany({
      where: { id: { in: args.contactIds }, workspaceId: args.workspaceId },
      select: { id: true },
    })
  ).map((c) => c.id)
  if (validContactIds.length === 0) return 0

  const created = await db.nativeContactListMember.createMany({
    data: validContactIds.map((contactId) => ({ listId: args.listId, contactId })),
    skipDuplicates: true,
  })
  return created.count
}

export async function removeContactsFromList(args: {
  workspaceId: string
  listId: string
  contactIds: string[]
}): Promise<number> {
  if (args.contactIds.length === 0) return 0

  const list = await db.nativeContactList.findFirst({
    where: { id: args.listId, workspaceId: args.workspaceId },
    select: { id: true },
  })
  if (!list) return 0

  const removed = await db.nativeContactListMember.deleteMany({
    where: { listId: args.listId, contactId: { in: args.contactIds } },
  })
  return removed.count
}

/**
 * Resolve list membership to a contact-id stream. For static lists this
 * is a join through NativeContactListMember; for smart lists we apply
 * the stored filter. Pagination is offset-based to keep the dashboard
 * UI simple — switch to cursor-based when a workspace grows past the
 * tens-of-thousands range.
 */
export async function getListContacts(args: {
  workspaceId: string
  listId: string
  limit?: number
  offset?: number
}) {
  const list = await db.nativeContactList.findFirst({
    where: { id: args.listId, workspaceId: args.workspaceId },
    select: { id: true, type: true, filter: true },
  })
  if (!list) return { contacts: [], total: 0 }

  const limit = Math.min(args.limit ?? 100, 1000)
  const offset = args.offset ?? 0

  if (list.type === 'static') {
    const [members, total] = await Promise.all([
      db.nativeContactListMember.findMany({
        where: { listId: list.id },
        include: { contact: true },
        orderBy: { addedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.nativeContactListMember.count({ where: { listId: list.id } }),
    ])
    return { contacts: members.map((m) => m.contact), total }
  }

  // Smart list — translate filter to a Prisma where clause.
  const where = buildSmartFilterWhere(args.workspaceId, list.filter as SmartListFilter | null)
  const [contacts, total] = await Promise.all([
    db.nativeContact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.nativeContact.count({ where }),
  ])
  return { contacts, total }
}

function buildSmartFilterWhere(
  workspaceId: string,
  filter: SmartListFilter | null,
): Prisma.NativeContactWhereInput {
  const where: Prisma.NativeContactWhereInput = { workspaceId }
  if (!filter) return where

  if (!filter.includeSuppressed) where.isSuppressed = false

  const tagAnd: Prisma.NativeContactWhereInput[] = []
  if (filter.tagsAll?.length) {
    tagAnd.push({ tags: { hasEvery: filter.tagsAll } })
  }
  if (filter.tagsAny?.length) {
    tagAnd.push({ tags: { hasSome: filter.tagsAny } })
  }
  if (filter.nameContains) {
    tagAnd.push({
      OR: [
        { firstName: { contains: filter.nameContains, mode: 'insensitive' } },
        { lastName: { contains: filter.nameContains, mode: 'insensitive' } },
      ],
    })
  }
  if (tagAnd.length) where.AND = tagAnd
  return where
}
