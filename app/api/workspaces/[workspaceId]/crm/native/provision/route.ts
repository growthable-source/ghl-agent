/**
 * Provision the native CRM for a workspace.
 *
 * Creates (or returns the existing) `native:<workspaceId>` Location row
 * so Agent.locationId can resolve through the same factory path as GHL
 * and HubSpot. The Location's OAuth columns (accessToken, refreshToken,
 * etc.) are required NOT NULL — for native we fill them with sentinel
 * values since there's no external token to store. The factory key is
 * the `native:` prefix on the id, not those columns.
 *
 * Idempotent: re-POSTing returns the existing row with status 200.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

const NATIVE_PREFIX = 'native:'
const SENTINEL = 'native'
// Sentinel expiry is far enough in the future that the standard
// "is this token expired?" checks against GHL never see this row as
// stale. The native adapter doesn't read these columns at all.
const SENTINEL_EXPIRES_AT = new Date('2099-12-31T23:59:59.000Z')

export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locationId = `${NATIVE_PREFIX}${workspaceId}`

  const existing = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, crmProvider: true },
  })
  if (existing) {
    // Already provisioned. If the provider drifted (workspace was on GHL
    // and is now switching to native), flip the column so the factory
    // does the right thing on the next call.
    if (existing.crmProvider !== 'native') {
      await db.location.update({
        where: { id: locationId },
        data: { crmProvider: 'native' },
      })
    }
    return NextResponse.json({ locationId, alreadyProvisioned: true })
  }

  await db.location.create({
    data: {
      id: locationId,
      workspaceId,
      companyId: SENTINEL,
      userId: SENTINEL,
      userType: 'Location',
      scope: SENTINEL,
      accessToken: SENTINEL,
      refreshToken: SENTINEL,
      refreshTokenId: SENTINEL,
      expiresAt: SENTINEL_EXPIRES_AT,
      crmProvider: 'native',
    },
  })

  return NextResponse.json({ locationId, alreadyProvisioned: false }, { status: 201 })
}
