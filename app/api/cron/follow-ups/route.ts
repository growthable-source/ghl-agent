import { NextRequest, NextResponse } from 'next/server'
import { processDueFollowUps } from '@/lib/follow-up-scheduler'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const processed = await processDueFollowUps()
  return NextResponse.json({ processed })
}
