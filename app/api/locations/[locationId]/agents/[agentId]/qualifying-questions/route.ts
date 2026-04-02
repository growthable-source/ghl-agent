import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const questions = await db.qualifyingQuestion.findMany({
    where: { agentId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ questions })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const body = await req.json()
  const question = await db.qualifyingQuestion.create({
    data: {
      agentId,
      question: body.question,
      fieldKey: body.fieldKey,
      required: body.required ?? true,
      order: body.order ?? 0,
    },
  })
  return NextResponse.json({ question }, { status: 201 })
}
