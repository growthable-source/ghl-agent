import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getValidAccessToken } from '@/lib/token-store'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Get the first location for this workspace to use its CRM locationId
  const location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'No location found for workspace' }, { status: 404 })

  const locationId = location.id
  const token = await getValidAccessToken(locationId)
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/?locationId=${locationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-04-15',
        Accept: 'application/json',
      },
    }
  )

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({ error: body }, { status: res.status })
  }

  const data = await res.json()
  // GHL returns { calendars: [...] }
  return NextResponse.json({ calendars: data.calendars ?? [] })
}
