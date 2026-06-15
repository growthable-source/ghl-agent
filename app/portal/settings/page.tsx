import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Settings · Customer Portal',
  robots: { index: false, follow: false },
}

export default async function PortalSettings() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const brands = session.brandIds.length
    ? await db.brand.findMany({ where: { id: { in: session.brandIds } }, select: { id: true, name: true, primaryColor: true }, orderBy: { name: 'asc' } })
    : []

  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-white">Settings</h1>
      <p className="text-sm text-zinc-400 mt-1">Your portal account.</p>

      <div className="rounded-xl border border-zinc-800 p-5 mt-6 space-y-4" style={{ background: 'var(--surface)' }}>
        <Row label="Name" value={session.name ?? '—'} />
        <Row label="Email" value={session.email} />
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Brands you can access</p>
          {brands.length === 0 ? (
            <p className="text-xs text-zinc-500">None assigned yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {brands.map(b => (
                <span key={b.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-zinc-200" style={{ background: 'var(--surface-secondary)' }}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.primaryColor || 'var(--portal-accent)' }} />{b.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 p-5 mt-4 flex items-center justify-between" style={{ background: 'var(--surface)' }}>
        <div>
          <p className="text-sm font-medium text-zinc-200">Sign out</p>
          <p className="text-xs text-zinc-500 mt-0.5">End your session on this device.</p>
        </div>
        <form action="/api/portal/logout" method="post">
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-red-400 hover:border-red-500/50 transition-colors">
            Sign out
          </button>
        </form>
      </div>

      <p className="text-[11px] text-zinc-600 mt-4">
        Need access to more brands, or notification preferences? Those are managed by your account contact —
        configurable self-serve settings are on the way.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className="text-sm text-zinc-100 mt-0.5">{value}</p>
    </div>
  )
}
