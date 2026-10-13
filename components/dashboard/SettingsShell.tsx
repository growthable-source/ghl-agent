'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { SETTINGS_NAV, settingsItemActive, workspaceRest } from '@/lib/dashboard-nav'
import { SectionLabel } from '@/components/ui/primitives'

/**
 * Settings shell (handoff §2): 220px grouped settings nav + content column.
 * Mounted from app/dashboard/[workspaceId]/settings/layout.tsx, so every
 * existing settings page keeps its URL and content and simply gains the nav.
 * Entries that live outside /settings (Integrations, Audit log, Consent)
 * link to their existing routes; Phase 5 moves them under the shell.
 */
export default function SettingsShell({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const rest = workspaceRest(pathname, workspaceId) ?? ''
  const currentTab = useSearchParams().get('tab')

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="hidden md:block w-[220px] shrink-0 border-r border-border-theme bg-surface px-3 py-5 overflow-y-auto">
        <h2 className="px-2.5 pb-3 text-[20px] font-semibold tracking-tight text-text-primary">Settings</h2>
        {SETTINGS_NAV.map(group => (
          <div key={group.group} className="mb-4">
            <SectionLabel className="px-2.5 pb-1.5">{group.group}</SectionLabel>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = settingsItemActive(rest, item.path, item.tab, currentTab)
                return (
                  <Link
                    key={`${item.path}:${item.tab ?? ''}`}
                    href={`/dashboard/${workspaceId}${item.path}${item.tab ? `?tab=${item.tab}` : ''}`}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center h-[30px] px-2.5 rounded-md text-[13px] transition-colors ${
                      active
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </aside>
      <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
    </div>
  )
}
