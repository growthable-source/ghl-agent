'use client'

/**
 * /dashboard/[workspaceId]/agents/[agentId]/flow
 *
 * Visual Workflow Canvas (Phase Adv-1) — full-bleed React Flow viewport.
 * The page itself is a thin shell: params → AgentFlowCanvas. The canvas
 * handles fetch, render, and the reset-layout toolbar.
 *
 * Phase 1 ships as a directly-navigable URL — no toggle in the agent
 * header yet (Phase 2). Users can land here and explore.
 */

import { useParams } from 'next/navigation'
import { AgentFlowCanvas } from '@/components/dashboard/AgentFlowCanvas'

export default function AgentFlowPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  return (
    <div
      style={{
        height: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AgentFlowCanvas workspaceId={workspaceId} agentId={agentId} />
    </div>
  )
}
