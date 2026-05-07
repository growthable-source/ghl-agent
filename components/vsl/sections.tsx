/**
 * VSL section components — visual rewrite.
 *
 * Goals over the previous version:
 *  - Honour `style.primary_color` everywhere via CSS variables (--brand,
 *    --brand-fg, --brand-soft, --brand-deep, --brand-glow). The page
 *    wrapper sets these; every accent (button, chip, gradient) reads
 *    from them. No more pages-all-look-blue.
 *  - Honour `style.font_family` via --page-font-display.
 *  - Real visual hierarchy: clamp()-scaled headlines, gradient backdrops,
 *    glassy cards, animated reveals, generous whitespace.
 *  - Wire AI-generated imagery (hero photo, mechanism step icons) when
 *    the spec includes them. Fall back gracefully when not.
 *
 * Server-component-safe — no hooks, no event handlers, no `'use client'`.
 * The form section is rendered separately by FormBlock (the only client
 * island). Hero/CTA "scroll to form" still uses plain `#form` anchor
 * links + smooth-scroll CSS.
 */

import type { CSSProperties, ReactNode } from 'react'
import { LucideIcon } from './LucideIcon'
import type {
  CTASection,
  FAQSection,
  FooterSection,
  GuaranteeSection,
  HeaderSection,
  HeroSection,
  MechanismSection,
  OfferSection,
  PageImages,
  PageSection,
  ProblemSection,
  ProofSection,
  UrgencySection,
} from '@/lib/page-spec'

// ─── Shared style fragments ──────────────────────────────────────────────

/** Primary CTA (filled with brand color). */
const ctaPrimary: CSSProperties = {
  background: 'var(--brand, #0A84FF)',
  color: 'var(--brand-fg, #ffffff)',
  boxShadow: '0 10px 30px -10px var(--brand-glow, rgba(10,132,255,0.4))',
}

/** Soft brand chip — subtle tint of brand color, used for eyebrows. */
const brandChip: CSSProperties = {
  background: 'var(--brand-soft, rgba(10,132,255,0.12))',
  color: 'var(--brand-deep, #0066cc)',
}

/** Display font (for big headlines). Falls back to body if no display
 *  font is loaded. */
const displayFont: CSSProperties = { fontFamily: 'var(--page-font-display, inherit)' }

/** Script accent font (Allura) used for [accent]…[/accent] markup
 *  in hero headlines. Loaded by app/p/layout.tsx. */
const scriptFont: CSSProperties = { fontFamily: 'var(--page-font-script, "Brush Script MT", cursive)' }

/**
 * Render a headline with [accent]…[/accent] markup parsed into a
 * brand-colored, script-font phrase on its own visual line. Used by
 * the hero — operators (or the AI) write copy like:
 *   "Launch Your [accent]Beauty Brand[/accent] With Confidence"
 * and the marked phrase pops as the emotional anchor of the headline.
 *
 * Pure split-on-marker — no DOM injection, no dangerouslySetInnerHTML,
 * so safe even when the spec is operator-edited. Scales the accent
 * relative to base font-size via 1.05em so it always looks right
 * regardless of the surrounding clamp().
 */
function renderHeadlineWithAccent(headline: string): ReactNode[] {
  const parts: ReactNode[] = []
  let cursor = 0
  const re = /\[accent\]([\s\S]+?)\[\/accent\]/g
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(headline)) !== null) {
    if (match.index > cursor) {
      parts.push(headline.slice(cursor, match.index))
    }
    parts.push(
      <span
        key={`a${i++}`}
        className="block"
        style={{
          ...scriptFont,
          color: 'var(--brand, #0A84FF)',
          fontWeight: 400,
          fontStyle: 'italic',
          // Allura/script faces look better slightly oversized vs the
          // surrounding sans display.
          fontSize: '1.15em',
          lineHeight: 1.05,
          // Pull script up just a touch so it visually nests with the
          // baseline of the surrounding line rather than feeling stranded.
          marginTop: '-0.05em',
          marginBottom: '-0.05em',
          letterSpacing: '0',
        }}
      >
        {match[1]}
      </span>,
    )
    cursor = match.index + match[0].length
  }
  if (cursor < headline.length) {
    parts.push(headline.slice(cursor))
  }
  return parts.length > 0 ? parts : [headline]
}

// ─── Header (top nav) ────────────────────────────────────────────────────

function HeaderBlock({ s, fallbackLogoUrl }: { s: HeaderSection; fallbackLogoUrl?: string | null }) {
  const logo = s.logo_url || fallbackLogoUrl
  const ctaHref = s.cta_target === 'form' || !s.cta_target ? '#form' : s.cta_target
  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md"
      style={{
        background: 'rgba(255, 255, 255, 0.85)',
        borderBottomWidth: '1px',
        borderBottomStyle: 'solid',
        borderBottomColor: 'rgba(0,0,0,0.06)',
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 md:px-6">
        <a href="#top" className="flex items-center gap-2.5 shrink-0">
          {logo ? (
            <img src={logo} alt={s.business_name ?? 'Logo'} className="block h-8 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="text-base font-semibold tracking-tight" style={{ ...displayFont, color: 'var(--text-primary, #0a0a0a)' }}>
              {s.business_name ?? 'Brand'}
            </span>
          )}
        </a>
        {s.nav_links && s.nav_links.length > 0 && (
          <nav className="hidden md:flex items-center gap-7 text-sm" style={{ color: 'rgba(0,0,0,0.7)' }}>
            {s.nav_links.map((link) => (
              <a key={link.href + link.label} href={link.href} className="transition-opacity hover:opacity-100" style={{ opacity: 0.75 }}>
                {link.label}
              </a>
            ))}
          </nav>
        )}
        {s.cta_label && (
          <a
            href={ctaHref}
            className="inline-flex h-10 items-center rounded-lg px-4 text-xs font-semibold transition-transform hover:-translate-y-0.5"
            style={ctaPrimary}
          >
            {s.cta_label}
          </a>
        )}
      </div>
    </header>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────

function HeroBlock({ s, images, inlineForm }: { s: HeroSection; images?: PageImages; inlineForm?: ReactNode }) {
  const heroImage = (s.media?.kind === 'image' && s.media.url) ? { url: s.media.url, alt: s.media.alt } : null
  const aiHero = images?.hero_url
  const operatorOrAiImage = heroImage?.url ?? aiHero ?? null
  const isVideo = s.media?.kind === 'video'

  // Resolve the layout. AI-emitted layout takes precedence; otherwise
  // we infer from what's present:
  //   - inline form passed in → form-in-hero (page renders form on right)
  //   - photo present → image-bg (full-bleed hero photo with overlay)
  //   - nothing → gradient
  // Video heroes are always centred full-width below the copy.
  const layout: 'gradient' | 'split-image' | 'image-bg' | 'form-in-hero' =
    isVideo
      ? 'gradient'
      : inlineForm
        ? 'form-in-hero'
        : (s.layout ?? (operatorOrAiImage ? 'image-bg' : 'gradient'))

  const isFormInHero = layout === 'form-in-hero'
  const isImageBg = layout === 'image-bg' && !!operatorOrAiImage
  const isSplitImage = layout === 'split-image' && !!operatorOrAiImage
  const isGradient = !isFormInHero && !isImageBg && !isSplitImage
  // Anything that puts content on the LEFT and another column on the
  // RIGHT is "two-column"; aligns text left, otherwise centred.
  const twoColumn = isFormInHero || isSplitImage

  return (
    <section
      className={`relative overflow-hidden px-4 ${isGradient ? 'pt-24 pb-28 md:pt-32 md:pb-36' : 'pt-16 pb-20 md:pt-20 md:pb-28'}`}
      id="top"
    >
      <HeroBackdrop variant={layout} bgImage={isImageBg ? operatorOrAiImage : null} />

      <div className={`mx-auto grid items-center gap-12 ${twoColumn ? 'max-w-7xl md:grid-cols-2' : 'max-w-4xl'}`}>
        <div className={twoColumn ? 'text-left' : 'text-center'} style={isImageBg ? { color: '#0a0a0a' } : undefined}>
          {s.eyebrow && (
            <div
              className="mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
              style={isImageBg ? { background: 'rgba(255,255,255,0.85)', color: 'var(--brand-deep, #0066cc)' } : brandChip}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--brand, #0A84FF)' }} />
              {s.eyebrow}
            </div>
          )}
          <h1
            className="font-bold tracking-tight"
            style={{
              ...displayFont,
              fontSize: isGradient
                ? 'clamp(2.5rem, 6vw + 0.5rem, 5.5rem)'
                : 'clamp(2.25rem, 4.5vw + 0.5rem, 4.25rem)',
              lineHeight: isGradient ? 0.98 : 1.05,
              letterSpacing: '-0.025em',
            }}
          >
            {renderHeadlineWithAccent(s.headline)}
          </h1>
          {s.subheadline && (
            <p
              className="mt-6 max-w-xl"
              style={{
                fontSize: 'clamp(1.05rem, 1vw + 0.6rem, 1.3rem)',
                lineHeight: 1.5,
                color: isImageBg ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.6)',
                marginInline: twoColumn ? undefined : 'auto',
              }}
            >
              {s.subheadline}
            </p>
          )}

          {/* Primary + secondary CTA cluster. Stack on mobile, inline on desktop. */}
          {(s.cta_label || s.secondary_cta) && (
            <div className={`mt-8 flex flex-col sm:flex-row gap-3 ${twoColumn ? '' : 'justify-center'}`}>
              {s.cta_label && (
                <a
                  href="#form"
                  className="inline-flex h-14 items-center justify-center rounded-xl px-8 text-base font-semibold transition-transform hover:-translate-y-0.5"
                  style={ctaPrimary}
                >
                  {s.cta_label}
                  <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M5 12h13" />
                  </svg>
                </a>
              )}
              {s.secondary_cta && <SecondaryCta cta={s.secondary_cta} />}
            </div>
          )}

          {s.trust_badges && s.trust_badges.length > 0 && (
            <ul
              className={`mt-8 grid gap-x-8 gap-y-2 text-sm sm:max-w-xl ${twoColumn ? '' : 'mx-auto'} ${
                s.trust_badges.length > 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'
              }`}
              style={{ color: isImageBg ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.65)' }}
            >
              {s.trust_badges.map((b) => (
                <li key={b} className="flex items-center gap-2">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'var(--brand-soft, rgba(10,132,255,0.15))' }}
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} style={{ color: 'var(--brand, #0A84FF)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="font-medium">{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right column. Either: form (form-in-hero), split image card, or
            nothing (gradient + image-bg both put content full-width and
            don't need this column). Video heroes get a wide embed below. */}
        {isFormInHero && (
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-[28px] opacity-40 blur-2xl"
              style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))' }}
            />
            {inlineForm}
          </div>
        )}
        {isSplitImage && operatorOrAiImage && (
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-[28px] opacity-40 blur-2xl"
              style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))' }}
            />
            <div className="overflow-hidden rounded-3xl border border-black/5 shadow-2xl">
              <img
                src={operatorOrAiImage}
                alt={heroImage?.alt ?? ''}
                className="h-auto w-full"
                loading="eager"
              />
            </div>
          </div>
        )}
        {isVideo && s.media?.kind === 'video' && (
          <div className="md:col-span-2 mt-2">
            <div className="overflow-hidden rounded-3xl border border-black/5 bg-black shadow-2xl">
              <div className="aspect-video">
                <iframe
                  src={s.media.embed_url}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Watch the video"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Backdrop layer per hero variant. Lifted out so HeroBlock stays
 *  readable. Each variant gets the visual treatment that suits it:
 *   - gradient: mesh + grain + animated brand-color blob
 *   - image-bg: hero photo full-bleed + soft white wash on left so
 *     headline stays legible over photography
 *   - split / form-in-hero: simple two-blob backdrop, focal point is
 *     the right-column content
 */
function HeroBackdrop({ variant, bgImage }: { variant: 'gradient' | 'split-image' | 'image-bg' | 'form-in-hero'; bgImage: string | null }) {
  if (variant === 'image-bg' && bgImage) {
    return (
      <>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: `url(${JSON.stringify(bgImage).slice(1, -1)}) center/cover no-repeat` }}
        />
        {/* Brand-tinted wash so legibility holds. Stronger from left
            to give the headline column a high-contrast band. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'linear-gradient(95deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.75) 35%, rgba(255,255,255,0.45) 70%, rgba(255,255,255,0.15) 100%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(700px 400px at 0% 50%, var(--brand-soft, rgba(10,132,255,0.12)), transparent 60%)',
          }}
        />
      </>
    )
  }
  if (variant === 'gradient') {
    return (
      <>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(900px 600px at 85% -10%, var(--brand-soft, rgba(10,132,255,0.18)), transparent 55%),' +
              'radial-gradient(700px 500px at -10% 20%, var(--brand-soft, rgba(10,132,255,0.14)), transparent 60%),' +
              'radial-gradient(600px 400px at 50% 110%, var(--brand-soft, rgba(10,132,255,0.10)), transparent 60%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.025]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"160\\" height=\\"160\\"><filter id=\\"n\\"><feTurbulence type=\\"fractalNoise\\" baseFrequency=\\"0.85\\"/></filter><rect width=\\"100%25\\" height=\\"100%25\\" filter=\\"url(%23n)\\"/></svg>")',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -z-10 hidden md:block"
          style={{
            top: '-15%',
            right: '-5%',
            width: '50vw',
            height: '50vw',
            maxWidth: '700px',
            maxHeight: '700px',
            background: 'radial-gradient(closest-side, var(--brand, #0A84FF), transparent 70%)',
            opacity: 0.18,
            filter: 'blur(40px)',
            animation: 'voxBlobFloat 20s ease-in-out infinite alternate',
          }}
        />
        <style>{`@keyframes voxBlobFloat { 0% { transform: translate(0,0) scale(1); } 100% { transform: translate(-40px, 30px) scale(1.05); } }`}</style>
      </>
    )
  }
  // split-image and form-in-hero share a softer two-blob backdrop
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        background:
          'radial-gradient(800px 500px at 80% -10%, var(--brand-soft, rgba(10,132,255,0.12)), transparent 60%), radial-gradient(700px 400px at -10% 30%, var(--brand-soft, rgba(10,132,255,0.12)), transparent 55%)',
      }}
    />
  )
}

function SecondaryCta({ cta }: { cta: NonNullable<HeroSection['secondary_cta']> }) {
  const isPhone = cta.kind === 'phone'
  const href = cta.href ?? (isPhone ? `tel:${cta.label.replace(/[^\d+]/g, '')}` : '#')
  if (isPhone) {
    return (
      <a
        href={href}
        className="inline-flex h-14 items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition-transform hover:-translate-y-0.5"
        style={{ background: '#0a0a0a', color: '#fafafa' }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h2.5a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.21l-2 1a11 11 0 005.66 5.66l1-2a1 1 0 011.21-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.3 21 3 14.7 3 7V6z" />
        </svg>
        {cta.label}
      </a>
    )
  }
  // ghost
  return (
    <a
      href={href}
      className="inline-flex h-14 items-center justify-center rounded-xl px-6 text-base font-semibold transition-colors"
      style={{
        background: 'transparent',
        color: 'var(--text-primary, #0a0a0a)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgba(0,0,0,0.18)',
      }}
    >
      {cta.label}
    </a>
  )
}

// ─── Problem ─────────────────────────────────────────────────────────────

function ProblemBlock({ s }: { s: ProblemSection }) {
  const hasPains = !!s.pains && s.pains.length > 0
  const hasIllustration = !!s.illustration_url
  return (
    <section className="px-4 py-20 md:py-28" style={{ background: '#0a0a0a', color: '#f5f5f5' }}>
      <div className={`mx-auto ${hasIllustration ? 'max-w-6xl grid gap-12 md:grid-cols-2 md:items-center' : 'max-w-3xl'}`}>
        <div>
          <h2
            className="font-bold tracking-tight"
            style={{
              ...displayFont,
              fontSize: 'clamp(1.75rem, 2.5vw + 0.75rem, 2.75rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            {s.headline}
          </h2>
          <p className="mt-5 whitespace-pre-line text-lg leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {s.body}
          </p>
          {hasPains && (
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {s.pains!.map((pain, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-xl border p-4"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
                  >
                    <LucideIcon name={pain.icon} size={20} />
                  </div>
                  <div>
                    <div className="text-base font-semibold" style={{ color: 'rgba(255,255,255,0.95)' }}>{pain.label}</div>
                    {pain.description && (
                      <div className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{pain.description}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!hasPains && s.bullets && s.bullets.length > 0 && (
            <ul className="mt-8 space-y-3">
              {s.bullets.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-3 rounded-xl border p-4 text-base"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <svg className="mt-1 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: '#ef4444' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span style={{ color: 'rgba(255,255,255,0.92)' }}>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {hasIllustration && (
          <div className="overflow-hidden rounded-2xl" style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.08)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.illustration_url} alt="" className="block h-auto w-full" loading="lazy" />
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Mechanism ───────────────────────────────────────────────────────────

function MechanismBlock({ s }: { s: MechanismSection }) {
  const isThreeUp = (s.steps?.length ?? 0) >= 3
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider" style={brandChip}>
            How it works
          </div>
          <h2
            className="font-bold tracking-tight"
            style={{
              ...displayFont,
              fontSize: 'clamp(1.75rem, 2.5vw + 0.75rem, 2.75rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            {s.headline}
          </h2>
          <p className="mt-4 whitespace-pre-line text-lg" style={{ color: 'rgba(0,0,0,0.65)' }}>
            {s.body}
          </p>
        </div>

        {s.illustration_url && (
          <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl" style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(0,0,0,0.08)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.illustration_url} alt="" className="block h-auto w-full" loading="lazy" />
          </div>
        )}
        {s.steps && s.steps.length > 0 && (
          <div className={`mt-12 grid gap-5 ${isThreeUp ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {s.steps.map((step, i) => (
              <div
                key={i}
                className="relative rounded-2xl border bg-white p-6 transition-shadow hover:shadow-lg"
                style={{ borderColor: 'rgba(0,0,0,0.08)' }}
              >
                {step.icon ? (
                  <div
                    className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))', color: 'var(--brand, #0A84FF)' }}
                  >
                    <LucideIcon name={step.icon} size={26} />
                  </div>
                ) : step.icon_url ? (
                  <div
                    className="mb-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl"
                    style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={step.icon_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                ) : (
                  <div
                    className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold"
                    style={ctaPrimary}
                  >
                    {i + 1}
                  </div>
                )}
                <h3 className="text-lg font-semibold tracking-tight" style={displayFont}>
                  {step.label}
                </h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(0,0,0,0.65)' }}>
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Proof ───────────────────────────────────────────────────────────────

function ProofBlock({ s }: { s: ProofSection }) {
  return (
    <section className="px-4 py-20 md:py-28" style={{ background: '#fafafa' }}>
      <div className="mx-auto max-w-5xl">
        {s.headline && (
          <h2
            className="text-center font-bold tracking-tight"
            style={{
              ...displayFont,
              fontSize: 'clamp(1.75rem, 2.5vw + 0.75rem, 2.75rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            {s.headline}
          </h2>
        )}

        {s.stats && s.stats.length > 0 && (
          <div
            className={`mt-12 grid gap-4 ${s.stats.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
          >
            {s.stats.map((st, i) => (
              <div
                key={i}
                className="rounded-2xl border bg-white p-6 text-center"
                style={{ borderColor: 'rgba(0,0,0,0.06)' }}
              >
                <div
                  className="font-bold tabular-nums"
                  style={{
                    ...displayFont,
                    fontSize: 'clamp(2rem, 3vw + 0.5rem, 3rem)',
                    lineHeight: 1,
                    background: 'linear-gradient(135deg, var(--brand, #0A84FF), var(--brand-deep, #0066cc))',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                  }}
                >
                  {st.value}
                </div>
                <div className="mt-3 text-sm font-medium" style={{ color: 'rgba(0,0,0,0.6)' }}>
                  {st.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {s.testimonials && s.testimonials.length > 0 && (
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {s.testimonials.map((t, i) => (
              <figure
                key={i}
                className="relative rounded-2xl border bg-white p-7"
                style={{ borderColor: 'rgba(0,0,0,0.06)' }}
              >
                <svg
                  className="absolute right-5 top-5 h-8 w-8"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ color: 'var(--brand-soft, rgba(10,132,255,0.18))' }}
                  aria-hidden
                >
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                </svg>
                <blockquote className="text-base leading-relaxed" style={{ color: 'rgba(0,0,0,0.85)' }}>
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3 text-sm">
                  {t.author_image_url ? (
                    <img src={t.author_image_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                      style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))', color: 'var(--brand-deep, #0066cc)' }}
                    >
                      {t.author_name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="font-semibold" style={{ color: 'rgba(0,0,0,0.9)' }}>{t.author_name}</div>
                    {t.author_role && (
                      <div className="text-xs" style={{ color: 'rgba(0,0,0,0.55)' }}>{t.author_role}</div>
                    )}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {s.logos && s.logos.length > 0 && (
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-60 grayscale">
            {s.logos.map((logo, i) => (
              <img key={i} src={logo.url} alt={logo.alt} className="h-8" />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Offer ───────────────────────────────────────────────────────────────

function OfferBlock({ s, images }: { s: OfferSection; images?: PageImages }) {
  const bg = images?.offer_bg_url
  return (
    <section className="relative overflow-hidden px-4 py-20 md:py-28">
      {bg && (
        <div aria-hidden className="absolute inset-0 -z-10 opacity-[0.07]">
          <img src={bg} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider" style={brandChip}>
          Everything you get
        </div>
        <h2
          className="font-bold tracking-tight"
          style={{
            ...displayFont,
            fontSize: 'clamp(1.75rem, 2.5vw + 0.75rem, 2.75rem)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          {s.headline}
        </h2>
        {s.description && (
          <p className="mt-4 text-lg" style={{ color: 'rgba(0,0,0,0.65)' }}>{s.description}</p>
        )}

        <div
          className="mt-8 rounded-3xl border bg-white p-6 md:p-8"
          style={{
            borderColor: 'rgba(0,0,0,0.06)',
            boxShadow: '0 30px 60px -25px rgba(0,0,0,0.12), 0 0 0 1px var(--brand-soft, rgba(10,132,255,0.12)) inset',
          }}
        >
          <ul className="space-y-3">
            {s.items.map((item, i) => (
              <li key={i} className="flex items-start gap-4">
                {item.icon ? (
                  <div
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))', color: 'var(--brand, #0A84FF)' }}
                  >
                    <LucideIcon name={item.icon} size={20} />
                  </div>
                ) : (
                  <div
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))' }}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} style={{ color: 'var(--brand, #0A84FF)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                <div className="flex flex-1 items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold" style={{ color: 'rgba(0,0,0,0.9)' }}>{item.label}</div>
                    {item.description && (
                      <div className="mt-1 text-sm" style={{ color: 'rgba(0,0,0,0.6)' }}>
                        {item.description}
                      </div>
                    )}
                  </div>
                  {item.value && (
                    <span
                      className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold"
                      style={brandChip}
                    >
                      {item.value}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {(s.total_value || s.price) && (
            <div className="mt-8 border-t pt-6 text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
              {s.total_value && (
                <div className="text-sm" style={{ color: 'rgba(0,0,0,0.55)' }}>
                  Total value: <span className="font-semibold line-through">{s.total_value}</span>
                </div>
              )}
              {s.price && (
                <div
                  className="mt-2 font-bold"
                  style={{
                    ...displayFont,
                    fontSize: 'clamp(2rem, 3vw + 0.5rem, 3rem)',
                    lineHeight: 1,
                    color: 'var(--brand, #0A84FF)',
                  }}
                >
                  {s.price}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Guarantee ───────────────────────────────────────────────────────────

function GuaranteeBlock({ s }: { s: GuaranteeSection }) {
  return (
    <section className="px-4 py-20 md:py-24" style={{ background: '#fafafa' }}>
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="relative mb-6">
          <div
            aria-hidden
            className="absolute inset-0 rounded-full blur-2xl"
            style={{ background: 'var(--brand-soft, rgba(10,132,255,0.18))' }}
          />
          <div
            className="relative flex h-28 w-28 items-center justify-center rounded-full bg-white"
            style={{ borderWidth: '4px', borderStyle: 'solid', borderColor: 'var(--brand, #0A84FF)' }}
          >
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--brand, #0A84FF)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            {s.badge_text && (
              <span
                className="absolute -bottom-3 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                style={ctaPrimary}
              >
                {s.badge_text}
              </span>
            )}
          </div>
        </div>
        <h2
          className="font-bold tracking-tight"
          style={{
            ...displayFont,
            fontSize: 'clamp(1.75rem, 2.5vw + 0.75rem, 2.5rem)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          {s.headline}
        </h2>
        <p className="mt-4 max-w-xl whitespace-pre-line text-lg" style={{ color: 'rgba(0,0,0,0.7)' }}>
          {s.body}
        </p>
      </div>
    </section>
  )
}

// ─── Urgency ─────────────────────────────────────────────────────────────

function UrgencyBlock({ s }: { s: UrgencySection }) {
  return (
    <section className="px-4 py-12 md:py-16">
      <div
        className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-2xl border-2 p-7 text-center"
        style={{
          borderColor: 'rgba(245,158,11,0.5)',
          background: 'linear-gradient(135deg, rgba(254,243,199,0.6), rgba(254,215,170,0.6))',
        }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: '#f59e0b', color: 'white' }}
        >
          <svg className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold md:text-2xl" style={{ ...displayFont, color: '#7c2d12' }}>
          {s.headline}
        </h2>
        {s.body && (
          <p className="max-w-lg text-sm md:text-base" style={{ color: '#9a3412' }}>
            {s.body}
          </p>
        )}
        {s.countdown_to && (
          <p className="text-xs font-medium" style={{ color: '#9a3412' }}>
            Closes {new Date(s.countdown_to).toLocaleString()}
          </p>
        )}
      </div>
    </section>
  )
}

// ─── FAQ ─────────────────────────────────────────────────────────────────

function FAQBlock({ s }: { s: FAQSection }) {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        {s.headline && (
          <h2
            className="mb-8 text-center font-bold tracking-tight"
            style={{
              ...displayFont,
              fontSize: 'clamp(1.75rem, 2.5vw + 0.75rem, 2.5rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            {s.headline}
          </h2>
        )}
        <div className="space-y-3">
          {s.items.map((item, i) => (
            <details
              key={i}
              className="group rounded-2xl border bg-white p-6 transition-shadow open:shadow-md"
              style={{ borderColor: 'rgba(0,0,0,0.08)' }}
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-base font-semibold">
                <span>{item.question}</span>
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform group-open:rotate-180"
                  style={{ background: 'var(--brand-soft, rgba(10,132,255,0.12))', color: 'var(--brand-deep, #0066cc)' }}
                  aria-hidden
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed" style={{ color: 'rgba(0,0,0,0.7)' }}>
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── CTA ─────────────────────────────────────────────────────────────────

function CTABlock({ s }: { s: CTASection }) {
  return (
    <section
      className="relative overflow-hidden px-4 py-20 md:py-28"
      style={{
        background: 'linear-gradient(135deg, var(--brand, #0A84FF), var(--brand-deep, #0066cc))',
        color: 'var(--brand-fg, #ffffff)',
      }}
    >
      {/* Subtle radial highlight on top-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(700px 350px at 90% 0%, rgba(255,255,255,0.18), transparent 60%)',
        }}
      />
      <div className="mx-auto max-w-3xl text-center">
        <h2
          className="font-bold tracking-tight"
          style={{
            ...displayFont,
            fontSize: 'clamp(2rem, 3vw + 0.5rem, 3.5rem)',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          {s.headline}
        </h2>
        {s.body && (
          <p
            className="mt-5 opacity-90"
            style={{ fontSize: 'clamp(1.05rem, 1.1vw + 0.6rem, 1.3rem)', lineHeight: 1.5 }}
          >
            {s.body}
          </p>
        )}
        <a
          href="#form"
          className="mt-9 inline-flex h-14 items-center justify-center rounded-xl bg-white px-9 text-base font-semibold transition-transform hover:-translate-y-0.5"
          style={{
            color: 'var(--brand-deep, #0066cc)',
            boxShadow: '0 20px 50px -15px rgba(0,0,0,0.4)',
          }}
        >
          {s.cta_label}
          <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M5 12h13" />
          </svg>
        </a>
      </div>
    </section>
  )
}

// ─── Footer ──────────────────────────────────────────────────────────────

function FooterBlock({ s }: { s: FooterSection }) {
  return (
    <footer className="px-4 py-12" style={{ background: '#0a0a0a', color: 'rgba(255,255,255,0.7)' }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 text-sm md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-base font-semibold" style={{ color: 'white' }}>{s.business_name}</div>
          {s.business_address && <div className="mt-1.5 text-[13px]">{s.business_address}</div>}
          {s.business_phone && <div className="mt-1 text-[13px]">{s.business_phone}</div>}
          {s.business_email && <div className="mt-1 text-[13px]">{s.business_email}</div>}
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          {s.legal_links && s.legal_links.length > 0 && (
            <div className="flex gap-5 text-[13px]">
              {s.legal_links.map((l) => (
                <a key={l.url} href={l.url} className="hover:text-white">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      {s.disclaimer && (
        <div className="mx-auto mt-8 max-w-5xl text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {s.disclaimer}
        </div>
      )}
    </footer>
  )
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

export function SectionRenderer({
  section,
  images,
  fallbackLogoUrl,
  inlineForm,
}: {
  section: PageSection
  /** Optional AI-generated imagery from PageSpec.images. Forwarded
   *  to the sections that can use it (hero, offer). */
  images?: PageImages
  /** Brand-kit logo to use in the header when the section didn't
   *  emit its own logo_url. */
  fallbackLogoUrl?: string | null
  /** When the page is rendering form-in-hero, the page hands a
   *  ready-rendered <FormBlock variant="compact" /> to the renderer
   *  so HeroBlock can mount it inside its right column. */
  inlineForm?: ReactNode
}) {
  switch (section.type) {
    case 'header':
      return <HeaderBlock s={section} fallbackLogoUrl={fallbackLogoUrl} />
    case 'hero':
      return <HeroBlock s={section} images={images} inlineForm={inlineForm} />
    case 'problem':
      return <ProblemBlock s={section} />
    case 'mechanism':
      return <MechanismBlock s={section} />
    case 'proof':
      return <ProofBlock s={section} />
    case 'offer':
      return <OfferBlock s={section} images={images} />
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
      const _exhaustive: never = section
      void _exhaustive
      return null
    }
  }
}
