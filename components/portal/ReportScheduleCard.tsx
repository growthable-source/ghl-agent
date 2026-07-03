'use client'

/**
 * Portal-side control for scheduled email reports: cadence, the
 * per-user recipient list (everyone on by default — excluding someone
 * is the explicit act), and a Send-now button so an admin can push the
 * report immediately instead of waiting for the schedule. Admins reach
 * this via the admin-preview session; the cadence is also editable from
 * the super-admin portal page.
 */

import { useEffect, useState } from 'react'
import Toggle from '@/components/ui/Toggle'

interface RecipientRow {
  id: string
  email: string
  name: string | null
  isActive: boolean
  accepted: boolean
  receiveReports: boolean
}

export default function ReportScheduleCard() {
  const [frequency, setFrequency] = useState<string | null>(null)
  const [users, setUsers] = useState<RecipientRow[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/portal/report-settings')
      .then(r => r.json())
      .then(d => {
        setFrequency(d.reportFrequency ?? 'weekly')
        setUsers(Array.isArray(d.users) ? d.users : [])
      })
      .catch(() => setFrequency('weekly'))
  }, [])

  async function saveFrequency(next: string) {
    setFrequency(next)
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/portal/report-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportFrequency: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Save failed')
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch (e: any) {
      setMsg(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleRecipient(userId: string, next: boolean) {
    // Optimistic — revert on failure.
    setUsers(prev => prev.map(u => (u.id === userId ? { ...u, receiveReports: next } : u)))
    try {
      const res = await fetch('/api/portal/report-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, receiveReports: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Update failed')
    } catch (e: any) {
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, receiveReports: !next } : u)))
      setMsg(e?.message ?? 'Update failed')
      setTimeout(() => setMsg(null), 3000)
    }
  }

  async function sendNow() {
    const included = users.filter(u => u.receiveReports && u.accepted && u.isActive).length
    if (!window.confirm(`Send the report now to ${included} recipient${included === 1 ? '' : 's'}?`)) return
    setSending(true)
    setSendMsg(null)
    try {
      const res = await fetch('/api/portal/report-settings/send', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Send failed')
      setSendMsg({ ok: true, text: `Sent to ${body.sent} recipient${body.sent === 1 ? '' : 's'}.` })
    } catch (e: any) {
      setSendMsg({ ok: false, text: e?.message ?? 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  const includedCount = users.filter(u => u.receiveReports && u.accepted && u.isActive).length

  return (
    <div className="rounded-xl border border-zinc-800 p-5" style={{ background: 'var(--surface)' }}>
      <p className="text-sm font-medium text-zinc-100">Email reports</p>
      <p className="text-xs text-zinc-500 mt-1 mb-3 max-w-lg">
        Your support summary by email — conversations handled, estimated time saved,
        anything outstanding or urgent, the support leaderboard, and AI insights on
        what your customers keep asking about.
      </p>

      {frequency === null ? (
        <div className="h-8 w-40 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {(['off', 'daily', 'weekly'] as const).map(f => (
              <button
                key={f}
                type="button"
                disabled={saving}
                onClick={() => saveFrequency(f)}
                className="text-sm px-3.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                style={
                  frequency === f
                    ? { borderColor: 'var(--portal-accent)', color: 'var(--portal-accent)', background: 'color-mix(in srgb, var(--portal-accent) 10%, transparent)' }
                    : { borderColor: 'var(--border)', color: 'var(--text-tertiary)' }
                }
              >
                {f === 'off' ? 'Off' : f === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
            {msg && <span className="text-xs text-zinc-500">{msg}</span>}
          </div>

          {/* Recipients */}
          <div className="mt-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Recipients · {includedCount} of {users.length} included
              </p>
              <button
                type="button"
                onClick={sendNow}
                disabled={sending || includedCount === 0 || frequency === null}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--portal-accent)', color: '#fff' }}
              >
                {sending ? 'Sending…' : 'Send now'}
              </button>
            </div>
            {sendMsg && (
              <p className="text-xs mb-2" style={{ color: sendMsg.ok ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                {sendMsg.text}
              </p>
            )}
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <div
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
              >
                <span>User</span>
                <span>Status</span>
                <span className="text-right">Included</span>
              </div>
              {users.length === 0 && (
                <p className="px-3.5 py-4 text-xs text-zinc-500">No portal users yet — invite someone and they'll appear here.</p>
              )}
              {users.map((u, i) => (
                <div
                  key={u.id}
                  className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-3.5 py-2.5 ${i > 0 ? 'border-t' : ''}`}
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-200 truncate">{u.name ?? u.email}</p>
                    {u.name && <p className="text-[10px] text-zinc-500 truncate">{u.email}</p>}
                  </div>
                  <span className="text-[10px]" style={{ color: u.accepted ? 'var(--accent-emerald)' : 'var(--text-tertiary)' }}>
                    {u.accepted ? (u.isActive ? 'active' : 'deactivated') : 'invite pending'}
                  </span>
                  <span className="flex justify-end">
                    <Toggle
                      checked={u.receiveReports}
                      onChange={next => toggleRecipient(u.id, next)}
                      title={u.receiveReports ? 'Included — click to exclude from report emails' : 'Excluded — click to include in report emails'}
                    />
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600 mt-1.5">
              Reports only go to included users with an accepted invite. New users are included automatically.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
