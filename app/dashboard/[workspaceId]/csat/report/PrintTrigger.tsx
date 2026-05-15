'use client'

import { useEffect } from 'react'

/**
 * Fires the browser's print dialog ~250ms after mount so the report
 * has time to render fonts and lay out before the snapshot is taken.
 * Operators get a save-as-PDF prompt without clicking anything.
 */
export default function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => {
      try { window.print() } catch { /* user cancelled or no print available */ }
    }, 250)
    return () => clearTimeout(t)
  }, [])
  return (
    <button
      onClick={() => window.print()}
      style={{
        fontSize: 12, fontWeight: 600,
        padding: '6px 12px', borderRadius: 6,
        background: '#111827', color: 'white', border: 'none', cursor: 'pointer',
      }}
    >
      Print again
    </button>
  )
}
