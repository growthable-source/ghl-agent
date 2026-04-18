'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * useDirtyForm — canonical hook for tracking whether a form has unsaved
 * changes. One pattern, every agent sub-page uses it.
 *
 * Usage:
 *   const { draft, set, dirty, save, saving, savedAt, reset } = useDirtyForm({
 *     initial,
 *     onSave: async (draft) => { await fetch(...) }
 *   })
 *
 *   <input value={draft.name} onChange={e => set({ name: e.target.value })} />
 *   <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
 *
 * Guards:
 *   - `beforeunload` warning if user tries to close the tab with unsaved changes
 *   - auto-clears dirty flag after successful save
 *   - tracks lastSavedAt so SaveBar can show "Saved 5s ago"
 */
export function useDirtyForm<T extends Record<string, any>>(params: {
  initial: T | null | undefined
  onSave: (draft: T) => Promise<void> | void
  /** When true, treats every render where `initial` changes as a reset. Default true. */
  syncWithInitial?: boolean
}): {
  draft: T
  set: (patch: Partial<T>) => void
  replace: (next: T) => void
  dirty: boolean
  saving: boolean
  savedAt: Date | null
  error: string | null
  save: () => Promise<void>
  reset: () => void
} {
  const syncWithInitial = params.syncWithInitial !== false
  const [draft, setDraft] = useState<T>(params.initial || ({} as T))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const baselineRef = useRef<T>(params.initial || ({} as T))

  // When the server-loaded data arrives/changes and we're not dirty, sync
  useEffect(() => {
    if (!syncWithInitial) return
    if (!params.initial) return
    if (dirty) return
    setDraft(params.initial)
    baselineRef.current = params.initial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.initial])

  // Warn before unload if dirty
  useEffect(() => {
    if (!dirty) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const set = useCallback((patch: Partial<T>) => {
    setDraft(prev => {
      const next = { ...prev, ...patch }
      // Only set dirty if something actually changed vs baseline
      const stillMatches = Object.keys(next).every(k => shallowEqual((next as any)[k], (baselineRef.current as any)[k]))
      setDirty(!stillMatches)
      return next
    })
  }, [])

  const replace = useCallback((next: T) => {
    setDraft(next)
    setDirty(!shallowEqualObjects(next, baselineRef.current))
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await params.onSave(draft)
      baselineRef.current = draft
      setDirty(false)
      setSavedAt(new Date())
    } catch (err: any) {
      setError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [draft, params])

  const reset = useCallback(() => {
    setDraft(baselineRef.current)
    setDirty(false)
    setError(null)
  }, [])

  return { draft, set, replace, dirty, saving, savedAt, error, save, reset }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => shallowEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return shallowEqualObjects(a, b)
  }
  return false
}

function shallowEqualObjects(a: Record<string, any>, b: Record<string, any>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(k => shallowEqual(a[k], b[k]))
}
