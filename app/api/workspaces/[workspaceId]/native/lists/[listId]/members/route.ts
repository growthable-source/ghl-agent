import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { addContactsToList, removeContactsFromList } from '@/lib/crm/native/lists'

type Params = { params: Promise<{ workspaceId: string; listId: string }> }

/** POST { contactIds: string[] } — add members. Idempotent. */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, listId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const ids = Array.isArray(body.contactIds) ? body.contactIds.filter((x: any) => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'contactIds required' }, { status: 400 })

  try {
    const added = await addContactsToList({ workspaceId, listId, contactIds: ids })
    return NextResponse.json({ added })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 })
  }
}

/** DELETE { contactIds: string[] } — remove members. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, listId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body.contactIds) ? body.contactIds.filter((x: any) => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'contactIds required' }, { status: 400 })
  const removed = await removeContactsFromList({ workspaceId, listId, contactIds: ids })
  return NextResponse.json({ removed })
}
