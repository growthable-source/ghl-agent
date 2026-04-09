'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardSidebar() {
  const pathname = usePathname()

  // Extract locationId from path — exclude known static routes
  const STATIC_ROUTES = ['settings', 'new']
  const match = pathname.match(/\/dashboard\/([^\/]+)/)
  const rawSegment = match ? match[1] : null
  const locationId = rawSegment && !STATIC_ROUTES.includes(rawSegment) ? rawSegment : null

  // Don't show location nav for these sub-pages
  const isOnboarding = pathname.includes('/onboarding')

  if (isOnboarding) return null

  function navLink(href: string, label: string) {
    const active = pathname === href || (href !== `/dashboard/${locationId}` && pathname.startsWith(href))
    return (
      <Link
        href={href}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          active
            ? 'bg-zinc-800 text-white'
            : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
        }`}
      >
        {label}
      </Link>
    )
  }

  return (
    <div className="w-56 shrink-0 border-r border-sidebar-border flex flex-col h-full bg-sidebar-bg">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-zinc-800">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-6 h-6 bg-white rounded flex items-center justify-center">
            <span className="text-black text-xs font-bold">V</span>
          </div>
          <span className="font-semibold text-sm text-white">Voxility</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {!locationId || locationId === 'undefined' ? (
          // Top-level nav
          <>
            {navLink('/dashboard', 'All Locations')}
          </>
        ) : (
          // Location-level nav
          <>
            <div className="px-3 py-1.5 mb-1">
              <p className="text-xs text-zinc-600 font-medium truncate" title={locationId}>
                {locationId.slice(0, 20)}{locationId.length > 20 ? '…' : ''}
              </p>
            </div>
            {!isOnboarding && (
              <>
                {navLink(`/dashboard/${locationId}`, 'Overview')}
                {navLink(`/dashboard/${locationId}/playground`, 'Playground')}
                {navLink(`/dashboard/${locationId}/logs`, 'Logs')}
                {navLink(`/dashboard/${locationId}/conversations`, 'Conversations')}
                {navLink(`/dashboard/${locationId}/calls`, 'Calls')}
                {navLink(`/dashboard/${locationId}/integrations`, 'Integrations')}
              </>
            )}
          </>
        )}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-zinc-800 space-y-0.5">
        <Link
          href="/dashboard/settings"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
            pathname === '/dashboard/settings'
              ? 'bg-zinc-800 text-white'
              : 'text-zinc-500 hover:text-white hover:bg-zinc-900'
          }`}
        >
          Settings
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-white transition-colors"
        >
          ← All Locations
        </Link>
      </div>
    </div>
  )
}
