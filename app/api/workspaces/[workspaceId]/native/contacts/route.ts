import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { normalizeEmail, normalizePhone } from '@/lib/crm/native/normalize'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:wsId/native/contacts?q=&listId=&page=&pageSize=
 *
 * Paginated contact list. Optional query (`q`) does an exact-match on
 * normalised email/phone first, then falls back to a name substring.
 * Optional listId narrows to members of that list.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const listId = url.searchParams.get('listId') ?? undefined
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50') || 50))

  const where: Prisma.NativeContactWhereInput = { workspaceId }
  if (q) {
    const email = normalizeEmail(q)
    const phone = normalizePhone(q)
    where.OR = [
      ...(email ? [{ email }] : []),
      ...(phone ? [{ phone }] : []),
      { firstName: { contains: q, mode: 'insensitive' as const } },
      { lastName: { contains: q, mode: 'insensitive' as const } },
    ]
  }
  if (listId) {
    where.listMemberships = { some: { listId } }
  }

  const [contacts, total] = await Promise.all([
    db.nativeContact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.nativeContact.count({ where }),
  ])

  return NextResponse.json({ contacts, total, page, pageSize })
}

/**
 * POST /api/workspaces/:wsId/native/contacts
 * Body: { firstName?, lastName?, email?, phone?, tags?, source?, customFields?, assignedToUserId? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const email = normalizeEmail(body.email)
  const phone = normalizePhone(body.phone)
  if (!email && !phone) {
    return NextResponse.json({ error: 'Email or phone required' }, { status: 400 })
  }

  // Soft dedupe — if a contact with this email/phone already exists,
  // return it rather than creating a duplicate.
  const existing = await db.nativeContact.findFirst({
    where: {
      workspaceId,
      OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    },
  })
  if (existing) return NextResponse.json({ contact: existing, deduped: true })

  const contact = await db.nativeContact.create({
    data: {
      workspaceId,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      email,
      phone,
      tags: Array.isArray(body.tags) ? body.tags : [],
      source: body.source ?? 'manual',
      assignedToUserId: body.assignedToUserId ?? null,
      customFields: body.customFields
        ? (body.customFields as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  })
  return NextResponse.json({ contact }, { status: 201 })
}
