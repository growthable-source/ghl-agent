/**
 * Public form-submit endpoint for Voxility landing pages.
 *
 * No auth: this is the webhook every /p/<slug> form posts to. We trust
 * the request shape but validate the landing page (must exist, must be
 * published) before any DB write. The route handler runs server-side so
 * it can use the service-role db client.
 *
 * Flow:
 *   1. Validate landing_page_id (exists + published) — abort early if not.
 *   2. Resolve workspace + the campaign attached to this page.
 *   3. Native CRM: upsert NativeContact by (workspaceId, email|phone),
 *      mirroring the pattern used by /api/twilio/sms.
 *      External CRM (ghl/hubspot): skip the contact upsert for now;
 *      raw payload is preserved on the FormSubmission row so a
 *      follow-up sync can write it via CrmAdapter.
 *   4. Insert FormSubmission row (raw payload + utm + fbp/fbc/gclid).
 *   5. Insert `lead` ConversionEvent — eventId is the idempotency key
 *      that Phase 4's conversion-fire job uses for Meta CAPI / Google
 *      Ads dedup.
 *   6. Return { ok, contact_id, submission_id, event_id }.
 *
 * Phase 4 will add: dispatching the conversion event to Meta CAPI +
 *   Google Ads server-side, plus invoking the campaign's triggered
 *   agent (instant SMS) and conversational agent (callback in 60s).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveCrmLocationId } from '@/lib/funnel-locator'
import { normalizeEmail, normalizePhone } from '@/lib/crm/native/normalize'
import { fireConversion } from '@/lib/conversion-fire'

// Form submissions never need anywhere close to 300s; 60s is plenty even
// with tail-latency CRM upserts. Reduce default to keep the route hot.
export const maxDuration = 60

type SubmitPayload = {
  landing_page_id: string
  campaign_id?: string | null
  fields: {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
    message?: string
  }
  tracking?: {
    fbp?: string | null
    fbc?: string | null
    gclid?: string | null
    utm?: Record<string, string>
    referrer?: string
  }
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function POST(req: NextRequest) {
  let payload: SubmitPayload
  try {
    payload = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }

  if (!payload?.landing_page_id) return bad('landing_page_id is required')
  if (!payload.fields?.email && !payload.fields?.phone) {
    return bad('At least one of email or phone is required')
  }

  // ─── 1. Page validation ─────────────────────────────────────────────
  const page = await db.landingPage.findUnique({
    where: { id: payload.landing_page_id },
    select: { id: true, workspaceId: true, published: true },
  })
  if (!page) return bad('Landing page not found', 404)
  if (!page.published) return bad('Landing page is not published', 403)

  const workspaceId = page.workspaceId

  // ─── 2. Campaign + Location resolution ──────────────────────────────
  // The campaign id can come from the request (sent by the form on the
  // hosted page) or from the page row itself (the inverse relation lives
  // on Campaign.landingPageId).
  let campaignId = payload.campaign_id ?? null
  let campaignLocationId: string | null = null
  if (!campaignId) {
    const c = await db.campaign.findFirst({
      where: { landingPageId: page.id },
      select: { id: true, locationId: true },
    })
    if (c) {
      campaignId = c.id
      campaignLocationId = c.locationId
    }
  } else {
    const c = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { locationId: true },
    })
    campaignLocationId = c?.locationId ?? null
  }

  const locationId = await resolveCrmLocationId({ workspaceId, campaignLocationId })

  // ─── 3. Contact upsert ──────────────────────────────────────────────
  // Native CRM: write through Prisma directly (matches /api/twilio/sms).
  // External CRM (ghl/hubspot): skip — raw payload survives on the
  // FormSubmission row and a follow-up sync can fan it out.
  let contactId: string | null = null
  if (locationId.startsWith('native:')) {
    const email = normalizeEmail(payload.fields.email)
    const phone = normalizePhone(payload.fields.phone)

    // Email match takes precedence; fall back to phone if no email match.
    let existing = email
      ? await db.nativeContact.findFirst({
          where: { workspaceId, email },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, sourceCampaignId: true },
        })
      : null
    if (!existing && phone) {
      existing = await db.nativeContact.findFirst({
        where: { workspaceId, phone },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, sourceCampaignId: true },
      })
    }

    if (existing) {
      // Don't overwrite existing fields with empty values; only fill gaps.
      const update: Record<string, unknown> = {}
      if (payload.fields.first_name && !existing.firstName) update.firstName = payload.fields.first_name
      if (payload.fields.last_name && !existing.lastName) update.lastName = payload.fields.last_name
      if (email && !existing.email) update.email = email
      if (phone && !existing.phone) update.phone = phone
      if (campaignId && !existing.sourceCampaignId) update.sourceCampaignId = campaignId
      if (Object.keys(update).length > 0) {
        await db.nativeContact.update({ where: { id: existing.id }, data: update })
      }
      contactId = existing.id
    } else {
      const created = await db.nativeContact.create({
        data: {
          workspaceId,
          firstName: payload.fields.first_name ?? null,
          lastName: payload.fields.last_name ?? null,
          email: email ?? null,
          phone: phone ?? null,
          source: 'funnel',
          sourceCampaignId: campaignId,
          sourceUrl: req.headers.get('origin') ?? req.headers.get('referer') ?? null,
          sourceUtm: payload.tracking?.utm ?? {},
        },
        select: { id: true },
      })
      contactId = created.id
    }
  }
  // External CRM dispatch is intentionally deferred — see header comment.

  // ─── 4. FormSubmission row ──────────────────────────────────────────
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    null

  const submission = await db.formSubmission.create({
    data: {
      workspaceId,
      campaignId,
      landingPageId: page.id,
      contactId,
      rawPayload: payload.fields ?? {},
      utm: payload.tracking?.utm ?? {},
      referrer: payload.tracking?.referrer ?? null,
      ipAddress,
      userAgent: req.headers.get('user-agent'),
      fbp: payload.tracking?.fbp ?? null,
      fbc: payload.tracking?.fbc ?? null,
      gclid: payload.tracking?.gclid ?? null,
    },
    select: { id: true },
  })

  // ─── 5. ConversionEvent (lead) ──────────────────────────────────────
  // Phase 4 will pick this up and fire to Meta CAPI + Google Ads. The
  // eventId field is an idempotency key — same row safe to retry on
  // both platforms without duplicating.
  const conversion = await db.conversionEvent.create({
    data: {
      workspaceId,
      campaignId,
      contactId,
      submissionId: submission.id,
      eventName: 'lead',
    },
    select: { id: true, eventId: true },
  })

  // Fire the lead conversion to Meta CAPI + Google Ads in the
  // background. We don't await — Meta CAPI is fast (~500ms) but on a
  // cold pixel-config lookup it can run longer, and the form submitter
  // shouldn't pay that latency. If the fire fails we leave a marker on
  // the event row and the cron-retry job picks it up.
  void fireConversion(conversion.id).catch((err) => {
    console.error('[form-submit] conversion-fire failed for event', conversion.id, err)
  })
  // TODO(voxility:phase-5) — invoke the campaign's triggered agent
  //   (instant SMS) using the existing agent infrastructure.

  return NextResponse.json({
    ok: true,
    contact_id: contactId,
    submission_id: submission.id,
    event_id: conversion.eventId,
  })
}

// CORS preflight — landing pages may be served from a custom domain
// (Phase 5+) so allow cross-origin POSTs explicitly.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
