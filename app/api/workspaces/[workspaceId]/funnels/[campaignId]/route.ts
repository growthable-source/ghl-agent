/**
 * Single campaign — read, patch, delete.
 *
 * GET    → full campaign + linked landing page metadata
 * PUT    → patch any subset of editable fields (name, goal, status,
 *          intake, agent ids, pixel tracking ids, budgets, dates)
 * DELETE → admin-only; cascades to LandingPage via FK SetNull, drops
 *          FormSubmission/ConversionEvent rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'

const SELECT = {
  id: true,
  workspaceId: true,
  locationId: true,
  name: true,
  goal: true,
  status: true,
  offerSummary: true,
  intake: true,
  brandVoice: true,
  primaryColor: true,
  dailyBudget: true,
  totalBudget: true,
  startDate: true,
  endDate: true,
  landingPageId: true,
  triggeredAgentId: true,
  conversationalAgentId: true,
  metaCampaignExternalId: true,
  googleCampaignExternalId: true,
  targetValuePerLead: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  landingPage: { select: { slug: true, published: true, publishedAt: true, title: true } },
} as const

async function loadAndAuth(workspaceId: string, campaignId: string, role: 'member' | 'admin' = 'member') {
  const auth = await requireWorkspaceRole(workspaceId, role)
  if (auth instanceof NextResponse) return { error: auth }
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: SELECT })
  if (!campaign || campaign.workspaceId !== workspaceId) {
    return { error: NextResponse.json({ error: 'Campaign not found' }, { status: 404 }) }
  }
  return { auth, campaign }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; campaignId: string }> },
) {
  const { workspaceId, campaignId } = await params
  const r = await loadAndAuth(workspaceId, campaignId)
  if ('error' in r) return r.error
  return NextResponse.json({ campaign: r.campaign })
}

interface PatchBody {
  name?: string
  goal?: 'lead_gen' | 'book_call' | 'webinar_signup' | 'sale' | 'application' | 'waitlist'
  status?: 'draft' | 'live' | 'paused' | 'ended'
  offer_summary?: string | null
  intake?: Record<string, unknown>
  brand_voice?: string | null
  primary_color?: string | null
  daily_budget?: number | null
  total_budget?: number | null
  start_date?: string | null
  end_date?: string | null
  triggered_agent_id?: string | null
  conversational_agent_id?: string | null
  target_value_per_lead?: number | null
  notes?: string | null
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; campaignId: string }> },
) {
  const { workspaceId, campaignId } = await params
  const r = await loadAndAuth(workspaceId, campaignId)
  if ('error' in r) return r.error

  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Verify any agent ids belong to this workspace before allowing
  // them to be attached.
  for (const agentId of [body.triggered_agent_id, body.conversational_agent_id]) {
    if (!agentId) continue
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } })
    if (!agent || agent.workspaceId !== workspaceId) {
      return NextResponse.json({ error: `Invalid agent id: ${agentId}` }, { status: 400 })
    }
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name.trim()
  if (body.goal !== undefined) data.goal = body.goal
  if (body.status !== undefined) data.status = body.status
  if (body.offer_summary !== undefined) data.offerSummary = body.offer_summary
  if (body.intake !== undefined) data.intake = body.intake as object
  if (body.brand_voice !== undefined) data.brandVoice = body.brand_voice
  if (body.primary_color !== undefined) data.primaryColor = body.primary_color
  if (body.daily_budget !== undefined) data.dailyBudget = body.daily_budget
  if (body.total_budget !== undefined) data.totalBudget = body.total_budget
  if (body.start_date !== undefined) data.startDate = body.start_date ? new Date(body.start_date) : null
  if (body.end_date !== undefined) data.endDate = body.end_date ? new Date(body.end_date) : null
  if (body.triggered_agent_id !== undefined) data.triggeredAgentId = body.triggered_agent_id
  if (body.conversational_agent_id !== undefined) data.conversationalAgentId = body.conversational_agent_id
  if (body.target_value_per_lead !== undefined) data.targetValuePerLead = body.target_value_per_lead
  if (body.notes !== undefined) data.notes = body.notes

  const campaign = await db.campaign.update({ where: { id: campaignId }, data, select: SELECT })
  return NextResponse.json({ campaign })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; campaignId: string }> },
) {
  const { workspaceId, campaignId } = await params
  const r = await loadAndAuth(workspaceId, campaignId, 'admin')
  if ('error' in r) return r.error
  await db.campaign.delete({ where: { id: campaignId } })
  return NextResponse.json({ ok: true })
}
