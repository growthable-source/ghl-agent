'use client'

/**
 * Tiny dropdown attached to the × on a dismissable banner.
 * Options:
 *   - Snooze 1 day
 *   - Snooze 1 week
 *   - Don't show again
 *
 * Hovering the × shows a tooltip-y "Dismiss options"; clicking opens
 * the menu. Outside-click closes it. Designed to sit inside the
 * banner's existing layout without expanding it — just replace the
 * raw × button with <BannerDismissMenu onSelect={...} accentColor={...} />.
 */

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Token used for the × color + hover state. Inherits from the
   *  banner so the menu trigger matches the banner's accent. */
  accentColor: string
  onSnooze: (hours: number) => void
  onDismissForever: () => void
}

export default function BannerDismissMenu({ accentColor, onSnooze, onDismissForever }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Dismiss options"
        title="Dismiss this banner"
        className="text-sm leading-none px-1 transition-opacity hover:opacity-100"
        style={{ color: accentColor, opacity: 0.7 }}
      >
        ×
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg shadow-xl overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <MenuItem onClick={() => { onSnooze(24); setOpen(false) }}>
            Snooze for 1 day
          </MenuItem>
          <MenuItem onClick={() => { onSnooze(24 * 7); setOpen(false) }}>
            Snooze for 1 week
          </MenuItem>
          <MenuDivider />
          <MenuItem destructive onClick={() => { onDismissForever(); setOpen(false) }}>
            Don&apos;t show again
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({ children, onClick, destructive }: {
  children: React.ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full text-left px-3 py-2 text-xs hover:bg-zinc-900 transition-colors"
      style={{ color: destructive ? 'var(--accent-red)' : 'var(--text-primary)' }}
    >
      {children}
    </button>
  )
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border)' }} />
}
