'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { siblingsFor } from '@/lib/dashboard-nav'

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
  wins: 'Objectives',
  'follow-ups': 'Follow-ups',
  qualifying: 'Qualifying',
  logs: 'Logs',
  conversations: 'Conversations',
  playground: 'Playground',
  onboarding: 'Onboarding',
  feedback: 'Feedback',
  activity: 'Live Activity',
  'needs-attention': 'Needs Attention',
  'next-actions': 'Next Actions',
  approvals: 'Approvals',
  insights: 'Insights',
  performance: 'Performance',
  digest: 'Weekly Digest',
  corrections: 'Corrections',
  'audit-log': 'Audit Log',
  consent: 'Consent',
  templates: 'Templates',
  billing: 'Billing',
  'routing-diagnostic': 'Routing Diagnostic',
  'prompt-versions': 'Prompt History',
  evaluations: 'Evaluations',
  'working-hours': 'Working Hours',
  contacts: 'Contact',
  replay: 'Replay',
  widgets: 'Chat Widgets',
  inbox: 'Inbox',
  // Native CRM
  lists: 'Lists',
  imports: 'Imports',
  suppressions: 'Suppressions',
  'custom-fields': 'Custom Fields',
}

// Reserved segments that are NOT a workspaceId
const NON_WORKSPACE_DASHBOARD_SEGMENTS = new Set(['new', 'settings', 'feedback', 'onboarding'])

export default function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  // Extract workspaceId + agentId from path (if present)
  const wsIndex = segments.indexOf('dashboard')
  const rawWorkspaceSeg = wsIndex >= 0 ? segments[wsIndex + 1] : null
  const workspaceId = rawWorkspaceSeg && !NON_WORKSPACE_DASHBOARD_SEGMENTS.has(rawWorkspaceSeg) ? rawWorkspaceSeg : null

  const agentsIdx = segments.indexOf('agents')
  const agentId = agentsIdx >= 0 && segments[agentsIdx + 1] && segments[agentsIdx + 1] !== 'new'
    ? segments[agentsIdx + 1]
    : null

  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [agentName, setAgentName] = useState<string | null>(null)

  // Fetch workspace name (once per workspaceId change)
  useEffect(() => {
    if (!workspaceId) { setWorkspaceName(null); return }
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => {
        const ws = data.workspaces?.find((w: any) => w.id === workspaceId)
        if (ws) setWorkspaceName(ws.name)
      })
      .catch(() => {})
  }, [workspaceId])

  // Fetch agent name (once per agentId change)
  useEffect(() => {
    if (!workspaceId || !agentId) { setAgentName(null); return }
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(data => {
        if (data.agent?.name) setAgentName(data.agent.name)
      })
      .catch(() => {})
  }, [workspaceId, agentId])

  // Build breadcrumb items from path
  const crumbs: { label: string; href: string }[] = []
  let path = ''

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    path += `/${seg}`

    if (seg === 'dashboard') {
      // Inside a workspace the workspace name is the root crumb (handoff
      // TopBar); the generic "Workspaces" root only shows on /dashboard/*.
      if (!workspaceId) crumbs.push({ label: 'Workspaces', href: '/dashboard' })
    } else if (segments[i - 1] === 'dashboard') {
      // This is the workspaceId (or a reserved segment like "new" / "settings")
      if (NON_WORKSPACE_DASHBOARD_SEGMENTS.has(seg)) {
        crumbs.push({ label: ROUTE_LABELS[seg] || seg, href: path })
      } else {
        crumbs.push({
          label: workspaceName || 'Workspace',
          href: path,
        })
      }
    } else if (segments[i - 1] === 'agents' && seg !== 'new') {
      crumbs.push({ label: agentName || 'Agent', href: path })
    } else if (segments[i - 1] === 'contacts') {
      // Contact ID — show last 8 chars so it's identifiable but short
      crumbs.push({ label: seg.slice(-8), href: path })
    } else if (segments[i - 1] === 'replay') {
      crumbs.push({ label: 'Message', href: path })
    } else if (segments[i - 1] === 'logs' && !ROUTE_LABELS[seg]) {
      crumbs.push({ label: 'Detail', href: path })
    } else if (ROUTE_LABELS[seg]) {
      crumbs.push({ label: ROUTE_LABELS[seg], href: path })
    }
  }

  if (crumbs.length <= 1 && !(workspaceId && siblingsFor(pathname, workspaceId).length)) return null

  // Sibling pages of the current nav item (e.g. Live ops → Queue / Logs /
  // Live activity). Stands in for the Phase 5 tabs so legacy pages that
  // no longer have their own sidebar entry stay reachable.
  const tabs = workspaceId ? siblingsFor(pathname, workspaceId) : []

  return (
    <div className="shrink-0 bg-surface border-b border-border-theme">
      <div className="h-14 flex items-center gap-1.5 px-6 text-[13px] text-text-tertiary">
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-text-muted">/</span>}
            {i === crumbs.length - 1 ? (
              <span className="text-text-primary font-medium">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="hover:text-text-primary transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
        {/* TODO(redesign-followup): bell / date-range segmented control / Live pill in the right-hand actions (need a notifications source). */}
      </div>
      {tabs.length > 1 && (
        <nav aria-label="Related pages" className="flex items-center gap-5 px-6 -mt-1">
          {tabs.map(t => (
            <Link
              key={t.path}
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={`-mb-px h-9 inline-flex items-center text-[13px] font-medium border-b-2 transition-colors ${
                t.active
                  ? 'border-brand-500 text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-primary'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
