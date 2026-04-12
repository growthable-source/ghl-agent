import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listPhoneNumbers, purchasePhoneNumber } from '@/lib/vapi-client'
import { getAllQuestions, buildQualifyingPromptBlock } from '@/lib/qualifying'
import { buildPersonaBlock } from '@/lib/persona'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params

    const [config, agent] = await Promise.all([
      db.vapiConfig.findUnique({ where: { agentId } }),
      db.agent.findUnique({
        where: { id: agentId },
        include: { knowledgeEntries: true },
      }),
    ])

    let phoneNumbers: { id: string; number: string; name: string; provider?: string; status?: string }[] = []
    let vapiError: string | null = null
    try {
      phoneNumbers = await listPhoneNumbers()
      console.log('[Vapi] phoneNumbers response:', JSON.stringify(phoneNumbers))
    } catch (err: any) {
      vapiError = err.message
      console.error('[Vapi] listPhoneNumbers failed:', err.message)
    }

    const rawKey = process.env.VAPI_API_KEY
    const vapiReady = !!rawKey && rawKey.trim().length > 0
    const vapiPublicKey = process.env.VAPI_PUBLIC_KEY || null

    // Build full system prompt for test calls — same as production
    let testSystemPrompt = agent?.systemPrompt || 'You are a helpful assistant.'
    if (agent?.instructions) testSystemPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
    if (agent?.knowledgeEntries?.length) {
      const kb = agent.knowledgeEntries.map(e => `### ${e.title}\n${e.content}`).join('\n\n')
      testSystemPrompt += `\n\n## Knowledge Base\n${kb}`
    }

    // Calendar ID
    if (agent?.calendarId) {
      testSystemPrompt += `\n\n## Calendar Configuration\nCalendar ID for booking: ${agent.calendarId}\nAlways use get_available_slots before booking. Use this calendar ID.`
    }

    // Qualifying questions
    if (agent) {
      const questions = await getAllQuestions(agentId)
      const qStyle = (agent as any).qualifyingStyle ?? 'strict'
      testSystemPrompt += buildQualifyingPromptBlock(questions, qStyle)
    }

    // Persona
    if (agent) {
      testSystemPrompt += buildPersonaBlock(agent as any)
    }

    // Fallback behavior
    const fallbackBehavior = (agent as any)?.fallbackBehavior ?? 'message'
    const fallbackMessage = (agent as any)?.fallbackMessage
    if (fallbackBehavior === 'transfer') {
      testSystemPrompt += `\n\n## When You Don't Know the Answer\nIf asked something you don't know, say you'll connect them with someone and end the topic. Do NOT guess.`
    } else if (fallbackMessage) {
      testSystemPrompt += `\n\n## When You Don't Know the Answer\nIf asked something you don't know, say: "${fallbackMessage}" — do NOT guess or make up information.`
    } else {
      testSystemPrompt += `\n\n## When You Don't Know the Answer\nIf asked something you don't know, say you'll find out and get back to them. Do NOT guess or make up information.`
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
      serverUrl: `${process.env.APP_URL || 'https://app.voxility.ai'}/api/vapi/webhook`,
      _debug: {
        keyPresent: !!rawKey,
        keyLength: rawKey?.length ?? 0,
        publicKeyPresent: !!process.env.VAPI_PUBLIC_KEY,
        publicKeyLength: process.env.VAPI_PUBLIC_KEY?.length ?? 0,
        nodeEnv: process.env.NODE_ENV,
      },
    })
  } catch (err: any) {
    console.error('[Vapi Route] CRASH:', err)
    return NextResponse.json({
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5),
    }, { status: 500 })
  }
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
  const { areaCode } = body

  try {
    const phone = await purchasePhoneNumber((areaCode || '').trim())
    return NextResponse.json({ phone })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
