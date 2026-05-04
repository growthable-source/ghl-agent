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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

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
  return NextResponse.json({ campaigns })
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
    },
    select: { id: true, name: true, status: true, createdAt: true },
  })
  return NextResponse.json({ campaign }, { status: 201 })
}
