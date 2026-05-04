'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import PlayEditor, { EMPTY_DRAFT, type PlayDraft } from '@/components/dashboard/PlayEditor'

export default function EditPlayPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const playId = params.playId as string

  const [initial, setInitial] = useState<PlayDraft | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules`)
      .then(r => r.json())
      .then(d => {
        const rule = (d.rules ?? []).find((r: any) => r.id === playId)
        if (!rule) {
          setNotFound(true)
          return
        }
        setInitial({
          id: rule.id,
          name: rule.name ?? '',
          conditionDescription: rule.conditionDescription ?? '',
          examples: Array.isArray(rule.examples) ? rule.examples : [],
          actionType: rule.actionType ?? EMPTY_DRAFT.actionType,
          actionParams: rule.actionParams ?? {},
          targetFieldKey: rule.targetFieldKey ?? '',
          targetValue: rule.targetValue ?? '',
          overwrite: !!rule.overwrite,
          isActive: rule.isActive !== false,
        })
      })
      .catch(() => setNotFound(true))
  }, [workspaceId, agentId, playId])

  if (notFound) {
    return (
      <div className="p-8 max-w-2xl">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          That Play doesn't exist or has been deleted.
        </p>
      </div>
    )
  }
  if (!initial) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 rounded-xl animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <PlayEditor
      workspaceId={workspaceId}
      agentId={agentId}
      initial={initial}
      mode="edit"
    />
  )
}
