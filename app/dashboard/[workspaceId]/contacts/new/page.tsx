import { db } from '@/lib/db'
import NewContactForm from './NewContactForm'

export default async function NewContactPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const [customFields, lists] = await Promise.all([
    db.nativeCustomField.findMany({
      where: { workspaceId },
      orderBy: { position: 'asc' },
    }),
    db.nativeContactList.findMany({
      where: { workspaceId, type: 'static' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return <NewContactForm
    workspaceId={workspaceId}
    customFields={customFields.map(f => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
      placeholder: f.placeholder,
    }))}
    lists={lists}
  />
}
