'use client'

/**
 * AgentFlowSidePanel — slide-in panel anchored to the right edge of the
 * viewport, used by the Visual Workflow Canvas (Phase 4) to host the
 * inline editor for whichever node was clicked.
 *
 * Behaviour matches the spec at docs/superpowers/specs/2026-05-28-
 * visual-workflow-canvas-design.md → § "Side panel":
 *   - ~400px wide (90vw cap so it stays usable on narrow viewports)
 *   - Esc closes (with an unsaved-changes confirm if `unsavedChanges`)
 *   - Backdrop click does NOT close — guards against accidental loss
 *     of in-flight edits. Only the X button + Esc dismiss the panel.
 *   - Body scrolls when content overflows. Header + footer are fixed.
 *   - Footer is optional — the inner editor supplies its own Save /
 *     Cancel buttons there via the `footer` prop.
 *
 * Controlled component — no internal open state. Parent owns the
 * selected node and the open/close lifecycle.
 */

import { useEffect } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  unsavedChanges?: boolean
  footer?: React.ReactNode
}

export function AgentFlowSidePanel({ open, onClose, title, children, unsavedChanges, footer }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tryClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // tryClose closes over `unsavedChanges`; we want the latest value so the
    // confirm prompt reflects current dirty state at the moment Esc lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unsavedChanges])

  function tryClose() {
    if (unsavedChanges) {
      if (typeof window !== 'undefined' && !window.confirm('Discard unsaved changes?')) return
    }
    onClose()
  }

  if (!open) return null

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.18)',
          zIndex: 49,
        }}
      />
      <aside
        role="dialog"
        aria-label={title}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: '90vw',
          background: 'var(--surface, #ffffff)',
          borderLeft: '1px solid var(--border, #e5e7eb)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border, #e5e7eb)' }}
        >
          <span
            className="text-sm font-semibold truncate pr-2"
            style={{ color: 'var(--text-primary, #111827)' }}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={tryClose}
            aria-label="Close"
            className="text-sm px-2 py-0.5 rounded shrink-0"
            style={{ color: 'var(--text-tertiary, #6b7280)', background: 'transparent' }}
          >
            ✕
          </button>
        </header>
        <div
          style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
          className="px-4 py-3 space-y-3"
        >
          {children}
        </div>
        {footer && (
          <footer
            className="px-4 py-3 border-t flex items-center justify-end gap-2"
            style={{ borderColor: 'var(--border, #e5e7eb)', background: 'var(--surface, #ffffff)' }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </>
  )
}
