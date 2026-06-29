'use client'

import { useState, type FormEvent } from 'react'

/**
 * Inline lead-capture box for landing pages — a real form embedded in the
 * page (not behind a modal), for the high-intent moment near the bottom.
 * Posts to the same endpoint as the demo modal and fires the Pixel `Lead`
 * event, then swaps to a success state in place.
 */
const LEAD_BUCKETS = ['Under 50', '50–200', '200–500', '500+'] as const

function track(event: string) {
  const w = window as unknown as { fbq?: (...args: unknown[]) => void }
  if (typeof w.fbq === 'function') w.fbq('track', event)
}

export default function InlineLeadForm({
  source = 'inline',
  orgLabel = 'Gym / studio name',
  orgPlaceholder = 'Iron House Fitness',
  emailPlaceholder = 'alex@yourgym.com',
  cta = 'Book my demo',
}: {
  source?: string
  orgLabel?: string
  orgPlaceholder?: string
  emailPlaceholder?: string
  cta?: string
}) {
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [monthlyLeads, setMonthlyLeads] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError('')
    try {
      const utm: Record<string, string> = {}
      const sp = new URLSearchParams(window.location.search)
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        const v = sp.get(k)
        if (v) utm[k] = v
      }
      const res = await fetch('/api/public/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), company: company.trim(),
          phone: phone.trim(), monthlyLeads, source,
          utm: Object.keys(utm).length ? utm : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.')
      track('Lead')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl p-7 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="mx-auto mb-4 flex items-center justify-center rounded-full" style={{ width: '3rem', height: '3rem', background: 'var(--accent-primary-bg)' }}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="var(--accent-primary)"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
        </div>
        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>You&apos;re in, {name.split(' ')[0] || 'there'} 🎉</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>We&apos;ll reach out shortly to lock in your demo — usually within a couple of hours on a business day.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-2xl p-6 sm:p-7" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 20px 60px -20px rgba(0,0,0,0.45)' }}>
      <div className="space-y-3">
        <Field label="Your name" value={name} onChange={setName} required placeholder="Alex Carter" autoComplete="name" />
        <Field label="Work email" value={email} onChange={setEmail} required type="email" placeholder={emailPlaceholder} autoComplete="email" />
        <div className="grid grid-cols-2 gap-3">
          <Field label={orgLabel} value={company} onChange={setCompany} required placeholder={orgPlaceholder} autoComplete="organization" />
          <Field label="Phone" value={phone} onChange={setPhone} required type="tel" placeholder="(555) 123-4567" autoComplete="tel" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>New leads per month</label>
          <select
            value={monthlyLeads}
            onChange={(e) => setMonthlyLeads(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="">Select…</option>
            {LEAD_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-xs mt-3" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>}
      <button type="submit" disabled={sending} className="btn-primary w-full mt-5 disabled:opacity-60">
        {sending ? 'One sec…' : cta}
      </button>
      <p className="text-[11px] text-center mt-3" style={{ color: 'var(--text-tertiary)' }}>
        No spam. We&apos;ll only use this to set up your demo.
      </p>
    </form>
  )
}

function Field({
  label, value, onChange, required, type = 'text', placeholder, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean
  type?: string; placeholder?: string; autoComplete?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      />
    </div>
  )
}
