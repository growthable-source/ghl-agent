'use client'

/**
 * Last-resort error boundary — catches throws that escape the root
 * layout itself (where the per-segment error.tsx can't help, because
 * the layout that would render it also failed). Must render its own
 * <html>/<body>. Deliberately dependency-free and inline-styled so it
 * works even if the app's CSS/providers are what broke.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8f7f4',
          color: '#1c1917',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#57534e', marginBottom: 20 }}>
            We hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#e84425',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 11, fontFamily: 'monospace', color: '#a8a29e' }}>
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
