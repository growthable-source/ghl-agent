'use client'

/**
 * GHL Custom-App iframe entry point.
 *
 * The URL registered as a Custom Menu Link in the GHL Marketplace points
 * here. The page mounts inside a GHL iframe, asks the parent frame for
 * the active user's encrypted identity blob, posts it to the handshake
 * endpoint to mint a Voxility session, then redirects into the
 * workspace dashboard in embedded mode.
 *
 * Failure modes (each with an inline message — the iframe is too narrow
 * for full error pages):
 *
 *   - Parent frame doesn't reply within 5s. Most likely cause: the page
 *     was loaded directly in a browser tab rather than inside a GHL
 *     iframe. Show a manual "Open in GHL" CTA.
 *   - Parent replies but the decrypt fails. Means the Shared Secret on
 *     our end doesn't match GHL's. The handshake response carries the
 *     specific reason so we can surface it.
 *   - Decrypt succeeds but no Location row matches. Workspace wasn't
 *     installed via the marketplace yet — direct the operator to the
 *     marketplace listing.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type State =
  | { kind: 'awaiting-parent' }
  | { kind: 'handshaking' }
  | { kind: 'redirecting' }
  | { kind: 'error'; message: string; detail?: string }

const PARENT_TIMEOUT_MS = 5000

export default function GhlEmbeddedEntry() {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'awaiting-parent' })

  useEffect(() => {
    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    async function completeHandshake(encryptedData: string) {
      if (resolved) return
      resolved = true
      if (timeoutId) clearTimeout(timeoutId)
      setState({ kind: 'handshaking' })

      try {
        const res = await fetch('/api/auth/ghl-iframe-handshake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // credentials: 'include' is required so the session cookie set
          // in the response actually lands — Next.js defaults to 'same-
          // origin' which would silently drop a SameSite=None cookie.
          credentials: 'include',
          body: JSON.stringify({ encryptedData }),
        })
        const data = await res.json()
        if (!res.ok) {
          setState({
            kind: 'error',
            message: data.error || 'Could not sign you in.',
            detail: data.code,
          })
          return
        }
        setState({ kind: 'redirecting' })
        // Use a hard nav, not router.push — we want the new cookie to be
        // read fresh by the server component layout on the next page,
        // and a client-side route transition reuses the same document.
        window.location.href = data.redirectTo as string
      } catch (err: any) {
        setState({
          kind: 'error',
          message: 'Network error during sign-in handshake.',
          detail: err?.message,
        })
      }
    }

    function onMessage(event: MessageEvent) {
      // GHL sends the encrypted payload back in response to our
      // REQUEST_USER_DATA. The shape is intentionally loose because
      // GHL has versioned this a few times; we accept any of the
      // known field names.
      const data = event.data
      if (!data || typeof data !== 'object') return
      const encrypted: string | undefined =
        data.encryptedData ?? data.encrypted_user_data ?? data.payload
      const messageType: string | undefined = data.message ?? data.type
      const isResponse = messageType === 'REQUEST_USER_DATA_RESPONSE' || encrypted
      if (!isResponse || !encrypted || typeof encrypted !== 'string') return
      void completeHandshake(encrypted)
    }

    window.addEventListener('message', onMessage)

    // Ask the parent frame for the user payload. The target origin is
    // '*' because we don't know in advance whether the parent is
    // gohighlevel.com or a whitelabel domain — the handshake's actual
    // trust gate is on the *decryption* with our Shared Secret, not on
    // the postMessage origin.
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    }

    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      setState({
        kind: 'error',
        message: 'No response from GHL. Open this app from a Custom Menu Link inside GoHighLevel.',
      })
    }, PARENT_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', onMessage)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--background, #0a0a0a)', color: 'var(--text-primary, #fafafa)' }}>
      <div className="max-w-sm w-full text-center">
        {state.kind === 'awaiting-parent' && (
          <>
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-secondary, #a1a1aa)' }}>
              Connecting to GoHighLevel…
            </p>
          </>
        )}
        {state.kind === 'handshaking' && (
          <>
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-secondary, #a1a1aa)' }}>
              Signing you in…
            </p>
          </>
        )}
        {state.kind === 'redirecting' && (
          <>
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-secondary, #a1a1aa)' }}>
              Loading your workspace…
            </p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <p className="text-sm font-medium mb-2">Could not load Voxility</p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary, #71717a)' }}>{state.message}</p>
            {state.detail && (
              <p className="text-[10px] font-mono mb-4" style={{ color: 'var(--text-tertiary, #71717a)' }}>{state.detail}</p>
            )}
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs px-3 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border, #27272a)', color: 'var(--text-primary, #fafafa)' }}
            >
              Open Voxility in a new tab →
            </a>
          </>
        )}
      </div>
    </div>
  )
}
