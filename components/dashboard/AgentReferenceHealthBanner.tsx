'use client'

import { useEffect, useState } from 'react'

interface ReferenceRow {
  resourceType: string
  resourceId: string
  sourceField: string
  status: string
  lastError: string | null
  lastCheckedAt: string
  firstBrokenAt: string | null
}

/**
 * Top-of-page banner shown on every agent sub-page when the agent has
 * any references in the 'broken' state. Polls /reference-health on
 * mount and after manual re-check.
 */
export function AgentReferenceHealthBanner({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [refs, setRefs] = useState<ReferenceRow[] | null>(null)
  const [rechecking, setRechecking] = useState(false)

  async function load() {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/reference-health`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const data = await res.json()
      setRefs(data.references ?? [])
    } catch {}
  }

  useEffect(() => { void load() }, [workspaceId, agentId])

  const broken = (refs ?? []).filter(r => r.status === 'broken')
  if (broken.length === 0) return null

  async function recheck() {
    setRechecking(true)
    try {
      await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/reference-health/recheck`,
        { method: 'POST' },
      )
      await load()
    } finally {
      setRechecking(false)
    }
  }

  return (
    <div
      role="alert"
      style={{
        background: 'var(--accent-red-bg, #fef2f2)',
        border: '1px solid var(--accent-red, #ef4444)',
        color: 'var(--accent-red, #b91c1c)',
        borderRadius: 8,
        padding: 16,
        margin: '0 0 16px',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {broken.length === 1
          ? '1 broken reference — affected tools have been disabled.'
          : `${broken.length} broken references — affected tools have been disabled.`}
      </div>
      <ul style={{ margin: '8px 0', paddingLeft: 20, fontSize: 13 }}>
        {broken.map(r => (
          <li key={`${r.resourceType}:${r.resourceId}:${r.sourceField}`}>
            <strong>{r.resourceType}</strong> <code>{r.resourceId}</code>
            {' · '}
            <span style={{ opacity: 0.8 }}>{r.sourceField}</span>
            {r.lastError ? <div style={{ opacity: 0.7, fontSize: 12 }}>{r.lastError}</div> : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={recheck}
        disabled={rechecking}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          background: 'var(--accent-red, #ef4444)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: rechecking ? 'wait' : 'pointer',
          border: 'none',
        }}
      >
        {rechecking ? 'Re-checking…' : 'Re-check now'}
      </button>
    </div>
  )
}
