import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import ListDetailClient from './ListDetailClient'

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; listId: string }>
}) {
  const { workspaceId, listId } = await params
  const list = await db.nativeContactList.findFirst({
    where: { id: listId, workspaceId },
    include: { _count: { select: { members: true } } },
  })
  if (!list) notFound()

  // First page of members + 50 of the workspace's other contacts so the
  // "add member" picker has something to show without an extra round-trip.
  const [members, otherContacts] = await Promise.all([
    db.nativeContactListMember.findMany({
      where: { listId },
      include: { contact: true },
      orderBy: { addedAt: 'desc' },
      take: 200,
    }),
    db.nativeContact.findMany({
      where: { workspaceId, listMemberships: { none: { listId } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ])

  return <ListDetailClient
    workspaceId={workspaceId}
    list={{
      id: list.id,
      name: list.name,
      description: list.description,
      type: list.type,
      memberCount: list._count.members,
    }}
    initialMembers={members.map(m => ({
      id: m.contact.id,
      firstName: m.contact.firstName,
      lastName: m.contact.lastName,
      email: m.contact.email,
      phone: m.contact.phone,
      isSuppressed: m.contact.isSuppressed,
    }))}
    pickerContacts={otherContacts.map(c => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
    }))}
  />
}
