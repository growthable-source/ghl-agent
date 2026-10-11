'use client'

/**
 * Custom domain (white-label) — serve Co-Pilot links and the chat/voice
 * widget from the workspace's own subdomain (live.acme.com) instead of
 * app.xovera.io. One domain per workspace, subdomains only.
 *
 * Always visible; adding a domain requires a platform admin to unlock
 * the workspace first (the commercial deal is outside the product), so
 * locked workspaces see the explainer + a contact prompt, not a form.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface DnsRecord { type: string; name: string; value: string; reason?: string }
interface DomainView {
  hostname: string
  status: string
  dnsRecords: DnsRecord[]
  lastError: string | null
  lastCheckedAt: string | null
}
interface State { unlocked: boolean; domain: DomainView | null; publicOrigin: string }

export default function CustomDomainPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const base = `/api/workspaces/${workspaceId}/domain`

  const [state, setState] = useState<State | null>(null)
  const [hostname, setHostname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(base)
    if (res.ok) setState(await res.json())
  }, [base])
  useEffect(() => { void load() }, [load])

  // Poll while pending so the badge flips without a manual re-check.
  useEffect(() => {
    if (state?.domain?.status !== 'pending') return
    const t = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(t)
  }, [state?.domain?.status, load])

  async function act(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(base, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return }
      setState(data)
      if (method === 'POST') setHostname('')
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return <div className="p-8 max-w-2xl"><div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} /></div>
  }

  const d = state.domain
  const card = { borderColor: 'var(--border)', background: 'var(--surface)' } as const

  return (
    <div className="p-8 max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Custom domain</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Serve your Co-Pilot links and chat/voice widget from your own subdomain, e.g.{' '}
          <span className="font-mono">live.yourcompany.com/copilot/live/…</span>, instead of our domain.
        </p>
      </div>

      {!state.unlocked && (
        <div className="rounded-xl border p-5" style={card}>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>White-label domains are not enabled for this workspace</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Custom domains are an add-on. Contact us to enable it and you&rsquo;ll be able to connect a subdomain right here.
          </p>
        </div>
      )}

      {state.unlocked && !d && (
        <div className="rounded-xl border p-5 space-y-3" style={card}>
          <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Subdomain</label>
          <div className="flex gap-2 flex-wrap">
            <input
              value={hostname}
              onChange={e => setHostname(e.target.value)}
              placeholder="live.yourcompany.com"
              className="flex-1 min-w-[240px] rounded-lg px-3 py-2 text-sm font-mono"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            />
            <button
              type="button"
              disabled={busy || !hostname.trim()}
              onClick={() => void act('POST', { hostname })}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--accent-primary)' }}
            >
              {busy ? 'Adding…' : 'Add domain'}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Subdomains only (like <span className="font-mono">live.acme.com</span>) — root domains such as acme.com aren&rsquo;t supported.
          </p>
        </div>
      )}

      {d && (
        <div className="rounded-xl border p-5 space-y-4" style={card}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{d.hostname}</span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: d.status === 'active' ? 'var(--accent-emerald)' : 'var(--surface-hover, #3f3f46)',
                  color: '#fff',
                }}
              >
                {d.status === 'active' ? 'Active' : 'Waiting for DNS'}
              </span>
              {!state.unlocked && (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>paused — white-labelling is locked</span>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void act('PATCH')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                {busy ? 'Checking…' : 'Re-check'}
              </button>
              <button type="button" disabled={busy}
                onClick={() => { if (confirm(`Remove ${d.hostname}? Links on this domain will stop working.`)) void act('DELETE') }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent-red)' }}>
                Remove
              </button>
            </div>
          </div>

          {d.status === 'active' ? (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Live. Your Co-Pilot share links, buttons and widget snippets now use <span className="font-mono">https://{d.hostname}</span>.
              Links you already shared on the old domain keep working.
            </p>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Add {d.dnsRecords.length > 1 ? 'these records' : 'this record'} at your DNS provider. It can take a few
                minutes (occasionally longer) to propagate; we re-check automatically and the badge will flip to Active.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)' }}>
                      <th className="text-left font-medium py-1 pr-3">Type</th>
                      <th className="text-left font-medium py-1 pr-3">Name / Host</th>
                      <th className="text-left font-medium py-1">Value / Target</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono" style={{ color: 'var(--text-primary)' }}>
                    {d.dnsRecords.map((r, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-1 pr-3">{r.type}</td>
                        <td className="py-1 pr-3 break-all">{r.name}</td>
                        <td className="py-1 break-all">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Some DNS providers want only the left part of the name (e.g. <span className="font-mono">live</span>). If you
                use Cloudflare, set the record to <strong>DNS only</strong> (grey cloud) so we can issue your certificate.
              </p>
            </>
          )}
          {d.lastError && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>Last check failed: {d.lastError}</p>}
        </div>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>}
    </div>
  )
}
