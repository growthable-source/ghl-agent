/**
 * Voxility funnels — list + create campaigns.
 *
 * GET  → list campaigns the caller can see (workspace-scoped).
 * POST → create a draft campaign with the 6-question intake. The
 *        landing page is created in a SEPARATE call once the wizard
 *        has the AI-generated spec (see ./[campaignId]/landing-page).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { canUseFunnelBuilder } from '@/lib/plans'

async function loadAccess(workspaceId: string) {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true, trialEndsAt: true },
  })
  return canUseFunnelBuilder(ws?.plan ?? 'free', ws?.trialEndsAt ?? null)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

  const access = await loadAccess(workspaceId)

  const campaigns = await db.campaign.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      goal: true,
      status: true,
      offerSummary: true,
      dailyBudget: true,
      createdAt: true,
      updatedAt: true,
      landingPageId: true,
      landingPage: { select: { slug: true, published: true } },
      _count: { select: { formSubmissions: true, conversionEvents: true } },
    },
  })
  return NextResponse.json({ campaigns, access })
}

interface CreateBody {
  name: string
  goal?: 'lead_gen' | 'book_call' | 'webinar_signup' | 'sale' | 'application' | 'waitlist'
  offer_summary?: string | null
  intake?: Record<string, unknown>
  brand_voice?: string | null
  primary_color?: string | null
  daily_budget?: number | null
  total_budget?: number | null
  location_id?: string | null
  // Brand kit — set on the wizard's Brand step (uploads happen via
  // /funnels/brand-asset-upload + /funnels/scrape-brand before this
  // POST fires; the wizard ships the resulting URLs/text here).
  logo_url?: string | null
  brand_guide_text?: string | null
  reference_url?: string | null
  extracted_colors?: string[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Plan gate — also enforced server-side so a direct API call from a
  // downgraded workspace can't sneak past the wizard's UI gate.
  const access = await loadAccess(workspaceId)
  if (!access.allowed) {
    return NextResponse.json(
      {
        error:
          access.reason === 'trial_expired'
            ? 'Your trial has expired. Upgrade to Growth or Scale to use the funnel builder.'
            : 'The funnel builder requires the Growth or Scale plan.',
        access,
      },
      { status: 402 },
    )
  }

  // Verify location_id (if provided) belongs to this workspace.
  if (body.location_id) {
    const loc = await db.location.findUnique({
      where: { id: body.location_id },
      select: { workspaceId: true },
    })
    if (!loc || loc.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid location_id' }, { status: 400 })
    }
  }

  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      locationId: body.location_id ?? null,
      name: body.name.trim(),
      goal: body.goal ?? 'lead_gen',
      status: 'draft',
      offerSummary: body.offer_summary ?? null,
      intake: (body.intake ?? {}) as object,
      brandVoice: body.brand_voice ?? null,
      primaryColor: body.primary_color ?? '#0A84FF',
      dailyBudget: body.daily_budget ?? null,
      totalBudget: body.total_budget ?? null,
      createdBy: auth.session.user.id!,
      logoUrl: body.logo_url ?? null,
      brandGuideText: body.brand_guide_text ?? null,
      referenceUrl: body.reference_url ?? null,
      extractedColors: Array.isArray(body.extracted_colors)
        ? body.extracted_colors
            .filter((c) => typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c.trim()))
            .map((c) => (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`))
            .slice(0, 8)
        : [],
    },
    select: { id: true, name: true, status: true, createdAt: true },
  })
  return NextResponse.json({ campaign }, { status: 201 })
}
