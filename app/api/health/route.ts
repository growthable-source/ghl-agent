import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const checks: Record<string, string> = {}

  checks.DATABASE_URL = process.env.DATABASE_URL ? 'set' : 'MISSING'
  checks.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ? 'set' : 'MISSING'
  checks.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ? 'set' : 'MISSING'
  checks.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'
  checks.APP_URL = process.env.APP_URL ?? 'MISSING'

  try {
    const count = await db.location.count()
    checks.db = `connected (${count} locations)`
  } catch (err: any) {
    checks.db = `ERROR: ${err.message}`
  }

  return NextResponse.json(checks)
}
