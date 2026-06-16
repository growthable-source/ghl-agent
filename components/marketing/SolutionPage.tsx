import Link from 'next/link'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import type { Solution } from '@/lib/solutions-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

export default function SolutionPage({ data }: { data: Solution }) {
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
      { '@type': 'ListItem', position: 2, name: data.eyebrow, item: `${SITE_URL}/${data.slug}` },
    ],
  }
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `Voxility — ${data.eyebrow}`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: data.metaDescription,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free during beta' },
  }

  return (
    <div data-theme="soft-light" className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <MarketingNav />

      {/* Hero */}
      <section className="relative pt-16 pb-12 px-6 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(232,68,37,0.07), transparent 60%)' }} />
        <div className="relative z-10 max-w-[900px] mx-auto text-center">
          <div className="section-label mb-3">{data.eyebrow}</div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.08] mb-5" style={{ color: 'var(--text-primary)' }}>
            {data.heading}
          </h1>
          <p className="text-lg leading-[1.6] max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>{data.hook}</p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8 justify-center">
            <Link href="/login?mode=signup" className="btn-primary">Start building free</Link>
            <Link href="/#copilot" className="btn-secondary">See the live demo</Link>
          </div>
        </div>
      </section>

      {/* Proof stats */}
      <section className="px-6 mb-16">
        <div className="max-w-[900px] mx-auto grid grid-cols-3 gap-6 text-center border-y py-8" style={{ borderColor: 'var(--border)' }}>
          {data.proof.map((p) => (
            <div key={p.label}>
              <div className="stat-value mb-2">{p.value}</div>
              <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{p.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Intro */}
      <section className="px-6 mb-16">
        <p className="max-w-[760px] mx-auto text-center text-[1.0625rem] leading-[1.7]" style={{ color: 'var(--text-secondary)' }}>{data.intro}</p>
      </section>

      {/* Features */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.features.map((f) => (
            <div key={f.title} className="vox-card p-7">
              <div className="icon-box mb-5">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{f.title}</h3>
              <p className="text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 mb-20">
        <div className="max-w-[760px] mx-auto">
          <h2 className="text-2xl font-bold tracking-tight mb-6 text-center">Frequently asked</h2>
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
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 mb-20">
        <div className="max-w-[760px] mx-auto vox-card p-8 md:p-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">Ready to see it work?</h2>
          <p className="mb-6 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>Build your first AI agent in under 5 minutes. Free while in beta.</p>
          <Link href="/login?mode=signup" className="btn-primary">Start building free</Link>
        </div>
      </section>

      <MarketingFooter />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </div>
  )
}
