import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ templates: [] }, { status: 401 })

  try {
    const templates = await db.agentTemplate.findMany({
      orderBy: [{ isOfficial: 'desc' }, { installCount: 'desc' }, { createdAt: 'desc' }],
    })
    return NextResponse.json({ templates })
  } catch {
    return NextResponse.json({ templates: [], notMigrated: true })
  }
}
