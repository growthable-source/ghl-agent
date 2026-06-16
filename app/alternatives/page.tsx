import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import { ALTERNATIVES } from '@/lib/alternatives-data'
import { SOLUTIONS } from '@/lib/solutions-data'

export const metadata: Metadata = {
  title: 'Voxility alternatives & comparisons',
  description:
    'How Voxility compares to Intercom, Fin, Zendesk AI, Tidio, and Drift — plus solution guides for AI customer service, AI chat widgets, AI receptionists, and AI SDRs.',
  alternates: { canonical: '/alternatives' },
  openGraph: { title: 'Voxility alternatives & comparisons', type: 'website', url: '/alternatives' },
}

export default function AlternativesHub() {
  return (
    <div data-theme="soft-light" className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <MarketingNav />

      <section className="max-w-[1100px] mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="section-label mb-3">Alternatives &amp; comparisons</div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4" style={{ color: 'var(--text-primary)' }}>
            How Voxility compares
          </h1>
          <p className="max-w-2xl mx-auto text-lg" style={{ color: 'var(--text-secondary)' }}>
            Honest, up-to-date comparisons against the tools you&apos;re probably weighing — plus problem-led guides for the outcomes you&apos;re after.
          </p>
        </div>

        <h2 className="text-xl font-bold tracking-tight mb-4">Compared to other tools</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-14">
          {ALTERNATIVES.map((a) => (
            <Link key={a.slug} href={`/${a.slug}`} className="vox-card p-6 block">
              <div className="section-label mb-2">{a.eyebrow}</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Voxility vs. {a.competitor}</h3>
              <p className="text-sm leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>{a.hook}</p>
              <span className="inline-block mt-3 text-sm font-medium" style={{ color: 'var(--accent-primary)' }}>Read the comparison →</span>
            </Link>
          ))}
        </div>

        <h2 className="text-xl font-bold tracking-tight mb-4">By what you want to do</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SOLUTIONS.map((s) => (
            <Link key={s.slug} href={`/${s.slug}`} className="vox-card p-6 block">
              <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{s.eyebrow}</h3>
              <p className="text-sm leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>{s.hook}</p>
              <span className="inline-block mt-3 text-sm font-medium" style={{ color: 'var(--accent-primary)' }}>Learn more →</span>
            </Link>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
