'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Share a knowledge collection with another workspace.
 *
 * Two routes to the same outcome — the destination gets its OWN copy:
 *  - "Copy to a workspace" for workspaces you're already in;
 *  - "Share link" for anyone else, redeemed at /knowledge-share/<code>.
 *
 * Data sources aren't copied (they hold credentials), so the modal
 * says so up front rather than letting the destination discover it.
 */

interface TargetWorkspace {
  id: string
  name: string
  icon: string | null
  role: string
  canReceive?: boolean
}

interface ShareImport {
  id: string
  workspaceId: string
  workspaceName: string
  entryCount: number
  createdAt: string
}

interface ShareLink {
  id: string
  code: string
  note: string | null
  maxUses: number | null
  useCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  imports: ShareImport[]
}

type Mode = 'copy' | 'link'

export default function ShareCollectionModal({
  workspaceId,
  collectionId,
  collectionName,
  dataSourceCount,
  onClose,
}: {
  workspaceId: string
  collectionId: string
  collectionName: string
  dataSourceCount: number
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('copy')

  const base = `/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}`

  // ── Copy tab ──
  const [targets, setTargets] = useState<TargetWorkspace[] | null>(null)
  const [targetId, setTargetId] = useState('')
  const [copyName, setCopyName] = useState(collectionName)
  const [copying, setCopying] = useState(false)
  const [copyResult, setCopyResult] = useState<{ workspaceId: string; collectionId: string; entryCount: number } | null>(null)

  // ── Link tab ──
  const [links, setLinks] = useState<ShareLink[]>([])
  const [linksLoading, setLinksLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('')
  const [minting, setMinting] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)

  const loadTargets = useCallback(async () => {
    const res = await fetch(`${base}/copy`)
    const data = await res.json().catch(() => ({}))
    setTargets(data.workspaces || [])
  }, [base])

  const loadLinks = useCallback(async () => {
    setLinksLoading(true)
    const res = await fetch(`${base}/share`)
    const data = await res.json().catch(() => ({}))
    setLinks(data.shares || [])
    setNotMigrated(!!data.notMigrated)
    setLinksLoading(false)
  }, [base])

  useEffect(() => { loadTargets(); loadLinks() }, [loadTargets, loadLinks])

  async function doCopy() {
    setError(null)
    if (!targetId) { setError('Pick a workspace to copy into.'); return }
    setCopying(true)
    try {
      const res = await fetch(`${base}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWorkspaceId: targetId, name: copyName.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Copy failed'); return }
      setCopyResult({
        workspaceId: targetId,
        collectionId: data.copied.collectionId,
        entryCount: data.copied.entryCount,
      })
    } finally { setCopying(false) }
  }

  async function mintLink() {
    setError(null)
    setMinting(true)
    try {
      const res = await fetch(`${base}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: note.trim() || null,
          maxUses: maxUses || null,
          expiresInDays: expiresInDays || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not create a share link'); return }
      setLinks(l => [data.share, ...l])
      setNote(''); setMaxUses(''); setExpiresInDays('')
      copyToClipboard(shareUrl(data.share.code), data.share.code)
    } finally { setMinting(false) }
  }

  async function revoke(shareId: string) {
    if (!confirm('Revoke this link? Anyone holding it will no longer be able to import. Copies already taken are unaffected.')) return
    const res = await fetch(`${base}/share`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId }),
    })
    if (res.ok) loadLinks()
  }

  function shareUrl(code: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/knowledge-share/${code}`
  }

  function copyToClipboard(text: string, code: string) {
    navigator.clipboard?.writeText(text).then(
      () => { setCopiedCode(code); setTimeout(() => setCopiedCode(c => (c === code ? null : c)), 2000) },
      () => {},
    )
  }

  const receivable = (targets || []).filter(t => t.canReceive !== false)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              Share “{collectionName}”
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              The other workspace gets its own copy — later edits don’t sync back.
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)' }} aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 border-b" style={{ borderColor: 'var(--border)' }}>
          {([
            { id: 'copy', label: 'Copy to a workspace' },
            { id: 'link', label: 'Share link' },
          ] as Array<{ id: Mode; label: string }>).map(t => {
            const active = mode === t.id
            return (
              <button
                key={t.id}
                onClick={() => { setMode(t.id); setError(null) }}
                className="text-xs font-medium px-3 py-2.5 border-b-2 -mb-px transition-colors"
                style={{
                  borderColor: active ? 'var(--accent-primary)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {dataSourceCount > 0 && (
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>
              Written items copy across. The {dataSourceCount} connected data source
              {dataSourceCount === 1 ? '' : 's'} won’t — those hold credentials, so the
              other workspace connects its own.
            </p>
          )}

          {mode === 'copy' && (
            copyResult ? (
              <div className="text-center py-6">
                <div className="text-3xl mb-2">✅</div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Copied {copyResult.entryCount} item{copyResult.entryCount === 1 ? '' : 's'}
                </p>
                <a
                  href={`/dashboard/${copyResult.workspaceId}/knowledge/${copyResult.collectionId}`}
                  className="inline-block mt-3 px-4 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: 'var(--accent-primary)', color: '#fff' }}
                >
                  Open it in the other workspace
                </a>
                <button
                  onClick={() => { setCopyResult(null); setTargetId('') }}
                  className="block mx-auto mt-3 text-[11px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Copy somewhere else
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
                    Destination workspace
                  </label>
                  {targets === null ? (
                    <div className="h-9 rounded-lg animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
                  ) : receivable.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      You’re not a member of another workspace you can write to. Use a
                      share link instead — the other side imports it themselves.
                    </p>
                  ) : (
                    <select
                      value={targetId}
                      onChange={e => setTargetId(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">— Choose a workspace —</option>
                      {receivable.map(w => (
                        <option key={w.id} value={w.id}>{w.icon ? `${w.icon} ` : ''}{w.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {receivable.length > 0 && (
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
                      Name in the destination
                    </label>
                    <input
                      value={copyName}
                      onChange={e => setCopyName(e.target.value)}
                      maxLength={80}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}
              </>
            )
          )}

          {mode === 'link' && (
            <>
              {notMigrated && (
                <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--accent-amber)' }}>Migration pending</p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Run <code>prisma/sql/2026-07-22-knowledge-collection-sharing.sql</code> to enable share links.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
                    Label (optional)
                  </label>
                  <input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="e.g. For Acme Dental onboarding"
                    maxLength={200}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Max uses</label>
                  <input
                    value={maxUses}
                    onChange={e => setMaxUses(e.target.value.replace(/\D/g, ''))}
                    placeholder="Unlimited"
                    inputMode="numeric"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Expires in (days)</label>
                  <input
                    value={expiresInDays}
                    onChange={e => setExpiresInDays(e.target.value.replace(/\D/g, ''))}
                    placeholder="Never"
                    inputMode="numeric"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <button
                onClick={mintLink}
                disabled={minting || notMigrated}
                className="w-full px-4 py-2 rounded-lg text-sm font-semibold"
                style={(minting || notMigrated)
                  ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }
                  : { background: 'var(--accent-primary)', color: '#fff' }}
              >
                {minting ? 'Creating…' : 'Create share link'}
              </button>

              <div className="pt-1">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Existing links</p>
                {linksLoading ? (
                  <div className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
                ) : links.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No links yet.</p>
                ) : (
                  <div className="space-y-2">
                    {links.map(l => {
                      const dead = !!l.revokedAt
                        || (!!l.expiresAt && new Date(l.expiresAt).getTime() <= Date.now())
                        || (l.maxUses !== null && l.useCount >= l.maxUses)
                      return (
                        <div
                          key={l.id}
                          className="p-3 rounded-lg border"
                          style={{ borderColor: 'var(--border)', opacity: dead ? 0.55 : 1 }}
                        >
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                              {l.code}
                            </code>
                            {!dead && (
                              <button
                                onClick={() => copyToClipboard(shareUrl(l.code), l.code)}
                                className="text-[11px] px-2 py-1 rounded"
                                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                              >
                                {copiedCode === l.code ? 'Copied!' : 'Copy link'}
                              </button>
                            )}
                            {!l.revokedAt && (
                              <button
                                onClick={() => revoke(l.id)}
                                className="text-[11px] px-2 py-1 rounded"
                                style={{ border: '1px solid var(--border)', color: 'var(--accent-red)' }}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                          {l.note && <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>{l.note}</p>}
                          <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            {l.revokedAt ? 'Revoked' : `Used ${l.useCount}${l.maxUses !== null ? ` of ${l.maxUses}` : ''}`}
                            {l.expiresAt && <> · expires {new Date(l.expiresAt).toLocaleDateString()}</>}
                          </p>
                          {l.imports.length > 0 && (
                            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                              Imported by {l.imports.map(i => i.workspaceName).join(', ')}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {mode === 'copy' && !copyResult && (
          <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
            <button
              onClick={doCopy}
              disabled={copying || !targetId}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={(copying || !targetId)
                ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }
                : { background: 'var(--accent-primary)', color: '#fff' }}
            >
              {copying ? 'Copying…' : 'Copy collection'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
