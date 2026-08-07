'use client'

/**
 * Partner builder iframe entry point.
 *
 * The partner's admin UI iframes this URL with a one-time token in `?t=`.
 * We post it to the handshake, which mints an embed session cookie and
 * tells us where to go. Then a hard navigation, so the builder page's
 * server-side auth() reads the freshly-set cookie.
 *
 * Failure modes get inline messages — the iframe is typically a few
 * hundred pixels wide and a full error page would be unreadable:
 *
 *   - No token at all. Someone opened this URL directly rather than
 *     through the partner admin.
 *   - Token spent or expired. Tokens are single-use with a 10-minute
 *     TTL, so a refresh lands here. The fix is always "reopen it from
 *     the help centre", never a retry.
 *   - Third-party cookies blocked. The session cookie is SameSite=None;
 *     if the browser drops it the handshake succeeds but the redirect
 *     bounces back to a login. Offer a new-tab escape hatch.
 */

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type State =
  | { kind: 'handshaking' }
  | { kind: 'redirecting' }
  | { kind: 'error'; message: string; detail?: string }

function WidgetBuilderEntry() {
  const params = useSearchParams()
  const token = params.get('t')
  // Derived at render, not in an effect — a missing token is knowable
  // immediately and setting it from an effect would cascade a render.
  const [state, setState] = useState<State>(() => token
    ? { kind: 'handshaking' }
    : {
        kind: 'error',
        message: 'This page has to be opened from your help centre admin.',
        detail: 'NO_TOKEN',
      })

  useEffect(() => {
    if (!token) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/partner-builder-handshake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Required: Next defaults to 'same-origin', which would
          // silently drop the SameSite=None cookie we're being handed.
          credentials: 'include',
          body: JSON.stringify({ token }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setState({ kind: 'error', message: data.error || 'Could not sign you in.', detail: data.code })
          return
        }
        setState({ kind: 'redirecting' })
        // Hard nav, not router.push — the new cookie must be read fresh
        // by the next page's server components, and a client-side
        // transition reuses the same document.
        window.location.href = data.redirectTo as string
      } catch (err: unknown) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: 'Network error while signing you in.',
          detail: err instanceof Error ? err.message : undefined,
        })
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (state.kind === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
        <div className="max-w-sm text-center">
          <p className="text-3xl mb-3">🔒</p>
          <p className="text-sm text-zinc-100 font-semibold mb-1">{state.message}</p>
          <p className="text-xs text-zinc-500">
            Close this panel and click “Customise widget” again to get a fresh link.
          </p>
          {state.detail && (
            <p className="text-[10px] text-zinc-700 font-mono mt-4">{state.detail}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
        <p className="text-xs text-zinc-500">
          {state.kind === 'redirecting' ? 'Opening your widget…' : 'Signing you in…'}
        </p>
      </div>
    </div>
  )
}

export default function Page() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <WidgetBuilderEntry />
    </Suspense>
  )
}
