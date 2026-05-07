/**
 * Asset generation pipeline.
 *
 * Takes a VisualBrief and produces the actual image assets (hero + 1-3
 * illustrations + OG image) the page composer will reference. All image
 * generation runs in parallel — the build orchestrator blocks on this
 * step, so finishing in ~30-60s instead of 2-3min matters.
 *
 * Replicate Flux 1.1 Pro Ultra is the primary; Gemini 2.5 Flash Image
 * fallback is handled inside generateLandingImage. Each asset upload
 * lands in Vercel Blob keyed by buildId so retries are isolated.
 *
 * Cost: ~$0.06 per image × (1 hero + N illustrations + 1 OG) × maybe 2
 * regenerations per build. Worst-case ~$0.50/build. The user has
 * said cost is not a concern.
 */

import { generateLandingImage, getImageProviderStatus } from './image-gen-orchestrator'
import type { BrandKit, CampaignIntake } from './vsl-generator'
import type { VisualBrief } from './visual-brief'

export interface PageAssets {
  /** Full-bleed hero photo URL (Vercel Blob), null if generation failed. */
  hero_url: string | null
  /** Open Graph social-preview image URL. */
  og_url: string | null
  /** Per-section illustrations keyed by role: 'problem' | 'mechanism' | 'proof'. */
  illustrations: Record<string, string>
  /** Diagnostic for the build's imageGenReport — what fired, what failed. */
  report: AssetGenReport
}

export interface AssetGenReport {
  enabled: boolean
  attempted: number
  succeeded: number
  provider: string | null
  errors: string[]
  /** When true, no provider is configured. Pages will still render
   *  via the gradient + icon fallbacks but no Replicate output exists. */
  noProvider: boolean
}

interface GenerateArgs {
  brief: VisualBrief
  intake: CampaignIntake
  brand_kit?: BrandKit
  primary_color: string
  /** Vercel Blob path prefix, typically `landing/builds/<buildId>`. */
  key_prefix: string
}

export async function generatePageAssets(args: GenerateArgs): Promise<PageAssets> {
  const providers = getImageProviderStatus()
  const enabled = providers.replicate || providers.gemini
  if (!enabled) {
    return {
      hero_url: null,
      og_url: null,
      illustrations: {},
      report: { enabled: false, attempted: 0, succeeded: 0, provider: null, errors: [], noProvider: true },
    }
  }

  const { brief, intake, brand_kit, primary_color, key_prefix } = args

  // Brand context — same prose used to ground every prompt.
  const brandContextText = buildBrandContext(brand_kit)
  // Hero gets the screenshot+logo as references; OG and illustrations
  // get LOGO ONLY so the model doesn't reproduce the operator's site.
  const heroRef = brand_kit?.screenshot_url ?? brand_kit?.logo_url ?? null
  const heroGeminiRefs = [brand_kit?.screenshot_url, brand_kit?.logo_url].filter((u): u is string => !!u)
  const logoOnlyRef = brand_kit?.logo_url ?? null
  const logoOnlyGeminiRefs = brand_kit?.logo_url ? [brand_kit.logo_url] : []

  // Hero
  const heroPrompt = buildHeroPrompt({ brief, primary_color, brandContextText, brand_kit })
  // Illustrations — concept-specific, brand-coherent, NOT photography.
  const illustrationPrompts = brief.illustrations.map((i) => ({
    role: i.role,
    prompt: buildIllustrationPrompt({ illustration: i, primary_color, brandContextText, brand_kit }),
  }))
  // OG — a clean original social card, never a screenshot of the source.
  const ogPrompt = buildOgPrompt({ intake, primary_color, brandContextText })

  // Fire all image-gens in parallel.
  const heroPromise = generateLandingImage({
    prompt: heroPrompt,
    aspect: 'wide',
    keyPrefix: `${key_prefix}/hero`,
    referenceImageUrl: heroRef,
    geminiReferenceImages: heroGeminiRefs.length > 0 ? heroGeminiRefs : undefined,
  }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), provider: undefined }))

  const ogPromise = generateLandingImage({
    prompt: ogPrompt,
    aspect: 'og',
    keyPrefix: `${key_prefix}/og`,
    referenceImageUrl: logoOnlyRef,
    geminiReferenceImages: logoOnlyGeminiRefs.length > 0 ? logoOnlyGeminiRefs : undefined,
  }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), provider: undefined }))

  const illustrationPromises = illustrationPrompts.map((ip) =>
    generateLandingImage({
      prompt: ip.prompt,
      aspect: 'square',
      keyPrefix: `${key_prefix}/illustration-${ip.role}`,
      referenceImageUrl: logoOnlyRef,
      geminiReferenceImages: logoOnlyGeminiRefs.length > 0 ? logoOnlyGeminiRefs : undefined,
    }).then((result) => ({ role: ip.role, result }))
      .catch((e) => ({ role: ip.role, result: { ok: false as const, error: e instanceof Error ? e.message : String(e), provider: undefined } })),
  )

  const [hero, og, ...illustrations] = await Promise.all([heroPromise, ogPromise, ...illustrationPromises])

  // Aggregate.
  const errors: string[] = []
  let succeeded = 0
  const attempted = 2 + illustrationPrompts.length // hero + og + N illustrations
  const providersFired = new Set<string>()

  const heroUrl = hero.ok && 'url' in hero && hero.url ? hero.url : null
  if (heroUrl) succeeded++
  else if ('error' in hero && hero.error) errors.push(`hero: ${hero.error}`)
  if (hero.ok && 'provider' in hero && hero.provider) providersFired.add(hero.provider)

  const ogUrl = og.ok && 'url' in og && og.url ? og.url : null
  if (ogUrl) succeeded++
  else if ('error' in og && og.error) errors.push(`og: ${og.error}`)
  if (og.ok && 'provider' in og && og.provider) providersFired.add(og.provider)

  const illustrationsByRole: Record<string, string> = {}
  for (const i of illustrations) {
    const r = i as { role: string; result: { ok: boolean; url?: string; error?: string; provider?: string } }
    if (r.result.ok && r.result.url) {
      illustrationsByRole[r.role] = r.result.url
      succeeded++
      if (r.result.provider) providersFired.add(r.result.provider)
    } else if (r.result.error) {
      errors.push(`illustration[${r.role}]: ${r.result.error}`)
    }
  }

  return {
    hero_url: heroUrl,
    og_url: ogUrl,
    illustrations: illustrationsByRole,
    report: {
      enabled: true,
      attempted,
      succeeded,
      provider: providersFired.size === 1 ? Array.from(providersFired)[0] : providersFired.size > 1 ? Array.from(providersFired).join('+') : null,
      errors,
      noProvider: false,
    },
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────

function buildBrandContext(brand_kit?: BrandKit): string {
  if (!brand_kit) return ''
  const bits: string[] = []
  if (brand_kit.brand_guide_text) {
    bits.push(`Brand guide notes: ${brand_kit.brand_guide_text.slice(0, 600)}`)
  }
  if (brand_kit.analysis) {
    const a = brand_kit.analysis
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
      bits.push(`Brand identity (extracted from operator's site):\n${visionBits.join('\n')}`)
    }
  }
  if (brand_kit.extracted_colors && brand_kit.extracted_colors.length > 0) {
    bits.push(`Brand palette: ${brand_kit.extracted_colors.join(', ')}`)
  }
  return bits.length > 0 ? `\n\n${bits.join('\n')}` : ''
}

function buildHeroPrompt(args: {
  brief: VisualBrief
  primary_color: string
  brandContextText: string
  brand_kit?: BrandKit
}): string {
  const photoStyle = args.brand_kit?.analysis?.photography_style
  const styleDirective = photoStyleDirective(photoStyle, args.primary_color)
  return `${styleDirective}\n\n` +
    `Subject: ${args.brief.hero_prompt_seed}\n\n` +
    `Use brand colour ${args.primary_color} naturally in the scene (clothing, props, environment) — not as an overlay. ` +
    `Negative space on one side for headline overlay; do NOT generate any text, logos, or watermarks.\n\n` +
    `ABSOLUTELY DO NOT GENERATE: groups of people gathered around a laptop · meeting rooms · ` +
    `handshakes · finger-pointing at screens · diverse-team-of-three smiling · women holding takeaway coffee in offices · ` +
    `"discussing strategy" tableaux · whiteboard scenes · open-plan office bokeh.${args.brandContextText}`
}

function buildIllustrationPrompt(args: {
  illustration: VisualBrief['illustrations'][number]
  primary_color: string
  brandContextText: string
  brand_kit?: BrandKit
}): string {
  const photoStyle = args.brand_kit?.analysis?.photography_style
  // Illustrations should be ILLUSTRATIONS regardless of the brand's
  // photography style — they fill a different visual role from the
  // hero. Keep them clean, brand-coloured, and graphic.
  const isIllustratedBrand = photoStyle === 'illustrated'
  const stylePrefix = isIllustratedBrand
    ? `Continuation of the operator's existing illustration style: clean line work, hand-drawn feel, modern editorial, brand colour ${args.primary_color} as primary accent.`
    : `Custom editorial illustration. Modern, clean line work with subtle gradient fills. Brand colour ${args.primary_color} as the primary accent. Generous negative space. Single clear subject. Designed to sit alongside text in a section card — NOT a photograph, NOT a stock illustration of "people in office," NOT a corporate handshake.`
  return `${stylePrefix}\n\n` +
    `Subject: ${args.illustration.prompt_seed}\n\n` +
    `Square 1:1 composition. Subject centred. No text, no logos, no watermarks, no UI mockups, no fake browser chrome.${args.brandContextText}`
}

function buildOgPrompt(args: { intake: CampaignIntake; primary_color: string; brandContextText: string }): string {
  return `Open Graph social preview image for a landing page. ` +
    `Business: ${args.intake.business_name}. Offer: ${args.intake.offer}. ` +
    `Bold, simple composition. Strong focal point centred. ` +
    `Use brand colour ${args.primary_color} as a primary accent. ` +
    `Looks great as a thumbnail in LinkedIn, Slack, Twitter previews. No text overlays. ` +
    `DO NOT reproduce the operator's existing website — this is a fresh original social card, ` +
    `not a screenshot of their homepage. No UI mockups, no dashboard screenshots, no nav bars, no fake browser chrome.${args.brandContextText}`
}

function photoStyleDirective(photoStyle: string | undefined, primaryColor: string): string {
  switch (photoStyle) {
    case 'illustrated':
      return `Custom flat illustration, hand-drawn feel, modern editorial style. Clean line work, generous use of brand colour ${primaryColor} for accents. NOT a photo. Single composition, no text, no UI mockups.`
    case 'product_shot':
      return `Clean product photography on a minimal background. Studio lighting, sharp focus, careful colour grading. Hero product front-and-centre.`
    case 'abstract':
      return `Abstract geometric composition. Bold shapes, generous use of brand colour ${primaryColor}, subtle gradients, depth via layering. NOT a photo of people.`
    case 'editorial_photo':
      return `Editorial photography, story-driven, real moment captured. Natural light, real people doing real things. Magazine-grade.`
    case 'stock_photo':
      return `Lifestyle photography in the style of contemporary brand campaigns (Apple, Airbnb, Patagonia). Real-feeling people in real environments, ${primaryColor} accent tones in the scene.`
    case 'none':
      return `Abstract editorial composition. Bold shapes, brand colour ${primaryColor}, architectural feel. NOT a photo.`
    default:
      return `Editorial-quality photograph, magazine cover-grade. Real people, real environments, natural lighting, shallow depth of field. NOT stock photography — no fake smiles, no posed corporate scenes.`
  }
}
