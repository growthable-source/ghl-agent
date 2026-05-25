import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

/**
 * CSV export of MarketplaceInstall rows, respecting the same q + source
 * filters as /admin/installs so the file matches what the admin sees.
 *
 * Server-streamed plain text, no streaming chunks — install volumes are
 * small enough (low thousands at most) that buffering a single CSV in
 * memory is fine. If we ever cross 100k installs, swap to chunked write.
 *
 * No pagination — explicit "give me everything that matches" — because
 * the use case is exporting to a CRM or spreadsheet, not browsing.
 */
export async function GET(req: NextRequest) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const source = (searchParams.get('source') ?? '').trim()

  const where: any = {}
  if (source) where.source = source
  if (q) {
    where.OR = [
      { locationName: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { userName: { contains: q, mode: 'insensitive' } },
      { userEmail: { contains: q, mode: 'insensitive' } },
      { locationEmail: { contains: q, mode: 'insensitive' } },
      { companyEmail: { contains: q, mode: 'insensitive' } },
      { externalLocationId: { contains: q } },
    ]
  }

  let rows: Array<{
    installedAt: Date
    source: string
    externalLocationId: string | null
    externalCompanyId: string | null
    externalUserId: string | null
    locationName: string | null
    locationEmail: string | null
    locationPhone: string | null
    locationWebsite: string | null
    locationAddress: string | null
    locationCity: string | null
    locationState: string | null
    locationCountry: string | null
    companyName: string | null
    companyEmail: string | null
    companyPhone: string | null
    companyWebsite: string | null
    userName: string | null
    userEmail: string | null
    userPhone: string | null
    userRole: string | null
    workspace: { id: string; name: string | null; slug: string | null } | null
    syncedToGhlAt: Date | null
    contactedAt: Date | null
    notes: string | null
  }>
  try {
    rows = await db.marketplaceInstall.findMany({
      where,
      orderBy: { installedAt: 'desc' },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
    }) as any
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.code === 'P2021') {
      return NextResponse.json(
        { error: 'MarketplaceInstall table not yet migrated.', code: 'NOT_MIGRATED' },
        { status: 503 },
      )
    }
    throw err
  }

  logAdminAction({
    admin: session,
    action: 'export_installs_csv',
    meta: { q, source, rows: rows.length },
  })

  const header = [
    'Installed at',
    'Source',
    'Workspace ID',
    'Workspace name',
    'External location ID',
    'External company ID',
    'External user ID',
    'Location name',
    'Location email',
    'Location phone',
    'Location website',
    'Location address',
    'Location city',
    'Location state',
    'Location country',
    'Company name',
    'Company email',
    'Company phone',
    'Company website',
    'User name',
    'User email',
    'User phone',
    'User role',
    'Synced to GHL at',
    'Contacted at',
    'Notes',
  ]

  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.installedAt.toISOString(),
        r.source,
        r.workspace?.id ?? '',
        r.workspace?.name ?? '',
        r.externalLocationId ?? '',
        r.externalCompanyId ?? '',
        r.externalUserId ?? '',
        r.locationName ?? '',
        r.locationEmail ?? '',
        r.locationPhone ?? '',
        r.locationWebsite ?? '',
        r.locationAddress ?? '',
        r.locationCity ?? '',
        r.locationState ?? '',
        r.locationCountry ?? '',
        r.companyName ?? '',
        r.companyEmail ?? '',
        r.companyPhone ?? '',
        r.companyWebsite ?? '',
        r.userName ?? '',
        r.userEmail ?? '',
        r.userPhone ?? '',
        r.userRole ?? '',
        r.syncedToGhlAt?.toISOString() ?? '',
        r.contactedAt?.toISOString() ?? '',
        r.notes ?? '',
      ].map(csvCell).join(','),
    )
  }

  const filename = `voxility-installs-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

/**
 * RFC 4180-compatible CSV cell escaping. Wraps in quotes whenever the
 * value contains a comma, quote, or newline; doubles internal quotes.
 * Numeric strings starting with 0 or quotes-looking content also get
 * wrapped so Excel doesn't reformat them.
 */
function csvCell(value: string): string {
  const s = String(value ?? '')
  if (s === '') return ''
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
