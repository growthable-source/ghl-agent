import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/kiosk/whoami — is the current session a kiosk operator?
 *
 * Drives the inbox "You are <name> · Switch" chip. Returns isKiosk:false
 * for normal logins (the chip then doesn't render). Resolves the kiosk
 * landing slug so "Switch" can route back to the right /kiosk/<slug>.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ isKiosk: false })

  let op: any = null
  try {
    op = await db.kioskOperator.findUnique({
      where: { userId: session.user.id },
      select: { displayName: true, workspace: { select: { slug: true } } },
    })
  } catch {
    return NextResponse.json({ isKiosk: false })
  }
  if (!op) return NextResponse.json({ isKiosk: false })

  return NextResponse.json({
    isKiosk: true,
    displayName: op.displayName,
    slug: op.workspace.slug,
  })
}
