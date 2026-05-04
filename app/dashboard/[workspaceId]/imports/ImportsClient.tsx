'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { parseCsv } from '@/lib/csv-parse'

interface ImportRow {
  id: string
  filename: string
  status: string
  totalRows: number
  importedCount: number
  skippedCount: number
  errorCount: number
  listName: string | null
  createdAt: string
}

const STANDARD_FIELDS = [
  { value: 'skip', label: 'Skip' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'tags', label: 'Tags (comma- or semicolon-sep)' },
  { value: 'source', label: 'Source' },
] as const

export default function ImportsClient({
  workspaceId,
  initialImports,
  lists,
}: {
  workspaceId: string
  initialImports: ImportRow[]
  lists: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [imports, setImports] = useState(initialImports)
  const [filename, setFilename] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [allRows, setAllRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [listId, setListId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number; importId: string } | null>(null)

  const onFile = async (file: File) => {
    setErr(null)
    setResult(null)
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length < 2) {
      setErr('CSV needs at least a header row and one data row.')
      return
    }
    const [hdr, ...rest] = parsed
    setFilename(file.name)
    setHeaders(hdr)
    setAllRows(rest)
    setPreviewRows(rest.slice(0, 5))
    // Best-effort auto-mapping: case-insensitive header → standard field.
    const auto: Record<string, string> = {}
    for (const h of hdr) {
      const norm = h.toLowerCase().replace(/[^a-z]/g, '')
      if (norm.includes('first')) auto[h] = 'firstName'
      else if (norm.includes('last')) auto[h] = 'lastName'
      else if (norm.includes('email')) auto[h] = 'email'
      else if (norm.includes('phone') || norm.includes('mobile')) auto[h] = 'phone'
      else if (norm.includes('tag')) auto[h] = 'tags'
      else auto[h] = 'skip'
    }
    setMapping(auto)
  }

  const start = async () => {
    if (!filename || allRows.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      const rows = allRows.map((cells, idx) => ({
        rowNumber: idx + 2, // +1 for header, +1 for 1-based
        data: Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])),
      }))
      const res = await fetch(`/api/workspaces/${workspaceId}/native/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          rows,
          columnMapping: mapping,
          listId: listId || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Import failed')
      }
      const j = await res.json()
      setResult({
        imported: j.summary.importedCount,
        skipped: j.summary.skippedCount,
        errors: j.summary.errorCount,
        importId: j.summary.importId,
      })
      // Optimistic prepend so the user sees the new job immediately
      setImports([
        {
          id: j.summary.importId,
          filename,
          status: 'completed',
          totalRows: rows.length,
          importedCount: j.summary.importedCount,
          skippedCount: j.summary.skippedCount,
          errorCount: j.summary.errorCount,
          listName: lists.find(l => l.id === listId)?.name ?? null,
          createdAt: new Date().toISOString(),
        },
        ...imports,
      ])
      router.refresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setFilename(null)
    setHeaders([])
    setPreviewRows([])
    setAllRows([])
    setMapping({})
    setListId('')
    setResult(null)
    setErr(null)
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Upload a CSV. We dedupe by email + phone, apply suppression, and track per-row errors.
            </p>
          </div>
        </div>

        {/* Upload */}
        {!filename && (
          <label
            className="block rounded-xl border border-dashed p-10 text-center cursor-pointer transition-opacity hover:opacity-90"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
            />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Drop a CSV here, or click to browse</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>First row should contain headers.</p>
          </label>
        )}

        {/* Mapping + preview */}
        {filename && !result && (
          <div className="rounded-xl border p-4 mb-6 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{filename}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{allRows.length} rows · {headers.length} columns</p>
              </div>
              <button onClick={reset} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Choose different file</button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Map columns</p>
              <div className="grid grid-cols-2 gap-2">
                {headers.map(h => (
                  <div key={h} className="flex items-center gap-2">
                    <span className="text-xs flex-1 truncate font-mono" style={{ color: 'var(--text-secondary)' }}>{h}</span>
                    <select
                      value={mapping[h] ?? 'skip'}
                      onChange={e => setMapping({ ...mapping, [h]: e.target.value })}
                      className="text-xs rounded border h-8 px-2"
                      style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
                    >
                      {STANDARD_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {previewRows.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Preview (first 5)</p>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr>{headers.map(h => <th key={h} className="px-2 py-1 text-left font-mono" style={{ color: 'var(--text-tertiary)' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-1 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }}>{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Add to list (optional)</p>
              <select
                value={listId}
                onChange={e => setListId(e.target.value)}
                className="w-full text-sm rounded border h-9 px-2"
                style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
              >
                <option value="">— none —</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            {err && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{err}</p>}
            <button
              onClick={start}
              disabled={busy}
              className="text-xs font-semibold px-4 h-9 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Importing…' : `Start import (${allRows.length} rows)`}
            </button>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className="rounded-xl border p-4 mb-6"
            style={{ borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--accent-emerald)' }}>Import finished</p>
            <p className="text-xs mt-1" style={{ color: 'var(--accent-emerald)', opacity: 0.85 }}>
              {result.imported} imported · {result.skipped} skipped · {result.errors} errors
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={reset}
                className="text-xs font-semibold px-3 h-8 rounded-md"
                style={{ background: 'var(--accent-emerald)', color: 'var(--btn-primary-text)' }}
              >
                Import another
              </button>
              {result.errors > 0 && (
                <Link
                  href={`/dashboard/${workspaceId}/imports/${result.importId}`}
                  className="text-xs font-semibold px-3 h-8 inline-flex items-center rounded-md border"
                  style={{ borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)' }}
                >
                  Review errors
                </Link>
              )}
            </div>
          </div>
        )}

        {/* History */}
        {imports.length > 0 && (
          <>
            <h2 className="text-sm font-semibold mt-6 mb-3" style={{ color: 'var(--text-secondary)' }}>Recent imports</h2>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {imports.map((imp, i) => (
                <Link
                  key={imp.id}
                  href={`/dashboard/${workspaceId}/imports/${imp.id}`}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 transition-opacity hover:opacity-95"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
                >
                  <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{imp.filename}</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{imp.totalRows} rows</span>
                  <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>{imp.importedCount} imported</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{imp.skippedCount} skipped</span>
                  <span className="text-xs" style={{ color: imp.errorCount > 0 ? 'var(--accent-red)' : 'var(--text-tertiary)' }}>{imp.errorCount} errors</span>
                  <span className="text-xs text-right" style={{ color: 'var(--text-tertiary)' }}>{new Date(imp.createdAt).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
