import { NextRequest, NextResponse } from 'next/server'
import { getValidAccessToken } from '@/lib/token-store'
import { requireLocationAccess } from '@/lib/require-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
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
