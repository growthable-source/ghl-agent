'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * While the simulation is still running/queued, refresh the server
 * component every few seconds so new turns land in the UI as the
 * background worker appends them.
 *
 * This is a minimal client island — the page itself stays a server
 * component. Once the sim hits complete/failed, the effect unmounts
 * itself and polling stops.
 */
export default function SimulationAutoRefresh({ status }: { status: string }) {
  const router = useRouter()

  useEffect(() => {
    if (status !== 'running' && status !== 'queued') return
    // 3s interval balances "feels live" against not hammering the DB.
    // The background run posts turn updates to the DB on every turn,
    // so a 3s refresh captures each new turn within a few seconds of
    // it landing.
    const id = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(id)
  }, [status, router])

  return null
}
