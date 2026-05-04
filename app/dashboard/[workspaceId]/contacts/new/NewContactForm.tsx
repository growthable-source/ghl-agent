'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface CustomField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  placeholder: string | null
}

export default function NewContactForm({
  workspaceId,
  customFields,
  lists,
}: {
  workspaceId: string
  customFields: CustomField[]
  lists: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [tags, setTags] = useState('')
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [listIds, setListIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() && !phone.trim()) {
      setErr('Email or phone is required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const tagList = tags.split(/[,;]/).map(t => t.trim()).filter(Boolean)
      const cf: Record<string, string> = {}
      for (const [k, v] of Object.entries(customValues)) if (v) cf[k] = v

      const res = await fetch(`/api/workspaces/${workspaceId}/native/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          tags: tagList,
          customFields: Object.keys(cf).length ? cf : undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to create contact')
      }
      const j = await res.json()
      const contactId = j.contact.id

      // Add to selected lists. We do this client-side rather than as a
      // transactional contact-create-with-lists API because the "+ to list"
      // UX is per-list anyway and a partial-failure (one list works, one
      // doesn't) just leaves the contact in the lists that succeeded —
      // operator can fix the rest manually.
      if (listIds.size > 0) {
        await Promise.all(
          Array.from(listIds).map(lid =>
            fetch(`/api/workspaces/${workspaceId}/native/lists/${lid}/members`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contactIds: [contactId] }),
            })
          )
        )
      }

      router.push(`/dashboard/${workspaceId}/contacts/${contactId}`)
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="p-6 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">New contact</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              At least an email or phone is required so the agent has somewhere to reach them.
            </p>
          </div>
          <Link href={`/dashboard/${workspaceId}/contacts`} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            ← Back to contacts
          </Link>
        </div>

        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" value={firstName} onChange={setFirstName} />
            <Field label="Last name" value={lastName} onChange={setLastName} />
            <Field label="Email" value={email} onChange={setEmail} type="email" />
            <Field label="Phone" value={phone} onChange={setPhone} placeholder="+15551234567" />
          </div>
          <Field
            label="Tags"
            value={tags}
            onChange={setTags}
            placeholder="comma-separated, e.g. vip, newsletter"
          />

          {customFields.length > 0 && (
            <div className="pt-2 space-y-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Custom fields</p>
              {customFields.map(cf => (
                <Field
                  key={cf.id}
                  label={cf.name}
                  value={customValues[cf.fieldKey] ?? ''}
                  onChange={v => setCustomValues({ ...customValues, [cf.fieldKey]: v })}
                  placeholder={cf.placeholder ?? ''}
                  type={cf.dataType === 'number' ? 'number' : cf.dataType === 'date' ? 'date' : cf.dataType === 'email' ? 'email' : cf.dataType === 'url' ? 'url' : 'text'}
                />
              ))}
            </div>
          )}

          {lists.length > 0 && (
            <div className="pt-2 space-y-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Add to lists</p>
              <div className="flex flex-wrap gap-2">
                {lists.map(l => {
                  const on = listIds.has(l.id)
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        const next = new Set(listIds)
                        if (on) next.delete(l.id); else next.add(l.id)
                        setListIds(next)
                      }}
                      className="text-xs px-3 h-7 rounded-full border transition-colors"
                      style={
                        on
                          ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderColor: 'transparent' }
                          : { borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }
                      }
                    >
                      {l.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {err && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{err}</p>}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="text-xs font-semibold px-4 h-9 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Creating…' : 'Create contact'}
            </button>
            <Link
              href={`/dashboard/${workspaceId}/contacts`}
              className="text-xs px-3 h-9 inline-flex items-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </form>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        className="w-full mt-1 px-3 h-9 rounded-md border text-sm"
        style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
      />
    </label>
  )
}
