import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

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
    return <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>
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
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      <aside className="w-60 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-4 border-b border-zinc-800">
          {portal?.logoUrl ? (
            <img src={portal.logoUrl} alt={portal.name} className="h-8 mb-2" />
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Customer Portal
          </p>
          <p className="text-sm font-medium text-zinc-100 truncate">{portal?.name ?? 'Portal'}</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 text-sm">
          <NavLink href="/portal" label="Overview" />
          <NavLink href="/portal/conversations" label="Conversations" />
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
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block px-3 py-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
    >
      {label}
    </Link>
  )
}
