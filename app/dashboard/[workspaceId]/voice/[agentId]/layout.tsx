'use client'

/**
 * Voice agent detail layout — the real dedicated surface.
 *
 * URL canonical for voice agents is `/dashboard/[wsId]/voice/[agentId]/...`.
 * This layout owns the voice-flavoured chrome: back-link to /voice
 * (not /agents), agent name + status pill, Test/Pause buttons, and a
 * voice-specific single-row tab strip.
 *
 * Sub-pages are mostly thin client-component re-exports of the
 * existing agents/[agentId]/* surfaces (knowledge, skills, etc.) —
 * same content, voice-flavoured chrome.
 *
 * Guard: if a non-VOICE agent ends up here (someone deep-linked a
 * text-agent id under /voice/...), we redirect to the text detail at
 * /agents/[id]/identity.
 */

import { useEffect, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import * as Lucide from 'lucide-react'
import { SplitDeployButton, StatusBadge } from '@/components/ui/primitives'
import { cx } from '@/lib/ui-classes'

type Tab = { key: string; label: string; path: string }

// The four things a non-technical operator actually reaches for. Plain
// language: "Configuration" → "Voice & Script". Everything else lives
// under the Advanced menu so this row stays focused.
const PRIMARY_TABS: Tab[] = [
  { key: 'overview',      label: 'Overview',       path: '' },
  { key: 'configuration', label: 'Voice & Script', path: '/configuration' },
  { key: 'knowledge',     label: 'Knowledge',      path: '/knowledge' },
  { key: 'calls',         label: 'Calls',          path: '/calls' },
]

// Power-user surfaces — reachable, just not front-and-centre. These are
// the same shared re-export pages as before; we only moved where they
// appear in the strip.
const ADVANCED_TABS: Tab[] = [
  { key: 'skills',   label: 'Skills',      path: '/skills' },
  { key: 'triggers', label: 'When to run', path: '/triggers' },
  { key: 'identity', label: 'Identity',    path: '/identity' },
]

// Used by resolveActiveTab — must cover every routable sub-page so
// active-state highlighting resolves for Advanced pages too.
const TABS: Tab[] = [...PRIMARY_TABS, ...ADVANCED_TABS]

function resolveActiveTab(suffix: string): Tab {
  const trimmed = suffix === '/' ? '' : suffix
  // Exact match first ('', '/configuration', '/knowledge', etc.)
  const exact = TABS.find(t => t.path === trimmed)
  if (exact) return exact
  // Prefix match for nested routes ('/replay/abc' under '/calls'?).
  // Longest-match wins so '/knowledge/overview' resolves to knowledge,
  // not the empty-path overview tab.
  const prefix = TABS
    .filter(t => t.path !== '' && trimmed.startsWith(t.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (prefix) return prefix
  return TABS[0]
}

export default function VoiceAgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/voice/${agentId}`

  const [agent, setAgent] = useState<{ name: string; isActive: boolean; agentType: string; phone: string | null } | null>(null)
  const [toggling, setToggling] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.agent) return
        const a = data.agent
        const next = {
          name: a.name as string,
          isActive: !!a.isActive,
          agentType: typeof a.agentType === 'string' ? a.agentType : 'SIMPLE',
          phone: typeof a.vapiConfig?.phoneNumber === 'string' ? a.vapiConfig.phoneNumber : null,
        }
        // Guard: non-voice agents shouldn't be at /voice/[id]/* —
        // bounce them to the text-agent detail to keep IA consistent.
        if (next.agentType !== 'VOICE') {
          router.replace(`/dashboard/${workspaceId}/agents/${agentId}`)
          return
        }
        setAgent(next)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, agentId, router])

  async function toggleActive() {
    if (!agent) return
    setToggling(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !agent.isActive }),
    })
    const { agent: updated } = await res.json()
    setAgent(a => a ? { ...a, isActive: updated.isActive } : a)
    setToggling(false)
  }

  const suffix = pathname.replace(base, '')
  const activeTab = resolveActiveTab(suffix)
  const activeIsAdvanced = ADVANCED_TABS.some(t => t.key === activeTab.key)

  const MicIcon = Lucide.Mic
  return (
    <div className="flex flex-col h-full">
      {/* Header: mic tile · name + status · meta  |  actions */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 shrink-0 bg-surface border-b-0">
        <div className="flex items-center gap-3 min-w-0">
          {agent ? (
            <>
              <span className="h-11 w-11 shrink-0 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                <MicIcon className="w-5 h-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-[20px] leading-tight font-semibold tracking-tight text-text-primary truncate">{agent.name}</h1>
                  <StatusBadge status={agent.isActive ? 'live' : 'paused'} />
                </div>
                <p className="mt-0.5 text-[12px] text-text-tertiary truncate">
                  Voice agent{agent.phone ? <> · <span className="font-mono">{agent.phone}</span></> : null}
                  {/* TODO(redesign-followup): version + "draft changes" chip, as on text agents — voice config has no draft state. */}
                </p>
              </div>
            </>
          ) : (
            <div className="h-11 w-56 rounded-lg animate-pulse bg-surface-tertiary" />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`${base}/configuration`} className="inline-flex items-center h-8 px-3 rounded-md border border-border-theme bg-surface text-[12.5px] font-medium text-text-primary hover:bg-surface-secondary">
            ▷ Test call
          </Link>
          <SplitDeployButton
            label={agent?.isActive ? 'Pause' : 'Activate'}
            variant={agent?.isActive ? 'secondary' : 'primary'}
            busy={toggling}
            disabled={!agent}
            onClick={toggleActive}
            items={[
              { label: 'Voice & script…', hint: 'Voice, prompt and phone number', href: `${base}/configuration` },
              { label: 'Schedule…', hint: 'Coming soon', disabled: true },
            ]}
          />
        </div>
      </div>

      {/* Underline tabs — primary tabs + an Advanced menu for power-user pages. */}
      <div className="flex items-stretch px-6 shrink-0 bg-surface border-b border-border-theme">
        <div className="flex items-stretch gap-5 overflow-x-auto min-w-0 flex-1">
          {PRIMARY_TABS.map(t => {
            const isActive = activeTab.key === t.key
            return (
              <Link
                key={t.key}
                href={`${base}${t.path}`}
                aria-current={isActive ? 'page' : undefined}
                className={cx('-mb-px h-10 inline-flex items-center whitespace-nowrap text-[13px] font-medium border-b-2 transition-colors',
                  isActive ? 'border-brand-500 text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-primary')}
              >
                {t.label}
              </Link>
            )
          })}

          {/* Advanced menu — Skills / When to run / Identity */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdvancedOpen(o => !o)}
              className={cx('-mb-px h-10 inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium border-b-2 transition-colors cursor-pointer',
                activeIsAdvanced ? 'border-brand-500 text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-primary')}
            >
              Advanced <span aria-hidden className="text-[10px]">▾</span>
            </button>
            {advancedOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAdvancedOpen(false)} />
                <div className="absolute left-0 top-10 z-20 xv-card shadow-xl py-1 min-w-[170px]">
                  {ADVANCED_TABS.map(t => {
                    const isActive = activeTab.key === t.key
                    return (
                      <Link
                        key={t.key}
                        href={`${base}${t.path}`}
                        onClick={() => setAdvancedOpen(false)}
                        className={cx('block px-3 py-2 text-[12.5px] font-medium hover:bg-surface-secondary', isActive ? 'text-brand-600' : 'text-text-secondary')}
                      >
                        {t.label}
                      </Link>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
