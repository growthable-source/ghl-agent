/**
 * Hero + OG image generation for a landing page.
 *
 * Pulls the prompt-construction + provider routing out of the
 * generate-page route so the build orchestrator can use the same path.
 *
 * Defaults:
 *   - heroStyle 'ai_photo' → generates a hero via Replicate Flux 1.1
 *     Pro Ultra (or Gemini fallback). ~$0.06.
 *   - heroStyle 'gradient' → no hero photo. Renderer uses the brand
 *     colour for a Stripe-style hero. OG image still generates.
 *
 * Brand-fidelity hooks: when the operator's reference site has been
 * scraped, the resulting screenshot URL + structured analysis are fed
 * into the prompt. Photography style ('illustrated', 'product_shot',
 * etc.) flips the hero prompt to match — asking for editorial
 * photography on an illustration brand always looks off.
 */

import { generateLandingImage, getImageProviderStatus } from './image-gen-orchestrator'
import type { BrandKit, CampaignIntake } from './vsl-generator'
import type { PageImages, PageSpec } from './page-spec'

export type HeroStyle = 'gradient' | 'ai_photo'

export interface ImageGenReport {
  images: PageImages
  attempted: number
  succeeded: number
  errors: string[]
  provider?: string
  /** Surface whether the deployment has any image provider configured. */
  enabled: boolean
}

export { getImageProviderStatus }

/**
 * Generate hero (when heroStyle='ai_photo') and OG images. Returns
 * the produced PageImages plus a diagnostic report for the wizard
 * banner. Never throws — failures land in `errors`.
 */
export async function generatePageImages(args: {
  intake: CampaignIntake
  spec: PageSpec
  brandKit?: BrandKit
  heroStyle: HeroStyle
  /** Blob path prefix, e.g. `landing/<id>` or `builds/<id>/iter-1`. */
  keyPrefix: string
}): Promise<ImageGenReport> {
  const providers = getImageProviderStatus()
  const enabled = providers.replicate || providers.gemini

  if (!enabled) {
    return { images: {}, attempted: 0, succeeded: 0, errors: [], enabled: false }
  }

  const { intake, spec, brandKit, heroStyle, keyPrefix } = args
  const primaryColour = spec.style?.primary_color ?? '#0A84FF'

  const context = [
    intake.business_name,
    intake.offer,
    intake.industry ? `Industry: ${intake.industry}` : '',
    intake.audience ? `Audience: ${intake.audience}` : '',
  ].filter(Boolean).join('. ')

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

  // Hero ref: screenshot is the richer signal for design vibe; logo
  // for colour/mark consistency. Both useful for the hero — model
  // adapts the operator's visual language into a fresh composition.
  const heroRef = brandKit?.screenshot_url ?? brandKit?.logo_url ?? null
  const heroGeminiRefs: string[] = []
  if (brandKit?.screenshot_url) heroGeminiRefs.push(brandKit.screenshot_url)
  if (brandKit?.logo_url) heroGeminiRefs.push(brandKit.logo_url)

  // OG ref: LOGO ONLY. Without this restriction the model takes the
  // operator's homepage screenshot too literally and produces an OG
  // image that's a near-copy of their existing site (same dashboard
  // mockup, same nav, same brand text). Logo alone keeps brand
  // identity (mark + colour) without forcing layout duplication.
  const ogRef = brandKit?.logo_url ?? null
  const ogGeminiRefs: string[] = []
  if (brandKit?.logo_url) ogGeminiRefs.push(brandKit.logo_url)

  const photoStyle = brandKit?.analysis?.photography_style
  const heroPrompt = buildHeroPrompt({ context, dreamOutcome: intake.dream_outcome, primaryColour, brandContextText, photoStyle })

  const ogPrompt =
    `Open Graph social preview image for a landing page. ` +
    `Business: ${intake.business_name}. Offer: ${intake.offer}. ` +
    `Bold, simple composition. Strong focal point centred. ` +
    `Use brand colour ${primaryColour} as a primary accent. ` +
    `Looks great as a thumbnail in LinkedIn, Slack, Twitter previews. No text overlays. ` +
    `DO NOT reproduce the operator's existing website — this is a fresh original social card, ` +
    `not a screenshot of their homepage. No UI mockups, no dashboard screenshots, no nav bars, ` +
    `no fake browser chrome.${brandContextText}`

  const heroPromise = heroStyle === 'ai_photo'
    ? generateLandingImage({
        prompt: heroPrompt,
        aspect: 'wide',
        keyPrefix: `${keyPrefix}/hero`,
        referenceImageUrl: heroRef,
        geminiReferenceImages: heroGeminiRefs.length > 0 ? heroGeminiRefs : undefined,
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    : Promise.resolve({ ok: true as const, url: undefined, provider: undefined })

  const ogPromise = generateLandingImage({
    prompt: ogPrompt,
    aspect: 'og',
    keyPrefix: `${keyPrefix}/og`,
    referenceImageUrl: ogRef,
    geminiReferenceImages: ogGeminiRefs.length > 0 ? ogGeminiRefs : undefined,
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
  const provider =
    (hero.ok && 'provider' in hero ? hero.provider : undefined) ??
    (og.ok && 'provider' in og ? og.provider : undefined)
  return { images, attempted, succeeded, errors, provider, enabled: true }
}

function buildHeroPrompt(args: {
  context: string
  dreamOutcome: string
  primaryColour: string
  brandContextText: string
  photoStyle?: string
}): string {
  const { context, dreamOutcome, primaryColour, brandContextText, photoStyle } = args
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
      stylePrefix = `Editorial photography, story-driven, real moment captured. Natural light, real people doing real things. Magazine-grade.`
      break
    case 'stock_photo':
      stylePrefix = `Lifestyle photography in the style of contemporary brand campaigns (Apple, Airbnb, Patagonia). ` +
        `Real-feeling people in real environments, ${primaryColour} accent tones in the scene.`
      break
    case 'none':
      stylePrefix = `Abstract editorial composition. Bold shapes, brand colour ${primaryColour}, ` +
        `architectural feel. NOT a photo.`
      break
  }
  // Anti-cliché block. Without this the model regresses to "people
  // around a laptop in a modern office" for almost any B2B intake —
  // the most generic stock-photo-ass output imaginable. Critics
  // consistently flag it as the #1 issue. Naming the cliché in the
  // prompt is the only thing that reliably defeats it.
  const banned = `\n\nABSOLUTELY DO NOT GENERATE: ` +
    `groups of people gathered around a laptop · meeting rooms · ` +
    `handshakes · finger-pointing at screens · diverse-team-of-three smiling · ` +
    `women holding takeaway coffee in offices · "discussing strategy" tableaux · ` +
    `whiteboard scenes · open-plan office bokeh. ` +
    `These are stock-photo clichés — the operator has seen them a thousand times. ` +
    `Find a SPECIFIC concrete visual for this exact offer instead.`
  return `${stylePrefix}\n\n` +
    `Subject context: ${context}. The image should evoke the dream outcome: "${dreamOutcome}". ` +
    `Brand colour ${primaryColour} should appear naturally in the scene (clothing, props, environment) — not as a colour overlay. ` +
    `Negative space on one side for headline overlay; do NOT generate any text, logos, or watermarks.${banned}${styleSuffix}${brandContextText}`
}
