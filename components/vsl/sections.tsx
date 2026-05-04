/**
 * VSL section components.
 *
 * Server-component-safe — no hooks, no event handlers, no `'use client'`.
 * The form section is rendered by the page itself (via FormBlock, which
 * IS a client island). Hero/CTA "scroll to form" works via plain `#form`
 * anchor links + smooth-scroll CSS, no JS needed.
 *
 * Ported from the lead-hacker-daily voxility-integration reference.
 */

import type {
  CTASection,
  FAQSection,
  FooterSection,
  GuaranteeSection,
  HeroSection,
  MechanismSection,
  OfferSection,
  PageSection,
  ProblemSection,
  ProofSection,
  UrgencySection,
} from '@/lib/page-spec'

// ─── Hero ─────────────────────────────────────────────────────────────

function HeroBlock({ s }: { s: HeroSection }) {
  return (
    <section className="relative px-4 pt-12 pb-16 md:pt-20 md:pb-24">
      <div className="mx-auto max-w-3xl text-center">
        {s.eyebrow && (
          <div className="mb-4 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-600">
            {s.eyebrow}
          </div>
        )}
        <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-5xl md:leading-[1.1]">
          {s.headline}
        </h1>
        {s.subheadline && (
          <p className="mt-5 text-lg text-neutral-600 md:text-xl">{s.subheadline}</p>
        )}

        {s.media && s.media.kind !== 'none' && (
          <div className="mt-10 overflow-hidden rounded-xl bg-black shadow-2xl">
            {s.media.kind === 'video' ? (
              <div className="aspect-video">
                <iframe
                  src={s.media.embed_url}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Watch the video"
                />
              </div>
            ) : (
              <img src={s.media.url} alt={s.media.alt} className="h-auto w-full" />
            )}
          </div>
        )}

        {s.cta_label && (
          <a
            href="#form"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-blue-600 px-8 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700"
          >
            {s.cta_label}
          </a>
        )}

        {s.trust_badges && s.trust_badges.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-neutral-500">
            {s.trust_badges.map((b) => (
              <span key={b} className="flex items-center gap-2">
                {/* star */}
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Problem ──────────────────────────────────────────────────────────

function ProblemBlock({ s }: { s: ProblemSection }) {
  return (
    <section className="bg-neutral-50 px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{s.headline}</h2>
        <p className="mt-4 whitespace-pre-line text-base text-neutral-700 md:text-lg">{s.body}</p>
        {s.bullets && s.bullets.length > 0 && (
          <ul className="mt-6 space-y-3">
            {s.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ─── Mechanism ────────────────────────────────────────────────────────

function MechanismBlock({ s }: { s: MechanismSection }) {
  return (
    <section className="px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{s.headline}</h2>
        <p className="mt-4 whitespace-pre-line text-base text-neutral-700 md:text-lg">{s.body}</p>
        {s.steps && s.steps.length > 0 && (
          <ol className="mt-8 space-y-5">
            {s.steps.map((step, i) => (
              <li key={i} className="flex gap-4 rounded-lg border border-neutral-200 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                  {i + 1}
                </div>
                <div>
                  <h3 className="font-semibold">{step.label}</h3>
                  <p className="mt-1 text-sm text-neutral-600">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

// ─── Proof ────────────────────────────────────────────────────────────

function ProofBlock({ s }: { s: ProofSection }) {
  return (
    <section className="bg-neutral-50 px-4 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        {s.headline && (
          <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">{s.headline}</h2>
        )}

        {s.stats && s.stats.length > 0 && (
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {s.stats.map((st, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 bg-white p-6 text-center">
                <div className="text-3xl font-bold text-blue-600 md:text-4xl">{st.value}</div>
                <div className="mt-2 text-sm text-neutral-600">{st.label}</div>
              </div>
            ))}
          </div>
        )}

        {s.testimonials && s.testimonials.length > 0 && (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {s.testimonials.map((t, i) => (
              <figure key={i} className="rounded-lg border border-neutral-200 bg-white p-6">
                <blockquote className="text-base">&ldquo;{t.quote}&rdquo;</blockquote>
                <figcaption className="mt-4 flex items-center gap-3 text-sm">
                  {t.author_image_url && (
                    <img src={t.author_image_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  )}
                  <div>
                    <div className="font-semibold">{t.author_name}</div>
                    {t.author_role && <div className="text-neutral-500">{t.author_role}</div>}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {s.logos && s.logos.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-60">
            {s.logos.map((logo, i) => (
              <img key={i} src={logo.url} alt={logo.alt} className="h-8" />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Offer ────────────────────────────────────────────────────────────

function OfferBlock({ s }: { s: OfferSection }) {
  return (
    <section className="px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">{s.headline}</h2>
        {s.description && (
          <p className="mt-3 text-center text-neutral-600">{s.description}</p>
        )}
        <ul className="mt-8 space-y-3">
          {s.items.map((item, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-4">
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <div className="flex flex-1 items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{item.label}</div>
                  {item.description && (
                    <div className="mt-1 text-sm text-neutral-600">{item.description}</div>
                  )}
                </div>
                {item.value && (
                  <span className="shrink-0 text-sm font-medium text-neutral-500">{item.value}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {(s.total_value || s.price) && (
          <div className="mt-8 rounded-lg bg-blue-50 p-6 text-center">
            {s.total_value && (
              <div className="text-sm text-neutral-600">
                Total value: <span className="font-semibold line-through">{s.total_value}</span>
              </div>
            )}
            {s.price && <div className="mt-1 text-3xl font-bold text-blue-600">{s.price}</div>}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Guarantee ────────────────────────────────────────────────────────

function GuaranteeBlock({ s }: { s: GuaranteeSection }) {
  return (
    <section className="bg-neutral-50 px-4 py-16 md:py-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="relative mb-5 flex h-24 w-24 items-center justify-center rounded-full border-4 border-blue-600 bg-white">
          <svg className="h-10 w-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {s.badge_text && (
            <span className="absolute -bottom-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              {s.badge_text}
            </span>
          )}
        </div>
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{s.headline}</h2>
        <p className="mt-3 max-w-xl whitespace-pre-line text-neutral-600">{s.body}</p>
      </div>
    </section>
  )
}

// ─── Urgency ──────────────────────────────────────────────────────────

function UrgencyBlock({ s }: { s: UrgencySection }) {
  return (
    <section className="px-4 py-12">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-lg border-2 border-blue-200 bg-blue-50 p-6 text-center">
        <h2 className="text-xl font-bold md:text-2xl">{s.headline}</h2>
        {s.body && <p className="max-w-lg text-sm text-neutral-700">{s.body}</p>}
        {s.countdown_to && (
          <p className="text-xs text-neutral-500">
            Closes {new Date(s.countdown_to).toLocaleString()}
          </p>
        )}
      </div>
    </section>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────

function FAQBlock({ s }: { s: FAQSection }) {
  return (
    <section className="px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        {s.headline && (
          <h2 className="mb-6 text-2xl font-bold tracking-tight md:text-3xl">{s.headline}</h2>
        )}
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {s.items.map((item, i) => (
            <details key={i} className="group p-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium">
                {item.question}
                <svg className="mt-1 h-4 w-4 shrink-0 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <p className="mt-3 whitespace-pre-line text-sm text-neutral-600">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────

function CTABlock({ s }: { s: CTASection }) {
  return (
    <section className="bg-blue-600 px-4 py-16 text-white md:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-4xl">{s.headline}</h2>
        {s.body && <p className="mt-3 text-base opacity-90 md:text-lg">{s.body}</p>}
        <a
          href="#form"
          className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-white px-8 text-sm font-semibold text-neutral-900 shadow-lg transition hover:bg-neutral-100"
        >
          {s.cta_label}
        </a>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────

function FooterBlock({ s }: { s: FooterSection }) {
  return (
    <footer className="border-t border-neutral-200 bg-white px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 text-sm text-neutral-600 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-semibold text-neutral-900">{s.business_name}</div>
          {s.business_address && <div className="mt-1">{s.business_address}</div>}
          {s.business_phone && <div className="mt-1">{s.business_phone}</div>}
          {s.business_email && <div className="mt-1">{s.business_email}</div>}
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          {s.legal_links && s.legal_links.length > 0 && (
            <div className="flex gap-4">
              {s.legal_links.map((l) => (
                <a key={l.url} href={l.url} className="hover:underline">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      {s.disclaimer && (
        <div className="mx-auto mt-6 max-w-5xl text-xs text-neutral-400">{s.disclaimer}</div>
      )}
    </footer>
  )
}

// ─── Dispatcher ───────────────────────────────────────────────────────

export function SectionRenderer({ section }: { section: PageSection }) {
  switch (section.type) {
    case 'hero':
      return <HeroBlock s={section} />
    case 'problem':
      return <ProblemBlock s={section} />
    case 'mechanism':
      return <MechanismBlock s={section} />
    case 'proof':
      return <ProofBlock s={section} />
    case 'offer':
      return <OfferBlock s={section} />
    case 'guarantee':
      return <GuaranteeBlock s={section} />
    case 'urgency':
      return <UrgencyBlock s={section} />
    case 'faq':
      return <FAQBlock s={section} />
    case 'cta':
      return <CTABlock s={section} />
    case 'footer':
      return <FooterBlock s={section} />
    case 'form':
      // The form is rendered separately by the page so it can host
      // submission state. The 'form' marker is a layout hint only.
      return null
    default: {
      // Exhaustiveness check
      const _exhaustive: never = section
      void _exhaustive
      return null
    }
  }
}
