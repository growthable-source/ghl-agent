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
import { generateVslPage, type CampaignIntake, type PageTemplate } from '@/lib/vsl-generator'

// Tool-call generation with thinking can take 30–60s on cold cache.
// Keep well under the route handler default cap.
export const maxDuration = 90

interface Body {
  intake: CampaignIntake
  template?: PageTemplate
  primary_color?: string
  save_to_landing_page_id?: string
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
