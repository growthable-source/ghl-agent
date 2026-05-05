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
import { generateLandingImage, getImageProviderStatus } from '@/lib/image-gen-orchestrator'
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
  /** Image strategy:
   *   'gradient' (default) — no AI hero photo. Page renders a Stripe-
   *      style gradient + huge typography hero. Cheaper and often
   *      better-looking for SaaS/B2B/agency.
   *   'ai_photo' — generate a photorealistic hero via Replicate Flux
   *      1.1 Pro Ultra (or fall back to Gemini). Best for consumer,
   *      service businesses, anything where a real-feeling photo
   *      matters more than typography polish.
   * OG image still generates either way (social previews matter). */
  hero_style?: 'gradient' | 'ai_photo'
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

  // ─── Image generation (strategy-driven) ────────────────────────────
  // hero_style controls whether we burn a Replicate/Gemini call on the
  // hero photo. 'gradient' default skips it entirely — the renderer
  // produces a Stripe-style gradient hero from the brand colour, which
  // is often better than mediocre AI photography. 'ai_photo' opt-in
  // uses Replicate Flux 1.1 Pro Ultra (or falls back to Gemini).
  // OG image always generates when SOMETHING can produce it, since
  // social previews matter and a missing OG image just means an ugly
  // link unfurl, not a broken page.
  const heroStyle = body.hero_style ?? 'gradient'
  const providers = getImageProviderStatus()
  const imageGen: { enabled: boolean; provider: string; attempted: number; succeeded: number; errors: string[] } = {
    enabled: providers.replicate || providers.gemini,
    provider: providers.replicate ? 'replicate' : providers.gemini ? 'gemini' : 'none',
    attempted: 0,
    succeeded: 0,
    errors: [],
  }
  try {
    const out = await generatePageImagesDetailed({
      intake: body.intake,
      spec: result.spec,
      brandKit: body.brand_kit,
      heroStyle,
      keyPrefix: `landing/${body.save_to_landing_page_id ?? 'preview'}`,
    })
    if (out.images.hero_url || out.images.og_url) {
      result.spec.images = out.images
    }
    imageGen.attempted = out.attempted
    imageGen.succeeded = out.succeeded
    imageGen.errors = out.errors
    if (out.provider) imageGen.provider = out.provider
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[generate-page] image generation crashed (continuing):', msg)
    imageGen.errors.push(`unhandled: ${msg}`)
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
  provider?: string
}

/**
 * Generate landing-page imagery according to the operator's chosen
 * strategy. 'gradient' hero skips the AI hero call entirely — the
 * renderer produces a Stripe-style gradient + typography hero that
 * usually outperforms generic AI photography. 'ai_photo' generates
 * a hero via the orchestrator (Replicate → Gemini fallback).
 *
 * OG image always generates when a provider is configured, regardless
 * of hero strategy — social-link previews are a different bar.
 */
async function generatePageImagesDetailed(args: {
  intake: CampaignIntake
  spec: PageSpec
  brandKit?: BrandKit
  heroStyle: 'gradient' | 'ai_photo'
  keyPrefix: string
}): Promise<ImageGenReport> {
  const { intake, spec, brandKit, heroStyle, keyPrefix } = args
  const primaryColour = spec.style?.primary_color ?? '#0A84FF'

  const context = [
    intake.business_name,
    intake.offer,
    intake.industry ? `Industry: ${intake.industry}` : '',
    intake.audience ? `Audience: ${intake.audience}` : '',
  ].filter(Boolean).join('. ')

  // Brand-kit context fed into every prompt so generated imagery looks
  // like the same brand as the operator's site, not stock photography.
  const brandContext: string[] = []
  if (brandKit?.brand_guide_text) {
    brandContext.push(`Brand guide notes: ${brandKit.brand_guide_text.slice(0, 600)}`)
  }
  if (brandKit?.analysis) {
    const a = brandKit.analysis
    const visionBits: string[] = []
    if (a.design_vibe) visionBits.push(`Design vibe: ${a.design_vibe}`)
    if (a.photography_style && a.photography_style !== 'unknown') {
      visionBits.push(`Photography style: ${a.photography_style} — match this exact style, don't substitute generic stock photography`)
    }
    if (a.visual_motifs && a.visual_motifs.length > 0) {
      visionBits.push(`Visual motifs to incorporate: ${a.visual_motifs.join(', ')}`)
    }
    if (a.industry_guess) visionBits.push(`Industry: ${a.industry_guess}`)
    if (visionBits.length > 0) {
      brandContext.push(`Brand identity (extracted from the operator's existing site):\n${visionBits.join('\n')}`)
    }
  }
  if (brandKit?.extracted_colors && brandKit.extracted_colors.length > 0) {
    brandContext.push(`Brand palette to harmonise with: ${brandKit.extracted_colors.join(', ')}`)
  }
  const brandContextText = brandContext.length > 0 ? `\n\n${brandContext.join('\n')}` : ''

  // Reference images: screenshot is the richer signal for design vibe,
  // logo is best for colour/mark consistency. Replicate accepts ONE
  // reference (we use the screenshot when available, logo otherwise);
  // Gemini accepts multiple. SVGs are filtered server-side in
  // image-gen-gemini — Replicate generally accepts whatever URL we give it.
  const heroRef = brandKit?.screenshot_url ?? brandKit?.logo_url ?? null
  const geminiRefs: string[] = []
  if (brandKit?.screenshot_url) geminiRefs.push(brandKit.screenshot_url)
  if (brandKit?.logo_url) geminiRefs.push(brandKit.logo_url)

  // Photography-style aware hero prompt. When the brand analysis says
  // 'illustrated' we ask for an illustration, not a photo, etc.
  const photoStyle = brandKit?.analysis?.photography_style
  const heroPrompt = buildHeroPrompt({ context, dreamOutcome: intake.dream_outcome, primaryColour, brandContextText, photoStyle })

  const ogPrompt =
    `Open Graph social preview image for a landing page. ` +
    `Business: ${intake.business_name}. Offer: ${intake.offer}. ` +
    `Bold, simple composition. Strong focal point centred. ` +
    `Use brand colour ${primaryColour} as a primary accent. ` +
    `Looks great as a thumbnail in LinkedIn, Slack, Twitter previews. No text overlays.${brandContextText}`

  // Run hero (if requested) + OG in parallel.
  const heroPromise = heroStyle === 'ai_photo'
    ? generateLandingImage({
        prompt: heroPrompt,
        aspect: 'wide',
        keyPrefix: `${keyPrefix}/hero`,
        referenceImageUrl: heroRef,
        geminiReferenceImages: geminiRefs.length > 0 ? geminiRefs : undefined,
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    : Promise.resolve({ ok: true as const, url: undefined, provider: undefined })

  const ogPromise = generateLandingImage({
    prompt: ogPrompt,
    aspect: 'og',
    keyPrefix: `${keyPrefix}/og`,
    referenceImageUrl: heroRef,
    geminiReferenceImages: geminiRefs.length > 0 ? geminiRefs : undefined,
  }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))

  const [hero, og] = await Promise.all([heroPromise, ogPromise])

  const images: PageImages = {
    ...(hero.ok && hero.url ? { hero_url: hero.url } : {}),
    ...(og.ok && og.url ? { og_url: og.url } : {}),
  }
  const errors: string[] = []
  if (heroStyle === 'ai_photo' && !hero.ok && 'error' in hero && hero.error) {
    errors.push(`hero: ${hero.error}`)
  }
  if (!og.ok && 'error' in og && og.error) {
    errors.push(`og: ${og.error}`)
  }
  const attempted = (heroStyle === 'ai_photo' ? 1 : 0) + 1
  const succeeded = (heroStyle === 'ai_photo' && hero.ok && hero.url ? 1 : 0) + (og.ok && og.url ? 1 : 0)
  // Surface whichever provider actually ran (Replicate or Gemini).
  const provider =
    (hero.ok && 'provider' in hero ? hero.provider : undefined) ??
    (og.ok && 'provider' in og ? og.provider : undefined)
  return { images, attempted, succeeded, errors, provider }
}

/** Style-aware hero prompt. The brand analysis's photography_style
 *  picks the right idiom — asking for "editorial photography" on a
 *  brand that uses illustration is a guaranteed off-brand result. */
function buildHeroPrompt(args: {
  context: string
  dreamOutcome: string
  primaryColour: string
  brandContextText: string
  photoStyle?: string
}): string {
  const { context, dreamOutcome, primaryColour, brandContextText, photoStyle } = args
  // Default = editorial photo (the sensible fallback for service /
  // consumer / B2B). Overridden by the brand analysis when present.
  let stylePrefix = `Editorial-quality photograph, magazine cover-grade. Real people, real environments, ` +
    `natural lighting, shallow depth of field. NOT stock photography — no fake smiles, no posed corporate scenes.`
  let styleSuffix = ''
  switch (photoStyle) {
    case 'illustrated':
      stylePrefix = `Custom flat illustration, hand-drawn feel, modern editorial style (think New York Times opinion piece illustration). ` +
        `Clean line work, generous use of brand colour ${primaryColour} for accents. NOT a photo.`
      styleSuffix = ` Single composition, no text, no UI mockups.`
      break
    case 'product_shot':
      stylePrefix = `Clean product photography on a minimal background. Studio lighting, sharp focus, ` +
        `careful colour grading. Hero product front-and-centre.`
      break
    case 'abstract':
      stylePrefix = `Abstract geometric composition. Bold shapes, generous use of brand colour ${primaryColour}, ` +
        `subtle gradients, depth via layering. NOT a photo of people.`
      break
    case 'editorial_photo':
      // Default already covers this — make it explicit.
      stylePrefix = `Editorial photography, story-driven, real moment captured. Natural light, real people doing real things. Magazine-grade.`
      break
    case 'stock_photo':
      // Operator's existing site uses stock — match it but raise the bar.
      stylePrefix = `Lifestyle photography in the style of contemporary brand campaigns (Apple, Airbnb, Patagonia). ` +
        `Real-feeling people in real environments, ${primaryColour} accent tones in the scene.`
      break
    case 'none':
      // Brand analysis said "no imagery" — but the operator opted in.
      // Default to abstract so we don't violate the no-photo brand.
      stylePrefix = `Abstract editorial composition. Bold shapes, brand colour ${primaryColour}, ` +
        `architectural feel. NOT a photo.`
      break
  }
  return `${stylePrefix}\n\n` +
    `Subject context: ${context}. The image should evoke the dream outcome: "${dreamOutcome}". ` +
    `Brand colour ${primaryColour} should appear naturally in the scene (clothing, props, environment) — not as a colour overlay. ` +
    `Negative space on one side for headline overlay; do NOT generate any text, logos, or watermarks.${styleSuffix}${brandContextText}`
}
