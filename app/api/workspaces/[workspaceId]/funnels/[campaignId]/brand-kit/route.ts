/**
 * Brand-kit endpoint for a single funnel campaign.
 *
 *   POST   multipart `file` field → upload logo image to Vercel Blob,
 *          set Campaign.logoUrl. Same MIME/size rules as workspace logos.
 *   PATCH  json { brandGuideText?, referenceUrl?, primaryColor?,
 *                 extractedColors? } → save text-y brand fields.
 *   GET    → return the current brand kit for the campaign.
 *
 * The fields exist on Campaign rather than Workspace so a single
 * workspace can run multiple funnels with distinct visual identities
 * (sub-brands, A/B page tests, geo variants). Workspace-level brand
 * kit can come later as a default for new campaigns.
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_LOGO_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
])

type Params = { workspaceId: string; campaignId: string }

async function loadCampaign(workspaceId: string, campaignId: string) {
  const camp = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    select: {
      id: true,
      logoUrl: true,
      brandGuideText: true,
      referenceUrl: true,
      extractedColors: true,
      primaryColor: true,
    },
  })
  return camp
}

export async function GET(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, campaignId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const camp = await loadCampaign(workspaceId, campaignId)
  if (!camp) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  return NextResponse.json({ brandKit: camp })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, campaignId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const camp = await loadCampaign(workspaceId, campaignId)
  if (!camp) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    brandGuideText?: string | null
    referenceUrl?: string | null
    primaryColor?: string | null
    extractedColors?: string[]
    logoUrl?: string | null
  }

  const data: Record<string, unknown> = {}
  if ('brandGuideText' in body) data.brandGuideText = (body.brandGuideText ?? '').trim() || null
  if ('referenceUrl' in body) data.referenceUrl = (body.referenceUrl ?? '').trim() || null
  if ('primaryColor' in body && typeof body.primaryColor === 'string' && body.primaryColor.trim()) {
    data.primaryColor = body.primaryColor.trim()
  }
  if (Array.isArray(body.extractedColors)) {
    // Filter to plausible hex strings; cap at 8 so a malicious payload
    // can't dump arbitrary data into the column.
    data.extractedColors = body.extractedColors
      .filter((c) => typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c.trim()))
      .map((c) => (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`))
      .slice(0, 8)
  }
  if ('logoUrl' in body) data.logoUrl = body.logoUrl ?? null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no editable fields in body' }, { status: 400 })
  }

  const updated = await db.campaign.update({
    where: { id: campaignId },
    data,
    select: {
      id: true,
      logoUrl: true,
      brandGuideText: true,
      referenceUrl: true,
      extractedColors: true,
      primaryColor: true,
    },
  })
  return NextResponse.json({ brandKit: updated })
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, campaignId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const camp = await loadCampaign(workspaceId, campaignId)
  if (!camp) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob storage not configured. Add BLOB_READ_WRITE_TOKEN in Vercel → Storage → Blob.' },
      { status: 500 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a `file` field.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field.' }, { status: 400 })
  }
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: `Logo too large — max ${MAX_LOGO_BYTES / 1024 / 1024} MB.` }, { status: 413 })
  }
  if (!ALLOWED_LOGO_MIME.has(file.type.toLowerCase())) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `campaigns/${campaignId}/logo-${Date.now()}.${ext}`
  let blobUrl: string
  try {
    const blob = await put(path, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    })
    blobUrl = blob.url
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 500 },
    )
  }

  await db.campaign.update({ where: { id: campaignId }, data: { logoUrl: blobUrl } })
  return NextResponse.json({ logoUrl: blobUrl })
}
