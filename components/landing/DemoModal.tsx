'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

/**
 * Conversion-optimized "Book a demo" flow for paid landing pages.
 *
 * Pattern (highest-converting for paid traffic): short qualifying form →
 * SAVE THE LEAD on submit (so a half-finished booking is still ours) →
 * immediately reveal the booking calendar inline. No email-verification
 * step (friction that kills demos); the calendar's own invite confirms.
 *
 * Pixel events: `Lead` fires the moment the form is saved; `Schedule`
 * fires (best-effort) when the embedded GoHighLevel calendar reports a
 * booking. Both are guarded so they no-op when no pixel is on the page.
 *
 * Calendar URL comes from NEXT_PUBLIC_GYMS_DEMO_CALENDAR_URL (the GHL /
 * LeadConnector booking-widget embed URL). Until that's set, the form
 * still captures + qualifies the lead and shows a graceful follow-up note.
 */

const CAL_URL = process.env.NEXT_PUBLIC_GYMS_DEMO_CALENDAR_URL || ''

const LEAD_BUCKETS = ['Under 50', '50–200', '200–500', '500+'] as const

function track(event: string) {
  const w = window as unknown as { fbq?: (...args: unknown[]) => void }
  if (typeof w.fbq === 'function') w.fbq('track', event)
}

export default function DemoModal({
  triggerLabel,
  variant = 'primary',
  source = 'demo',
  heading = 'Book your demo',
  orgLabel = 'Business name',
  orgPlaceholder = 'Acme Inc.',
  emailPlaceholder = 'you@business.com',
}: {
  triggerLabel: string
  variant?: 'primary' | 'link'
  source?: string
  /** Niche-specific modal title, e.g. "Book your med spa demo". */
  heading?: string
  /** Label for the org field, e.g. "Clinic / practice name". */
  orgLabel?: string
  orgPlaceholder?: string
  emailPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'calendar'>('form')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scheduledRef = useRef(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [monthlyLeads, setMonthlyLeads] = useState('')

  const close = useCallback(() => {
    setOpen(false)
    // Reset to the form for next time, after the close animation.
    setTimeout(() => { setStep('form'); setError(''); scheduledRef.current = false }, 200)
  }, [])

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, close])

  // Best-effort: fire Pixel `Schedule` when the embedded GHL calendar
  // reports a booking. LeadConnector posts a window message on completion;
  // we match loosely and fire once.
  useEffect(() => {
    if (step !== 'calendar') return
    const onMsg = (e: MessageEvent) => {
      const blob = typeof e.data === 'string' ? e.data : JSON.stringify(e.data ?? '')
      if (!scheduledRef.current && /book|appointment|schedule|success/i.test(blob)) {
        scheduledRef.current = true
        track('Schedule')
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [step])

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
          name: name.trim(),
          email: email.trim(),
          company: company.trim(),
          phone: phone.trim(),
          monthlyLeads,
          source,
          utm: Object.keys(utm).length ? utm : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.')
      track('Lead')
      setStep('calendar')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  // Pre-fill the GHL booking widget with what they already typed, so they
  // don't re-enter name/email/phone on the calendar — meaningful friction
  // saved at the highest-intent moment.
  const calSrc = (() => {
    if (!CAL_URL) return ''
    const params = new URLSearchParams()
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts[0]) params.set('first_name', parts[0])
    if (parts.length > 1) params.set('last_name', parts.slice(1).join(' '))
    if (email.trim()) params.set('email', email.trim())
    if (phone.trim()) params.set('phone', phone.trim())
    const qs = params.toString()
    return qs ? `${CAL_URL}?${qs}` : CAL_URL
  })()

  const triggerClass =
    variant === 'primary'
      ? 'btn-primary'
      : 'text-sm underline'
  const triggerStyle = variant === 'link' ? { color: 'var(--accent-primary)' } : undefined

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClass} style={triggerStyle}>
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={close}
        >
          <div
            className="relative w-full max-w-md rounded-2xl shadow-2xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none"
              style={{ color: 'var(--text-tertiary)', background: 'var(--surface-secondary)' }}
            >
              ×
            </button>

            {step === 'form' ? (
              <form onSubmit={submit} className="p-6 sm:p-7">
                <h3 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>
                  {heading}
                </h3>
                <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
                  See Voxility answer a lead live. Pick a time on the next step.
                </p>

                <div className="space-y-3">
                  <Field label="Your name" value={name} onChange={setName} required placeholder="Alex Carter" autoComplete="name" />
                  <Field label="Work email" value={email} onChange={setEmail} required type="email" placeholder={emailPlaceholder} autoComplete="email" />
                  <Field label={orgLabel} value={company} onChange={setCompany} required placeholder={orgPlaceholder} autoComplete="organization" />
                  <Field label="Phone" value={phone} onChange={setPhone} required type="tel" placeholder="(555) 123-4567" autoComplete="tel" />
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      New leads per month
                    </label>
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

                {error && <p className="text-xs mt-3" style={{ color: 'var(--accent-red)' }}>{error}</p>}

                <button type="submit" disabled={sending} className="btn-primary w-full mt-5 disabled:opacity-60">
                  {sending ? 'One sec…' : 'See available times →'}
                </button>
                <p className="text-[11px] text-center mt-3" style={{ color: 'var(--text-tertiary)' }}>
                  No spam. We&apos;ll only use this to set up your demo.
                </p>
              </form>
            ) : (
              <div className="p-6 sm:p-7">
                <h3 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>
                  Pick a time {name ? `, ${name.split(' ')[0]}` : ''} 👇
                </h3>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  You&apos;re saved — now grab a slot that works for you.
                </p>
                {calSrc ? (
                  <iframe
                    src={calSrc}
                    title="Book a demo"
                    className="w-full rounded-lg"
                    style={{ height: '60vh', minHeight: 480, border: '1px solid var(--border)' }}
                  />
                ) : (
                  <div className="rounded-lg p-5 text-sm" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    ✓ Got it — we&apos;ll reach out shortly to lock in your demo time. (Booking calendar coming online.)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Field({
  label, value, onChange, required, type = 'text', placeholder, autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  type?: string
  placeholder?: string
  autoComplete?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      />
    </div>
  )
}
