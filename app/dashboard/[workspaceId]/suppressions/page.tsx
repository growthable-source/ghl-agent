import { db } from '@/lib/db'
import SuppressionsClient from './SuppressionsClient'

export default async function SuppressionsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const items = await db.nativeSuppression.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return <SuppressionsClient
    workspaceId={workspaceId}
    initial={items.map(i => ({
      id: i.id,
      type: i.type,
      value: i.value,
      reason: i.reason,
      createdAt: i.createdAt.toISOString(),
    }))}
  />
}
