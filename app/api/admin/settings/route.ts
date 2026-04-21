import { NextRequest, NextResponse } from 'next/server'
import { requireAdminRole, logAdminAction } from '@/lib/admin-auth'
import { getAuditRetentionDays, setSetting } from '@/lib/system-settings'

export const dynamic = 'force-dynamic'

// GET — return every setting the admin UI displays. Keep this shape
// backward-compatible as we add more keys.
export async function GET() {
  const session = await requireAdminRole('super')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const auditRetentionDays = await getAuditRetentionDays()
  return NextResponse.json({ auditRetentionDays })
}

// PATCH — partial update. Each known key has its own validator so an
// operator can't shove garbage into a JSON blob.
export async function PATCH(req: NextRequest) {
  const session = await requireAdminRole('super')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}

  if (body.auditRetentionDays !== undefined) {
    const raw = body.auditRetentionDays
    if (raw === null || raw === '' || raw === 0) {
      await setSetting('auditRetentionDays', {}, session.email)   // empty object = "no retention"
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 1 || n > 3650) {
        return NextResponse.json({ error: 'auditRetentionDays must be 1–3650 (or empty for keep-forever).' }, { status: 400 })
      }
      await setSetting('auditRetentionDays', { days: Math.floor(n) }, session.email)
    }
    logAdminAction({
      admin: session,
      action: 'update_setting',
      target: 'auditRetentionDays',
      meta: { value: body.auditRetentionDays },
    }).catch(() => {})
  }

  const auditRetentionDays = await getAuditRetentionDays()
  return NextResponse.json({ ok: true, auditRetentionDays })
}
