import { db } from '@/lib/db'
import ListsClient from './ListsClient'

export default async function ListsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const lists = await db.nativeContactList.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { members: true } } },
  })
  return <ListsClient workspaceId={workspaceId} initialLists={lists.map(l => ({
    id: l.id,
    name: l.name,
    description: l.description,
    type: l.type,
    memberCount: l._count.members,
    createdAt: l.createdAt.toISOString(),
  }))} />
}
