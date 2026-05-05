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

type Params = { params: Promise<{ slug: string }> }

const PAGE_SELECT = {
  id: true,
  campaignId: true,
  title: true,
  metaDescription: true,
  ogImageUrl: true,
  metaPixelId: true,
  googleConversionId: true,
  spec: true,
  formSchema: true,
  published: true,
} as const

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  // No catch — let DB errors surface. Was masking actual problems as 404s.
  const page = await db.landingPage.findUnique({
    where: { slug },
    select: { title: true, metaDescription: true, ogImageUrl: true, published: true },
  })
  if (!page || !page.published) return { title: 'Not found' }
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    openGraph: {
      title: page.title,
      description: page.metaDescription ?? undefined,
      images: page.ogImageUrl ? [{ url: page.ogImageUrl }] : undefined,
    },
  }
}

export default async function PublicLandingPage({ params }: Params) {
  const { slug } = await params

  // No catch — let DB errors propagate to the Next.js error handler so
  // they show up in Vercel runtime logs instead of being swallowed as
  // a generic 404. We log slug + result so the runtime trace is grep-able.
  const page = await db.landingPage.findUnique({
    where: { slug },
    select: PAGE_SELECT,
  })
  console.log(`[PublicLandingPage] slug=${slug} found=${!!page} published=${page?.published ?? 'n/a'}`)

  if (!page || !page.published) notFound()

  // Find the campaign id (we joined-via-LandingPage above; the reverse
  // relation lives on Campaign.landingPageId so we look it up cheaply).
  // Skipping the join here keeps the public render fast — campaignId is
  // only needed for the FormBlock to attribute the submission.
  const campaign = page.campaignId
    ? await db.campaign.findUnique({
        where: { id: page.campaignId },
        select: { id: true },
      }).catch(() => null)
    : await db.campaign.findFirst({
        where: { landingPageId: page.id },
        select: { id: true },
      }).catch(() => null)

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

  return (
    <main
      className="min-h-screen bg-white text-neutral-900"
      style={{ scrollBehavior: 'smooth' }}
    >
      {sectionsBeforeForm.map((section, i) => (
        <SectionRenderer key={i} section={section} />
      ))}

      <FormBlock
        section={formSection ?? undefined}
        schema={formSchema}
        pageId={page.id}
        campaignId={campaign?.id ?? null}
      />

      {sectionsAfterForm.map((section, i) => (
        <SectionRenderer key={`a${i}`} section={section} />
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
