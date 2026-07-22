'use client'

/**
 * Agency-level LeadConnector Custom Menu Link entry point that wraps a
 * customer portal.
 *
 * Unlike ../page.tsx (which mints a dashboard session), this page never
 * signs anyone in. It runs the same REQUEST_USER_DATA handshake purely
 * to learn WHICH agency (companyId) is looking at us, asks
 * /api/embedded/portal-binding for that agency's saved portal URL, and:
 *
 *   - no binding yet → shows a one-field form to save one,
 *   - binding exists → renders it full-bleed in an inner iframe, with a
 *     small "Change" affordance floating above it.
 *
 * The encrypted blob is kept in memory for the lifetime of the page —
 * the PUT that saves a new URL re-sends it as its auth proof.
 */

import { useEffect, useRef, useState } from 'react'

type State =
  | { kind: 'awaiting-parent' }
  | { kind: 'loading' }
  | { kind: 'form'; current: string | null; error?: string; saving?: boolean }
  | { kind: 'portal'; url: string }
  | { kind: 'error'; message: string; detail?: string }

const PARENT_TIMEOUT_MS = 5000

export default function EmbeddedPortalWrapper() {
  const [state, setState] = useState<State>({ kind: 'awaiting-parent' })
  const encryptedRef = useRef<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    async function lookupBinding(encryptedData: string) {
      if (resolved) return
      resolved = true
      if (timeoutId) clearTimeout(timeoutId)
      encryptedRef.current = encryptedData
      setState({ kind: 'loading' })
      try {
        const res = await fetch('/api/embedded/portal-binding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedData }),
        })
        const data = await res.json()
        if (!res.ok) {
          setState({ kind: 'error', message: data.error || 'Could not verify your CRM identity.', detail: data.code })
          return
        }
        if (data.portalUrl) setState({ kind: 'portal', url: data.portalUrl })
        else setState({ kind: 'form', current: null })
      } catch (err) {
        setState({
          kind: 'error',
          message: 'Network error while loading your portal settings.',
          detail: err instanceof Error ? err.message : undefined,
        })
      }
    }

    function onMessage(event: MessageEvent) {
      // Same intentionally-loose shape handling as ../page.tsx — the
      // marketplace has versioned these field names over time.
      const data = event.data
      if (!data || typeof data !== 'object') return
      const encrypted: string | undefined =
        data.encryptedData ?? data.encrypted_user_data ?? data.payload
      if (!encrypted || typeof encrypted !== 'string') return
      void lookupBinding(encrypted)
    }

    window.addEventListener('message', onMessage)

    // Origin '*' by design — see ../page.tsx: trust is the server-side
    // decrypt, not the postMessage origin.
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    }

    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      setState({
        kind: 'error',
        message: 'No response from your CRM. Open this app from a Custom Menu Link inside your CRM.',
      })
    }, PARENT_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', onMessage)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  async function save() {
    const encryptedData = encryptedRef.current
    if (!encryptedData || state.kind !== 'form') return
    setState({ ...state, saving: true, error: undefined })
    try {
      const res = await fetch('/api/embedded/portal-binding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptedData, portalUrl: draft }),
      })
      const data = await res.json()
      if (!res.ok) {
        setState({ kind: 'form', current: state.current, error: data.error || 'Could not save.', saving: false })
        return
      }
      setState({ kind: 'portal', url: data.portalUrl })
    } catch {
      setState({ kind: 'form', current: state.current, error: 'Network error while saving.', saving: false })
    }
  }

  if (state.kind === 'portal') {
    return (
      <div className="fixed inset-0">
        <iframe
          src={state.url}
          title="Portal"
          className="w-full h-full border-0"
          allow="clipboard-write"
        />
        <button
          type="button"
          onClick={() => {
            setDraft(state.url)
            setState({ kind: 'form', current: state.url })
          }}
          className="absolute bottom-3 right-3 text-[11px] px-2.5 py-1.5 rounded-md border transition-opacity opacity-40 hover:opacity-100"
          style={{ background: 'var(--background, #0a0a0a)', borderColor: 'var(--border, #27272a)', color: 'var(--text-secondary, #a1a1aa)' }}
        >
          Change portal URL
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--background, #0a0a0a)', color: 'var(--text-primary, #fafafa)' }}>
      <div className="max-w-sm w-full text-center">
        {(state.kind === 'awaiting-parent' || state.kind === 'loading') && (
          <>
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-secondary, #a1a1aa)' }}>
              {state.kind === 'awaiting-parent' ? 'Connecting to your CRM…' : 'Loading your portal…'}
            </p>
          </>
        )}

        {state.kind === 'form' && (
          <div className="text-left">
            <h1 className="text-base font-medium mb-1 text-center">Connect your portal</h1>
            <p className="text-xs mb-4 text-center" style={{ color: 'var(--text-tertiary, #71717a)' }}>
              Enter your portal URL. It will load here for everyone in your agency.
            </p>
            <input
              autoFocus
              type="url"
              placeholder="https://portal.yourdomain.com"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
            />
            {state.error && <p className="text-xs text-red-400 mt-2">{state.error}</p>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={state.saving || !draft.trim()}
              className="w-full mt-3 px-3 py-2 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state.saving ? 'Saving…' : 'Save & open portal'}
            </button>
            {state.current && (
              <button
                type="button"
                onClick={() => setState({ kind: 'portal', url: state.current! })}
                className="w-full mt-2 text-xs py-1.5"
                style={{ color: 'var(--text-tertiary, #71717a)' }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {state.kind === 'error' && (
          <>
            <p className="text-sm font-medium mb-2">Could not load your portal</p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary, #71717a)' }}>{state.message}</p>
            {state.detail && (
              <p className="text-[10px] font-mono mb-4" style={{ color: 'var(--text-tertiary, #71717a)' }}>{state.detail}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
