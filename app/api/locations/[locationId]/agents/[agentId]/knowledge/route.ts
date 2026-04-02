import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const entries = await db.knowledgeEntry.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const body = await req.json()
  const entry = await db.knowledgeEntry.create({
    data: { agentId, title: body.title, content: body.content },
  })
  return NextResponse.json({ entry }, { status: 201 })
}
