'use client'

/**
 * FormBlock — client island for the contact form on a published landing page.
 *
 * Submission goes to /api/public/form-submit (no auth, validates the
 * landing page, upserts the contact via CrmAdapter). Captures Meta browser
 * cookies (_fbp, _fbc) and gclid so the server-side conversion event can
 * dedupe with the browser pixel and attribute clicks correctly.
 */

import { useEffect, useState, type FormEvent } from 'react'
import type { CanonicalFormField, FormSchema, FormSection } from '@/lib/page-spec'

const FIELD_LABELS: Record<CanonicalFormField, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  phone: 'Phone',
  message: 'Message',
}

const FIELD_PLACEHOLDERS: Record<CanonicalFormField, string> = {
  first_name: 'Your first name',
  last_name: 'Your last name',
  email: 'you@example.com',
  phone: '+1 555 555 5555',
  message: 'Anything we should know?',
}

const FIELD_INPUT_TYPES: Record<CanonicalFormField, 'text' | 'email' | 'tel' | 'textarea'> = {
  first_name: 'text',
  last_name: 'text',
  email: 'email',
  phone: 'tel',
  message: 'textarea',
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[2]) : null
}

function readUTM(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const utm: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = params.get(k)
    if (v) utm[k.replace('utm_', '')] = v
  }
  return utm
}

export interface FormBlockProps {
  section?: FormSection
  schema: FormSchema
  pageId: string
  campaignId: string | null
}

export function FormBlock({ section, schema, pageId, campaignId }: FormBlockProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tracking, setTracking] = useState<{
    fbp: string | null
    fbc: string | null
    gclid: string | null
    utm: Record<string, string>
    referrer: string
  }>({ fbp: null, fbc: null, gclid: null, utm: {}, referrer: '' })

  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    setTracking({
      fbp: readCookie('_fbp'),
      fbc: readCookie('_fbc'),
      gclid: params?.get('gclid') ?? null,
      utm: readUTM(),
      referrer: typeof document !== 'undefined' ? document.referrer : '',
    })
  }, [])

  function setField(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }))
  }

  function validate(): string | null {
    for (const f of schema.required) {
      const v = (values[f] ?? '').trim()
      if (!v) return `${FIELD_LABELS[f]} is required.`
      if (f === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return 'Please enter a valid email.'
      }
      if (f === 'phone' && v.replace(/\D/g, '').length < 7) {
        return 'Please enter a valid phone number.'
      }
    }
    return null
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/public/form-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landing_page_id: pageId,
          campaign_id: campaignId,
          fields: values,
          tracking,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Submission failed (HTTP ${res.status}).`)
      }
      setSubmitted(true)
      // Browser-side pixel firing happens here too — server-side CAPI in
      // the conversion-fire job (phase 4) provides the dedup-safe second
      // source.
      const w = window as unknown as { fbq?: (...args: unknown[]) => void; gtag?: (...args: unknown[]) => void }
      if (typeof w.fbq === 'function') w.fbq('track', 'Lead')
      if (typeof w.gtag === 'function') w.gtag('event', 'conversion', { send_to: 'auto' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <section id="form" className="px-4 py-20 md:py-28">
        <div className="mx-auto max-w-md rounded-3xl border bg-white p-10 text-center"
          style={{
            borderColor: 'rgba(0,0,0,0.06)',
            boxShadow: '0 30px 60px -25px rgba(0,0,0,0.18), 0 0 0 1px var(--brand-soft, rgba(10,132,255,0.12)) inset',
          }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))' }}>
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              style={{ color: 'var(--brand, #0A84FF)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--page-font-display, inherit)' }}>
            {schema.success_headline ?? "You're in."}
          </div>
          <p className="mt-3 text-base" style={{ color: 'rgba(0,0,0,0.65)' }}>
            {schema.success_body ?? "We'll be in touch shortly."}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section id="form" className="px-4 py-20 md:py-28" style={{ background: '#fafafa' }}>
      <div className="mx-auto max-w-md rounded-3xl border bg-white p-7 md:p-9"
        style={{
          borderColor: 'rgba(0,0,0,0.06)',
          boxShadow: '0 30px 60px -25px rgba(0,0,0,0.18), 0 0 0 1px var(--brand-soft, rgba(10,132,255,0.12)) inset',
        }}>
        {section?.headline && (
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl"
            style={{ fontFamily: 'var(--page-font-display, inherit)', letterSpacing: '-0.02em' }}>
            {section.headline}
          </h2>
        )}
        {section?.body && (
          <p className="mt-2 text-sm" style={{ color: 'rgba(0,0,0,0.65)' }}>{section.body}</p>
        )}
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {schema.fields.map((f) => {
            const isRequired = schema.required.includes(f)
            const isTextarea = FIELD_INPUT_TYPES[f] === 'textarea'
            return (
              <div key={f}>
                <label className="block text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'rgba(0,0,0,0.6)' }} htmlFor={`f_${f}`}>
                  {FIELD_LABELS[f]} {isRequired && <span style={{ color: 'var(--brand, #0A84FF)' }}>*</span>}
                </label>
                {isTextarea ? (
                  <textarea
                    id={`f_${f}`}
                    name={f}
                    rows={3}
                    required={isRequired}
                    placeholder={FIELD_PLACEHOLDERS[f]}
                    value={values[f] ?? ''}
                    onChange={(e) => setField(f, e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border bg-white px-3 py-2.5 text-sm transition focus:outline-none focus:ring-2"
                    style={{
                      borderColor: 'rgba(0,0,0,0.12)',
                      ['--tw-ring-color' as string]: 'var(--brand, #0A84FF)',
                    }}
                  />
                ) : (
                  <input
                    id={`f_${f}`}
                    name={f}
                    type={FIELD_INPUT_TYPES[f]}
                    required={isRequired}
                    placeholder={FIELD_PLACEHOLDERS[f]}
                    autoComplete={
                      f === 'email'
                        ? 'email'
                        : f === 'phone'
                          ? 'tel'
                          : f === 'first_name'
                            ? 'given-name'
                            : f === 'last_name'
                              ? 'family-name'
                              : 'off'
                    }
                    value={values[f] ?? ''}
                    onChange={(e) => setField(f, e.target.value)}
                    className="mt-1.5 block h-12 w-full rounded-xl border bg-white px-3.5 text-sm transition focus:outline-none focus:ring-2"
                    style={{
                      borderColor: 'rgba(0,0,0,0.12)',
                      ['--tw-ring-color' as string]: 'var(--brand, #0A84FF)',
                    }}
                  />
                )}
              </div>
            )
          })}
          {error && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-14 w-full items-center justify-center rounded-xl text-base font-semibold transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0"
            style={{
              background: 'var(--brand, #0A84FF)',
              color: 'var(--brand-fg, #ffffff)',
              boxShadow: '0 14px 30px -10px var(--brand-glow, rgba(10,132,255,0.4))',
            }}
          >
            {submitting ? 'Submitting…' : schema.cta_label}
          </button>
          {schema.consent_text && (
            <p className="text-center text-[11px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.5)' }}>
              {schema.consent_text}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}
