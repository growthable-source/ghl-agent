import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { envPresence } from '@/lib/auth-host'

export async function GET() {
  const checks: Record<string, string> = {}

  checks.DATABASE_URL = process.env.DATABASE_URL ? 'set' : 'MISSING'
  // LeadConnector marketplace app (CRM install). Not Auth.js Google sign-in.
  checks.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ? 'set' : 'MISSING'
  checks.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ? 'set' : 'MISSING'
  checks.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'
  checks.APP_URL = process.env.APP_URL ?? 'MISSING'
  // Auth.js operator login. Presence only — never the values.
  // next-auth accepts AUTH_SECRET, and falls back to NEXTAUTH_SECRET.
  checks.AUTH_SECRET = envPresence(process.env.AUTH_SECRET)
  checks.NEXTAUTH_SECRET = envPresence(process.env.NEXTAUTH_SECRET)
  checks.GOOGLE_CLIENT_ID = envPresence(process.env.GOOGLE_CLIENT_ID)
  checks.GOOGLE_CLIENT_SECRET = envPresence(process.env.GOOGLE_CLIENT_SECRET)
  // Set means Auth.js would pin every host to one origin if the stock
  // handler were used. The auth route ignores these; unset them anyway.
  checks.AUTH_URL = envPresence(process.env.AUTH_URL) === 'set' ? 'set' : 'unset'
  checks.NEXTAUTH_URL = envPresence(process.env.NEXTAUTH_URL) === 'set' ? 'set' : 'unset'

  try {
    const count = await db.location.count()
    checks.db = `connected (${count} locations)`
  } catch (err: any) {
    checks.db = `ERROR: ${err.message}`
  }

  return NextResponse.json(checks)
}
