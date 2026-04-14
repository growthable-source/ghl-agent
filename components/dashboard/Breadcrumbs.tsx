'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ROUTE_LABELS: Record<string, string> = {
  agents: 'Agents',
  new: 'New Agent',
  settings: 'Settings',
  integrations: 'Integrations',
  calls: 'Calls',
  deploy: 'Channels',
  triggers: 'Triggers',
  tools: 'Tools',
  knowledge: 'Knowledge',
  rules: 'Rules',
  voice: 'Voice',
  persona: 'Persona',
  goals: 'Goals',
  'follow-ups': 'Follow-ups',
  qualifying: 'Qualifying',
  logs: 'Logs',
  conversations: 'Conversations',
  playground: 'Playground',
  onboarding: 'Onboarding',
  feedback: 'Feedback',
}

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
      crumbs.push({ label: 'Workspaces', href: '/dashboard' })
    } else if (segments[i - 1] === 'dashboard') {
      // This is workspaceId
      crumbs.push({ label: seg.slice(0, 12) + (seg.length > 12 ? '...' : ''), href: path })
    } else if (segments[i - 1] === 'agents' && seg !== 'new') {
      // This is an agentId
      crumbs.push({ label: 'Agent', href: path })
    } else if (segments[i - 1] === 'logs' && !ROUTE_LABELS[seg]) {
      // Log detail page (dynamic id)
      crumbs.push({ label: 'Detail', href: path })
    } else if (ROUTE_LABELS[seg]) {
      crumbs.push({ label: ROUTE_LABELS[seg], href: path })
    }
  }

  if (crumbs.length <= 1) return null

  return (
    <div className="flex items-center gap-1.5 px-6 py-3 border-b border-zinc-800/60 text-xs text-zinc-500">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-700">/</span>}
          {i === crumbs.length - 1 ? (
            <span className="text-zinc-200 font-medium">{crumb.label}</span>
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
