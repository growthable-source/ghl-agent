import { db } from '@/lib/db'
import CustomFieldsClient from './CustomFieldsClient'

export default async function CustomFieldsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const fields = await db.nativeCustomField.findMany({
    where: { workspaceId },
    orderBy: { position: 'asc' },
  })
  return <CustomFieldsClient
    workspaceId={workspaceId}
    initial={fields.map(f => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
      placeholder: f.placeholder,
      position: f.position,
    }))}
  />
}
