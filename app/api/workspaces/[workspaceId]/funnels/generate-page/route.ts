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
  // Failures don't break the page — but the per-image errors flow back
  // up so the wizard can show "0/3 images succeeded — reason X" rather
  // than silently producing a text-only page.
  let imageGen: { enabled: boolean; attempted: number; succeeded: number; errors: string[] } = {
    enabled: isGeminiImageEnabled(),
    attempted: 0,
    succeeded: 0,
    errors: [],
  }
  if (imageGen.enabled) {
    try {
      const out = await generatePageImagesDetailed({
        intake: body.intake,
        spec: result.spec,
        brandKit: body.brand_kit,
        keyPrefix: `landing/${body.save_to_landing_page_id ?? 'preview'}`,
      })
      if (out.images.hero_url || out.images.offer_bg_url || out.images.og_url) {
        result.spec.images = out.images
      }
      imageGen = { enabled: true, attempted: out.attempted, succeeded: out.succeeded, errors: out.errors }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[generate-page] image generation crashed (continuing):', msg)
      imageGen.errors.push(`unhandled: ${msg}`)
    }
  } else {
    imageGen.errors.push('GEMINI_API_KEY not set on this deployment')
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

  return NextResponse.json({ ...result, imageGen })
}

interface ImageGenReport {
  images: PageImages
  attempted: number
  succeeded: number
  errors: string[]
}

/**
 * Build prompts from the spec, fan out to Gemini in parallel, return
 * a PageImages map plus per-image errors. Each promise is independently
 * caught so one image failing doesn't sink the others.
 */
async function generatePageImagesDetailed(args: {
  intake: CampaignIntake
  spec: PageSpec
  brandKit?: BrandKit
  keyPrefix: string
}): Promise<ImageGenReport> {
  const { intake, spec, brandKit, keyPrefix } = args
  const primaryColour = spec.style?.primary_color ?? '#0A84FF'

  const context = [
    intake.business_name,
    intake.offer,
    intake.industry ? `Industry: ${intake.industry}` : '',
    intake.audience ? `Audience: ${intake.audience}` : '',
  ].filter(Boolean).join('. ')

  // Brand-kit context fed into every prompt so generated imagery looks
  // like the same brand as the operator's site, not stock photography.
  // The screenshot of the existing site (when available) is passed as a
  // multimodal reference too — Gemini matches design vibe, photography
  // style, and colour energy when it can SEE the brand.
  const brandContext: string[] = []
  if (brandKit?.brand_guide_text) {
    brandContext.push(`Brand guide notes: ${brandKit.brand_guide_text.slice(0, 600)}`)
  }
  if (brandKit?.analysis) {
    const a = brandKit.analysis
    const visionBits: string[] = []
    if (a.design_vibe) visionBits.push(`Design vibe: ${a.design_vibe}`)
    if (a.photography_style && a.photography_style !== 'unknown') {
      visionBits.push(`Photography style: ${a.photography_style} (match this — don't switch styles)`)
    }
    if (a.visual_motifs && a.visual_motifs.length > 0) {
      visionBits.push(`Visual motifs: ${a.visual_motifs.join(', ')}`)
    }
    if (a.industry_guess) visionBits.push(`Industry: ${a.industry_guess}`)
    if (visionBits.length > 0) {
      brandContext.push(`Brand identity (extracted from the operator's existing site):\n${visionBits.join('\n')}`)
    }
  }
  if (brandKit?.extracted_colors && brandKit.extracted_colors.length > 0) {
    brandContext.push(`Brand palette to harmonise with: ${brandKit.extracted_colors.join(', ')}`)
  }
  const refImageNotes: string[] = []
  if (brandKit?.screenshot_url) refImageNotes.push("the operator's actual existing site")
  if (brandKit?.logo_url) refImageNotes.push('the brand logo')
  if (refImageNotes.length > 0) {
    brandContext.push(`Reference images included: ${refImageNotes.join(' and ')}. Match their colour palette, photography style, and overall design energy.`)
  }
  const brandContextText = brandContext.length > 0 ? `\n\n${brandContext.join('\n')}` : ''

  // Pass BOTH the screenshot and the logo to Gemini when we have them.
  // Screenshot first — it's the richer visual signal (full design vibe,
  // not just a mark). Both are filtered to PNG/JPEG/WebP server-side
  // (Gemini rejects SVG); SVG logos are silently skipped there.
  const refImages: string[] = []
  if (brandKit?.screenshot_url) refImages.push(brandKit.screenshot_url)
  if (brandKit?.logo_url) refImages.push(brandKit.logo_url)

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
      referenceImages: refImages.length > 0 ? refImages : undefined,
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    generateAndUpload({
      prompt: offerBgPrompt,
      aspect: 'wide',
      keyPrefix: `${keyPrefix}/offer-bg`,
      referenceImages: refImages.length > 0 ? refImages : undefined,
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    generateAndUpload({
      prompt: ogPrompt,
      aspect: 'og',
      keyPrefix: `${keyPrefix}/og`,
      referenceImages: refImages.length > 0 ? refImages : undefined,
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
  ])

  const images: PageImages = {
    ...(hero.ok && hero.url ? { hero_url: hero.url } : {}),
    ...(offerBg.ok && offerBg.url ? { offer_bg_url: offerBg.url } : {}),
    ...(og.ok && og.url ? { og_url: og.url } : {}),
  }
  const errors: string[] = []
  if (!hero.ok && hero.error) errors.push(`hero: ${hero.error}`)
  if (!offerBg.ok && offerBg.error) errors.push(`offer-bg: ${offerBg.error}`)
  if (!og.ok && og.error) errors.push(`og: ${og.error}`)
  const succeeded = (hero.ok ? 1 : 0) + (offerBg.ok ? 1 : 0) + (og.ok ? 1 : 0)
  return { images, attempted: 3, succeeded, errors }
}
