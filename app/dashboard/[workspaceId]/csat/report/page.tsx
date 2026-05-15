import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { renderCsatReportHtml } from '@/lib/csat-report'
import PrintTrigger from './PrintTrigger'

/**
 * Server-rendered CSAT report. Reads the same /csat API the dashboard
 * does, hands the data to the shared renderCsatReportHtml() helper,
 * then drops the resulting HTML inline. A small client component
 * fires window.print() on load so the operator gets a save-as-PDF
 * prompt without touching anything.
 *
 * The page is gated to workspace members — `auth()` + membership check.
 * Filter params (days, brandId, rating, handler) ride through from the
 * dashboard's queryString.
 */
export const dynamic = 'force-dynamic'

export default async function CsatReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  })
  if (!member) notFound()

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  })
  if (!workspace) notFound()

  // Re-fetch via the existing API so we get the exact same shape +
  // filter behaviour the dashboard does. Pass session cookies through.
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') q.set(k, v)
  }
  const hdrs = await headers()
  const protocol = hdrs.get('x-forwarded-proto') || 'https'
  const host = hdrs.get('host') || ''
  const base = `${protocol}://${host}`
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/csat?${q.toString()}`, {
    headers: { cookie: hdrs.get('cookie') ?? '' },
    cache: 'no-store',
  })
  const data = await res.json()

  const html = renderCsatReportHtml(data, {
    workspaceId,
    workspaceName: workspace.name,
  })

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: white !important; }
          .no-print { display: none !important; }
        }
        body { background: white; }
      `}</style>
      <div className="no-print" style={{ padding: '12px 24px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          Use your browser&apos;s print dialog to save as PDF.
        </p>
        <PrintTrigger />
      </div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}
