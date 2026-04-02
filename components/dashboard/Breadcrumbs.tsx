'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  // Build breadcrumb items from path
  const crumbs: { label: string; href: string }[] = []
  let path = ''

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    path += `/${seg}`

    if (seg === 'dashboard') {
      crumbs.push({ label: 'Locations', href: '/dashboard' })
    } else if (segments[i - 1] === 'dashboard') {
      // This is locationId
      crumbs.push({ label: seg.slice(0, 12) + (seg.length > 12 ? '…' : ''), href: path })
    } else if (seg === 'agents') {
      crumbs.push({ label: 'Agents', href: path })
    } else if (segments[i - 1] === 'agents' && seg !== 'new') {
      crumbs.push({ label: 'Agent', href: path })
    } else if (seg === 'new' && segments[i - 1] === 'agents') {
      crumbs.push({ label: 'New Agent', href: path })
    } else if (seg === 'persona') {
      crumbs.push({ label: 'Persona', href: path })
    } else if (seg === 'goals') {
      crumbs.push({ label: 'Goals', href: path })
    } else if (seg === 'follow-ups') {
      crumbs.push({ label: 'Follow-ups', href: path })
    } else if (seg === 'qualifying') {
      crumbs.push({ label: 'Qualifying', href: path })
    } else if (seg === 'logs') {
      crumbs.push({ label: 'Logs', href: path })
    } else if (segments[i - 1] === 'logs') {
      crumbs.push({ label: 'Detail', href: path })
    } else if (seg === 'conversations') {
      crumbs.push({ label: 'Conversations', href: path })
    } else if (seg === 'playground') {
      crumbs.push({ label: 'Playground', href: path })
    } else if (seg === 'onboarding') {
      crumbs.push({ label: 'Onboarding', href: path })
    }
  }

  if (crumbs.length <= 1) return null

  return (
    <div className="flex items-center gap-1.5 px-6 py-3 border-b border-zinc-800/60 text-xs text-zinc-500">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-700">/</span>}
          {i === crumbs.length - 1 ? (
            <span className="text-zinc-300">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-zinc-200 transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </div>
  )
}
