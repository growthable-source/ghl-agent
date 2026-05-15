'use client'

/**
 * Operator-editable visitor identity panel.
 *
 * Shows name / email / phone with an Edit affordance. Saving PATCHes
 * /widget-conversations/:id/visitor which updates the WidgetVisitor
 * row and — for native-CRM workspaces — upserts a NativeContact and
 * links it back via crmContactId.
 *
 * Why edit at all: visitors often start a chat anonymous, then give
 * their name/email mid-conversation in plain text. Operators capturing
 * those details into a clean record is more reliable than asking the
 * AI to extract them, and it puts the contact straight into the CRM
 * so follow-up via list / SMS / email "just works."
 */

import { useEffect, useState } from 'react'

interface VisitorShape {
  id: string
  name: string | null
  email: string | null
  phone?: string | null
  crmContactId?: string | null
}

interface Props {
  workspaceId: string
  conversationId: string
  visitor: VisitorShape
  /** Called after a successful save so the parent can re-fetch the
   *  conversation payload (we may have created a CRM link). */
  onSaved?: () => void
}

export default function UserInfoSection({ workspaceId, conversationId, visitor, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(visitor.name ?? '')
  const [email, setEmail] = useState(visitor.email ?? '')
  const [phone, setPhone] = useState(visitor.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Re-seed when the operator switches conversation while editing.
  useEffect(() => {
    setEditing(false)
    setName(visitor.name ?? '')
    setEmail(visitor.email ?? '')
    setPhone(visitor.phone ?? '')
    setError(null)
    setToast(null)
  }, [visitor.id, visitor.name, visitor.email, visitor.phone])

  const isEmpty = !visitor.name && !visitor.email && !visitor.phone
  const isLinkedToCrm = !!visitor.crmContactId

  async function save() {
    setSaving(true)
    setError(null)
    setToast(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/visitor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed.'); return }
      setEditing(false)
      if (data.nativeContact?.created) {
        setToast('Saved · created a new contact in your CRM')
      } else if (data.nativeContact) {
        setToast('Saved · updated the linked CRM contact')
      } else if (data.nativeCrmEnabled) {
        setToast('Saved · add an email or phone to create a CRM contact')
      } else {
        setToast('Saved.')
      }
      onSaved?.()
      setTimeout(() => setToast(null), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally { setSaving(false) }
  }

  function cancel() {
    setEditing(false)
    setName(visitor.name ?? '')
    setEmail(visitor.email ?? '')
    setPhone(visitor.phone ?? '')
    setError(null)
  }

  return (
    <div className="p-5 border-b border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">User info</p>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] font-semibold text-orange-400 hover:text-orange-300"
          >
            {isEmpty ? '+ Add' : 'Edit'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Doe"
              autoFocus
              className="w-full rounded px-2 py-1.5 text-xs"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded px-2 py-1.5 text-xs"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className="w-full rounded px-2 py-1.5 text-xs"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            />
          </Field>
          {error && <p className="text-[11px]" style={{ color: 'var(--accent-red)' }}>{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancel}
              disabled={saving}
              className="text-xs px-2 py-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : isEmpty ? (
        <button
          onClick={() => setEditing(true)}
          className="w-full text-left p-3 rounded-lg border border-dashed transition-colors hover:bg-zinc-900/40"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No contact info yet. Click to add — adding an email or phone creates a record in your CRM automatically.
          </p>
        </button>
      ) : (
        <div className="space-y-1.5 text-xs">
          <ReadOnlyRow label="Name"  value={visitor.name} />
          <ReadOnlyRow label="Email" value={visitor.email} mono />
          <ReadOnlyRow label="Phone" value={visitor.phone ?? null} mono />
          {isLinkedToCrm && (
            <p className="text-[10px] mt-2 inline-flex items-center gap-1" style={{ color: 'var(--accent-emerald)' }}>
              ✓ Linked to CRM contact
            </p>
          )}
        </div>
      )}

      {toast && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--accent-emerald)' }}>{toast}</p>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
      {children}
    </div>
  )
}

function ReadOnlyRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return (
    <div className="flex items-baseline gap-2">
      <span className="text-zinc-500 shrink-0 w-12">{label}</span>
      <span className="text-zinc-600 italic">—</span>
    </div>
  )
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-zinc-500 shrink-0 w-12">{label}</span>
      <span className={`text-zinc-200 truncate ${mono ? 'font-mono text-[11px]' : ''}`} title={value}>{value}</span>
    </div>
  )
}
