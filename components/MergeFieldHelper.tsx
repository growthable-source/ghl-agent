'use client'

import { useEffect, useRef, useState, forwardRef } from 'react'
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
   *  Typically fetched by the page from /api/workspaces/:id/contact-fields. */
  customFields?: Array<{ name: string; fieldKey: string }>
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

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

  const customSpecs: MergeFieldSpec[] = (customFields ?? []).map(cf => ({
    token: `{{custom.${cf.fieldKey}}}`,
    label: cf.name,
    example: '',
    group: 'Custom' as const,
  }))
  const all = [...MERGE_FIELDS, ...customSpecs]
  const groups: MergeFieldSpec['group'][] = ['Contact', 'Custom', 'Agent', 'Date']

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

      {open && (
        <div className="absolute right-0 mt-1 z-40 w-80 max-h-96 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl">
          <div className="px-3 py-2 border-b border-zinc-800 text-[11px] text-zinc-500">
            Click a field to insert it at the cursor. Tokens render at send time using live contact data. Add a fallback like <span className="font-mono text-zinc-400">{'{{'}contact.first_name|there{'}}'}</span>.
          </div>
          {groups.map(group => {
            const items = all.filter(f => f.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="py-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
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
      )}
    </div>
  )
}
