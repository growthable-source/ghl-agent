import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; evaluationId: string }> }

/**
 * POST — execute a single evaluation against the agent's current prompt.
 *
 * This reuses the agent's playground endpoint if available; otherwise falls
 * back to a lightweight direct Claude call. The run result is saved as an
 * AgentEvaluationRun.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, evaluationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const evaluation = await db.agentEvaluation.findUnique({
    where: { id: evaluationId },
    include: { evaluation: false } as any,
  }).catch(() => null)

  if (!evaluation || evaluation.agentId !== agentId) {
    return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 })
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, systemPrompt: true, instructions: true, name: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Execute via Claude API directly (mirrors the inference logic)
  let actualResponse = ''
  let toolsCalled: string[] = []
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const systemPrompt = agent.systemPrompt + (agent.instructions ? `\n\n${agent.instructions}` : '')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: evaluation.scenario }],
      }),
    })
    const data = await res.json()
    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') actualResponse += block.text
        if (block.type === 'tool_use') toolsCalled.push(block.name)
      }
    }
  } catch (err: any) {
    actualResponse = `[ERROR] ${err.message}`
  }

  // Evaluate against expectations
  const failureReasons: string[] = []
  const lowered = actualResponse.toLowerCase()
  for (const expected of evaluation.expectedContains) {
    if (!lowered.includes(expected.toLowerCase())) {
      failureReasons.push(`Missing expected phrase: "${expected}"`)
    }
  }
  for (const forbidden of evaluation.expectedNotContains) {
    if (lowered.includes(forbidden.toLowerCase())) {
      failureReasons.push(`Contained forbidden phrase: "${forbidden}"`)
    }
  }
  if (evaluation.expectedTool && !toolsCalled.includes(evaluation.expectedTool)) {
    failureReasons.push(`Expected tool call: "${evaluation.expectedTool}" was not used`)
  }
  const passed = failureReasons.length === 0

  const run = await db.agentEvaluationRun.create({
    data: {
      evaluationId,
      actualResponse,
      passed,
      failureReasons,
      toolsCalled,
      runBy: access.session.user.id,
    },
  })

  return NextResponse.json({ run })
}
