'use client'

/**
 * Per-agent CRM connection card. THE place a CRM gets connected — the
 * connection belongs to the agent, not the workspace: each agent binds
 * to its own LeadConnector sub-account (Agent.locationId), and two
 * agents in one workspace can point at different sub-accounts.
 *
 * Used by BOTH agent surfaces:
 *   text agents:  /dashboard/[ws]/agents/[agentId]/integrations
 *   voice agents: /dashboard/[ws]/voice/[agentId]/configuration
 *
 * Connect/Reconnect links are plain <a> tags on purpose — the connect
 * endpoint is an API route answering with a 302 to the OAuth chooser,
 * and next/link's client-side router navigation 404s on API routes.
 */

import { useCallback, useEffect, useState } from 'react'
import { LeadConnectorIcon, HubSpotIcon } from '@/components/icons/brand-icons'
import NewBadge from '@/components/NewBadge'

type CrmProvider = 'native' | 'ghl' | 'hubspot'

interface ConnectionIdentity {
  locationId: string
  provider: string
  businessName: string | null
  businessCity: string | null
  businessState: string | null
}

export default function AgentCrmCard({
  workspaceId,
  agentId,
  returnTo,
}: {
  workspaceId: string
  agentId: string
  /** Path to bounce back to after the OAuth round-trip. */
  returnTo: string
}) {
  const [currentCrm, setCurrentCrm] = useState<CrmProvider | null>(null)
  const [agentLocationId, setAgentLocationId] = useState<string | null>(null)
  const [availableCrms, setAvailableCrms] = useState<Record<CrmProvider, boolean>>({ native: false, ghl: false, hubspot: false })
  const [connections, setConnections] = useState<ConnectionIdentity[]>([])
  const [switching, setSwitching] = useState<CrmProvider | null>(null)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const connectHref =
    `/api/auth/crm/connect?workspaceId=${workspaceId}&agentId=${agentId}` +
    `&returnTo=${encodeURIComponent(returnTo)}`

  const refresh = useCallback(async () => {
    try {
      const [agentRes, wsIntRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()),
        fetch(`/api/workspaces/${workspaceId}/integrations`).then(r => r.json()),
      ])
      const locProvider = agentRes?.agent?.location?.crmProvider as string | undefined
      setCurrentCrm(
        locProvider === 'ghl' || locProvider === 'hubspot' || locProvider === 'native'
          ? locProvider
          : 'native',
      )
      setAgentLocationId(agentRes?.agent?.locationId ?? null)
      if (wsIntRes?.availableCrms) {
        setAvailableCrms({
          native: !!wsIntRes.availableCrms.native,
          ghl: !!wsIntRes.availableCrms.ghl,
          hubspot: !!wsIntRes.availableCrms.hubspot,
        })
      }
      if (Array.isArray(wsIntRes?.crmConnections)) setConnections(wsIntRes.crmConnections)
    } catch {
      /* card renders with connect CTA; the OAuth flow is the recovery path */
    } finally {
      setLoading(false)
    }
  }, [workspaceId, agentId])

  useEffect(() => { refresh() }, [refresh])

  async function switchAgentCrm(provider: CrmProvider) {
    if (provider === currentCrm) return
    setSwitching(provider)
    setBanner(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crmProvider: provider }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const labels: Record<CrmProvider, string> = { native: 'Native CRM', ghl: 'LeadConnector', hubspot: 'HubSpot' }
      setBanner({ kind: 'success', text: `This agent now uses ${labels[provider]} for contacts, deals, and messaging.` })
      await refresh()
    } catch (err: any) {
      setBanner({ kind: 'error', text: err.message || 'Could not switch CRM' })
    } finally {
      setSwitching(null)
    }
  }

  // Identity of the sub-account THIS agent is bound to (if we have a
  // marketplace-install snapshot for it).
  const identity = agentLocationId
    ? connections.find(c => c.locationId === agentLocationId) ?? null
    : null

  if (loading) {
    return (
      <div className="mb-6 rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="h-5 w-40 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
    )
  }

  return (
    <div
      className="mb-6 rounded-xl border p-5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        CRM connection <NewBadge since="2026-07-02" className="ml-1" />
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Which CRM this agent reads from and writes to. Connections belong to the
        agent — each agent can link its own LeadConnector sub-account.
      </p>

      {banner && (
        <p
          className="text-xs mb-3"
          style={{ color: banner.kind === 'success' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}
        >
          {banner.text}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {([
          { value: 'native', label: 'Native CRM', sub: 'Built-in contacts + lists', Icon: null as null | typeof LeadConnectorIcon },
          { value: 'ghl', label: 'LeadConnector', sub: 'LeadConnector CRM', Icon: LeadConnectorIcon },
          { value: 'hubspot', label: 'HubSpot', sub: 'HubSpot CRM', Icon: HubSpotIcon },
        ] as const).map(opt => {
          const isActive = currentCrm === opt.value
          // Native is always switchable; ghl/hubspot are instantly
          // switchable only when the workspace already holds a usable
          // connection (an agent connected one before).
          const canSwitch = opt.value === 'native' ? true : availableCrms[opt.value]
          const isSwitching = switching === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => canSwitch && switchAgentCrm(opt.value)}
              disabled={!canSwitch || isSwitching || isActive}
              title={!canSwitch && opt.value === 'ghl' ? 'Use "Connect LeadConnector" below' : undefined}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                canSwitch ? 'hover:border-zinc-500' : 'opacity-50 cursor-not-allowed'
              } disabled:cursor-not-allowed`}
              style={
                isActive
                  ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                  : { borderColor: 'var(--border)', background: 'var(--surface)' }
              }
            >
              <div className="flex items-center gap-2 w-full">
                {opt.Icon ? (
                  <opt.Icon className="w-5 h-5" />
                ) : (
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center text-xs"
                    style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                  >
                    📇
                  </div>
                )}
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                {isActive && (
                  <span
                    className="ml-auto text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                  >
                    Active
                  </span>
                )}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.sub}</span>
            </button>
          )
        })}
      </div>

      {/* LeadConnector connect / identity strip */}
      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        {currentCrm === 'ghl' ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Connected to{' '}
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {identity?.businessName ?? agentLocationId ?? 'a LeadConnector sub-account'}
              </span>
              {identity && [identity.businessCity, identity.businessState].filter(Boolean).length > 0 && (
                <span> · {[identity.businessCity, identity.businessState].filter(Boolean).join(', ')}</span>
              )}
            </p>
            <a
              href={connectHref}
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Reconnect / change sub-account
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Link this agent to its own LeadConnector sub-account.
            </p>
            <a
              href={connectHref}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-colors"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              Connect LeadConnector →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
