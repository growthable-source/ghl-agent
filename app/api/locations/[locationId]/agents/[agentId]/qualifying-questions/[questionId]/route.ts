import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string; agentId: string; questionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { questionId } = await params
  const body = await req.json()
  const question = await db.qualifyingQuestion.update({
    where: { id: questionId },
    data: {
      ...(body.question !== undefined && { question: body.question }),
      ...(body.fieldKey !== undefined && { fieldKey: body.fieldKey }),
      ...(body.required !== undefined && { required: body.required }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.answerType !== undefined && { answerType: body.answerType }),
      ...(body.choices !== undefined && { choices: body.choices }),
      ...(body.conditionOp !== undefined && { conditionOp: body.conditionOp }),
      ...(body.conditionVal !== undefined && { conditionVal: body.conditionVal }),
      ...(body.actionType !== undefined && { actionType: body.actionType }),
      ...(body.actionValue !== undefined && { actionValue: body.actionValue }),
    },
  })
  return NextResponse.json({ question })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { questionId } = await params
  await db.qualifyingQuestion.delete({ where: { id: questionId } })
  return NextResponse.json({ success: true })
}
