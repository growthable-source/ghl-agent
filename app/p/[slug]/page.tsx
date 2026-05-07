/**
 * Public Voxility landing page renderer at /p/<slug>.
 *
 * Server component. Anonymous access. Reads LandingPage by slug. Renders
 * the section list via <SectionRenderer/>. The form is rendered as a
 * client island (FormBlock) — the rest of the tree is fully server-rendered
 * for SEO and TTFB.
 *
 * Per the AGENTS.md note in this repo: this targets Next 16+. Notable
 * conventions used here: `params: Promise<{ slug: string }>`,
 * `await params`, `notFound()` for 404, `generateMetadata` for OG.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Script from 'next/script'
import { db } from '@/lib/db'
import { SectionRenderer } from '@/components/vsl/sections'
import { FormBlock } from '@/components/vsl/FormBlock'
import {
  parseFormSchema,
  parsePageSpec,
  type FormSection,
  type PageSection,
} from '@/lib/page-spec'
import { buildPageBackgroundStyle, buildPageThemeStyle } from '@/lib/brand-theme'
import { brandFontStyleFromAnalysis } from '@/lib/brand-fonts'
import { verifyPreviewToken } from '@/lib/preview-token'

type Params = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preview?: string }>
}

// LandingPage has NO campaignId column — the FK lives on Campaign.landingPageId
// (which is @unique, so the reverse relation is one-to-one). To get the
// owning campaign we look it up by landingPageId in a separate query below.
const PAGE_SELECT = {
  id: true,
  title: true,
  metaDescription: true,
  ogImageUrl: true,
  metaPixelId: true,
  googleConversionId: true,
  spec: true,
  formSchema: true,
  published: true,
} as const

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params
  const { preview } = await searchParams
  // No catch — let DB errors surface. Was masking actual problems as 404s.
  const page = await db.landingPage.findUnique({
    where: { slug },
    select: { id: true, title: true, metaDescription: true, ogImageUrl: true, published: true, spec: true },
  })
  if (!page) return { title: 'Not found' }
  // Bypass the published gate when a valid preview token for this page
  // is presented — the build orchestrator signs one before each render
  // pass so Browserbase can screenshot unpublished drafts.
  const isPreview = !!preview && verifyPreviewToken(preview, page.id)
  if (!page.published && !isPreview) return { title: 'Not found' }
  // Prefer the operator-uploaded OG image; fall back to the AI-generated
  // `spec.images.og_url` if no manual override was set.
  const spec = parsePageSpec(page.spec)
  const ogImage = page.ogImageUrl ?? spec.images?.og_url ?? null
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    openGraph: {
      title: page.title,
      description: page.metaDescription ?? undefined,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
  }
}

export default async function PublicLandingPage({ params, searchParams }: Params) {
  const { slug } = await params
  const { preview } = await searchParams

  // No catch — let DB errors propagate to the Next.js error handler so
  // they show up in Vercel runtime logs instead of being swallowed as
  // a generic 404. We log slug + result so the runtime trace is grep-able.
  const page = await db.landingPage.findUnique({
    where: { slug },
    select: PAGE_SELECT,
  })
  console.log(`[PublicLandingPage] slug=${slug} found=${!!page} published=${page?.published ?? 'n/a'} preview=${!!preview}`)

  if (!page) notFound()
  // Bypass the published gate when a valid preview token is presented.
  // Tokens are bound to the page id and HMAC-signed with the build
  // orchestrator's secret, so they can't be forged or reused for other pages.
  const isPreview = !!preview && verifyPreviewToken(preview, page.id)
  if (!page.published && !isPreview) notFound()

  // Owning campaign — Campaign.landingPageId is @unique so this is a
  // single-row lookup. Only used so the form can attribute submissions
  // back to the right campaign.
  const campaign = await db.campaign.findUnique({
    where: { landingPageId: page.id },
    // logoUrl flows into the HeaderBlock as a fallback. brandAnalysis
    // carries the detected font_families from the operator's reference
    // site — we load those via Google Fonts and apply them as the
    // page's typography so the output uses the brand's actual fonts
    // instead of a hardcoded default.
    select: { id: true, logoUrl: true, brandAnalysis: true },
  })

  const spec = parsePageSpec(page.spec)
  const formSchema = parseFormSchema(page.formSchema)

  // Find the form section so we can place <FormBlock/> at the right point
  // in the section list. If the AI generator didn't emit one explicitly,
  // place the form right before the footer (or at the end).
  let formSection: FormSection | null = null
  const sectionsBeforeForm: PageSection[] = []
  const sectionsAfterForm: PageSection[] = []
  let foundForm = false
  for (const section of spec.sections) {
    if (section.type === 'form' && !foundForm) {
      formSection = section
      foundForm = true
    } else if (!foundForm) {
      sectionsBeforeForm.push(section)
    } else {
      sectionsAfterForm.push(section)
    }
  }
  if (!foundForm) {
    const footerIdx = sectionsBeforeForm.findIndex((s) => s.type === 'footer')
    if (footerIdx >= 0) {
      sectionsAfterForm.push(...sectionsBeforeForm.splice(footerIdx))
    }
  }

  // Detect a form-in-hero layout. When the hero opted into that
  // layout, we render the FormBlock inline INSIDE the hero (right
  // column) and suppress the standalone form section between offer
  // and footer — the form already exists above the fold.
  const heroSection = sectionsBeforeForm.find((s) => s.type === 'hero')
  const formInHero = heroSection?.type === 'hero' && heroSection.layout === 'form-in-hero'

  // Brand-color + font theming: derive a palette from spec.style and
  // expose it as CSS custom properties on the page wrapper. Every
  // <section> reads `var(--brand)` / `var(--brand-soft)` etc. instead
  // of hard-coding a colour, so changing the AI's primary_color now
  // actually changes the page.
  const themeStyle = buildPageThemeStyle({
    primaryColor: spec.style?.primary_color,
    fontFamily: spec.style?.font_family,
    background: spec.style?.background,
  })
  const bgStyle = buildPageBackgroundStyle(spec.style?.background, spec.images?.background_url)
  // Brand-detected fonts override the static next/font choice. The
  // brand-render Browserbase pass captured the operator's actual
  // computed font-families; we load those via Google Fonts and apply
  // them as --page-font-display / --page-font-body so the generated
  // page renders in the brand's REAL typography rather than Inter.
  const brandAnalysis = (campaign?.brandAnalysis ?? null) as { font_families?: string[] } | null
  const brandFonts = brandFontStyleFromAnalysis(brandAnalysis?.font_families)
  const images = spec.images
  const fallbackLogoUrl = campaign?.logoUrl ?? null

  // Pre-render the inline form so it can be passed into the hero as a
  // ReactNode. Server-component + client-island compose cleanly here
  // because FormBlock is a 'use client' island and we're handing the
  // already-rendered JSX through a normal prop.
  const inlineForm = formInHero ? (
    <FormBlock
      section={formSection ?? undefined}
      schema={formSchema}
      pageId={page.id}
      campaignId={campaign?.id ?? null}
      variant="inline"
    />
  ) : null

  return (
    <main
      className="min-h-screen"
      style={{ scrollBehavior: 'smooth', ...themeStyle, ...bgStyle, ...brandFonts.cssVars }}
    >
      {/* Dynamic Google Fonts from the operator's reference site.
          Inline `<link>` is hoisted into <head> by Next.js so the
          font request fires before the body renders. */}
      {brandFonts.googleFontsUrl && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link rel="stylesheet" href={brandFonts.googleFontsUrl} />
      )}
      {sectionsBeforeForm.map((section, i) => (
        <SectionRenderer
          key={i}
          section={section}
          images={images}
          fallbackLogoUrl={fallbackLogoUrl}
          inlineForm={section.type === 'hero' ? inlineForm : null}
        />
      ))}

      {/* Standalone form between offer + footer. Skipped when the
          hero already hosts the form (form-in-hero layout). */}
      {!formInHero && (
        <FormBlock
          section={formSection ?? undefined}
          schema={formSchema}
          pageId={page.id}
          campaignId={campaign?.id ?? null}
        />
      )}

      {sectionsAfterForm.map((section, i) => (
        <SectionRenderer
          key={`a${i}`}
          section={section}
          images={images}
          fallbackLogoUrl={fallbackLogoUrl}
        />
      ))}

      {/* ─── Browser pixels — Meta + Google. Server-side conversions
          fire from /api/public/form-submit independently (Phase 4). */}
      {page.metaPixelId && (
        <Script id="vox-meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${page.metaPixelId}');
          fbq('track', 'PageView');
        `}</Script>
      )}
      {page.googleConversionId && (
        <>
          <Script
            id="vox-google-gtag"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${page.googleConversionId}`}
          />
          <Script id="vox-google-gtag-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${page.googleConversionId}');
          `}</Script>
        </>
      )}
    </main>
  )
}
