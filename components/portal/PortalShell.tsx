'use client'

/**
 * Client wrapper for the signed-in portal shell. When the portal runs
 * inside the LeadConnector menu (?embedded=leadconnector + iframe,
 * detected by EmbeddedProvider), the vertical sidebar is swapped for a
 * compact horizontal tab bar — the host app already provides the outer
 * chrome, and a 240px sidebar wastes most of a menu iframe.
 */

import { EmbeddedProvider, useEmbedded } from '@/lib/embedded-context'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const EMBED_TABS = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/conversations', label: 'Live Chats' },
  { href: '/portal/locations', label: 'Locations' },
  { href: '/portal/tickets', label: 'Tickets' },
  { href: '/portal/reports', label: 'Reports' },
  { href: '/portal/settings', label: 'Settings' },
]

function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const { embedded } = useEmbedded()
  const pathname = usePathname()

  if (!embedded) {
    return (
      <>
        {sidebar}
        <main className="flex-1 min-w-0">{children}</main>
      </>
    )
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <nav className="flex gap-1 border-b border-zinc-800 px-3 pt-2 text-sm overflow-x-auto">
        {EMBED_TABS.map(t => {
          const active = t.href === '/portal' ? pathname === '/portal' : pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`whitespace-nowrap rounded-t-lg px-3 py-2 ${
                active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}

export default function PortalShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <EmbeddedProvider>
      <Shell sidebar={sidebar}>{children}</Shell>
    </EmbeddedProvider>
  )
}
