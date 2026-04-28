'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PlanLimitNotice, { isPlanLimitError, type PlanLimitData } from '@/components/PlanLimitNotice'

interface Widget {
  id: string
  name: string
  publicKey: string
  type?: 'chat' | 'click_to_call'
  primaryColor: string
  isActive: boolean
  voiceEnabled: boolean
  allowedDomains: string[]
  folderId: string | null
  _count: { conversations: number; visitors: number }
  activeConversationsCount: number
  createdAt: string
}

interface Folder {
  id: string
  name: string
  color: string | null
  order: number
}

const ALL = '__all__'
const UNFILED = '__unfiled__'

export default function WidgetsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [widgets, setWidgets] = useState<Widget[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [notMigrated, setNotMigrated] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [planLimit, setPlanLimit] = useState<PlanLimitData | null>(null)

  // Folder + selection state
  const [activeFolder, setActiveFolder] = useState<string>(ALL)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderDialogName, setFolderDialogName] = useState('')

  // Confirm-delete state
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: 'single'; id: string; name: string; activeCount: number }
    | { kind: 'bulk'; ids: string[]; blocked: Array<{ id: string; name: string; activeCount: number }> }
    | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widgets`)
    const data = await res.json()
    setWidgets(data.widgets || [])
    setFolders(data.folders || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchAll() }, [fetchAll])
  // Refresh every 15s so the live-conversation counts stay current.
  useEffect(() => {
    const i = setInterval(fetchAll, 15000)
    return () => clearInterval(i)
  }, [fetchAll])

  const filtered = useMemo(() => {
    if (activeFolder === ALL) return widgets
    if (activeFolder === UNFILED) return widgets.filter(w => !w.folderId)
    return widgets.filter(w => w.folderId === activeFolder)
  }, [widgets, activeFolder])

  const totalLive = widgets.reduce((s, w) => s + (w.activeConversationsCount || 0), 0)

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
    setSelectMode(false)
  }

  async function moveSelectedToFolder(folderId: string | null) {
    if (selected.size === 0) return
    await Promise.all(Array.from(selected).map(id =>
      fetch(`/api/workspaces/${workspaceId}/widgets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
    ))
    clearSelection()
    await fetchAll()
  }

  async function createFolder() {
    const name = folderDialogName.trim()
    if (!name) return
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, order: folders.length }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.folder) {
        setFolders(f => [...f, data.folder])
        setActiveFolder(data.folder.id)
      }
    }
    setFolderDialogName('')
    setFolderDialogOpen(false)
  }

  async function deleteFolder(id: string) {
    if (!confirm('Delete this folder? Widgets inside will move back to "All widgets" — they won\'t be deleted.')) return
    await fetch(`/api/workspaces/${workspaceId}/widget-folders/${id}`, { method: 'DELETE' })
    if (activeFolder === id) setActiveFolder(ALL)
    await fetchAll()
  }

  function openSingleConfirm(w: Widget) {
    setDeleteError(null)
    setConfirmTarget({ kind: 'single', id: w.id, name: w.name, activeCount: w.activeConversationsCount })
  }

  function openBulkConfirm() {
    if (selected.size === 0) return
    const blocked = widgets
      .filter(w => selected.has(w.id) && w.activeConversationsCount > 0)
      .map(w => ({ id: w.id, name: w.name, activeCount: w.activeConversationsCount }))
    setDeleteError(null)
    setConfirmTarget({ kind: 'bulk', ids: Array.from(selected), blocked })
  }

  async function executeDelete(force = false) {
    if (!confirmTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      if (confirmTarget.kind === 'single') {
        const url = `/api/workspaces/${workspaceId}/widgets/${confirmTarget.id}${force ? '?force=1' : ''}`
        const res = await fetch(url, { method: 'DELETE' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setDeleteError(data.error || 'Delete failed')
          return
        }
        setWidgets(prev => prev.filter(w => w.id !== confirmTarget.id))
        setConfirmTarget(null)
      } else {
        // Bulk — server refuses if any have active convos. Surface the
        // blocked list so the operator can either deselect them or
        // resolve those conversations first.
        const ids = confirmTarget.ids.join(',')
        const res = await fetch(`/api/workspaces/${workspaceId}/widgets?ids=${encodeURIComponent(ids)}`, {
          method: 'DELETE',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setDeleteError(data.error || 'Bulk delete failed')
          if (Array.isArray(data.blocked)) {
            setConfirmTarget(t => t && t.kind === 'bulk' ? { ...t, blocked: data.blocked } : t)
          }
          return
        }
        setWidgets(prev => prev.filter(w => !confirmTarget.ids.includes(w.id)))
        clearSelection()
        setConfirmTarget(null)
      }
    } catch (err: any) {
      setDeleteError(err?.message || 'Network error')
    } finally { setDeleting(false) }
  }

  async function createWidget(type: 'chat' | 'click_to_call') {
    setCreating(true)
    setCreateError(null)
    setPlanLimit(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: type === 'click_to_call' ? 'Click to call' : 'New chat widget',
          type,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.widget) {
        if (isPlanLimitError(data)) setPlanLimit(data)
        else setCreateError(data.error || `Could not create widget (HTTP ${res.status})`)
        return
      }
      setPickerOpen(false)
      router.push(`/dashboard/${workspaceId}/widgets/${data.widget.id}`)
    } catch (err: any) {
      setCreateError(err?.message || 'Network error — please try again')
    } finally { setCreating(false) }
  }

  if (loading) return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="h-44 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />)}
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Widgets
              {totalLive > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {totalLive} active conversation{totalLive === 1 ? '' : 's'}
                </span>
              )}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              Embeddable chat widgets and click-to-call buttons. Drop them anywhere — landing pages, blog posts, email signatures.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectMode && (
              <button
                onClick={clearSelection}
                className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 transition-colors"
              >Cancel</button>
            )}
            {!selectMode ? (
              <button
                onClick={() => setSelectMode(true)}
                disabled={widgets.length === 0}
                className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-300 border border-zinc-700 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-30"
              >Select</button>
            ) : (
              <>
                <span className="text-xs text-zinc-400 mr-1">{selected.size} selected</span>
                <BulkActionsMenu
                  folders={folders}
                  disabled={selected.size === 0}
                  onMove={moveSelectedToFolder}
                />
                <button
                  onClick={openBulkConfirm}
                  disabled={selected.size === 0}
                  className="text-xs font-semibold px-3 py-2 rounded-lg text-red-300 border border-red-500/40 bg-red-500/5 hover:text-red-200 hover:border-red-500/60 transition-colors disabled:opacity-30"
                >Delete</button>
              </>
            )}
            <button
              onClick={() => setPickerOpen(true)}
              disabled={creating}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ background: '#fa4d2e' }}
            >{creating ? 'Creating…' : '+ New widget'}</button>
          </div>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_widget_migration.sql to enable widgets.</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          {/* Folder sidebar */}
          <aside className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2 px-2">Folders</p>
            <FolderRow
              label="All widgets"
              count={widgets.length}
              active={activeFolder === ALL}
              onClick={() => setActiveFolder(ALL)}
            />
            <FolderRow
              label="Unfiled"
              count={widgets.filter(w => !w.folderId).length}
              active={activeFolder === UNFILED}
              onClick={() => setActiveFolder(UNFILED)}
              muted
            />
            {folders.map(f => (
              <FolderRow
                key={f.id}
                label={f.name}
                color={f.color}
                count={widgets.filter(w => w.folderId === f.id).length}
                active={activeFolder === f.id}
                onClick={() => setActiveFolder(f.id)}
                onDelete={() => deleteFolder(f.id)}
              />
            ))}
            <button
              onClick={() => setFolderDialogOpen(true)}
              className="w-full text-left px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
            >+ New folder</button>
          </aside>

          {/* Widget grid */}
          <div>
            {filtered.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">💬</div>
                <p className="text-sm font-medium text-white mb-1">
                  {widgets.length === 0 ? 'No widgets yet' : 'Nothing in this folder'}
                </p>
                <p className="text-xs text-zinc-500 mb-4 max-w-sm mx-auto">
                  {widgets.length === 0
                    ? 'Spin up a chat widget or a click-to-call button. Both get a free hosted page you can share as a link.'
                    : 'Move some widgets in or pick a different folder.'}
                </p>
                {widgets.length === 0 && (
                  <button onClick={() => setPickerOpen(true)} disabled={creating}
                    className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#fa4d2e' }}>
                    {creating ? 'Creating…' : 'Create first widget'}
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(w => {
                  const isCall = w.type === 'click_to_call'
                  const isLive = w.activeConversationsCount > 0
                  const isSelected = selected.has(w.id)
                  return (
                    <WidgetCard
                      key={w.id}
                      widget={w}
                      isCall={isCall}
                      isLive={isLive}
                      isSelected={isSelected}
                      selectMode={selectMode}
                      workspaceId={workspaceId}
                      onToggleSelect={() => toggleSelect(w.id)}
                      onDelete={() => openSingleConfirm(w)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-bold text-white">Create a widget</h2>
              <button onClick={() => setPickerOpen(false)} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-zinc-500 mb-5">Pick what you&apos;re embedding.</p>
            {planLimit && <div className="mb-4"><PlanLimitNotice workspaceId={workspaceId} data={planLimit} /></div>}
            {createError && !planLimit && (
              <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">{createError}</div>
            )}
            <div className="space-y-2">
              <button
                onClick={() => createWidget('chat')}
                disabled={creating}
                className="w-full text-left p-4 rounded-xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors disabled:opacity-50"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">💬</span>
                  <div>
                    <p className="text-sm font-semibold text-white">Chat widget</p>
                    <p className="text-[11px] text-zinc-500">Floating chat bubble with optional voice escalation.</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => createWidget('click_to_call')}
                disabled={creating}
                className="w-full text-left p-4 rounded-xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors disabled:opacity-50"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📞</span>
                  <div>
                    <p className="text-sm font-semibold text-white">Click-to-call button</p>
                    <p className="text-[11px] text-zinc-500">A styled button that opens a voice call instantly. Floating or inline.</p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {folderDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialogOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-white mb-3">New folder</p>
            <input
              autoFocus
              type="text"
              value={folderDialogName}
              onChange={e => setFolderDialogName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createFolder() } }}
              placeholder="Folder name"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white mb-3"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialogOpen(false)} className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button
                onClick={createFolder}
                disabled={!folderDialogName.trim()}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                style={{ background: '#fa4d2e' }}
              >Create</button>
            </div>
          </div>
        </div>
      )}

      {confirmTarget && (
        <DeleteConfirmModal
          target={confirmTarget}
          deleting={deleting}
          error={deleteError}
          onCancel={() => { setConfirmTarget(null); setDeleteError(null) }}
          onConfirm={executeDelete}
        />
      )}
    </div>
  )
}

function FolderRow({
  label, count, active, onClick, onDelete, muted, color,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  onDelete?: () => void
  muted?: boolean
  color?: string | null
}) {
  return (
    <div className={`group flex items-center rounded-lg overflow-hidden ${active ? 'bg-zinc-900' : ''}`}>
      <button
        onClick={onClick}
        className={`flex-1 text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
          active ? 'text-white' : muted ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-300 hover:text-white'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color || (active ? '#fa4d2e' : '#52525b') }} />
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[10px] text-zinc-600">{count}</span>
      </button>
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 px-2 text-zinc-600 hover:text-red-400 text-xs"
          title="Delete folder"
        >×</button>
      )}
    </div>
  )
}

function BulkActionsMenu({
  folders, disabled, onMove,
}: {
  folders: Folder[]
  disabled: boolean
  onMove: (folderId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-300 border border-zinc-700 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-30"
      >Move to…</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-52 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl z-40 overflow-hidden">
            <button
              onClick={() => { setOpen(false); onMove(null) }}
              className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors"
            >No folder</button>
            {folders.length > 0 && <div className="border-t border-zinc-800" />}
            {folders.map(f => (
              <button
                key={f.id}
                onClick={() => { setOpen(false); onMove(f.id) }}
                className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors"
              >{f.name}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function WidgetCard({
  widget: w, isCall, isLive, isSelected, selectMode, workspaceId, onToggleSelect, onDelete,
}: {
  widget: Widget
  isCall: boolean
  isLive: boolean
  isSelected: boolean
  selectMode: boolean
  workspaceId: string
  onToggleSelect: () => void
  onDelete: () => void
}) {
  const cardCls = `relative p-5 rounded-xl border bg-zinc-900/40 transition-colors ${
    isSelected ? 'border-orange-500/60 bg-orange-500/5'
    : 'border-zinc-800 hover:border-zinc-700'
  }`
  const inner = (
    <>
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl" style={{ background: w.isActive ? w.primaryColor : '#3f3f46' }} />
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
          style={{ background: w.primaryColor }}>
          {isCall ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isLive && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {w.activeConversationsCount} live
            </span>
          )}
          <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800 uppercase tracking-wide">
            {isCall ? 'call' : 'chat'}
          </span>
          {!w.isActive && (
            <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800">paused</span>
          )}
        </div>
      </div>
      <p className="text-sm font-semibold text-white mb-1 truncate">{w.name}</p>
      <p className="text-[11px] text-zinc-500 truncate">
        {w.allowedDomains.length > 0 ? w.allowedDomains.join(', ') : 'any domain'}
      </p>
      <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-zinc-800">
        <div>
          <p className="text-lg font-bold text-white">{w._count.visitors}</p>
          <p className="text-[10px] text-zinc-500">Visitors</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">{w._count.conversations}</p>
          <p className="text-[10px] text-zinc-500">{isCall ? 'Calls' : 'Conversations'}</p>
        </div>
      </div>
      {w.voiceEnabled && !isCall && (
        <span className="absolute bottom-3 right-3 text-[10px] font-medium text-purple-400 px-1.5 py-0.5 rounded bg-purple-500/10">
          🎙 voice
        </span>
      )}
    </>
  )

  if (selectMode) {
    return (
      <button onClick={onToggleSelect} className={`${cardCls} text-left`}>
        <div className="absolute top-3 right-3 z-10">
          <span className={`flex items-center justify-center w-5 h-5 rounded border-2 ${
            isSelected ? 'border-orange-500 bg-orange-500' : 'border-zinc-600 bg-zinc-950'
          }`}>
            {isSelected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
        </div>
        {inner}
      </button>
    )
  }

  return (
    <div className={`${cardCls} group`}>
      <Link href={`/dashboard/${workspaceId}/widgets/${w.id}`} className="block">
        {inner}
      </Link>
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete() }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 w-7 h-7 rounded flex items-center justify-center hover:bg-zinc-800 transition-colors"
        title="Delete widget"
        aria-label="Delete widget"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
        </svg>
      </button>
    </div>
  )
}

function DeleteConfirmModal({
  target, deleting, error, onCancel, onConfirm,
}: {
  target:
    | { kind: 'single'; id: string; name: string; activeCount: number }
    | { kind: 'bulk'; ids: string[]; blocked: Array<{ id: string; name: string; activeCount: number }> }
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (force?: boolean) => void
}) {
  const isSingle = target.kind === 'single'
  const hasActive = isSingle
    ? target.activeCount > 0
    : target.blocked.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-zinc-950 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-zinc-800">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🗑</span>
            <div className="flex-1">
              <p className="text-base font-bold text-white">
                {isSingle ? `Delete widget "${target.name}"?` : `Delete ${target.ids.length} widget${target.ids.length === 1 ? '' : 's'}?`}
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                This permanently removes the widget along with all its visitors, conversations, and stored uploads. The deletion cannot be undone.
              </p>
            </div>
          </div>
        </div>

        {hasActive && (
          <div className="p-5 border-b border-zinc-800 bg-amber-500/5">
            <p className="text-xs font-semibold text-amber-300 mb-1.5">⚠ Active conversation warning</p>
            {isSingle ? (
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                This widget has <strong>{target.activeCount}</strong> active conversation{target.activeCount === 1 ? '' : 's'} right now.
                Deleting kicks {target.activeCount === 1 ? 'that visitor' : 'those visitors'} mid-chat. Resolve or take over first if you can.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-amber-200/90 leading-relaxed mb-2">
                  {target.blocked.length} of the {target.ids.length} selected widget{target.ids.length === 1 ? ' has' : 's have'} active conversations:
                </p>
                <ul className="text-[11px] text-amber-200 space-y-0.5 ml-4 list-disc">
                  {target.blocked.map(b => (
                    <li key={b.id}><strong>{b.name}</strong> — {b.activeCount} active</li>
                  ))}
                </ul>
                <p className="text-[11px] text-amber-200/70 mt-2">
                  Bulk delete will refuse if any widget has active chats. Take those over from the inbox first, or remove them from your selection.
                </p>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="px-5 py-3 border-b border-zinc-800 bg-red-500/5 text-[11px] text-red-300">{error}</div>
        )}

        <div className="p-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
          >Cancel</button>
          {isSingle && hasActive ? (
            <button
              onClick={() => onConfirm(true)}
              disabled={deleting}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
            >{deleting ? 'Deleting…' : 'Delete anyway'}</button>
          ) : (
            <button
              onClick={() => onConfirm(false)}
              disabled={deleting || (!isSingle && hasActive)}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-30"
            >{deleting ? 'Deleting…' : 'Delete'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
