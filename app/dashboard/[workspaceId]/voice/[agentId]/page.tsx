'use client'

/**
 * Voice agent — Overview page.
 *
 * The dedicated landing for a single voice agent. Tells the operator
 * the three things they actually need at a glance:
 *
 *   • Phone number — big, prominent, copyable.
 *   • Voice + engine — what voice they'll hear, with a link to change it.
 *   • Recent activity — KPI strip + last 5 calls.
 *
 * Embeds the VoicePhoneCallUI test panel so testing the agent is one
 * scroll away, not buried under tabs.
 *
 * If Vapi rejected the last save / sync, surface the error inline at
 * the top of the page so the operator knows what to fix.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import VoicePhoneCallUI from '@/components/dashboard/VoicePhoneCallUI'
import { getVapiNativeVoice } from '@/lib/voice/vapi-native-voices'

interface AgentData {
  id: string
  name: string
  isActive: boolean
  agentType: string
  locationId: string | null
}

interface VapiConfigData {
  voiceId: string
  voiceName: string | null
  ttsProvider: string
  phoneNumber: string | null
  firstMessage: string | null
  vapiAssistantId: string | null
}

interface CallData {
  id: string
  callerPhone: string | null
  status: string | null
  durationSec: number | null
  createdAt: string
}

export default function VoiceAgentOverview() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [agent, setAgent] = useState<AgentData | null>(null)
  const [vapi, setVapi] = useState<VapiConfigData | null>(null)
  const [calls, setCalls] = useState<CallData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [agentRes, vapiRes, callsRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`),
          fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`),
          fetch(`/api/workspaces/${workspaceId}/calls?agentId=${agentId}&limit=10`).catch(() => null),
        ])

        if (cancelled) return
        if (agentRes.ok) {
          const d = await agentRes.json()
          setAgent({
            id: d.agent.id,
            name: d.agent.name,
            isActive: !!d.agent.isActive,
            agentType: d.agent.agentType || 'SIMPLE',
            locationId: d.agent.locationId || null,
          })
        }
        if (vapiRes.ok) {
          const d = await vapiRes.json()
          // The vapi GET returns the config + a few computed fields.
          // Normalize the shape we use here.
          setVapi({
            voiceId: d.voiceId || d.config?.voiceId || '',
            voiceName: d.voiceName ?? d.config?.voiceName ?? null,
            ttsProvider: d.ttsProvider || d.config?.ttsProvider || 'vapi',
            phoneNumber: d.phoneNumber ?? d.config?.phoneNumber ?? null,
            firstMessage: d.firstMessage ?? d.config?.firstMessage ?? null,
            vapiAssistantId: d.vapiAssistantId ?? d.config?.vapiAssistantId ?? null,
          })
        }
        if (callsRes?.ok) {
          const d = await callsRes.json()
          if (Array.isArray(d.calls)) setCalls(d.calls.slice(0, 10))
        }
      } catch (err) {
        console.error('[VoiceAgentOverview] load failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [workspaceId, agentId])

  if (loading || !agent) {
    return (
      <div className="px-8 py-8">
        <div className="h-8 w-48 rounded animate-pulse mb-2" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
    )
  }

  const voiceLabel = vapi?.voiceName || vapi?.voiceId || 'No voice selected'
  const engineLabel = vapi?.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Standard'
  const phoneNumber = vapi?.phoneNumber
  const hasAssistantSync = !!vapi?.vapiAssistantId

  // KPI: last 7 days of calls
  const now = Date.now()
  const sevenDays = 7 * 24 * 3600 * 1000
  const recent7 = calls.filter(c => now - new Date(c.createdAt).getTime() <= sevenDays)
  const successful = recent7.filter(c => isSuccess(c.status)).length
  const avgDuration = recent7.length > 0
    ? Math.round(recent7.reduce((acc, c) => acc + (c.durationSec || 0), 0) / recent7.length)
    : 0
  const successRate = recent7.length > 0 ? Math.round((successful / recent7.length) * 100) : null

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto w-full">
      {/* Sync error banner */}
      {!hasAssistantSync && (
        <div
          className="rounded-xl p-4 mb-6 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <span className="text-xl shrink-0" aria-hidden>⚠️</span>
          <div className="text-sm flex-1">
            <p className="font-semibold mb-0.5" style={{ color: '#ef4444' }}>
              This agent isn&apos;t synced with the voice provider yet
            </p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Open Voice &amp; Script and click Save to register it. Phone calls and browser test calls won&apos;t work until this succeeds — the save button surfaces the exact error inline.
            </p>
            <Link
              href={`/dashboard/${workspaceId}/voice/${agentId}/configuration`}
              className="inline-block mt-2 text-xs font-semibold"
              style={{ color: '#ef4444' }}
            >
              Open Voice &amp; Script →
            </Link>
          </div>
        </div>
      )}

      {/* Top row: phone + voice cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <PhoneCard phoneNumber={phoneNumber ?? null} />
        <VoiceCard
          voiceLabel={voiceLabel}
          engineLabel={engineLabel}
          firstMessage={vapi?.firstMessage ?? null}
          configHref={`/dashboard/${workspaceId}/voice/${agentId}/configuration`}
          voiceDescription={describeVoice(vapi?.voiceId, vapi?.ttsProvider)}
        />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <KpiCard
          label="Calls (last 7 days)"
          value={String(recent7.length)}
          hint={recent7.length > 0 ? `latest ${formatRelative(recent7[0].createdAt)}` : 'no calls yet'}
        />
        <KpiCard
          label="Avg call duration"
          value={formatDuration(avgDuration)}
          hint="across the last 7 days"
        />
        <KpiCard
          label="Success rate"
          value={successRate !== null ? `${successRate}%` : '—'}
          hint={successRate !== null ? `${successful} of ${recent7.length} completed` : 'needs at least 1 call'}
        />
      </div>

      {/* Test panel */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Test this agent</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Browser test or dial a real number. The agent will use the voice + opening line above.
        </p>
        <VoicePhoneCallUI
          workspaceId={workspaceId}
          agentId={agentId}
          agentName={agent.name}
          voiceId={vapi?.voiceId || ''}
          firstMessage={vapi?.firstMessage ?? null}
          ttsProvider={(vapi?.ttsProvider as 'vapi' | 'elevenlabs') || 'vapi'}
          locationId={agent.locationId || ''}
          outboundEnabled={!!phoneNumber && !!agent.locationId}
        />
      </div>

      {/* Recent calls */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent calls</h2>
          <Link
            href={`/dashboard/${workspaceId}/voice/${agentId}/calls`}
            className="text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            See all calls →
          </Link>
        </div>
        {calls.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-tertiary)' }}
          >
            No calls yet. Place a test call above to see activity here.
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {calls.slice(0, 5).map((c, i) => (
              <Link
                key={c.id}
                href={`/dashboard/${workspaceId}/calls/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:opacity-90"
                style={i > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                    style={{ background: 'var(--surface-secondary)' }}
                    aria-hidden
                  >
                    📞
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {c.callerPhone || 'Unknown number'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDuration(c.durationSec)} · {formatRelative(c.createdAt)}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-medium" style={{ color: callStatusColour(c.status) }}>
                  {c.status || 'unknown'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Bits ────────────────────────────────────────────────────────────

function PhoneCard({ phoneNumber }: { phoneNumber: string | null }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (!phoneNumber) return
    try {
      await navigator.clipboard.writeText(phoneNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
        Phone number
      </p>
      {phoneNumber ? (
        <>
          <p
            className="text-2xl font-bold tracking-tight mb-3"
            style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
          >
            {formatPhone(phoneNumber)}
          </p>
          <button
            onClick={copy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: copied ? 'var(--accent-emerald-bg)' : 'var(--surface-secondary)',
              color: copied ? 'var(--accent-emerald)' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            {copied ? '✓ Copied' : 'Copy number'}
          </button>
        </>
      ) : (
        <>
          <p className="text-lg mb-2" style={{ color: 'var(--text-tertiary)' }}>No number yet</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Browser test calls still work. Add a number in Configuration when you&apos;re ready to take real calls.
          </p>
        </>
      )}
    </div>
  )
}

function VoiceCard({
  voiceLabel, engineLabel, firstMessage, configHref, voiceDescription,
}: {
  voiceLabel: string
  engineLabel: string
  firstMessage: string | null
  configHref: string
  voiceDescription: string | null
}) {
  return (
    <Link
      href={configHref}
      className="rounded-xl p-5 block transition-colors hover:opacity-95"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
        Voice
      </p>
      <p className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{voiceLabel}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
        {engineLabel}{voiceDescription ? ` · ${voiceDescription}` : ''}
      </p>
      {firstMessage && (
        <p className="text-xs italic mt-3 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
          “{firstMessage}”
        </p>
      )}
      <p className="text-[11px] font-semibold mt-3" style={{ color: 'var(--accent-primary)' }}>
        Edit voice &amp; script →
      </p>
    </Link>
  )
}

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

// ─── Helpers ─────────────────────────────────────────────────────────

function describeVoice(voiceId: string | undefined, ttsProvider: string | undefined): string | null {
  if (!voiceId || ttsProvider !== 'vapi') return null
  const v = getVapiNativeVoice(voiceId)
  if (!v?.labels) return null
  return [v.labels.accent, v.labels.gender, v.labels.age].filter(Boolean).join(' · ')
}

function isSuccess(status: string | null): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s.includes('success') || s.includes('completed') || s.includes('ended')
}

function callStatusColour(status: string | null): string {
  if (!status) return 'var(--text-tertiary)'
  const s = status.toLowerCase()
  if (isSuccess(status)) return 'var(--accent-emerald)'
  if (s.includes('failed') || s.includes('error')) return '#ef4444'
  return 'var(--text-secondary)'
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

function formatPhone(raw: string): string {
  // Light pretty-print for +1 US/CA. Anything else gets the raw form.
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return raw
}
