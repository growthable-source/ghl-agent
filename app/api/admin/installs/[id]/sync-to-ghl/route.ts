import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

/**
 * Push a MarketplaceInstall into our OWN LeadConnector CRM as a Contact.
 *
 * "Our own GHL" means Ryan's internal sales tracking GHL account — the
 * one where leads from this product live. Configure via env:
 *
 *   VOXILITY_SALES_GHL_LOCATION_ID   — the destination location id
 *   VOXILITY_SALES_GHL_ACCESS_TOKEN  — a long-lived token for that
 *                                      location (generate from the GHL
 *                                      private integrations panel)
 *
 * Without those set, this endpoint returns 503 — admins still see the
 * button in the UI, they just get a clear "configure these env vars
 * first" message rather than a silent failure.
 *
 * On success, stamps syncedToGhlAt on the install row so subsequent
 * pushes from the same lead update the existing GHL contact rather
 * than creating duplicates (GHL's /contacts/upsert handles dedup by
 * email or phone).
 */
const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const destLocationId = process.env.VOXILITY_SALES_GHL_LOCATION_ID
  const destToken = process.env.VOXILITY_SALES_GHL_ACCESS_TOKEN
  if (!destLocationId || !destToken) {
    return NextResponse.json(
      {
        error: 'Sync target not configured. Set VOXILITY_SALES_GHL_LOCATION_ID + VOXILITY_SALES_GHL_ACCESS_TOKEN to your internal GHL location.',
        code: 'SYNC_NOT_CONFIGURED',
      },
      { status: 503 },
    )
  }

  const install = await db.marketplaceInstall.findUnique({
    where: { id },
    include: { workspace: { select: { id: true, name: true, slug: true } } },
  }).catch(() => null)
  if (!install) {
    return NextResponse.json({ error: 'Install not found' }, { status: 404 })
  }

  // Best identifier we have on the installing user — the user's email
  // beats the location/company email because GHL dedups on the contact
  // email and we want one contact per installing operator, not per
  // location. Fall back through the chain when fields are null.
  const contactEmail =
    install.userEmail ??
    install.locationEmail ??
    install.companyEmail ??
    null
  if (!contactEmail) {
    return NextResponse.json(
      {
        error: 'No email on this install — nothing to dedup against. Add one manually in the GHL contact, or skip the sync.',
        code: 'NO_EMAIL',
      },
      { status: 422 },
    )
  }

  // Tags carry the install context into GHL so sales can filter.
  // Source label matches the dashboard so reporting lines up across
  // both products.
  const tags = [
    `xovera-install`,
    `source:${install.source}`,
    install.userRole ? `role:${install.userRole}` : null,
  ].filter(Boolean) as string[]

  const body = {
    locationId: destLocationId,
    email: contactEmail,
    firstName: install.userName?.split(' ')[0] ?? null,
    lastName: install.userName?.split(' ').slice(1).join(' ') || null,
    phone: install.userPhone ?? install.locationPhone ?? install.companyPhone ?? null,
    companyName: install.companyName ?? install.locationName ?? null,
    website: install.companyWebsite ?? install.locationWebsite ?? null,
    address1: install.locationAddress ?? null,
    city: install.locationCity ?? null,
    state: install.locationState ?? null,
    country: install.locationCountry ?? null,
    tags,
    customFields: [
      // Free-text fields on the GHL contact so the sales rep can see
      // exactly which Xovera workspace this lead came from without
      // having to cross-reference IDs.
      { key: 'xovera_workspace_id', field_value: install.workspace?.id ?? '' },
      { key: 'xovera_workspace_name', field_value: install.workspace?.name ?? '' },
      { key: 'xovera_install_id', field_value: install.id },
      { key: 'xovera_installed_at', field_value: install.installedAt.toISOString() },
      { key: 'xovera_external_location_id', field_value: install.externalLocationId ?? '' },
      { key: 'xovera_external_company_id', field_value: install.externalCompanyId ?? '' },
    ],
  }

  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${destToken}`,
        Version: GHL_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[sync-to-ghl] upsert failed:', res.status, text.slice(0, 500))
      return NextResponse.json(
        { error: `GHL rejected the upsert: ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 },
      )
    }

    await db.marketplaceInstall.update({
      where: { id },
      data: { syncedToGhlAt: new Date() },
    })

    logAdminAction({
      admin: session,
      action: 'sync_install_to_ghl',
      meta: { installId: id, email: contactEmail, workspaceId: install.workspace?.id },
    })

    return NextResponse.redirect(new URL('/admin/installs', req.url), 303)
  } catch (err: any) {
    console.error('[sync-to-ghl] threw:', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Sync failed' }, { status: 500 })
  }
}
