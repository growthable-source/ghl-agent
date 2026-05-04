import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { addSuppression, removeSuppression } from '@/lib/crm/native/suppression'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const type = url.searchParams.get('type') as 'email' | 'phone' | null
  const items = await db.nativeSuppression.findMany({
    where: { workspaceId, ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ suppressions: items })
}

/** POST { type: 'email'|'phone', value, reason? } */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  if (body.type !== 'email' && body.type !== 'phone') {
    return NextResponse.json({ error: 'type must be email or phone' }, { status: 400 })
  }
  if (!body.value) return NextResponse.json({ error: 'value required' }, { status: 400 })

  await addSuppression({
    workspaceId,
    type: body.type,
    value: String(body.value),
    reason: body.reason ?? 'manual',
  })
  return NextResponse.json({ ok: true })
}

/** DELETE { type, value } — un-suppress (use carefully). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  if (body.type !== 'email' && body.type !== 'phone') {
    return NextResponse.json({ error: 'type required' }, { status: 400 })
  }
  await removeSuppression({ workspaceId, type: body.type, value: String(body.value) })
  return NextResponse.json({ ok: true })
}
