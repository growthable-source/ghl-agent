'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Template {
  id: string
  slug: string
  name: string
  description: string
  category: string
  icon: string
  systemPrompt: string
  suggestedTools: string[]
  suggestedChannels: string[]
  isOfficial: boolean
  installCount: number
}

const CATEGORY_LABELS: Record<string, string> = {
  sales: 'Sales',
  support: 'Support',
  real_estate: 'Real Estate',
  healthcare: 'Healthcare',
  hospitality: 'Hospitality',
  custom: 'Custom',
}

export default function TemplatesPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('all')
  const [notMigrated, setNotMigrated] = useState(false)

  useEffect(() => {
    // Workspace-scoped endpoint returns both official templates AND any
    // workspace-saved templates owned by this tenant. Workspace saves
    // surface at the top of the list.
    fetch(`/api/workspaces/${workspaceId}/templates`)
      .then(r => r.json())
      .then(data => {
        setTemplates(data.templates || [])
        setNotMigrated(!!data.notMigrated)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  async function install(t: Template) {
    setInstalling(t.id)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/templates/${t.id}/install`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        router.push(`/dashboard/${workspaceId}/agents/${data.agent.id}`)
      } else {
        alert(data.error || 'Failed to install')
      }
    } finally { setInstalling(null) }
  }

  const categories = ['all', ...Array.from(new Set(templates.map(t => t.category)))]
  const filtered = category === 'all' ? templates : templates.filter(t => t.category === category)

  if (loading) return <div className="p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Agent Templates</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Start from a proven template. Install in one click — tweak after.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl" style={{ background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber-bg)' }}>
            <p className="text-sm" style={{ color: 'var(--accent-amber)' }}>Run manual_symbiosis_wave2.sql to see templates.</p>
          </div>
        )}

        {/* Category chips */}
        <div className="mb-6 flex flex-wrap gap-2">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
              style={
                category === c
                  ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                  : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }
              }
            >
              {c === 'all' ? 'All' : CATEGORY_LABELS[c] || c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
            No templates available yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(t => (
              <div
                key={t.id}
                className="group relative p-5 rounded-xl transition-all flex flex-col"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl">{t.icon}</div>
                  {t.isOfficial && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                    >
                      Official
                    </span>
                  )}
                </div>
                <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t.name}</h3>
                <p className="text-xs mb-4 flex-1" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                <div className="flex flex-wrap gap-1 mb-4">
                  {t.suggestedChannels.slice(0, 4).map(ch => (
                    <span key={ch} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--surface-tertiary)' }}>{ch}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t.installCount} install{t.installCount === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => install(t)}
                    disabled={installing === t.id}
                    className="text-xs font-semibold px-4 py-1.5 rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                    style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                  >
                    {installing === t.id ? 'Installing...' : 'Install'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
