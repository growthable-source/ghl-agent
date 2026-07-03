import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { normalizeCustomDomain } from '@/lib/portal-branding'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// PATCH — update portal name / branding / active flag.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  let body: any = {}
  try { body = await req.json() } catch {}

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string') data.name = body.name.trim()
  if (body.logoUrl === null || typeof body.logoUrl === 'string') data.logoUrl = body.logoUrl || null
  if (body.primaryColor === null || typeof body.primaryColor === 'string') data.primaryColor = body.primaryColor || null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  // Scheduled email reports to portal users.
  if (typeof body.reportFrequency === 'string') {
    if (!['off', 'daily', 'weekly'].includes(body.reportFrequency)) {
      return NextResponse.json({ error: 'reportFrequency must be off, daily, or weekly' }, { status: 400 })
    }
    data.reportFrequency = body.reportFrequency
  }
  // Custom domain: blank clears it; otherwise normalize + validate. A
  // non-empty string that fails validation is rejected rather than
  // silently dropped, so the operator knows it didn't take.
  if (body.customDomain === null || typeof body.customDomain === 'string') {
    const raw = typeof body.customDomain === 'string' ? body.customDomain.trim() : ''
    if (!raw) {
      data.customDomain = null
    } else {
      const normalized = normalizeCustomDomain(raw)
      if (!normalized) {
        return NextResponse.json({ error: 'That domain looks invalid. Use a hostname like support.acme.com.' }, { status: 400 })
      }
      data.customDomain = normalized
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No mutable fields' }, { status: 400 })
  }

  try {
    const portal = await db.portal.update({
      where: { id },
      data,
      select: { id: true, name: true, isActive: true },
    })
    logAdminActionAfter({ admin: session, action: 'update_portal', target: id, meta: data })
    return NextResponse.json({ portal })
  } catch (err) {
    // Unique-constraint violation = the domain is taken by another portal.
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'That domain is already used by another portal.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Portal not found' }, { status: 404 })
  }
}

// DELETE — wipe the portal entirely. Cascade removes users, invites,
// brand assignments. Use with care; deactivating via PATCH is reversible.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  try {
    await db.portal.delete({ where: { id } })
    logAdminActionAfter({ admin: session, action: 'delete_portal', target: id })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Portal not found' }, { status: 404 })
  }
}
