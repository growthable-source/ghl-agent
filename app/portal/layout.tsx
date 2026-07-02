import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPortalSession } from '@/lib/portal-auth'
import { getPortalBranding } from '@/lib/portal-branding'
import { db } from '@/lib/db'
import NewBadge from '@/components/NewBadge'
import PortalShell from '@/components/portal/PortalShell'

export const metadata = {
  title: 'Customer Portal',
  // Don't index portal-facing surfaces. Each portal has its own customer
  // audience; search engines have no business there.
  robots: { index: false, follow: false },
}

// Cookies + DB lookups make this layout intrinsically dynamic.
export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const host = h.get('host')
  const pathname = h.get('x-invoke-path') ?? h.get('x-matched-path') ?? h.get('next-url') ?? ''
  // Login + invite-acceptance are the only routes reachable without
  // a session. Everything else under /portal/* bounces to /portal/login.
  const isPublicPortalRoute =
    pathname.startsWith('/portal/login') ||
    pathname.startsWith('/portal/invite')

  const session = await getPortalSession()
  if (!session && !isPublicPortalRoute) {
    redirect('/portal/login')
  }

  if (!session) {
    // Pre-login (login / invite pages): brand the accent by custom domain.
    const branding = await getPortalBranding(host)
    return (
      <div
        className="min-h-screen bg-zinc-950 text-zinc-100"
        style={{ ['--portal-accent']: branding?.primaryColor || '#fbbf24' } as React.CSSProperties}
      >
        {children}
      </div>
    )
  }

  // Pull the portal name + the user's brands for the sidebar.
  const portal = await db.portal.findUnique({
    where: { id: session.portalId },
    select: { name: true, primaryColor: true, logoUrl: true },
  })
  const brands = session.brandIds.length > 0
    ? await db.brand.findMany({
        where: { id: { in: session.brandIds } },
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      })
    : []

  return (
    <div
      className="min-h-screen flex bg-zinc-950 text-zinc-100"
      style={{ ['--portal-accent']: portal?.primaryColor || '#fbbf24' } as React.CSSProperties}
    >
      <PortalShell
        sidebar={
      <aside className="w-60 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-4 border-b border-zinc-800">
          {portal?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={portal.logoUrl} alt={portal.name} className="h-8 mb-2" />
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--portal-accent)]">
            Customer Portal
          </p>
          <p className="text-sm font-medium text-zinc-100 truncate">{portal?.name ?? 'Portal'}</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 text-sm">
          <NavLink href="/portal" label="Overview" icon="grid" />
          <NavLink href="/portal/conversations" label="Live Chats" icon="chat" />
          <NavLink href="/portal/locations" label="Locations" icon="pin" isNew />
          <NavLink href="/portal/tickets" label="Tickets" icon="ticket" />
          <NavLink href="/portal/reports" label="Reports" icon="chart" />
          <NavLink href="/portal/settings" label="Settings" icon="gear" />
          {brands.length > 0 && (
            <div className="pt-3 mt-2 border-t border-zinc-800">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Your brands
              </p>
              {brands.map(b => (
                <NavLink
                  key={b.id}
                  href={`/portal/conversations?brand=${b.slug}`}
                  label={b.name}
                />
              ))}
            </div>
          )}
        </nav>
        <div className="border-t border-zinc-800 p-3 text-[11px] space-y-1">
          <p className="text-zinc-300 truncate">{session.name ?? session.email}</p>
          {session.name && <p className="text-zinc-500 truncate">{session.email}</p>}
          <form action="/api/portal/logout" method="post">
            <button
              type="submit"
              className="text-zinc-500 hover:text-red-400 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
        }
      >
        {children}
      </PortalShell>
    </div>
  )
}

const NAV_ICONS: Record<string, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  ticket: <><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" /><path d="M13 5v14" strokeDasharray="2 2" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  pin: <><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
}

function NavLink({ href, label, icon, isNew }: { href: string; label: string; icon?: string; isNew?: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
    >
      {icon && (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {NAV_ICONS[icon]}
        </svg>
      )}
      {label}
      {isNew && <NewBadge since="2026-07-02" className="ml-1" />}
    </Link>
  )
}
