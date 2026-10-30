'use client'

/**
 * Client view of the caller's white-label rights, from GET
 * /api/workspaces/<id>/domain. Both flags start false so owner-only
 * controls never flash for an admin before the answer arrives.
 *
 *   canManage        owner / platform admin — the Custom domain page,
 *                    links to it.
 *   canEditBranding  the workspace logo + widget "Powered by" line
 *                    (owner-only once white-label is unlocked).
 */

import { useEffect, useState } from 'react'

export function useWhitelabelAccess(workspaceId: string | undefined) {
  const [access, setAccess] = useState({ canManage: false, canEditBranding: false })
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void fetch(`/api/workspaces/${workspaceId}/domain`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { canManage?: boolean; canEditBranding?: boolean } | null) => {
        if (!cancelled && d) setAccess({ canManage: !!d.canManage, canEditBranding: !!d.canEditBranding })
      })
      .catch(() => { /* keep the controls hidden */ })
    return () => { cancelled = true }
  }, [workspaceId])
  return access
}
