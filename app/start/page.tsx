'use client'

import { useState, type FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'
import { LeadConnectorIcon, HubSpotIcon } from '@/components/icons/brand-icons'
import type { CrmChoice } from '@/lib/signup-intent'

const CRM_OPTIONS: { value: CrmChoice; title: string; sub: string; Icon?: React.ComponentType<{ className?: string }> }[] = [
  { value: 'native', title: "I don't have a CRM", sub: 'Use Xovera’s built-in CRM — nothing to set up', },
  { value: 'ghl', title: 'GoHighLevel', sub: 'Connect your LeadConnector account', Icon: LeadConnectorIcon },
  { value: 'hubspot', title: 'HubSpot', sub: 'Connect your HubSpot account', Icon: HubSpotIcon },
]

export default function StartPage() {
  const [crm, setCrm] = useState<CrmChoice>('native')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/public/signup-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), company: company.trim(), crm }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      // Lead captured + choice stashed — now hand off to Google.
      await signIn('google', { callbackUrl: '/dashboard' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div data-theme="soft-light" className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--background)', color: 'var(--text-primary)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <Link href="/" className="inline-flex mb-5"><XoveraLogo height={32} /></Link>
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>Start free</h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Two quick questions, then you&apos;re in. Free while in beta.</p>
        </div>

        <form onSubmit={go} className="space-y-5">
          {/* CRM choice */}
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Which CRM do you use?</label>
            <div className="space-y-2">
              {CRM_OPTIONS.map((opt) => {
                const selected = crm === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCrm(opt.value)}
                    className="w-full text-left rounded-xl px-4 py-3 flex items-center gap-3 transition-colors"
                    style={selected
                      ? { background: 'var(--accent-primary-bg)', border: '1.5px solid var(--accent-primary)' }
                      : { background: 'var(--surface)', border: '1px solid var(--border)' }}
                  >
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: 'var(--surface-secondary)' }}>
                      {opt.Icon ? <span style={{ color: 'var(--text-primary)' }}><opt.Icon className="w-5 h-5" /></span> : <XoveraLogo variant="mark" height={18} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{opt.title}</span>
                      <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.sub}</span>
                    </span>
                    <span className="ml-auto w-4 h-4 rounded-full shrink-0 flex items-center justify-center" style={selected ? { border: '4px solid var(--accent-primary)', background: 'var(--background)' } : { border: '1.5px solid var(--border-secondary)' }} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Lead capture */}
          <div className="space-y-3">
            <Field label="Your name" value={name} onChange={setName} placeholder="Alex Carter" autoComplete="name" />
            <Field label="Work email" value={email} onChange={setEmail} type="email" placeholder="alex@yourbusiness.com" autoComplete="email" />
            <Field label="Business name" value={company} onChange={setCompany} placeholder="Iron House Fitness" autoComplete="organization" />
          </div>

          {error && <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
            {busy ? 'One sec…' : 'Continue with Google →'}
          </button>
          <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
            We&apos;ll create your account with Google. No credit card required.
          </p>
        </form>

        <p className="text-sm text-center mt-6" style={{ color: 'var(--text-tertiary)' }}>
          Already have an account?{' '}
          <Link href="/login" className="hover:underline" style={{ color: 'var(--text-primary)' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} required placeholder={placeholder} autoComplete={autoComplete}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      />
    </div>
  )
}
