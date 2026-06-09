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

  const [agent, setAgent] = useState<{ name: string; isActive: boolean; agentType: string } | null>(null)
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-6 pb-0 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/dashboard/${workspaceId}/voice`}
            className="transition-colors text-sm shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ← Voice agents
          </Link>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          {agent ? (
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0"
                style={{
                  background: agent.isActive
                    ? 'linear-gradient(135deg, #fa4d2e 0%, #fb8e6a 100%)'
                    : 'var(--surface-secondary)',
                  color: agent.isActive ? '#fff' : 'var(--text-tertiary)',
                }}
                aria-hidden
              >
                🎤
              </div>
              <h1 className="text-lg font-semibold tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
                {agent.name}
              </h1>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium shrink-0"
                style={
                  agent.isActive
                    ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                    : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: agent.isActive ? 'var(--accent-emerald)' : 'var(--text-tertiary)' }}
                />
                {agent.isActive ? 'Live' : 'Paused'}
              </span>
            </div>
          ) : (
            <div className="h-5 w-32 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleActive}
            disabled={toggling || !agent}
            title={agent?.isActive ? 'Pause this voice agent' : 'Activate this voice agent'}
            className="text-xs border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            style={
              agent?.isActive
                ? { color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                : { color: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)' }
            }
          >
            {toggling ? '...' : agent?.isActive ? 'Pause' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Tab strip — primary tabs + an Advanced menu for power-user pages. */}
      <div className="flex items-stretch px-8 mt-4 shrink-0">
        <div className="flex items-stretch gap-0 overflow-x-auto min-w-0 flex-1">
          {PRIMARY_TABS.map(t => {
            const isActive = activeTab.key === t.key
            return (
              <Link
                key={t.key}
                href={`${base}${t.path}`}
                className="relative px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors"
                style={isActive
                  ? { color: 'var(--accent-primary)' }
                  : { color: 'var(--text-tertiary)' }
                }
              >
                {t.label}
                {isActive && (
                  <span
                    className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                    style={{ background: 'var(--accent-primary)' }}
                  />
                )}
              </Link>
            )
          })}

          {/* Advanced menu — Skills / When to run / Identity */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdvancedOpen(o => !o)}
              className="relative px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors inline-flex items-center gap-1"
              style={activeIsAdvanced
                ? { color: 'var(--accent-primary)' }
                : { color: 'var(--text-tertiary)' }
              }
            >
              Advanced
              <span aria-hidden style={{ fontSize: '0.6rem' }}>▾</span>
              {activeIsAdvanced && (
                <span
                  className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                  style={{ background: 'var(--accent-primary)' }}
                />
              )}
            </button>
            {advancedOpen && (
              <>
                {/* click-away catcher */}
                <div className="fixed inset-0 z-10" onClick={() => setAdvancedOpen(false)} />
                <div
                  className="absolute right-0 mt-1 z-20 rounded-lg border py-1 min-w-[160px] shadow-lg"
                  style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                >
                  {ADVANCED_TABS.map(t => {
                    const isActive = activeTab.key === t.key
                    return (
                      <Link
                        key={t.key}
                        href={`${base}${t.path}`}
                        onClick={() => setAdvancedOpen(false)}
                        className="block px-3 py-2 text-xs font-medium transition-colors"
                        style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
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

      <div className="shrink-0">
        <div className="h-px" style={{ background: 'var(--border)' }} />
      </div>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
