'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * ViewModeToggle — header pill that flips the agent shell between the
 * legacy tabbed IA ('simple') and the full-bleed visual workflow canvas
 * ('advanced').
 *
 * Persists the choice via PATCH on the agent record so the next pageload
 * lands in the same view the operator left in. After the PATCH succeeds
 * the user is redirected:
 *   simple → advanced: push to /flow (the canvas)
 *   advanced → simple: push to the agent root (which redirects to the
 *                      tabbed default page)
 *
 * Failure mode: log + leave the user where they are. The visible state
 * doesn't change locally — it's read from the server-side viewMode prop
 * which a `router.refresh()` will pull again on the next successful
 * round-trip.
 */
export function ViewModeToggle({
  workspaceId,
  agentId,
  viewMode,
}: {
  workspaceId: string
  agentId: string
  viewMode: 'simple' | 'advanced'
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = viewMode === 'simple' ? 'advanced' : 'simple'
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewMode: next }),
      })
      if (!res.ok) {
        console.warn('[ViewModeToggle] PATCH failed:', res.status)
        return
      }
      if (next === 'advanced') {
        router.push(`/dashboard/${workspaceId}/agents/${agentId}/flow`)
      } else {
        router.push(`/dashboard/${workspaceId}/agents/${agentId}`)
      }
      router.refresh()
    } catch (err) {
      console.warn('[ViewModeToggle] PATCH threw:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className="text-xs border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
      style={{
        color: 'var(--text-secondary)',
        borderColor: 'var(--border)',
        cursor: saving ? 'wait' : 'pointer',
      }}
      title={
        viewMode === 'simple'
          ? 'Show this agent as a visual workflow canvas'
          : 'Return to tabbed configuration view'
      }
    >
      {saving
        ? 'Switching…'
        : viewMode === 'simple'
          ? 'Switch to Advanced view'
          : 'Switch to Simple view'}
    </button>
  )
}
