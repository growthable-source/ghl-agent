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
import { generatePageImages, getImageProviderStatus } from '@/lib/page-images'

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
    const out = await generatePageImages({
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

