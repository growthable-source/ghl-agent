'use client'

import { useState } from 'react'

interface CheckResult {
  totalCandidates: number
  processed: number
  healthy: number
  broken: number
  transient: number
  errors: number
  perAgent: Array<{
    agentId: string
    name: string
    healthy: number
    broken: number
    transient: number
    skipped: number
  }>
}

/**
 * Workspace-wide "Run Connectivity Check" panel — lives on the integrations
 * page next to the broken-references aggregate banner.
 *
 * Two modes:
 *   - If broken refs exist: red banner with the existing aggregate count +
 *     a primary "Run Connectivity Check" button so the operator can
 *     re-verify after fixing something in the CRM.
 *   - If everything looks healthy: subtle "Run Connectivity Check" button
 *     so the operator can spot-check before reporting an issue ("are my
 *     calendars / workflows / etc. all still reachable?").
 *
 * Posts to /api/workspaces/[wsId]/reference-health which sweeps every
 * agent in the workspace that has at least one CRM-referenced resource
 * and runs the validator without throttle. No CRON_SECRET required — auth
 * is by workspace membership.
 */
export function ConnectivityCheckPanel({
  workspaceId,
  brokenRefAgentCount,
  onRefresh,
}: {
  workspaceId: string
  brokenRefAgentCount: number
  onRefresh: () => void
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reference-health`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        setError(`Check failed (${res.status})${body ? `: ${body.slice(0, 120)}` : ''}`)
        return
      }
      const data = (await res.json()) as CheckResult
      setResult(data)
      onRefresh()
    } catch (err: any) {
      setError(err?.message ?? 'Check failed')
    } finally {
      setRunning(false)
    }
  }

  const hasBroken = brokenRefAgentCount > 0
  const resultSummary = result
    ? result.broken === 0
      ? `All ${result.processed} agent${result.processed === 1 ? '' : 's'} healthy.`
      : `${result.broken} broken reference${result.broken === 1 ? '' : 's'} across ${
          result.perAgent.filter(a => a.broken > 0).length
        } agent${result.perAgent.filter(a => a.broken > 0).length === 1 ? '' : 's'}.`
    : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        padding: 12,
        marginBottom: 16,
        background: hasBroken ? 'var(--accent-red-bg, #fef2f2)' : 'var(--bg-subtle, #f9fafb)',
        color: hasBroken ? 'var(--accent-red, #b91c1c)' : 'var(--text-secondary, #4b5563)',
        border: hasBroken
          ? '1px solid var(--accent-red, #ef4444)'
          : '1px solid var(--border, #e5e7eb)',
        borderRadius: 8,
        fontSize: 14,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {hasBroken ? (
          <a
            href={`/dashboard/${workspaceId}/agents`}
            style={{
              color: 'inherit',
              textDecoration: 'underline',
              fontWeight: 500,
            }}
          >
            {brokenRefAgentCount === 1
              ? '1 agent has broken references'
              : `${brokenRefAgentCount} agents have broken references`}
            {' →'}
          </a>
        ) : (
          <span>Verify every agent’s CRM references are still reachable.</span>
        )}
        {result && !error ? (
          <span
            style={{
              fontSize: 12,
              opacity: 0.85,
              color: result.broken === 0 ? 'var(--accent-emerald, #047857)' : 'inherit',
            }}
          >
            Last check: {resultSummary}
          </span>
        ) : null}
        {error ? (
          <span style={{ fontSize: 12, color: 'var(--accent-red, #b91c1c)' }}>{error}</span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={running}
        style={{
          padding: '8px 14px',
          borderRadius: 6,
          background: hasBroken ? 'var(--accent-red, #ef4444)' : 'var(--button-bg, #111827)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: running ? 'wait' : 'pointer',
          border: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {running ? 'Checking…' : 'Run Connectivity Check'}
      </button>
    </div>
  )
}
