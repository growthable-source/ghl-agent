'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import LiveDataSourcesPanel from '@/components/dashboard/LiveDataSourcesPanel'
import SaveBar from '@/components/dashboard/SaveBar'
import { useDirtyForm } from '@/lib/use-dirty-form'

/**
 * Per-agent knowledge page — ONE list, ONE question: what does this
 * agent know, and when should it use each piece?
 *
 * Collections are the only knowledge container — each holds crawled
 * links/files (searched live) AND hand-written notes (always in the
 * prompt). One row per collection: a checkbox to attach it to this
 * agent, plus an optional usage trigger ("only use this when…") that
 * the runtime injects as a condition the model must respect.
 *
 * Save semantics:
 *  - every collection checked → knowledgeScopeAll=true, so collections
 *    created later are auto-included ("read everything")
 *  - any collection unchecked → scopeAll=false + the attached set is
 *    authoritative (AgentCollection junction)
 *  - triggers → Agent.knowledgeConditions map { collectionId: condition }
 */

interface CollectionLite {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  entryCount: number
  dataSourceCount: number
  sourceCount: number
}

interface KnowledgeDraft extends Record<string, unknown> {
  collectionIds: string[]
  /** collectionId → "only use when …" condition. */
  conditions: Record<string, string>
}

export default function AgentKnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [collections, setCollections] = useState<CollectionLite[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [initial, setInitial] = useState<KnowledgeDraft | null>(null)
  // Rows whose trigger editor is open even though the condition text is
  // still empty (freshly clicked "+ Add a trigger").
  const [openTriggers, setOpenTriggers] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const [colRes, agentRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/collections`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()).catch(() => ({})),
    ])

    const cols: CollectionLite[] = colRes.available || []
    setCollections(cols)
    setNotMigrated(!!colRes.notMigrated)

    // scopeAll means "read everything", so every box starts ticked —
    // including collections the junction table doesn't list yet.
    const scopeAll: boolean = agentRes.agent?.knowledgeScopeAll ?? true
    const attachedCollections: string[] = scopeAll
      ? cols.map(c => c.id)
      : (colRes.attached || []).map((c: CollectionLite) => c.id)

    const rawConditions = agentRes.agent?.knowledgeConditions
    const conditions: Record<string, string> = {}
    if (rawConditions && typeof rawConditions === 'object' && !Array.isArray(rawConditions)) {
      for (const [k, v] of Object.entries(rawConditions)) {
        if (typeof v === 'string' && v.trim()) conditions[k] = v
      }
    }

    setInitial({ collectionIds: attachedCollections, conditions })
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { load() }, [load])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<KnowledgeDraft>({
    initial,
    onSave: async (d) => {
      // Only keep conditions for sources that are still attached — an
      // unchecked source's trigger would otherwise linger invisibly.
      const attached = new Set(d.collectionIds)
      const conditions: Record<string, string> = {}
      for (const [id, cond] of Object.entries(d.conditions)) {
        if (attached.has(id) && cond.trim()) conditions[id] = cond.trim()
      }
      // Everything ticked (or nothing to tick yet) → scopeAll, so
      // collections created later are auto-included.
      const scopeAll = collections.length === 0 || d.collectionIds.length === collections.length

      const [agentRes, colRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            knowledgeScopeAll: scopeAll,
            knowledgeConditions: conditions,
          }),
        }),
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/collections`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collectionIds: d.collectionIds }),
        }),
      ])
      if (!agentRes.ok) throw new Error((await agentRes.json().catch(() => ({})))?.error || 'Failed to save knowledge settings')
      if (!colRes.ok) throw new Error((await colRes.json().catch(() => ({})))?.error || 'Failed to save attached collections')
    },
  })

  function toggleCollection(id: string) {
    const current = draft.collectionIds
    set({
      collectionIds: current.includes(id) ? current.filter(x => x !== id) : [...current, id],
    })
  }

  function setCondition(id: string, value: string) {
    set({ conditions: { ...draft.conditions, [id]: value } })
  }

  function removeCondition(id: string) {
    const next = { ...draft.conditions }
    delete next[id]
    set({ conditions: next })
    setOpenTriggers(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  function openTrigger(id: string) {
    setOpenTriggers(prev => new Set(prev).add(id))
  }

  if (loading || !initial) {
    return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</div>
  }

  const hasSources = collections.length > 0
  const attachedCount = draft.collectionIds.length

  const renderTriggerControl = (id: string) => {
    const condition = draft.conditions[id] ?? ''
    const editing = condition !== '' || openTriggers.has(id)
    if (!editing) {
      return (
        <button
          type="button"
          onClick={e => { e.preventDefault(); openTrigger(id) }}
          className="text-[11px] font-medium mt-2 hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Always used — + add a trigger
        </button>
      )
    }
    return (
      <div className="mt-2 flex items-start gap-2" onClick={e => e.preventDefault()}>
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--accent-primary)' }}>
            Only use this knowledge when…
          </p>
          <input
            type="text"
            value={condition}
            autoFocus={condition === ''}
            onChange={e => setCondition(id, e.target.value)}
            placeholder='e.g. "the visitor asks about pricing" or "the contact is NOT an existing customer"'
            className="w-full text-xs rounded-lg px-2.5 py-2 outline-none"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
        </div>
        <button
          type="button"
          onClick={e => { e.preventDefault(); removeCondition(id) }}
          className="text-[11px] mt-5 px-2 py-1.5 rounded-lg hover:opacity-80"
          style={{ color: 'var(--text-tertiary)' }}
          title="Remove trigger — always use this knowledge"
        >
          ✕
        </button>
      </div>
    )
  }

  const renderRow = (opts: {
    id: string
    icon: string
    iconBg: string
    name: string
    description: string | null
    meta: string
    editHref?: string
  }) => {
    const checked = draft.collectionIds.includes(opts.id)
    const hasTrigger = !!(draft.conditions[opts.id]?.trim())
    return (
      <label
        key={opts.id}
        className="block p-3 rounded-xl cursor-pointer transition-colors"
        style={
          checked
            ? { border: '1px solid var(--accent-primary)', background: 'var(--accent-primary-bg)' }
            : { border: '1px solid var(--border)', background: 'var(--surface)' }
        }
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleCollection(opts.id)}
            className="mt-1 accent-orange-500"
          />
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
            style={{ background: opts.iconBg }}
          >
            {opts.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{opts.name}</p>
              {checked && hasTrigger && (
                <span
                  className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                >
                  Conditional
                </span>
              )}
            </div>
            {opts.description && (
              <p className="text-xs line-clamp-2 mt-0.5" style={{ color: 'var(--text-secondary)' }}>{opts.description}</p>
            )}
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{opts.meta}</p>
            {checked && renderTriggerControl(opts.id)}
          </div>
          {opts.editHref && (
            <Link
              href={opts.editHref}
              onClick={e => e.stopPropagation()}
              className="text-[11px] flex-shrink-0 hover:opacity-80"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Edit →
            </Link>
          )}
        </div>
      </label>
    )
  }

  return (
    <div className="p-8 max-w-3xl space-y-6 pb-24">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          What this agent knows
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Tick the collections this agent should use. Add a trigger to any collection to control <em>when</em> it&apos;s
          used — otherwise it always applies. To add or edit the content itself, open the{' '}
          <Link href={`/dashboard/${workspaceId}/knowledge`} className="hover:underline" style={{ color: 'var(--accent-primary)' }}>
            workspace Knowledge page
          </Link>.
        </p>
      </div>

      {notMigrated && (
        <div
          className="p-4 rounded-xl"
          style={{ border: '1px solid var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-amber)' }}>Migration pending</p>
          <p className="text-xs mt-1" style={{ color: 'var(--accent-amber)' }}>
            Run <code className="px-1 rounded" style={{ background: 'var(--surface-tertiary)' }}>prisma/migrations/20260429160000_knowledge_collections/migration.sql</code> to enable Collections.
          </p>
        </div>
      )}

      {!hasSources ? (
        <div
          className="text-center py-12 rounded-xl"
          style={{ border: '1px dashed var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl"
            style={{ background: 'var(--surface-tertiary)' }}
          >📚</div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No knowledge in this workspace yet</p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>Add some knowledge first, then come back to connect it to this agent.</p>
          <Link
            href={`/dashboard/${workspaceId}/knowledge`}
            className="inline-block text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            Open Knowledge
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {collections.map(c => {
              const accent = c.color || '#fa4d2e'
              return renderRow({
                id: c.id,
                icon: c.icon || '📚',
                iconBg: `linear-gradient(135deg, ${accent}33, ${accent}11)`,
                name: c.name,
                description: c.description,
                meta: [
                  c.sourceCount > 0
                    ? `${c.sourceCount} link${c.sourceCount === 1 ? '' : 's'} & file${c.sourceCount === 1 ? '' : 's'} · searched live as people ask questions`
                    : null,
                  c.entryCount > 0 ? `${c.entryCount} written item${c.entryCount === 1 ? '' : 's'}` : null,
                  c.dataSourceCount > 0 ? `${c.dataSourceCount} data source${c.dataSourceCount === 1 ? '' : 's'}` : null,
                ].filter(Boolean).join(' · ') || 'Empty collection',
                editHref: `/dashboard/${workspaceId}/knowledge/${c.id}`,
              })
            })}
          </div>

          {attachedCount === 0 && (
            <p className="text-[11px]" style={{ color: 'var(--accent-amber)' }}>
              Nothing selected — this agent will answer from its instructions alone, with no knowledge.
            </p>
          )}
        </>
      )}

      {/* Live data sources (e.g. Shopify) are tools the agent calls
          mid-conversation, not indexed text. The connection is
          workspace-wide, so this stays a status panel rather than a
          per-agent checkbox. */}
      <LiveDataSourcesPanel workspaceId={workspaceId} />

      <SaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        error={error}
        onSave={save}
        onReset={() => { reset(); setOpenTriggers(new Set()) }}
      />
    </div>
  )
}
