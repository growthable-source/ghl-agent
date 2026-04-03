import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listPhoneNumbers, purchasePhoneNumber } from '@/lib/vapi-client'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const config = await db.vapiConfig.findUnique({ where: { agentId } })

  let phoneNumbers: { id: string; number: string; name: string }[] = []
  try {
    phoneNumbers = await listPhoneNumbers()
  } catch {}

  const vapiReady = !!process.env.VAPI_API_KEY

  return NextResponse.json({ config, phoneNumbers, vapiReady })
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
