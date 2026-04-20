import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; questionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, questionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
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
      ...(body.conditionValues !== undefined && { conditionValues: Array.isArray(body.conditionValues) ? body.conditionValues : [] }),
      ...(body.actionType !== undefined && { actionType: body.actionType }),
      ...(body.actionValue !== undefined && { actionValue: body.actionValue }),
      ...(body.actionParams !== undefined && { actionParams: body.actionParams }),
      ...(body.crmFieldKey !== undefined && { crmFieldKey: body.crmFieldKey }),
      ...(body.overwrite !== undefined && { overwrite: body.overwrite }),
    },
  })
  return NextResponse.json({ question })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, questionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.qualifyingQuestion.delete({ where: { id: questionId } })
  return NextResponse.json({ success: true })
}
