'use client'

/**
 * Origin every shareable link / embed snippet should be built from: the
 * workspace's active white-label domain, else the origin the operator is
 * on. Renders with window.location.origin first so snippets never flash
 * empty, then swaps once the domain state loads.
 */

import { useEffect, useState } from 'react'

export function useWorkspacePublicOrigin(workspaceId: string | undefined): string {
  const [origin, setOrigin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''))
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void fetch(`/api/workspaces/${workspaceId}/domain`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { publicOrigin?: string } | null) => {
        if (!cancelled && d?.publicOrigin) setOrigin(d.publicOrigin)
      })
      .catch(() => { /* keep the fallback origin */ })
    return () => { cancelled = true }
  }, [workspaceId])
  return origin
}
