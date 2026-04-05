import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { type, token } = await req.json()

  if (!token || !type) {
    return NextResponse.json({ error: 'Missing type or token' }, { status: 400 })
  }

  try {
    switch (type) {
      case 'calendly': {
        const res = await fetch('https://api.calendly.com/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Invalid Calendly token')
        const data = await res.json()
        return NextResponse.json({
          valid: true,
          userName: data.resource?.name,
          userUri: data.resource?.uri,
        })
      }

      case 'calcom': {
        const res = await fetch('https://api.cal.com/v2/me', {
          headers: {
            Authorization: `Bearer ${token}`,
            'cal-api-version': '2024-08-13',
          },
        })
        if (!res.ok) throw new Error('Invalid Cal.com API key')
        const data = await res.json()
        return NextResponse.json({
          valid: true,
          userName: data.data?.name || data.data?.username,
          userId: data.data?.id,
        })
      }

      case 'stripe': {
        const res = await fetch('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Invalid Stripe key')
        const data = await res.json()
        return NextResponse.json({
          valid: true,
          accountName: data.settings?.dashboard?.display_name || data.business_profile?.name || data.id,
          accountId: data.id,
        })
      }

      default:
        return NextResponse.json({ error: `Unknown integration type: ${type}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
