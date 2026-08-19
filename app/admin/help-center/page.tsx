import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'
import { growthablePlanLabel } from '@/lib/partner/growthable-plans'
import UnlockControl from './UnlockControl'
import BuilderLinkButton from './BuilderLinkButton'
import OnboardingEmailButton from './OnboardingEmailButton'

// The help-center product's own admin (GKB) — where a centre's delete
// danger-zone, domain state, and "Sync from Xovera" button live.
// Derived from the sync-push URL so there's one source of truth for
// the partner host.
function helpCenterAdminBase(): string | null {
  const url = process.env.HELP_CENTER_SYNC_URL
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  page?: string
}

const PAGE_SIZE = 50

/**
 * Help Center installs — every account the partner help-center product
 * has provisioned, with the operational lever this page exists for:
 * the comped UNLOCK (plan grant + ticketing + crawl their articles
 * into the agent's knowledge). Partner-billed upgrades come through
 * the partner API; this page is for the ones we unlock by hand.
 */
export default async function AdminHelpCenterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  const where: Record<string, unknown> = {}
  if (q) {
    where.OR = [
      { businessName: { contains: q, mode: 'insensitive' } },
      { externalEmail: { contains: q, mode: 'insensitive' } },
      { externalId: { contains: q } },
    ]
  }

  let total = 0
  let rows: Array<{
    id: string
    externalId: string
    externalEmail: string
    businessName: string
    status: string
    workspaceId: string | null
    widgetId: string | null
    metadata: unknown
    createdAt: Date
  }> = []
  let notMigrated = false
  try {
    const [t, r] = await Promise.all([
      db.partnerInstall.count({ where }),
      db.partnerInstall.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
    ])
    total = t
    rows = r
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e?.message?.includes('does not exist') || e?.code === 'P2021') notMigrated = true
    else throw err
  }

  // Plans live on the workspace, not the install — batch-load them.
  const wsIds = rows.map(r => r.workspaceId).filter((id): id is string => !!id)
  const workspaces = wsIds.length > 0
    ? await db.workspace.findMany({
        where: { id: { in: wsIds } },
        select: { id: true, plan: true, trialEndsAt: true },
      })
    : []
  const wsById = new Map(workspaces.map(w => [w.id, w]))

  // Portal + brand per install, resolved through the widget's brand —
  // same derivation the partner GET uses. Batched: widgets → brandIds →
  // portalBrand links.
  const widgetIds = rows.map(r => r.widgetId).filter((id): id is string => !!id)
  const widgets = widgetIds.length > 0
    ? await db.chatWidget.findMany({
        where: { id: { in: widgetIds } },
        select: { id: true, brandId: true, workspaceId: true },
      })
    : []
  const brandIds = widgets.map(w => w.brandId).filter((id): id is string => !!id)
  const portalLinks = brandIds.length > 0
    ? await db.portalBrand.findMany({
        where: { brandId: { in: brandIds } },
        select: { brandId: true, portal: { select: { id: true, slug: true } } },
      }).catch(() => [])
    : []
  const widgetById = new Map(widgets.map(w => [w.id, w]))
  const portalByBrand = new Map(portalLinks.map(p => [p.brandId, p.portal]))

  logAdminAction({
    admin: session,
    action: 'view_help_center_installs',
    meta: { q, page, rowsReturned: rows.length },
  })

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Help Center installs</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Accounts provisioned by the help-center partner. Unlock grants a comped plan
            (no Stripe rows), optional ticketing, and crawls their articles into the agent&apos;s knowledge.
          </p>
        </div>
        <form className="flex items-center gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search business, email, external id…"
            className="rounded-lg px-3 py-2 text-sm bg-zinc-900 text-zinc-200 border border-zinc-700 w-72"
          />
          <button className="text-sm px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300">Search</button>
        </form>
      </div>

      {notMigrated ? (
        <p className="mt-8 text-sm text-amber-400">PartnerInstall table missing — run the partner-installs migration.</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">{q ? 'No matches.' : 'No installs yet.'}</p>
      ) : (
        <div className="mt-6 rounded-xl border border-zinc-800 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="text-zinc-500 text-[10px] uppercase tracking-wider bg-zinc-900/60">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Business</th>
                <th className="text-left px-4 py-2.5 font-semibold">Email</th>
                <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                <th className="text-left px-4 py-2.5 font-semibold">Plan</th>
                <th className="text-left px-4 py-2.5 font-semibold">Unlocked</th>
                <th className="text-left px-4 py-2.5 font-semibold">Configure</th>
                <th className="text-left px-4 py-2.5 font-semibold">Unlock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const ws = r.workspaceId ? wsById.get(r.workspaceId) : null
                const meta = (r.metadata ?? {}) as {
                  helpCenterUrl?: string
                  unlock?: { growthablePlan?: string; plan?: string; by?: string; at?: string; articlesSynced?: boolean }
                }
                const adminBase = helpCenterAdminBase()
                const gkbAdminUrl = adminBase && r.externalId.startsWith('hc_')
                  ? `${adminBase}/admin/centers/${r.externalId.slice(3)}`
                  : null
                const trialExpired = !!ws?.trialEndsAt && ws.trialEndsAt < new Date()
                const widget = r.widgetId ? widgetById.get(r.widgetId) : null
                const portal = widget?.brandId ? portalByBrand.get(widget.brandId) : null
                return (
                  <tr key={r.id} className="border-t border-zinc-800 align-top">
                    <td className="px-4 py-3">
                      <p className="text-zinc-100">{r.businessName}</p>
                      <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{r.externalId}</p>
                      {meta.helpCenterUrl && (
                        <a href={meta.helpCenterUrl} target="_blank" rel="noreferrer" className="text-[10px] text-zinc-500 underline break-all">
                          {meta.helpCenterUrl}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{r.externalEmail}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        r.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400'
                        : r.status === 'registered' ? 'bg-sky-500/10 text-sky-400'
                        : r.status === 'failed' ? 'bg-red-500/10 text-red-400'
                        : r.status === 'disabled' ? 'bg-zinc-700/40 text-zinc-400'
                        : 'bg-amber-500/10 text-amber-400'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-200 capitalize">{ws?.plan ?? '—'}</p>
                      {ws?.plan === 'trial' && (
                        <p className="text-[10px] text-zinc-500">{trialExpired ? 'trial expired' : 'in trial'}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {meta.unlock?.growthablePlan || meta.unlock?.plan ? (
                        <div>
                          <p className="text-emerald-400 text-xs font-semibold">
                            ✓ {growthablePlanLabel(meta.unlock.growthablePlan) ?? meta.unlock.plan}
                          </p>
                          <p className="text-[10px] text-zinc-500">
                            by {meta.unlock.by ?? '?'}{meta.unlock.at ? ` · ${new Date(meta.unlock.at).toLocaleDateString()}` : ''}
                            {meta.unlock.articlesSynced ? ' · articles synced' : ''}
                          </p>
                        </div>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1.5">
                        {gkbAdminUrl && (
                          <a
                            href={gkbAdminUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] px-2 py-1 rounded border border-amber-500/40 text-amber-300"
                            title="The help center product's admin for this centre — edit, sync from Xovera, and DELETE live here"
                          >
                            Help center admin ↗
                          </a>
                        )}
                        {r.workspaceId && (
                          <Link
                            href={`/admin/workspaces/${r.workspaceId}`}
                            className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300"
                          >
                            Workspace →
                          </Link>
                        )}
                        {r.widgetId && <BuilderLinkButton installId={r.id} />}
                        {portal && (
                          <Link
                            href={`/admin/portals/${portal.id}`}
                            className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300"
                            title={`Portal "${portal.slug}" — impersonate from its detail page`}
                          >
                            Portal →
                          </Link>
                        )}
                        {r.workspaceId && (
                          <OnboardingEmailButton installId={r.id} defaultRecipient={r.externalEmail} />
                        )}
                        {!gkbAdminUrl && !r.workspaceId && <span className="text-zinc-600 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(r.status === 'ready' && r.workspaceId) || r.status === 'registered' ? (
                        <UnlockControl
                          installId={r.id}
                          currentPlan={ws?.plan ?? 'trial'}
                          helpCenterUrl={meta.helpCenterUrl ?? ''}
                          registered={r.status === 'registered'}
                        />
                      ) : (
                        <span className="text-zinc-600 text-xs">not ready</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
          <span>Page {page} of {totalPages} · {total} installs</span>
          {page > 1 && <a className="underline" href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}>← Prev</a>}
          {page < totalPages && <a className="underline" href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}>Next →</a>}
        </div>
      )}
    </div>
  )
}
