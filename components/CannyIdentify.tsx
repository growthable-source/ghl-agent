'use client'

import { useSession } from 'next-auth/react'
import { useEffect } from 'react'
import { isPrimaryHost } from '@/lib/domains/primary-hosts'

declare global {
  interface Window {
    Canny?: (...args: unknown[]) => void
  }
}

export default function CannyIdentify() {
  const { data: session } = useSession()

  useEffect(() => {
    if (!session?.user || !window.Canny) return
    // A white-label team's staff aren't our users — never send them to our
    // feedback board (same client-side host rule as LeadConnectorChat).
    if (!isPrimaryHost(window.location.hostname)) return

    window.Canny('identify', {
      appID: '69d62477414c6291da2963c2',
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? session.user.email,
        avatarURL: session.user.image ?? undefined,
      },
    })
  }, [session])

  return null
}
