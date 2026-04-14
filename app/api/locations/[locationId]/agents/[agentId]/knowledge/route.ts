import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const entries = await db.knowledgeEntry.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const entry = await db.knowledgeEntry.create({
    data: { agentId, title: body.title, content: body.content },
  })
  return NextResponse.json({ entry }, { status: 201 })
}
