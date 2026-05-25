'use client'

/**
 * Detects whether Voxility is running embedded inside another product
 * (today: a GHL Custom Menu Link iframe) and exposes a React context so
 * any component can adapt its chrome. Two signals:
 *
 *   1. ?embedded=<host> query param on first load. Survives client-side
 *      navigation via sessionStorage so deep-linked subpages stay in
 *      embedded mode after the user clicks around.
 *   2. window.self !== window.top — running in an iframe. Used as a
 *      defensive check; we don't *only* go by this because some preview
 *      tools (Stripe, Vercel) also iframe the app.
 *
 * Treat both signals as required for "embedded mode" to engage. The
 * query param is the explicit opt-in, the iframe check is the safety
 * net against someone slapping `?embedded=ghl` on a regular browser URL
 * to break out of the workspace switcher.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type EmbeddedHost = 'ghl' | null

interface EmbeddedContextValue {
  embedded: boolean
  host: EmbeddedHost
}

const Ctx = createContext<EmbeddedContextValue>({ embedded: false, host: null })

const STORAGE_KEY = 'voxility:embedded-host'

export function EmbeddedProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<EmbeddedHost>(null)
  const [inIframe, setInIframe] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Resolve host: URL param wins, sessionStorage as the fallback for
    // SPA navigations that have lost the original query string.
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('embedded')
    const stored = sessionStorage.getItem(STORAGE_KEY)
    const resolved: EmbeddedHost = fromUrl === 'ghl' || stored === 'ghl' ? 'ghl' : null
    if (resolved) {
      sessionStorage.setItem(STORAGE_KEY, resolved)
      setHost(resolved)
    }

    // Iframe check. We don't try/catch — accessing window.top from a
    // cross-origin parent throws a SecurityError, and that's actually a
    // strong signal that we *are* embedded (same-origin pages can read
    // window.top freely). Treat any throw as iframe=true.
    try {
      setInIframe(window.self !== window.top)
    } catch {
      setInIframe(true)
    }
  }, [])

  // "embedded" requires BOTH signals — see the file header for rationale.
  const embedded = inIframe && host !== null
  return <Ctx.Provider value={{ embedded, host }}>{children}</Ctx.Provider>
}

export function useEmbedded() {
  return useContext(Ctx)
}
