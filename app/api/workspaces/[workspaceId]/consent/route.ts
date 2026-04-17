import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const status = url.searchParams.get('status') // filter

  try {
    const [records, counts] = await Promise.all([
      db.contactConsent.findMany({
        where: { workspaceId, ...(status ? { status } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      db.contactConsent.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
    ])

    const summary = counts.reduce((acc, c) => {
      acc[c.status] = c._count._all
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({ records, summary })
  } catch {
    return NextResponse.json({ records: [], summary: {}, notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.locationId || !body.contactId || !body.channel || !body.status) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  try {
    const record = await db.contactConsent.upsert({
      where: {
        contactId_channel_workspaceId: {
          contactId: body.contactId,
          channel: body.channel,
          workspaceId,
        },
      },
      update: {
        status: body.status,
        source: body.source || 'manual',
        detail: body.detail || null,
      },
      create: {
        workspaceId,
        locationId: body.locationId,
        contactId: body.contactId,
        channel: body.channel,
        status: body.status,
        source: body.source || 'manual',
        detail: body.detail || null,
      },
    })
    return NextResponse.json({ record })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
