'use client'

/**
 * Tool gate analytics page — surfaces the data captured by Phase B3's
 * enforced-tool gate. Workspace-scoped, member-readable. Lives in the
 * "Insights" group in the sidebar.
 */

import { useParams } from 'next/navigation'
import ToolGateStats from '@/components/dashboard/ToolGateStats'
import NewBadge from '@/components/NewBadge'

export default function ToolGatePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              Tool gate <NewBadge since="2026-05-30" />
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Every time an enforced tool is checked, the gate logs whether it was allowed or blocked. Use
              this to spot tools your agents keep getting stopped from calling.
            </p>
          </div>
        </div>

        <ToolGateStats workspaceId={workspaceId} />
      </div>
    </div>
  )
}
