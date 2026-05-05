/**
 * Generate a VSL page spec from a campaign intake.
 *
 * POST body: {
 *   intake: { business_name, offer, dream_outcome, false_belief,
 *             mechanism, proof, price?, audience?, industry?, brand_voice? },
 *   template?: 'vsl' | 'lead_gen' | 'webinar_optin' | 'application' | 'book_call',
 *   primary_color?: string,
 *   save_to_landing_page_id?: string  // if set, persist the generated
 *                                     //   spec onto that LandingPage row
 *                                     //   (replaces title + spec).
 * }
 *
 * Returns: { title, meta_description, spec }
 *
 * Auth: any workspace member can generate. Plan-gating to growth/scale
 * tiers is enforced at the wizard's entry point (FunnelGate, Phase 6),
 * not here — generation is cheap to invoke and we want preview-on-edit
 * to work for downgraded workspaces too.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { generateVslPage, type BrandKit, type CampaignIntake, type PageTemplate } from '@/lib/vsl-generator'
import { generateAndUpload, isGeminiImageEnabled } from '@/lib/image-gen-gemini'
import type { PageImages, PageSpec } from '@/lib/page-spec'

// Tool-call generation with thinking can take 30–60s on cold cache.
// Keep well under the route handler default cap.
export const maxDuration = 90

interface Body {
  intake: CampaignIntake
  template?: PageTemplate
  primary_color?: string
  save_to_landing_page_id?: string
  brand_kit?: BrandKit
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params

  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.intake?.business_name || !body.intake?.offer || !body.intake?.dream_outcome) {
    return NextResponse.json(
      { error: 'intake.business_name, offer, and dream_outcome are required' },
      { status: 400 },
    )
  }

  let result
  try {
    result = await generateVslPage({
      intake: body.intake,
      template: body.template,
      primary_color: body.primary_color,
      brand_kit: body.brand_kit,
    })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again in a moment.' },
        { status: 429 },
      )
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is invalid or unset.' },
        { status: 500 },
      )
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status ?? 500 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 },
    )
  }

  // ─── Image generation (best-effort) ────────────────────────────────
  // After Claude returns the spec, fan out 3 Gemini Imagen calls in
  // parallel for hero photo + offer-section background + OG image.
  // Failures are swallowed — the page still saves with text-only
  // sections if Gemini is unreachable, the API key is missing, or any
  // single prompt fails.
  if (isGeminiImageEnabled()) {
    try {
      const images = await generatePageImages({
        intake: body.intake,
        spec: result.spec,
        brandKit: body.brand_kit,
        keyPrefix: `landing/${body.save_to_landing_page_id ?? 'preview'}`,
      })
      if (images.hero_url || images.offer_bg_url || images.og_url) {
        result.spec.images = images
      }
    } catch (err) {
      console.warn('[generate-page] image generation failed (continuing):', err instanceof Error ? err.message : err)
    }
  }

  // Persist to a specific LandingPage if requested. Verify the page
  // belongs to this workspace before writing — never trust the id from
  // the request body.
  if (body.save_to_landing_page_id) {
    const page = await db.landingPage.findUnique({
      where: { id: body.save_to_landing_page_id },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Landing page not found' }, { status: 404 })
    }
    await db.landingPage.update({
      where: { id: body.save_to_landing_page_id },
      data: {
        title: result.title,
        metaDescription: result.meta_description,
        spec: result.spec as object,
      },
    })
  }

  return NextResponse.json(result)
}

/**
 * Build prompts from the spec, fan out to Gemini in parallel, return
 * a PageImages map. Each promise is independently caught so one image
 * failing doesn't sink the others. Returns an empty object if every
 * call fails.
 */
async function generatePageImages(args: {
  intake: CampaignIntake
  spec: PageSpec
  brandKit?: BrandKit
  keyPrefix: string
}): Promise<PageImages> {
  const { intake, spec, brandKit, keyPrefix } = args
  const primaryColour = spec.style?.primary_color ?? '#0A84FF'

  const context = [
    intake.business_name,
    intake.offer,
    intake.industry ? `Industry: ${intake.industry}` : '',
    intake.audience ? `Audience: ${intake.audience}` : '',
  ].filter(Boolean).join('. ')

  // Brand-kit context fed into every prompt so generated imagery looks
  // like the same brand as the logo, not stock photography. The actual
  // logo image is also passed as a multimodal reference (referenceImages)
  // so Gemini can match marks/colours/style — text alone isn't enough.
  const brandContext: string[] = []
  if (brandKit?.brand_guide_text) {
    brandContext.push(`Brand guide notes: ${brandKit.brand_guide_text.slice(0, 600)}`)
  }
  if (brandKit?.extracted_colors && brandKit.extracted_colors.length > 0) {
    brandContext.push(`Brand palette to harmonise with: ${brandKit.extracted_colors.join(', ')}`)
  }
  if (brandKit?.logo_url) {
    brandContext.push(`A reference image of the brand logo is included — match its colour palette, geometry, and feel.`)
  }
  const brandContextText = brandContext.length > 0 ? `\n\n${brandContext.join('\n')}` : ''

  // Only the logo is small enough + brand-defining enough to be worth
  // sending as a reference. Reference URL og:image is too noisy.
  const refImages = brandKit?.logo_url ? [brandKit.logo_url] : undefined

  const heroPrompt =
    `Editorial-quality photograph for a landing-page hero. ` +
    `Subject: ${context}. The image should evoke the dream outcome: "${intake.dream_outcome}". ` +
    `Modern, well-lit, shallow depth of field. Real people if relevant — not stock-photo poses. ` +
    `Negative space on one side for headline overlay (the headline is added separately, do not draw text). ` +
    `Color palette should harmonise with brand colour ${primaryColour}.${brandContextText}`

  const offerBgPrompt =
    `Subtle abstract background pattern for an offer/CTA section. ` +
    `Brand: ${intake.business_name}. Industry: ${intake.industry ?? 'business services'}. ` +
    `Soft geometric shapes or organic gradients in a near-white setting, ` +
    `with accent tones derived from brand colour ${primaryColour}. ` +
    `Very low contrast — this image will be rendered at ~7% opacity behind text.${brandContextText}`

  const ogPrompt =
    `Open Graph social preview image for a landing page. ` +
    `Business: ${intake.business_name}. Offer: ${intake.offer}. ` +
    `Bold, simple composition. Strong focal point centred. ` +
    `Use brand colour ${primaryColour} as a primary accent. ` +
    `Looks great as a thumbnail in LinkedIn, Slack, Twitter previews.${brandContextText}`

  const [hero, offerBg, og] = await Promise.all([
    generateAndUpload({
      prompt: heroPrompt,
      aspect: 'wide',
      keyPrefix: `${keyPrefix}/hero`,
      referenceImages: refImages,
    }).catch((e) => {
      console.warn('[generate-page] hero image failed:', e instanceof Error ? e.message : e)
      return null
    }),
    generateAndUpload({
      prompt: offerBgPrompt,
      aspect: 'wide',
      keyPrefix: `${keyPrefix}/offer-bg`,
      referenceImages: refImages,
    }).catch((e) => {
      console.warn('[generate-page] offer-bg image failed:', e instanceof Error ? e.message : e)
      return null
    }),
    generateAndUpload({
      prompt: ogPrompt,
      aspect: 'og',
      keyPrefix: `${keyPrefix}/og`,
      referenceImages: refImages,
    }).catch((e) => {
      console.warn('[generate-page] og image failed:', e instanceof Error ? e.message : e)
      return null
    }),
  ])

  return {
    ...(hero ? { hero_url: hero } : {}),
    ...(offerBg ? { offer_bg_url: offerBg } : {}),
    ...(og ? { og_url: og } : {}),
  }
}
