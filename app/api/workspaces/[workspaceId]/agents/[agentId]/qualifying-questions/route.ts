import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const questions = await db.qualifyingQuestion.findMany({
    where: { agentId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ questions })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const question = await db.qualifyingQuestion.create({
    data: {
      agentId,
      question: body.question,
      fieldKey: body.fieldKey,
      required: body.required ?? true,
      order: body.order ?? 0,
      answerType: body.answerType ?? 'text',
      choices: body.choices ?? [],
      conditionOp: body.conditionOp ?? null,
      conditionVal: body.conditionVal ?? null,
      conditionValues: Array.isArray(body.conditionValues) ? body.conditionValues : [],
      actionType: body.actionType ?? null,
      actionValue: body.actionValue ?? null,
      actionParams: body.actionParams ?? null,
      crmFieldKey: body.crmFieldKey ?? null,
      overwrite: body.overwrite ?? false,
    },
  })
  return NextResponse.json({ question }, { status: 201 })
}
