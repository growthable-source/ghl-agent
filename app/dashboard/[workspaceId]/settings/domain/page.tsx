'use client'

/**
 * Custom domain (white-label) — serve Co-Pilot links, the chat/voice
 * widget and the team's own branded sign-in + dashboard from the
 * workspace's own subdomain (live.acme.com) instead of app.xovera.io.
 * One domain per workspace, subdomains only.
 *
 * Always visible; adding a domain requires a platform admin to unlock
 * the workspace first (the commercial deal is outside the product), so
 * locked workspaces see the explainer + a contact prompt, not a form.
 * Only the workspace owner and platform admins reach this page
 * (./layout.tsx, lib/whitelabel/manage-policy.ts); admins get a 404 and
 * never see it in the nav. `canManage` is therefore always true here — the
 * checks below are a belt-and-braces fallback.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { readableTextOn } from '@/lib/domains/brand-metadata'

interface DnsRecord { type: string; name: string; value: string; reason?: string }
interface DomainView {
  hostname: string
  status: string
  dnsRecords: DnsRecord[]
  lastError: string | null
  lastCheckedAt: string | null
}
interface Branding {
  brandName: string | null
  faviconUrl: string | null
  rootUrl: string | null
  logoUrl: string | null
  accentColor: string | null
  buttonTextColor: string | null
  loginHeading: string | null
  loginMessage: string | null
}
interface State { unlocked: boolean; domain: DomainView | null; publicOrigin: string; branding: Branding; canManage: boolean }

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
          <span className="font-mono">live.yourcompany.com/copilot/live/…</span>, instead of our domain. Your team
          signs in there too, on a page with your branding.
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

      {state.unlocked && !d && state.canManage && (
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
              {state.canManage && (<>
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
              </>)}
            </div>
          </div>

          {d.status === 'active' ? (
            <>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Live. Your Co-Pilot share links, buttons and widget snippets now use <span className="font-mono">https://{d.hostname}</span>.
                Links you already shared on the old domain keep working.
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Team sign-in:{' '}
                <a href={`https://${d.hostname}/sign-in`} target="_blank" rel="noopener noreferrer" className="font-mono underline">
                  https://{d.hostname}/sign-in
                </a>
                {' '}— members sign in with a one-time code emailed to them. Support agents only see the inbox and tickets.
              </p>
            </>
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

      {state.unlocked && state.canManage && (
        <BrandingCard
          workspaceId={workspaceId}
          initial={state.branding}
          hostname={d?.hostname ?? null}
          onSaved={next => setState(prev => (prev ? { ...prev, branding: next.branding } : next))}
        />
      )}

      {error && <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>}
    </div>
  )
}

/**
 * Tab title + favicon + bare-domain destination for pages on the custom
 * domain. All optional; blanks fall back to the workspace name / logo /
 * a minimal branded page — never to our brand.
 */
function BrandingCard({ workspaceId, initial, hostname, onSaved }: {
  workspaceId: string
  initial: Branding
  hostname: string | null
  onSaved: (next: State) => void
}) {
  const [brandName, setBrandName] = useState(initial.brandName ?? '')
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl ?? '')
  const [rootUrl, setRootUrl] = useState(initial.rootUrl ?? '')
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '')
  const [accentColor, setAccentColor] = useState(initial.accentColor ?? '')
  const [buttonTextColor, setButtonTextColor] = useState(initial.buttonTextColor ?? '')
  const [loginHeading, setLoginHeading] = useState(initial.loginHeading ?? '')
  const [loginMessage, setLoginMessage] = useState(initial.loginMessage ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const input = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' } as const

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/domain`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, faviconUrl, rootUrl, logoUrl, accentColor, buttonTextColor, loginHeading, loginMessage }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: data.error || 'Could not save.' }); return }
      onSaved(data)
      setFaviconUrl(data.branding?.faviconUrl ?? '')
      setRootUrl(data.branding?.rootUrl ?? '')
      setLogoUrl(data.branding?.logoUrl ?? '')
      setAccentColor(data.branding?.accentColor ?? '')
      setButtonTextColor(data.branding?.buttonTextColor ?? '')
      setMsg({ ok: true, text: 'Saved. Browsers cache favicons — a hard refresh may be needed to see a new one.' })
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File, target: 'favicon' | 'whitelabel-logo' = 'favicon') {
    setBusy(true)
    setMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('target', target)
      const res = await fetch(`/api/workspaces/${workspaceId}/logo/upload`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: data.error || 'Upload failed.' }); return }
      if (target === 'whitelabel-logo') {
        setLogoUrl(data.logoUrl ?? '')
        setMsg({ ok: true, text: 'Logo uploaded.' })
      } else {
        setFaviconUrl(data.faviconUrl ?? '')
        setMsg({ ok: true, text: 'Favicon uploaded.' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Branding</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          What visitors see in the browser tab on your domain{hostname ? <> (<span className="font-mono">{hostname}</span>)</> : null} — live
          help, Co-Pilot links, hosted call pages and the chat widget.
        </p>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Brand name (page title)</label>
        <input value={brandName} onChange={e => setBrandName(e.target.value)} maxLength={60} placeholder="Defaults to your workspace name"
          className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Tabs read like &ldquo;Live help | {brandName.trim() || 'Your brand'}&rdquo;.</p>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Favicon</label>
        <div className="flex gap-2 items-center flex-wrap">
          {faviconUrl.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={faviconUrl} alt="" className="w-8 h-8 rounded border object-contain" style={{ borderColor: 'var(--border)' }} />
          )}
          <input value={faviconUrl} onChange={e => setFaviconUrl(e.target.value)} placeholder="https://… (defaults to your workspace logo)"
            className="flex-1 min-w-[220px] rounded-lg px-3 py-2 text-sm font-mono" style={input} />
          <label className="px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            Upload
            <input type="file" accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp,image/jpeg,image/gif" className="hidden"
              disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          </label>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Square image, 64×64 or larger. PNG, SVG or ICO.</p>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Homepage redirect</label>
        <input value={rootUrl} onChange={e => setRootUrl(e.target.value)} placeholder="https://yourcompany.com"
          className="w-full rounded-lg px-3 py-2 text-sm font-mono" style={input} />
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          Where people land if they visit {hostname ? <span className="font-mono">{hostname}</span> : 'your domain'} directly. Leave blank for a simple page with your name and logo.
        </p>
      </div>

      <div className="pt-3 border-t space-y-4" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Team sign-in page</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Shown at {hostname ? <span className="font-mono">{hostname}/sign-in</span> : 'your domain’s /sign-in page'}, and the logo
            also heads the dashboard your team uses there.
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Logo</label>
          <div className="flex gap-2 items-center flex-wrap">
            {logoUrl.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-8 max-w-[120px] rounded border object-contain" style={{ borderColor: 'var(--border)' }} />
            )}
            <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://… (defaults to your workspace logo)"
              className="flex-1 min-w-[220px] rounded-lg px-3 py-2 text-sm font-mono" style={input} />
            <label className="px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              Upload
              <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif" className="hidden"
                disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f, 'whitelabel-logo'); e.target.value = '' }} />
            </label>
          </div>
        </div>

        <div className="flex gap-6 flex-wrap">
          <ColourField label="Button colour" value={accentColor} onChange={setAccentColor} fallback="#18181b" placeholder="#1d4ed8"
            hint="Leave blank for neutral dark. Also used for the generated favicon." />
          <ColourField label="Button text colour" value={buttonTextColor} onChange={setButtonTextColor}
            fallback={readableTextOn(/^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#18181b')} placeholder="Automatic"
            hint="Leave blank to pick black or white automatically." />
        </div>

        {/* Look-only sample of the sign-in button — the real one is on the
            team sign-in page. Labelled so nobody tries to click it. */}
        <div className="rounded-lg p-3 flex flex-col items-center gap-2" style={{ background: '#f4f4f5' }} aria-hidden="true">
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#71717a' }}>
            Preview only — how the button will look
          </span>
          <span className="px-4 py-2 rounded-lg text-sm font-semibold cursor-default select-none"
            style={{
              background: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#18181b',
              color: /^#[0-9a-f]{6}$/i.test(buttonTextColor) ? buttonTextColor
                : readableTextOn(/^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#18181b'),
            }}>
            Email me a sign-in code
          </span>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Heading</label>
          <input value={loginHeading} onChange={e => setLoginHeading(e.target.value)} maxLength={80} placeholder={`Sign in to ${brandName.trim() || 'your brand'}`}
            className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Message</label>
          <textarea value={loginMessage} onChange={e => setLoginMessage(e.target.value)} maxLength={500} rows={3}
            placeholder="Optional — e.g. who to contact if you can't sign in."
            className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save()}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent-primary)' }}>
          {busy ? 'Saving…' : 'Save branding'}
        </button>
        {msg && <p className="text-xs" style={{ color: msg.ok ? 'var(--text-secondary)' : 'var(--accent-red)' }}>{msg.text}</p>}
      </div>
    </div>
  )
}

/** Hex colour: swatch picker + text box. Blank = the caller's fallback. */
function ColourField({ label, value, onChange, fallback, placeholder, hint }: {
  label: string
  value: string
  onChange: (v: string) => void
  fallback: string
  placeholder: string
  hint: string
}) {
  const valid = /^#[0-9a-f]{6}$/i.test(value)
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</label>
      <div className="flex gap-2 items-center">
        <input type="color" value={valid ? value : fallback} onChange={e => onChange(e.target.value)} aria-label={`${label} picker`}
          className="h-9 w-12 rounded border cursor-pointer" style={{ borderColor: 'var(--border)' }} />
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={7}
          className="w-32 rounded-lg px-3 py-2 text-sm font-mono"
          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} />
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-xs underline" style={{ color: 'var(--text-tertiary)' }}>
            Clear
          </button>
        )}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>
    </div>
  )
}
