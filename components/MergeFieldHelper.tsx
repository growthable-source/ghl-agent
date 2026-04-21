'use client'

import { useEffect, useRef, useState, forwardRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { MERGE_FIELDS, type MergeFieldSpec } from '@/lib/merge-fields'

/**
 * Drop-in replacement for <textarea> that adds a merge-field helper button
 * in the top-right of the input. Forwards every textarea prop through so
 * styling and refs work as expected.
 *
 * <MergeFieldTextarea
 *    value={message}
 *    onChange={e => setMessage(e.target.value)}
 *    onValueChange={setMessage}  // optional — receives the string directly
 *    rows={3}
 *    className="..."
 * />
 *
 * onValueChange is the escape hatch we use for inserting tokens — the
 * helper button writes directly through this so callers don't need to
 * synthesise a fake event.
 */
export const MergeFieldTextarea = forwardRef<
  HTMLTextAreaElement,
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    onValueChange: (next: string) => void
    customFields?: Array<{ name: string; fieldKey: string }>
    wrapperClassName?: string
  }
>(function MergeFieldTextarea({ value, onChange, onValueChange, customFields, wrapperClassName, className, ...rest }, forwarded) {
  const localRef = useRef<HTMLTextAreaElement>(null)
  // Accept an external ref without dropping our internal one.
  function setRef(el: HTMLTextAreaElement | null) {
    (localRef as any).current = el
    if (typeof forwarded === 'function') forwarded(el)
    else if (forwarded) (forwarded as React.RefObject<HTMLTextAreaElement | null>).current = el
  }

  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <textarea
        ref={setRef}
        value={value}
        onChange={onChange}
        className={className}
        {...rest}
      />
      <div className="absolute top-1.5 right-1.5">
        <MergeFieldHelper
          targetRef={localRef}
          value={value}
          onChange={onValueChange}
          customFields={customFields}
        />
      </div>
    </div>
  )
})

/**
 * Same pattern but for <input type="text"> (used for voice end-message, etc).
 */
export const MergeFieldInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    onValueChange: (next: string) => void
    customFields?: Array<{ name: string; fieldKey: string }>
    wrapperClassName?: string
  }
>(function MergeFieldInput({ value, onChange, onValueChange, customFields, wrapperClassName, className, ...rest }, forwarded) {
  const localRef = useRef<HTMLInputElement>(null)
  function setRef(el: HTMLInputElement | null) {
    (localRef as any).current = el
    if (typeof forwarded === 'function') forwarded(el)
    else if (forwarded) (forwarded as React.RefObject<HTMLInputElement | null>).current = el
  }

  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <input
        ref={setRef}
        type="text"
        value={value}
        onChange={onChange}
        // Extra right padding so text doesn't run under the helper button.
        className={`${className ?? ''} pr-28`}
        {...rest}
      />
      <div className="absolute top-1/2 -translate-y-1/2 right-1.5">
        <MergeFieldHelper
          targetRef={localRef}
          value={value}
          onChange={onValueChange}
          customFields={customFields}
        />
      </div>
    </div>
  )
})

/**
 * Popover button placed next to (or inside) any template textarea. Opens a
 * panel listing every available merge field grouped by kind. Clicking a
 * field inserts its token at the textarea's current cursor position via the
 * provided `onInsert` handler — caller owns the textarea state.
 *
 * Contract:
 *   const ref = useRef<HTMLTextAreaElement>(null)
 *   <textarea ref={ref} ... />
 *   <MergeFieldHelper targetRef={ref} value={message} onChange={setMessage} />
 *
 * The component will insert tokens at the cursor position; if the textarea
 * isn't focused, tokens are appended with a leading space.
 */
export default function MergeFieldHelper({
  targetRef,
  value,
  onChange,
  customFields,
}: {
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  value: string
  onChange: (next: string) => void
  /** Optional list of CRM custom fields to expose alongside the built-ins.
   *  When omitted, the helper auto-fetches from /api/workspaces/:id/contact-fields
   *  on first open so every page gets custom fields without plumbing. Pages
   *  that already loaded the list (qualifying, rules) pass it in to avoid
   *  a duplicate request. */
  customFields?: Array<{ name: string; fieldKey: string }>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [fetchedFields, setFetchedFields] = useState<Array<{ name: string; fieldKey: string }> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // The popover lives inside dashboard routes — grab the workspace id so we
  // can link to the full reference page. If we're somehow rendered outside
  // a workspace route, the link is hidden.
  const params = useParams()
  const workspaceId = (params?.workspaceId as string | undefined) ?? ''

  // Auto-fetch custom fields on first open — only when the caller didn't
  // pass them in. One-shot (no dependency on `open` beyond gating) so we
  // don't re-request every time the popover toggles.
  useEffect(() => {
    if (!open) return
    if (customFields) return            // caller supplied the list
    if (fetchedFields !== null) return  // already fetched this mount
    if (!workspaceId) return
    fetch(`/api/workspaces/${workspaceId}/contact-fields`)
      .then(r => r.json())
      .then(({ fields }) => {
        const list = Array.isArray(fields) ? fields : []
        // Only surface Custom fields — Standard fields are already in
        // MERGE_FIELDS (contact.first_name etc.) and would duplicate.
        const customs = list
          .filter((f: any) => f.group === 'Custom' && f.fieldKey)
          .map((f: any) => ({ name: f.name, fieldKey: f.fieldKey }))
        setFetchedFields(customs)
      })
      .catch(() => setFetchedFields([]))
  }, [open, customFields, fetchedFields, workspaceId])

  // Close on outside click — the popover is fixed-positioned but still
  // dismissed like a native menu.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Focus the search box when the popover opens; clear the query on close
  // so it doesn't persist stale state across opens.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open])

  function insertToken(token: string) {
    const el = targetRef.current
    if (!el) {
      // No active ref — append with a leading space so we don't jam against
      // prior content.
      onChange(value ? `${value} ${token}` : token)
      setOpen(false)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const next = value.slice(0, start) + token + value.slice(end)
    onChange(next)
    // Restore focus and put the cursor after the inserted token so users can
    // keep typing — without this the focus is on the helper button.
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      try { el.setSelectionRange(pos, pos) } catch { /* input types without selection */ }
    })
    setOpen(false)
  }

  // Prefer the caller-supplied list (qualifying + rules already have it
  // loaded), otherwise fall back to the list we fetched ourselves.
  const effectiveCustomFields = customFields ?? fetchedFields ?? []
  const customSpecs: MergeFieldSpec[] = effectiveCustomFields.map(cf => ({
    token: `{{custom.${cf.fieldKey}}}`,
    label: cf.name,
    example: '',
    group: 'Custom' as const,
  }))
  const all = [...MERGE_FIELDS, ...customSpecs]
  const groups: MergeFieldSpec['group'][] = ['Contact', 'Custom', 'Agent', 'User', 'Date']

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] font-medium text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
        title="Insert a contact / agent / date value"
      >
        {'{{'}…{'}}'} Insert value
      </button>

      {open && (() => {
        // Substring filter over label + token (case-insensitive). Groups
        // with zero matches are hidden entirely so the list collapses
        // naturally as the user types.
        const q = query.trim().toLowerCase()
        const matches = q
          ? all.filter(f =>
              f.label.toLowerCase().includes(q) ||
              f.token.toLowerCase().includes(q) ||
              f.group.toLowerCase().includes(q),
            )
          : all
        return (
          <div className="absolute right-0 mt-1 z-40 w-80 max-h-[28rem] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl">
            {/* Search — sticky at top, always visible as the list scrolls */}
            <div className="border-b border-zinc-800 p-2 shrink-0">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
                  // Enter inserts the first match so power users can type + hit enter.
                  if (e.key === 'Enter' && matches[0]) { e.preventDefault(); insertToken(matches[0].token) }
                }}
                placeholder="Search merge fields…"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div className="px-3 py-2 border-b border-zinc-800 text-[11px] text-zinc-500 shrink-0">
              Click a field to insert. Tokens render at send time. Add a fallback like <span className="font-mono text-zinc-400">{'{{'}contact.first_name|there{'}}'}</span>.
            </div>
            <div className="overflow-y-auto flex-1">
              {matches.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px] text-zinc-600">
                  No merge fields match &ldquo;{query}&rdquo;.
                </div>
              )}
              {groups.map(group => {
                const items = matches.filter(f => f.group === group)
                if (items.length === 0) return null
                return (
                  <div key={group} className="py-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 sticky top-0 bg-zinc-950">
                      {group}
                    </div>
                    {items.map(f => (
                      <button
                        key={f.token}
                        type="button"
                        onClick={() => insertToken(f.token)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-zinc-900 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs text-zinc-200 truncate">{f.label}</div>
                          <div className="text-[10px] text-zinc-600 font-mono truncate">{f.token}</div>
                        </div>
                        {f.example && (
                          <div className="text-[10px] text-zinc-600 italic truncate max-w-[100px]">
                            {f.example}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
            {workspaceId && (
              <div className="border-t border-zinc-800 px-3 py-2 shrink-0">
                {/* Opens in a new tab — users often want to keep the form
                    in-flight and cross-reference the docs side by side. */}
                <Link
                  href={`/dashboard/${workspaceId}/help/merge-fields`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1"
                >
                  Full reference
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </Link>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
