/**
 * Create or replace the landing page attached to a campaign, then
 * publish it. Used by the wizard's final step. Idempotent: if the
 * campaign already has a landing page, it's updated in place rather
 * than orphaned.
 *
 * POST body: {
 *   title: string,
 *   meta_description?: string,
 *   spec: PageSpec,
 *   form_schema?: FormSchema,
 *   template?: 'vsl' | 'lead_gen' | 'webinar_optin' | 'application' | 'book_call',
 *   meta_pixel_id?: string,
 *   google_conversion_id?: string,
 *   google_conversion_label?: string,
 *   publish?: boolean   // default true; pass false to leave as draft
 * }
 *
 * Returns: { landing_page: { id, slug, published, url } }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'

interface Body {
  title: string
  meta_description?: string
  spec: object
  form_schema?: object
  template?: 'vsl' | 'lead_gen' | 'webinar_optin' | 'application' | 'book_call'
  meta_pixel_id?: string | null
  google_conversion_id?: string | null
  google_conversion_label?: string | null
  publish?: boolean
}

/** Generate a URL-safe slug from arbitrary text, suffix-disambiguated
 *  against existing LandingPage.slug values. */
async function claimSlug(base: string): Promise<string> {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'page'

  // Try the bare slug, then append a 5-char random suffix until free.
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0
      ? cleaned
      : `${cleaned.slice(0, 44)}-${Math.random().toString(36).slice(2, 7)}`
    const taken = await db.landingPage.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!taken) return candidate
  }
  throw new Error('Could not allocate landing page slug after 12 attempts')
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; campaignId: string }> },
) {
  const { workspaceId, campaignId } = await params

  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, workspaceId: true, name: true, landingPageId: true },
  })
  if (!campaign || campaign.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 })
  if (!body.spec) return NextResponse.json({ error: 'spec is required' }, { status: 400 })

  const publish = body.publish !== false
  const now = new Date()

  if (campaign.landingPageId) {
    // Update in place — preserve slug + createdAt.
    const updated = await db.landingPage.update({
      where: { id: campaign.landingPageId },
      data: {
        title: body.title.trim(),
        metaDescription: body.meta_description ?? null,
        spec: body.spec,
        formSchema: body.form_schema ?? {},
        template: body.template ?? 'vsl',
        metaPixelId: body.meta_pixel_id ?? null,
        googleConversionId: body.google_conversion_id ?? null,
        googleConversionLabel: body.google_conversion_label ?? null,
        published: publish,
        publishedAt: publish ? now : null,
      },
      select: { id: true, slug: true, published: true },
    })
    return NextResponse.json({
      landing_page: { ...updated, url: `/p/${updated.slug}` },
    })
  }

  // Fresh page — claim a unique slug from the campaign name.
  const slug = await claimSlug(campaign.name)

  const created = await db.landingPage.create({
    data: {
      workspaceId,
      template: body.template ?? 'vsl',
      slug,
      title: body.title.trim(),
      metaDescription: body.meta_description ?? null,
      spec: body.spec,
      formSchema: body.form_schema ?? {},
      metaPixelId: body.meta_pixel_id ?? null,
      googleConversionId: body.google_conversion_id ?? null,
      googleConversionLabel: body.google_conversion_label ?? null,
      published: publish,
      publishedAt: publish ? now : null,
      createdBy: auth.session.user.id!,
    },
    select: { id: true, slug: true, published: true },
  })

  // Wire it back to the campaign so future updates land on the same row.
  await db.campaign.update({
    where: { id: campaignId },
    data: { landingPageId: created.id },
  })

  return NextResponse.json({
    landing_page: { ...created, url: `/p/${created.slug}` },
  }, { status: 201 })
}
