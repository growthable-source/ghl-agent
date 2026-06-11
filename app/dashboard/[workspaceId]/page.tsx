/**
 * Workspace dashboard — server shell.
 *
 * Runs the empty-workspace auto-launch check (zero agents → bounce
 * into the agent wizard so the user isn't dropped onto an empty
 * dashboard with no obvious next step) and then delegates the rest
 * of the rendering to the client view.
 *
 * Lives in page.tsx — not the layout — because `params` here is
 * the only reliable signal that we're on the `/dashboard/[wsId]`
 * root URL exactly. The previous header-based detection in the
 * layout (`x-invoke-path` / `x-matched-path` / `next-url`) wasn't
 * guaranteed across Next.js runtimes and the auto-launch would
 * silently no-op on non-Vercel deployments.
 */

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import WorkspaceDashboardView from './_dashboard-view'

export const dynamic = 'force-dynamic'

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  // Workspace-membership gating is already done by the layout. We
  // just need the agent count here. Wrap in try/catch so a DB blip
  // never blocks the dashboard from rendering — the empty-state CTA
  // on the client view is a fine fallback.
  let agentCount = -1
  try {
    const session = await auth()
    if (session?.user?.id) {
      agentCount = await db.agent.count({ where: { workspaceId } })
    }
  } catch (err: any) {
    console.warn('[WorkspaceDashboard] agent-count check failed:', err?.message)
  }

  // Previously a zero-agent workspace was bounced straight into the
  // agent-creation form — no context, no "what is this", no way to
  // look around first. Now the dashboard renders with a first-run
  // setup checklist as its hero (SetupChecklist in the client view),
  // which explains each step and links into the wizard. The user gets
  // oriented instead of ambushed.

  return <WorkspaceDashboardView />
}
