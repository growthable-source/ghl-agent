import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listPhoneNumbers, purchasePhoneNumber } from '@/lib/vapi-client'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params

  const [config, agent] = await Promise.all([
    db.vapiConfig.findUnique({ where: { agentId } }),
    db.agent.findUnique({
      where: { id: agentId },
      include: { knowledgeEntries: true },
    }),
  ])

  let phoneNumbers: { id: string; number: string; name: string }[] = []
  let vapiError: string | null = null
  try {
    phoneNumbers = await listPhoneNumbers()
  } catch (err: any) {
    vapiError = err.message
    console.error('[Vapi] listPhoneNumbers failed:', err.message)
  }

  const vapiReady = !!process.env.VAPI_API_KEY
  const vapiPublicKey = process.env.VAPI_PUBLIC_KEY || null

  // Build system prompt for test calls
  let testSystemPrompt = agent?.systemPrompt || 'You are a helpful assistant.'
  if (agent?.instructions) testSystemPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  if (agent?.knowledgeEntries?.length) {
    const kb = agent.knowledgeEntries.map(e => `### ${e.title}\n${e.content}`).join('\n\n')
    testSystemPrompt += `\n\n## Knowledge Base\n${kb}`
  }

  return NextResponse.json({
    config,
    phoneNumbers,
    vapiReady,
    vapiError,
    vapiPublicKey,
    agentName: agent?.name || 'Agent',
    agentPersonaName: agent?.agentPersonaName || null,
    testSystemPrompt,
    serverUrl: `${process.env.APP_URL || 'https://voxilityai.vercel.app'}/api/vapi/webhook`,
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const body = await req.json()

  const config = await db.vapiConfig.upsert({
    where: { agentId },
    create: { agentId, ...body },
    update: body,
  })

  return NextResponse.json({ config })
}

// POST — purchase a new phone number
export async function POST(req: NextRequest, { params }: Params) {
  await params
  const body = await req.json()
  const { areaCode, country } = body

  if (!areaCode) {
    return NextResponse.json({ error: 'areaCode is required' }, { status: 400 })
  }

  try {
    const phone = await purchasePhoneNumber(areaCode.trim(), country || 'US')
    return NextResponse.json({ phone })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
