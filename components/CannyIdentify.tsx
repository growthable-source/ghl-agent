'use client'

import { useSession } from 'next-auth/react'
import { useEffect } from 'react'

declare global {
  interface Window {
    Canny?: (...args: unknown[]) => void
  }
}

export default function CannyIdentify() {
  const { data: session } = useSession()

  useEffect(() => {
    if (!session?.user || !window.Canny) return

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
