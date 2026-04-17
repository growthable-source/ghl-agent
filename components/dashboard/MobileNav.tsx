'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Bottom navigation bar shown on mobile viewports. Quick access to the
 * four highest-frequency actions: Needs Attention, Approvals, Activity,
 * and back to Overview.
 */
export default function MobileNav() {
  const pathname = usePathname()
  const match = pathname.match(/\/dashboard\/([^\/]+)/)
  const workspaceId = match && !['settings', 'new'].includes(match[1]) ? match[1] : null

  if (!workspaceId) return null

  const links = [
    { href: `/dashboard/${workspaceId}`, label: 'Home', icon: '🏠' },
    { href: `/dashboard/${workspaceId}/needs-attention`, label: 'Attention', icon: '⚠️' },
    { href: `/dashboard/${workspaceId}/approvals`, label: 'Approve', icon: '✓' },
    { href: `/dashboard/${workspaceId}/activity`, label: 'Live', icon: '📊' },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-zinc-950/95 backdrop-blur border-t border-zinc-800">
      <div className="flex items-stretch">
        {links.map(link => {
          const active = pathname === link.href || (link.href !== `/dashboard/${workspaceId}` && pathname.startsWith(link.href))
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
              style={{ color: active ? '#fa4d2e' : '#71717a' }}
            >
              <span className="text-lg">{link.icon}</span>
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
