import Link from 'next/link'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import type { Alternative } from '@/lib/alternatives-data'
import type { CompareCellKind } from '@/lib/compare-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xovera.io'

const CELL: Record<CompareCellKind, { icon: string; color: string }> = {
  yes: { icon: '✓', color: 'var(--accent-emerald)' },
  no: { icon: '✗', color: 'var(--accent-red)' },
  partial: { icon: '~', color: 'var(--accent-amber)' },
  na: { icon: '–', color: 'var(--text-muted)' },
}

function Cell({ kind, note }: { kind: CompareCellKind; note?: string }) {
  const m = CELL[kind]
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-base leading-none" style={{ color: m.color }}>{m.icon}</span>
      {note && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{note}</span>}
    </div>
  )
}

export default function AlternativePage({ data }: { data: Alternative }) {
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Alternatives', item: `${SITE_URL}/alternatives` },
      { '@type': 'ListItem', position: 3, name: `${data.competitor} alternative`, item: `${SITE_URL}/${data.slug}` },
    ],
  }

  return (
    <div data-theme="soft-light" className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <MarketingNav />

      <article className="max-w-[1000px] mx-auto px-6 py-16">
        {/* Breadcrumb */}
        <nav className="text-xs mb-6" style={{ color: 'var(--text-tertiary)' }}>
          <Link href="/" className="hover:text-[var(--text-primary)] transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/alternatives" className="hover:text-[var(--text-primary)] transition-colors">Alternatives</Link>
          <span className="mx-2">/</span>
          <span style={{ color: 'var(--text-secondary)' }}>{data.competitor} alternative</span>
        </nav>

        {/* Hero */}
        <header className="mb-12">
          <div className="section-label mb-3">{data.eyebrow}</div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] mb-4" style={{ color: 'var(--text-primary)' }}>
            {data.heading}
          </h1>
          <p className="text-lg leading-[1.6] max-w-3xl" style={{ color: 'var(--text-secondary)' }}>{data.hook}</p>
          <div className="flex flex-col sm:flex-row gap-3 mt-7">
            <Link href="/start" className="btn-primary">Start building free</Link>
            <Link href="/#copilot" className="btn-secondary">See the live demo</Link>
          </div>
          <div className="text-xs font-mono mt-4" style={{ color: 'var(--text-tertiary)' }}>Updated {data.updatedAt}</div>
        </header>

        {/* Pitches */}
        <section className="grid md:grid-cols-2 gap-4 mb-14">
          <div className="vox-card p-6">
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>What {data.competitor} is</div>
            <p className="text-[0.95rem] leading-[1.7]" style={{ color: 'var(--text-secondary)' }}>{data.theirPitch}</p>
          </div>
          <div className="vox-card p-6" style={{ background: 'linear-gradient(135deg, var(--accent-primary-bg) 0%, var(--surface) 100%)' }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--accent-primary)' }}>How Xovera is different</div>
            <p className="text-[0.95rem] leading-[1.7]" style={{ color: 'var(--text-secondary)' }}>{data.ourAngle}</p>
          </div>
        </section>

        {/* Feature matrix */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold tracking-tight mb-6">Xovera vs. {data.competitor}, feature by feature</h2>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <div className="grid grid-cols-[1fr_auto_auto] text-sm">
              <div className="px-4 py-3 font-semibold" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}>Feature</div>
              <div className="px-4 py-3 font-semibold text-center min-w-[120px]" style={{ background: 'var(--surface-secondary)', color: 'var(--accent-primary)' }}>Xovera</div>
              <div className="px-4 py-3 font-semibold text-center min-w-[120px]" style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>{data.competitor}</div>
              {data.rows.map((r, i) => (
                <div key={r.feature} className="contents">
                  <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: i % 2 ? 'var(--surface)' : 'transparent' }}>{r.feature}</div>
                  <div className="px-4 py-3 border-t flex justify-center" style={{ borderColor: 'var(--border)', background: i % 2 ? 'var(--surface)' : 'transparent' }}><Cell {...r.us} /></div>
                  <div className="px-4 py-3 border-t flex justify-center" style={{ borderColor: 'var(--border)', background: i % 2 ? 'var(--surface)' : 'transparent' }}><Cell {...r.them} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Verdicts */}
        <section className="grid md:grid-cols-2 gap-4 mb-14">
          <div className="vox-card p-6">
            <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>When {data.competitor} is the better pick</h3>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {data.whenToPickThem.map((t) => (<li key={t} className="flex gap-2"><span style={{ color: 'var(--text-tertiary)' }}>•</span>{t}</li>))}
            </ul>
          </div>
          <div className="vox-card p-6">
            <h3 className="font-semibold mb-3" style={{ color: 'var(--accent-primary)' }}>When Xovera is the better pick</h3>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {data.whenToPickUs.map((t) => (<li key={t} className="flex gap-2"><span style={{ color: 'var(--accent-primary)' }}>✓</span>{t}</li>))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold tracking-tight mb-6">{data.competitor} alternative — FAQ</h2>
          <div className="vox-card p-6 md:p-8">
            {data.faqs.map((f) => (
              <details key={f.q} className="group border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <summary className="flex items-center justify-between cursor-pointer py-5 font-semibold text-[0.9375rem] list-none [&::-webkit-details-marker]:hidden" style={{ color: 'var(--text-primary)' }}>
                  {f.q}
                  <span className="ml-4 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }}>⌄</span>
                </summary>
                <p className="pb-5 text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="vox-card p-8 md:p-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">See why teams switch to Xovera.</h2>
          <p className="mb-6 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>Build your first AI agent in under 5 minutes. Free while in beta.</p>
          <Link href="/start" className="btn-primary">Start building free</Link>
        </section>
      </article>

      <MarketingFooter />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </div>
  )
}
