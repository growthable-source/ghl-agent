'use client'

import { useState } from 'react'
import type { SiteReview } from './page'

/**
 * The review, then the offer, then one short form.
 *
 * Deliberately quiet: this page opens by telling a business owner what is
 * wrong with their website, which only lands if it reads as an honest
 * assessment rather than a pitch. The offer comes after the review, and the
 * form asks for the least we can act on.
 */

export default function RedesignClient({
  slug,
  businessName,
  websiteDomain,
  websiteUrl,
  contactEmail,
  review,
  alreadyRequested,
  previewUrl,
}: {
  slug: string
  businessName: string
  websiteDomain: string
  websiteUrl: string
  contactEmail: string | null
  review: SiteReview | null
  alreadyRequested: boolean
  previewUrl: string | null
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState(contactEmail ?? '')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(alreadyRequested)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/redesign/${slug}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, notes }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const findings = review?.findings ?? []

  return (
    <main className="min-h-screen px-6 py-14 sm:py-20" style={{ background: 'var(--surface-primary)' }}>
      <div className="max-w-2xl mx-auto">
        <p
          className="font-extrabold text-xs tracking-[0.2em] uppercase mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          Website review
        </p>
        <h1
          className="font-black tracking-tight mb-5"
          style={{ fontSize: 'clamp(1.8rem, 4.5vw, 3rem)', color: 'var(--text-primary)' }}
        >
          {businessName}
        </h1>
        <p className="mb-10 leading-[1.65]" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          We looked at{' '}
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline"
            style={{ color: 'var(--text-primary)' }}
          >
            {websiteDomain}
          </a>
          {review?.summary ? <> — {review.summary}</> : '.'}
        </p>

        {findings.length > 0 && (
          <section className="mb-12">
            <h2 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>
              What we found
            </h2>
            <ul className="space-y-5">
              {findings.map((f, i) => (
                <li
                  key={i}
                  className="rounded-2xl border p-5"
                  style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
                >
                  <p className="font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    {f.title}
                  </p>
                  <p className="leading-[1.6] text-[0.95rem]" style={{ color: 'var(--text-secondary)' }}>
                    {f.detail}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(review?.suggestions?.length ?? 0) > 0 && (
          <section className="mb-12">
            <h2 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>
              What we&apos;d do differently
            </h2>
            <ul className="space-y-2.5">
              {review!.suggestions!.map((s, i) => (
                <li key={i} className="flex gap-3 leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>
                  <span aria-hidden style={{ color: 'var(--text-primary)' }}>
                    →
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section
          className="rounded-3xl border px-6 sm:px-10 py-10"
          style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
        >
          {done ? (
            <div className="text-center">
              <h2 className="font-black tracking-tight mb-3" style={{ fontSize: '1.65rem', color: 'var(--text-primary)' }}>
                {previewUrl ? 'Your new site is ready' : "You're on the list"}
              </h2>
              {previewUrl ? (
                <>
                  <p className="mb-7 leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
                    Here&apos;s the rebuild we made for {businessName}. Nothing is live — have a look
                    and tell us if you want it.
                  </p>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-lg py-4 px-10 rounded-full inline-block"
                  >
                    View your new site →
                  </a>
                </>
              ) : (
                <p className="leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
                  We&apos;ll build your new page and email it over. No charge, and nothing goes live
                  unless you ask it to.
                </p>
              )}
            </div>
          ) : (
            <>
              <h2
                className="font-black tracking-tight mb-3"
                style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', color: 'var(--text-primary)' }}
              >
                We&apos;ll rebuild it for you, free.
              </h2>
              <p className="mb-8 leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
                A new homepage for {businessName}, built from scratch. We send you a preview to look
                at — no charge and no obligation. You only pay if you want us to put it live.
              </p>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label htmlFor="rd-name" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Your name
                  </label>
                  <input
                    id="rd-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={120}
                    autoComplete="name"
                    className="w-full rounded-xl border px-4 py-3"
                    style={{ background: 'var(--surface-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label htmlFor="rd-email" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Where should we send it?
                  </label>
                  <input
                    id="rd-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={254}
                    autoComplete="email"
                    className="w-full rounded-xl border px-4 py-3"
                    style={{ background: 'var(--surface-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label htmlFor="rd-notes" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Anything we should know? <span className="font-normal opacity-60">(optional)</span>
                  </label>
                  <textarea
                    id="rd-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Colours you like, pages that matter most, anything to avoid…"
                    className="w-full rounded-xl border px-4 py-3"
                    style={{ background: 'var(--surface-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm" style={{ color: '#e84425' }}>
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary text-lg py-4 px-10 rounded-full w-full sm:w-auto disabled:opacity-60"
                >
                  {submitting ? 'Sending…' : 'Build my new site →'}
                </button>
              </form>
            </>
          )}
        </section>

        <p className="mt-8 text-center text-sm leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>
          This review was generated from your public homepage. If something here is wrong, tell us in
          the notes — we&apos;d rather know.
        </p>
      </div>
    </main>
  )
}
