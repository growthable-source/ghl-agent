'use client'

import { useParams } from 'next/navigation'
import PlayEditor, { EMPTY_DRAFT } from '@/components/dashboard/PlayEditor'

export default function NewPlayPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  return (
    <PlayEditor
      workspaceId={workspaceId}
      agentId={agentId}
      initial={EMPTY_DRAFT}
      mode="new"
    />
  )
}
