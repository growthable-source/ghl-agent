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
import * as Lucide from 'lucide-react'
import { KpiTile, PageHeader, Pill, StatusBadge } from '@/components/ui/primitives'
import { buttonClass, dataTable } from '@/lib/ui-classes'

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
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'any' | 'live' | 'paused' | 'draft'>('any')

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
      <div className="p-6">
        <div className="h-7 w-48 rounded animate-pulse mb-2 bg-surface-tertiary" />
        <div className="h-4 w-96 rounded animate-pulse bg-surface-tertiary" />
      </div>
    )
  }

  const hasAgents = agents.length > 0
  // Draft = never got a phone number; Live / Paused follow isActive.
  const statusOf = (a: VoiceAgent): 'live' | 'paused' | 'draft' =>
    !a.vapiConfig?.phoneNumber ? 'draft' : a.isActive ? 'live' : 'paused'
  const rows = agents.filter(a =>
    (statusFilter === 'any' || statusOf(a) === statusFilter) &&
    (!query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())))
  const numbers = agents.filter(a => a.vapiConfig?.phoneNumber)
  const MicIcon = Lucide.Mic

  return (
    <div className="p-6 max-w-[1200px] mx-auto w-full space-y-4">
      <PageHeader
        title="Voice agents"
        subtitle={<>AI agents that answer and make phone calls. Text channels live in{' '}
          <Link href={`/dashboard/${workspaceId}/agents`} className="text-brand-500 hover:underline">Text agents</Link>.</>}
        actions={<Link href={`/dashboard/${workspaceId}/voice/new`} className={buttonClass('primary')}>+ New voice agent</Link>}
      />

      {/* TODO(redesign-followup): "Calls · 7d", "Avg. duration", "Booked from calls" tiles and per-agent calls / duration / success / trend columns — no per-agent call aggregates; the recent-calls feed is capped at 10. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiTile label="Live voice agents" value={`${kpi.activeAgents} / ${agents.length}`} />
        <KpiTile label="Minutes this month" value={String(kpi.minutesThisMonth)} suffix="all voice agents" />
        <KpiTile label="Phone numbers" value={String(kpi.phoneNumbers)} suffix="ready for calls" />
      </div>

      {!hasAgents ? (
        <EmptyState workspaceId={workspaceId} />
      ) : (
        <div className="xv-card">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border-theme">
            {/* TODO(redesign-followup): Inbound / Outbound tabs — agents don't record a call direction. */}
            <span className="text-[12px] text-text-tertiary">{rows.length} of {agents.length} agents</span>
            <div className="flex-1" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voice agents…" aria-label="Search voice agents"
              className="h-8 w-[220px] rounded-md border border-border-theme bg-surface px-2.5 text-[12.5px] outline-none focus:border-brand-500" />
            <select aria-label="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-8 rounded-md border border-border-theme bg-surface px-2.5 text-[12.5px] cursor-pointer">
              <option value="any">Status: Any</option>
              <option value="live">Live</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-text-tertiary">No voice agents match.</p>
          ) : (
            <table className={dataTable.table}>
              <thead className={dataTable.thead}>
                <tr>{['Agent', 'Status', 'Phone number', 'Voice'].map(h => <th key={h} className={dataTable.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(a => {
                  const st = statusOf(a)
                  const phone = a.vapiConfig?.phoneNumber
                  const voiceName = a.vapiConfig?.voiceName || a.vapiConfig?.voiceId
                  const engine = a.vapiConfig?.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Built-in'
                  return (
                    <tr key={a.id} className={dataTable.tr()}>
                      <td className={dataTable.td}>
                        {/* Canonical URL for a voice agent is /voice/[id]. */}
                        <Link href={`/dashboard/${workspaceId}/voice/${a.id}`} className="flex items-center gap-3 min-w-0">
                          <span className="h-9 w-9 shrink-0 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center"><MicIcon className="w-4 h-4" strokeWidth={1.8} /></span>
                          <span className="min-w-0">
                            <span className="block font-medium truncate hover:underline">{a.name}</span>
                            {st === 'draft' && <span className="block text-[12px] text-amber-600">No number</span>}
                          </span>
                        </Link>
                      </td>
                      <td className={dataTable.td}><StatusBadge status={st === 'live' ? 'live' : st === 'paused' ? 'paused' : 'draft'} /></td>
                      <td className={`${dataTable.td} font-mono text-[12.5px] ${phone ? 'text-text-primary' : 'text-text-muted'}`}>{phone || 'Not assigned'}</td>
                      <td className={`${dataTable.td} text-text-secondary`}>{voiceName ? `${voiceName} · ${engine}` : 'No voice'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="xv-card">
          <div className="h-11 px-4 flex items-center justify-between border-b border-border-theme">
            <h2 className="text-[14px] font-semibold text-text-primary">Recent calls</h2>
            <Link href={`/dashboard/${workspaceId}/calls`} className="text-[12px] font-medium text-brand-500 hover:text-brand-600">See all →</Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-text-tertiary">No calls yet.</p>
          ) : (
            <ul>
              {recent.slice(0, 6).map(c => {
                const sl = (c.status || '').toLowerCase()
                const tone = sl.includes('success') || sl.includes('completed') || sl.includes('ended') ? 'success' : sl.includes('fail') || sl.includes('error') ? 'danger' : 'neutral'
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border-theme last:border-0">
                    <div className="min-w-0">
                      <p className="font-mono text-[12.5px] truncate text-text-primary">{c.callerPhone || 'Unknown number'}</p>
                      <p className="text-[12px] text-text-tertiary truncate">{c.agentName} · {formatDuration(c.durationSec)} · {formatRelative(c.createdAt)}</p>
                    </div>
                    <Pill tone={tone}>{c.status || 'unknown'}</Pill>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="xv-card">
          <div className="h-11 px-4 flex items-center border-b border-border-theme">
            <h2 className="text-[14px] font-semibold text-text-primary">Phone numbers</h2>
          </div>
          {numbers.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-text-tertiary">No numbers assigned yet.</p>
          ) : (
            <ul>
              {numbers.map(a => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border-theme last:border-0">
                  <span className="font-mono text-[12.5px] text-text-primary">{a.vapiConfig?.phoneNumber}</span>
                  <Link href={`/dashboard/${workspaceId}/voice/${a.id}`} className="text-[13px] text-text-secondary hover:underline truncate">→ {a.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function EmptyState({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="xv-card px-8 py-12 text-center">
      <h2 className="text-[15px] font-semibold text-text-primary mb-1">No voice agents yet</h2>
      <p className="text-[13px] max-w-md mx-auto mb-5 text-text-tertiary">
        Build a voice agent in under five minutes. Pick a use case, a voice, a phone number, and you&apos;re live.
      </p>
      <Link href={`/dashboard/${workspaceId}/voice/new`} className={buttonClass('primary')}>+ New voice agent</Link>
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
