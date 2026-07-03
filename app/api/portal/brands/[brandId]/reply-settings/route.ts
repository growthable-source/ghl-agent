import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

type Params = { params: Promise<{ brandId: string }> }

const MAX_KEYWORDS = 100
const MAX_KEYWORD_LENGTH = 80

/**
 * Brand reply rules — currently the negative keyword/phrase list the AI
 * must never use when drafting replies for this brand.
 *
 *   GET   — { negativeKeywords }
 *   PATCH { negativeKeywords: string[] } — replace the list
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { brandId } = await params
  if (!session.brandIds.includes(brandId)) {
    return NextResponse.json({ error: 'Unknown brand' }, { status: 403 })
  }

  try {
    const brand = await db.brand.findUnique({
      where: { id: brandId },
      select: { negativeKeywords: true },
    })
    return NextResponse.json({ negativeKeywords: brand?.negativeKeywords ?? [] })
  } catch {
    return NextResponse.json({ negativeKeywords: [] }) // pre-migration: column missing
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { brandId } = await params
  if (!session.brandIds.includes(brandId)) {
    return NextResponse.json({ error: 'Unknown brand' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body.negativeKeywords)) {
    return NextResponse.json({ error: 'negativeKeywords must be an array of strings.' }, { status: 400 })
  }
  const cleaned = [...new Set(
    (body.negativeKeywords as unknown[])
      .filter((k): k is string => typeof k === 'string')
      .map(k => k.trim().slice(0, MAX_KEYWORD_LENGTH))
      .filter(k => k.length > 0),
  )].slice(0, MAX_KEYWORDS)

  try {
    await db.brand.update({ where: { id: brandId }, data: { negativeKeywords: cleaned } })
    return NextResponse.json({ negativeKeywords: cleaned })
  } catch {
    return NextResponse.json(
      { error: 'Reply rules aren’t initialised on this database yet. Please try again later.' },
      { status: 503 },
    )
  }
}
