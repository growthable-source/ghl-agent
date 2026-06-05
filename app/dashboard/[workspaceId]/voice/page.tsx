'use client'

/**
 * Voice agents — dedicated section landing page.
 *
 * The voice surface used to be a sub-tab on text agents. As of
 * 2026-06-06 it's a top-level section with its own sidebar entry,
 * its own list page, and its own wizard. This page is the list.
 *
 * Reads the same /api/workspaces/<wsId>/agents endpoint as the text
 * agents page, then narrows to agentType==='VOICE'. Each card shows
 * the agent's phone number prominently (the thing operators actually
 * care about on a voice agent) and last-call recency.
 *
 * Phase E of the voice overhaul. Header + KPI strip + grid + recent
 * activity feed below.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface VoiceAgent {
  id: string
  name: string
  isActive: boolean
  agentType: string
  vapiConfig?: {
    voiceName?: string | null
    voiceId?: string | null
    phoneNumber?: string | null
    ttsProvider?: string | null
    isActive?: boolean
  } | null
  routingRules?: unknown[]
}

interface RecentCall {
  id: string
  agentId: string
  agentName: string
  callerPhone: string | null
  status: string | null
  durationSec: number | null
  createdAt: string
}

interface KpiSummary {
  activeAgents: number
  minutesThisMonth: number
  phoneNumbers: number
}

export default function VoiceAgentsListPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [agents, setAgents] = useState<VoiceAgent[]>([])
  const [recent, setRecent] = useState<RecentCall[]>([])
  const [kpi, setKpi] = useState<KpiSummary>({ activeAgents: 0, minutesThisMonth: 0, phoneNumbers: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents`)
        const data = await res.json()
        if (cancelled) return
        const voiceAgents: VoiceAgent[] = (data.agents || []).filter(
          (a: VoiceAgent) => a.agentType === 'VOICE',
        )
        setAgents(voiceAgents)

        // KPI: active agents (isActive AND have a vapiAssistant active),
        // unique phone numbers across configs.
        const activeAgents = voiceAgents.filter(a => a.isActive && a.vapiConfig?.isActive).length
        const phoneNumbers = new Set(
          voiceAgents
            .map(a => a.vapiConfig?.phoneNumber)
            .filter((p): p is string => !!p),
        ).size
        setKpi(prev => ({ ...prev, activeAgents, phoneNumbers }))
      } catch (err) {
        console.error('Failed to load voice agents:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }

      // Recent calls + minutes-this-month — best-effort. If the
      // endpoint isn't there or returns an error, we just skip
      // (the KPI card falls back to 0 and the feed stays empty).
      try {
        const callsRes = await fetch(`/api/workspaces/${workspaceId}/calls?limit=10`)
        if (callsRes.ok) {
          const data = await callsRes.json()
          if (!cancelled && Array.isArray(data.calls)) {
            setRecent(data.calls.slice(0, 10))
            const minutes = data.calls
              .filter((c: RecentCall) => isThisMonth(c.createdAt))
              .reduce((acc: number, c: RecentCall) => acc + Math.ceil((c.durationSec || 0) / 60), 0)
            setKpi(prev => ({ ...prev, minutesThisMonth: minutes }))
          }
        }
      } catch {
        /* swallow */
      }
    }
    load()
    return () => { cancelled = true }
  }, [workspaceId])

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 rounded animate-pulse mb-2" style={{ background: 'var(--surface-tertiary)' }} />
        <div className="h-4 w-96 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
    )
  }

  const hasAgents = agents.length > 0

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto w-full">
      {/* Hero header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
              style={{
                background: 'linear-gradient(135deg, #fa4d2e 0%, #fb8e6a 100%)',
                boxShadow: '0 8px 24px -8px rgba(250, 77, 46, 0.45)',
              }}
              aria-hidden
            >
              🎤
            </div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Voice agents
            </h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Inbound and outbound phone calls — fully managed. Each voice agent gets a phone number, a voice,
            and a system prompt, and shows up here.
          </p>
        </div>
        <Link
          href={`/dashboard/${workspaceId}/voice/new`}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors hover:opacity-90"
          style={{ background: '#fa4d2e', color: '#fff', boxShadow: '0 10px 30px -10px rgba(250,77,46,0.4)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New voice agent
        </Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <KpiCard label="Active voice agents" value={String(kpi.activeAgents)} hint={`of ${agents.length} total`} />
        <KpiCard label="Minutes this month" value={String(kpi.minutesThisMonth)} hint="across all voice agents" />
        <KpiCard label="Active phone numbers" value={String(kpi.phoneNumbers)} hint="ready to receive calls" />
      </div>

      {/* Agent grid or empty state */}
      {!hasAgents ? (
        <EmptyState workspaceId={workspaceId} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {agents.map(a => (
            <VoiceAgentCard key={a.id} agent={a} workspaceId={workspaceId} />
          ))}
        </div>
      )}

      {/* Recent activity */}
      {recent.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Recent calls
            </h2>
            <Link
              href={`/dashboard/${workspaceId}/calls`}
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              See all calls →
            </Link>
          </div>
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {recent.map((c, i) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={i > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: 'var(--surface-secondary)' }} aria-hidden>
                    📞
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {c.callerPhone || 'Unknown number'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {c.agentName} · {formatDuration(c.durationSec)} · {formatRelative(c.createdAt)}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-medium" style={{ color: callStatusColour(c.status) }}>
                  {c.status || 'unknown'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Bits ────────────────────────────────────────────────────────────

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-xl px-4 py-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
    </div>
  )
}

function VoiceAgentCard({ agent, workspaceId }: { agent: VoiceAgent; workspaceId: string }) {
  const phone = agent.vapiConfig?.phoneNumber
  const voiceName = agent.vapiConfig?.voiceName || agent.vapiConfig?.voiceId || 'No voice'
  const engine = agent.vapiConfig?.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Built-in'
  // Canonical URL for a voice agent is /voice/[id] — the dedicated
  // surface with its own layout, breadcrumb, and tab strip. Old
  // /agents/[id]/voice URLs still resolve (the agents layout redirects
  // voice-typed agents) but new card clicks should land at the
  // canonical home page.
  return (
    <Link
      href={`/dashboard/${workspaceId}/voice/${agent.id}`}
      className="rounded-xl p-4 block transition-colors hover:opacity-95"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
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
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {agent.name}
            </p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
              {engine} · {voiceName}
            </p>
          </div>
        </div>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
          style={
            agent.isActive
              ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
              : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }
          }
        >
          {agent.isActive ? 'Live' : 'Paused'}
        </span>
      </div>
      <div
        className="rounded-lg px-3 py-2 text-xs font-medium"
        style={{
          background: 'var(--surface-secondary)',
          color: phone ? 'var(--text-primary)' : 'var(--text-tertiary)',
          letterSpacing: phone ? '0.02em' : undefined,
        }}
      >
        {phone || 'No phone number yet — open agent to add one'}
      </div>
    </Link>
  )
}

function EmptyState({ workspaceId }: { workspaceId: string }) {
  return (
    <div
      className="rounded-2xl px-8 py-12 text-center mb-10"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-4"
        style={{
          background: 'linear-gradient(135deg, #fa4d2e 0%, #fb8e6a 100%)',
          boxShadow: '0 12px 30px -10px rgba(250,77,46,0.4)',
        }}
        aria-hidden
      >
        🎤
      </div>
      <h2 className="font-semibold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>
        No voice agents yet
      </h2>
      <p className="text-sm max-w-md mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
        Build a voice agent in under five minutes. Pick a use case, a voice, a phone number, and you&apos;re live.
      </p>
      <Link
        href={`/dashboard/${workspaceId}/voice/new`}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
        style={{ background: '#fa4d2e', color: '#fff' }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        New voice agent
      </Link>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────

function isThisMonth(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()
}

function formatDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m${s ? ` ${s}s` : ''}`
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

function callStatusColour(status: string | null): string {
  if (!status) return 'var(--text-tertiary)'
  const s = status.toLowerCase()
  if (s.includes('success') || s.includes('completed') || s.includes('ended')) return 'var(--accent-emerald)'
  if (s.includes('failed') || s.includes('error')) return '#ef4444'
  return 'var(--text-secondary)'
}
