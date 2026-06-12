/**
 * GET /api/workspaces/:workspaceId/heartbeat
 *
 * One consolidated poll for everything the dashboard chrome refreshes
 * in the background. Before this, every open tab independently hit
 * needs-attention (HandoffAlertBanner @12s AND useNavCounts @30s),
 * approvals, inbox/unread-count, and widget-conversations/recent
 * (NewChatAlert @10s) — six authed function invocations per ~30s per
 * tab, each paying its own session+membership queries and a separate
 * browser round trip.
 *
 * This endpoint fails fast on access once, then invokes the existing
 * route handlers IN-PROCESS and in parallel — zero duplication of
 * their query logic, one browser round trip. Each sub-handler still
 * runs its own (now ~4ms, DB-adjacent) access check; that redundancy
 * is the price of not forking the logic, and it's parallel anyway.
 * Sub-payloads are passed through raw under stable keys so the client
 * parsers stay byte-compatible with the individual endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { GET as needsAttentionGET } from '../needs-attention/route'
import { GET as approvalsGET } from '../approvals/route'
import { GET as unreadCountGET } from '../inbox/unread-count/route'
import { GET as recentConversationsGET } from '../widget-conversations/recent/route'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const p = () => Promise.resolve({ workspaceId })
  const mk = (pathAndQuery: string) =>
    new NextRequest(new URL(`http://internal${pathAndQuery}`))
  const run = (handler: (req: NextRequest, ctx: any) => Promise<Response>, pathAndQuery: string) =>
    handler(mk(pathAndQuery), { params: p() })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)

  const [attention, approvals, unread, recent] = await Promise.all([
    run(needsAttentionGET, '/internal/needs-attention'),
    run(approvalsGET, '/internal/approvals?status=pending&count=1'),
    run(unreadCountGET, '/internal/unread-count'),
    run(recentConversationsGET, '/internal/recent'),
  ])

  return NextResponse.json({ attention, approvals, unread, recent })
}
