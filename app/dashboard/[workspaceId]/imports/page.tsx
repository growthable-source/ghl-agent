import { db } from '@/lib/db'
import ImportsClient from './ImportsClient'

export default async function ImportsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const [imports, lists] = await Promise.all([
    db.nativeContactImport.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { list: { select: { id: true, name: true } } },
    }),
    db.nativeContactList.findMany({
      where: { workspaceId, type: 'static' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return <ImportsClient
    workspaceId={workspaceId}
    initialImports={imports.map(i => ({
      id: i.id,
      filename: i.filename,
      status: i.status,
      totalRows: i.totalRows,
      importedCount: i.importedCount,
      skippedCount: i.skippedCount,
      errorCount: i.errorCount,
      listName: i.list?.name ?? null,
      createdAt: i.createdAt.toISOString(),
    }))}
    lists={lists}
  />
}
