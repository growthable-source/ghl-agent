import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import VoxilityLogo from '@/components/VoxilityLogo'
import { findComparisonBySlug, COMPARISONS, type CompareCellKind } from '@/lib/compare-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

type Params = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  return COMPARISONS.map(c => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const cmp = findComparisonBySlug(slug)
  if (!cmp) return {}
  return {
    title: cmp.title,
    description: cmp.description,
    alternates: { canonical: `/compare/${cmp.slug}` },
    openGraph: {
      type: 'article',
      title: cmp.title,
      description: cmp.description,
      url: `${SITE_URL}/compare/${cmp.slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: cmp.title,
      description: cmp.description,
    },
  }
}

/**
 * Individual comparison page. Designed to rank for "<us> vs <them>"
 * and adjacent intent queries while staying genuinely honest — the
 * "when to pick them" section isn't there as a flex, it's the single
 * biggest trust signal a comparison page can emit.
 */
export default async function ComparePage({ params }: Params) {
  const { slug } = await params
  const cmp = findComparisonBySlug(slug)
  if (!cmp) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: cmp.title,
    description: cmp.description,
    datePublished: cmp.updatedAt,
    dateModified: cmp.updatedAt,
    author: { '@type': 'Organization', name: 'Voxility', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'Voxility',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo-color.svg` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/compare/${cmp.slug}` },
  }

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Compare', item: `${SITE_URL}/compare` },
      { '@type': 'ListItem', position: 3, name: `${cmp.us} vs ${cmp.them}`, item: `${SITE_URL}/compare/${cmp.slug}` },
    ],
  }

  return (
    <div className="min-h-screen" style={{ background: '#05080f', color: '#f8fafc' }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl border-b" style={{ background: 'rgba(5,8,15,0.92)', borderColor: 'rgba(18,26,43,0.8)' }}>
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center">
            <VoxilityLogo height={26} />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm">
            <Link href="/" className="hover:text-white transition-colors" style={{ color: '#94a3b8' }}>Home</Link>
            <Link href="/blog" className="hover:text-white transition-colors" style={{ color: '#94a3b8' }}>Blog</Link>
            <Link href="/compare" className="hover:text-white transition-colors" style={{ color: '#94a3b8' }}>Compare</Link>
          </div>
          <Link href="/login?mode=signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
        </div>
      </nav>

      <article className="max-w-[900px] mx-auto px-6 py-16">
        {/* Breadcrumb */}
        <nav className="text-xs mb-6" style={{ color: '#64748b' }}>
          <Link href="/" className="hover:text-white transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/compare" className="hover:text-white transition-colors">Compare</Link>
          <span className="mx-2">/</span>
          <span style={{ color: '#94a3b8' }}>{cmp.us} vs {cmp.them}</span>
        </nav>

        {/* Header */}
        <header className="mb-10">
          <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: '#fa4d2e' }}>
            Honest comparison
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] mb-4" style={{ color: '#f8fafc' }}>
            {cmp.us} <span style={{ color: '#64748b', fontWeight: 400 }}>vs.</span>{' '}
            <span className="text-gradient">{cmp.them}</span>
          </h1>
          <p className="text-lg leading-[1.6]" style={{ color: '#94a3b8' }}>
            {cmp.description}
          </p>
          <div className="text-xs font-mono mt-4" style={{ color: '#64748b' }}>
            Updated {cmp.updatedAt}
          </div>
        </header>

        {/* Pitches side-by-side */}
        <section className="grid md:grid-cols-2 gap-4 mb-14">
          <div className="vox-card p-6">
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: '#94a3b8' }}>What {cmp.them} is</div>
            <p className="text-[0.95rem] leading-[1.7]" style={{ color: '#cbd5e1' }}>{cmp.theirPitch}</p>
          </div>
          <div className="vox-card p-6" style={{ background: 'linear-gradient(135deg, rgba(250,77,46,0.04) 0%, #0c111d 100%)' }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: '#fa4d2e' }}>How {cmp.us} is different</div>
            <p className="text-[0.95rem] leading-[1.7]" style={{ color: '#cbd5e1' }}>{cmp.ourAngle}</p>
          </div>
        </section>

        {/* Feature matrix */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold tracking-tight mb-6">Feature-by-feature</h2>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#121a2b' }}>
            <table className="w-full text-sm">
              <thead style={{ background: '#090d15' }}>
                <tr>
                  <th className="text-left px-5 py-3 font-semibold" style={{ color: '#94a3b8' }}>Feature</th>
                  <th className="text-left px-5 py-3 font-semibold" style={{ color: '#fa4d2e' }}>{cmp.us}</th>
                  <th className="text-left px-5 py-3 font-semibold" style={{ color: '#94a3b8' }}>{cmp.them}</th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((row, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: '#121a2b' }}>
                    <td className="px-5 py-3.5" style={{ color: '#cbd5e1' }}>{row.feature}</td>
                    <td className="px-5 py-3.5"><Cell kind={row.us.kind} note={row.us.note} /></td>
                    <td className="px-5 py-3.5"><Cell kind={row.them.kind} note={row.them.note} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* When to pick — the honest section */}
        <section className="grid md:grid-cols-2 gap-4 mb-14">
          <div className="vox-card p-6">
            <h3 className="text-lg font-semibold mb-4" style={{ color: '#f8fafc' }}>When to pick {cmp.them}</h3>
            <ul className="space-y-2.5 text-sm leading-[1.6]" style={{ color: '#94a3b8' }}>
              {cmp.whenToPickThem.map((line, i) => (
                <li key={i} className="flex gap-2"><span style={{ color: '#64748b' }}>→</span>{line}</li>
              ))}
            </ul>
          </div>
          <div className="vox-card p-6" style={{ background: 'linear-gradient(135deg, rgba(250,77,46,0.04) 0%, #0c111d 100%)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: '#f8fafc' }}>When to pick {cmp.us}</h3>
            <ul className="space-y-2.5 text-sm leading-[1.6]" style={{ color: '#cbd5e1' }}>
              {cmp.whenToPickUs.map((line, i) => (
                <li key={i} className="flex gap-2"><span style={{ color: '#fa4d2e' }}>→</span>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-lg p-8 md:p-10 text-center" style={{ background: 'linear-gradient(135deg, #090d15 0%, #0f1524 100%)', border: '1px solid #121a2b' }}>
          <h2 className="text-2xl font-bold mb-3" style={{ color: '#f8fafc' }}>Try {cmp.us} on your own conversations</h2>
          <p className="mb-6 max-w-xl mx-auto" style={{ color: '#94a3b8' }}>
            Run your 2–3 hardest real customer scenarios through both platforms. The honest test beats any comparison page.
          </p>
          <Link href="/login?mode=signup" className="btn-primary">
            Start building free →
          </Link>
        </section>

        {/* Structured data */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      </article>
    </div>
  )
}

function Cell({ kind, note }: { kind: CompareCellKind; note?: string }) {
  const badge =
    kind === 'yes' ? { symbol: '✓', bg: 'rgba(22,162,73,0.12)', fg: '#16a249' } :
    kind === 'no' ? { symbol: '✗', bg: 'rgba(239,67,67,0.1)', fg: '#ef4343' } :
    kind === 'partial' ? { symbol: '~', bg: 'rgba(251,191,36,0.1)', fg: '#fbbf24' } :
    { symbol: '—', bg: 'rgba(100,116,139,0.1)', fg: '#64748b' }
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0"
        style={{ background: badge.bg, color: badge.fg }}
        aria-hidden="true"
      >
        {badge.symbol}
      </span>
      {note && <span className="text-xs" style={{ color: '#94a3b8' }}>{note}</span>}
    </div>
  )
}
