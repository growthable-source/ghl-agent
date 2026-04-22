import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAdminSession, roleHas } from '@/lib/admin-auth'

export const metadata = {
  title: 'Voxility Admin',
  // No robots — this UI should never be indexed.
  robots: { index: false, follow: false },
}

// Force dynamic because getAdminSession reads cookies + DB.
export const dynamic = 'force-dynamic'

/**
 * Every page under /admin shares this layout. Logged-out admins bounce to
 * /admin/login. The login page itself is the only public child — detected
 * via the x-invoke-path header (set by Next.js middleware/internals) or
 * x-matched-path / next-url header fallbacks.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const pathname = h.get('x-invoke-path') ?? h.get('x-matched-path') ?? h.get('next-url') ?? ''
  // Two routes are reachable without a session: the login page (for
  // everyone) and the one-time setup page (for the very first admin).
  // Everything else under /admin/* bounces to /admin/login.
  const isPublicAdminRoute =
    pathname.startsWith('/admin/login') ||
    pathname.startsWith('/admin/setup')

  const session = await getAdminSession()

  if (!session && !isPublicAdminRoute) {
    redirect('/admin/login')
  }

  // Password OK but 2FA pending — bounce to /admin/login so the 2FA
  // phase UI can render. /admin/2fa is ALSO allowed here so someone who
  // just enrolled can reach the setup page.
  if (session && !session.twoFactorVerified && !isPublicAdminRoute && !pathname.startsWith('/admin/2fa')) {
    redirect('/admin/login')
  }

  if (!session || !session.twoFactorVerified) {
    // Login + setup pages render full-bleed without the sidebar.
    return <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>
  }

  return (
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
        <div className="px-4 py-4 border-b border-zinc-800">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
            Voxility
          </p>
          <p className="text-sm font-medium text-zinc-200">Super Admin</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 text-sm">
          <NavLink href="/admin" label="Overview" />
          <NavLink href="/admin/workspaces" label="Workspaces" />
          <NavLink href="/admin/users" label="Users" />
          <NavLink href="/admin/conversations" label="Conversations" />
          <NavLink href="/admin/logs" label="Message logs" />
          <NavLink href="/admin/audit" label="Audit trail" />
          <div className="pt-3 mt-2 border-t border-zinc-800">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Account
            </p>
            <NavLink href="/admin/2fa" label="Two-factor auth" />
            {roleHas(session.role, 'super') && (
              <>
                <NavLink href="/admin/admins" label="Admins" />
                <NavLink href="/admin/settings" label="Settings" />
              </>
            )}
          </div>
        </nav>
        <div className="border-t border-zinc-800 p-3 text-[11px] space-y-1">
          <p className="text-zinc-400 truncate" title={session.email}>
            {session.name ?? session.email}
          </p>
          {session.name && <p className="text-zinc-600 truncate">{session.email}</p>}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
            {session.role}
          </p>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="text-zinc-500 hover:text-red-400 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        {children}
      </main>
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
