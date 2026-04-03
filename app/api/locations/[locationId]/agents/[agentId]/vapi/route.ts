import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listPhoneNumbers } from '@/lib/vapi-client'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const config = await db.vapiConfig.findUnique({ where: { agentId } })

  let phoneNumbers: { id: string; number: string; name: string }[] = []
  try {
    phoneNumbers = await listPhoneNumbers()
  } catch {}

  return NextResponse.json({ config, phoneNumbers })
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
