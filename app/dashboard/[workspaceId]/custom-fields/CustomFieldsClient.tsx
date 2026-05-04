'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface CustomField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  placeholder: string | null
  position: number
}

const DATA_TYPES = [
  'text', 'number', 'date', 'select', 'multiselect', 'boolean', 'phone', 'email', 'url',
] as const

export default function CustomFieldsClient({
  workspaceId,
  initial,
}: {
  workspaceId: string
  initial: CustomField[]
}) {
  const router = useRouter()
  const [fields, setFields] = useState(initial)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [dataType, setDataType] = useState<typeof DATA_TYPES[number]>('text')
  const [placeholder, setPlaceholder] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Auto-derive snake_case field key from the human label as the user
  // types — they can still override it manually.
  const onNameChange = (v: string) => {
    setName(v)
    if (!fieldKey || fieldKey === toFieldKey(name)) {
      setFieldKey(toFieldKey(v))
    }
  }

  const create = async () => {
    if (!name.trim() || !fieldKey.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/native/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fieldKey, dataType, placeholder: placeholder || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed')
      }
      const j = await res.json()
      setFields([...fields, j.field])
      setName('')
      setFieldKey('')
      setDataType('text')
      setPlaceholder('')
      setCreating(false)
      router.refresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this field? Existing values stay in the DB but become unreachable via merge tags.')) return
    await fetch(`/api/workspaces/${workspaceId}/native/custom-fields/${id}`, { method: 'DELETE' })
    setFields(fields.filter(f => f.id !== id))
    router.refresh()
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Custom fields</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Define fields you can reference as <code style={{ color: 'var(--text-primary)' }}>{'{{contact.<key>}}'}</code> in agent prompts.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="text-xs font-semibold px-3 h-9 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              + New field
            </button>
          )}
        </div>

        {creating && (
          <div className="rounded-xl border p-4 mb-6 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Label</label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => onNameChange(e.target.value)}
                  placeholder="Vehicle VIN"
                  className="w-full mt-1 px-3 h-9 rounded-md border text-sm"
                  style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Field key</label>
                <input
                  value={fieldKey}
                  onChange={e => setFieldKey(toFieldKey(e.target.value))}
                  placeholder="vehicle_vin"
                  className="w-full mt-1 px-3 h-9 rounded-md border text-sm font-mono"
                  style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Type</label>
                <select
                  value={dataType}
                  onChange={e => setDataType(e.target.value as any)}
                  className="w-full mt-1 px-3 h-9 rounded-md border text-sm"
                  style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
                >
                  {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Placeholder</label>
                <input
                  value={placeholder}
                  onChange={e => setPlaceholder(e.target.value)}
                  placeholder="optional helper text"
                  className="w-full mt-1 px-3 h-9 rounded-md border text-sm"
                  style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
                />
              </div>
            </div>
            {err && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{err}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={create}
                disabled={busy || !name.trim() || !fieldKey.trim()}
                className="text-xs font-semibold px-3 h-8 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                {busy ? 'Creating…' : 'Create field'}
              </button>
              <button
                onClick={() => { setCreating(false); setName(''); setFieldKey(''); setErr(null) }}
                className="text-xs px-3 h-8"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {fields.length === 0 && !creating ? (
          <div
            className="text-center py-12 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No custom fields</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Add fields to extend your contact records beyond name + email + phone.</p>
          </div>
        ) : fields.length > 0 ? (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {fields.map((f, i) => (
              <div
                key={f.id}
                className="grid grid-cols-[2fr_2fr_1fr_80px] gap-3 items-center px-4 py-3"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{f.name}</p>
                  {f.placeholder && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.placeholder}</p>
                  )}
                </div>
                <code className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{'{{contact.' + f.fieldKey + '}}'}</code>
                <span className="text-xs uppercase" style={{ color: 'var(--text-tertiary)' }}>{f.dataType}</span>
                <button
                  onClick={() => remove(f.id)}
                  className="text-xs text-right transition-opacity hover:opacity-80"
                  style={{ color: 'var(--accent-red)' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function toFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '_$&')
}
