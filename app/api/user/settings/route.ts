import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, image: true, theme: true },
  })
  return NextResponse.json({ user })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const data: Record<string, string> = {}
  if (body.theme && ['dark', 'light', 'system'].includes(body.theme)) {
    data.theme = body.theme
  }
  if (body.name !== undefined) {
    data.name = body.name
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const user = await db.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, email: true, image: true, theme: true },
  })

  return NextResponse.json({ user })
}
