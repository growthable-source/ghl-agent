import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/help-auth'

/**
 * Tiny endpoint for client components that need to know whether the
 * current user is a super-admin. Returns only a boolean — no email,
 * no leakage beyond what the session already knows.
 */
export async function GET() {
  const { ok } = await isSuperAdmin()
  return NextResponse.json({ isSuperAdmin: ok })
}
