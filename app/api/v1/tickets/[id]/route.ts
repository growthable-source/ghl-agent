import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope, AuthError } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { getTicket } from '@/lib/support-metrics/tickets'

export const GET = withApiLog(async (req: NextRequest, ctx?: unknown) => {
  try {
    const { params } = ctx as { params: Promise<{ id: string }> }
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = resolveScope(key, { requestedWorkspaceId: url.searchParams.get('workspaceId') || undefined })
    const { from, to, brandId } = parseWindow(url)
    const { id } = await params
    const ticket = await getTicket(db, { workspaceId: workspaceId!, from, to, brandId }, id)
    if (!ticket) throw new AuthError(404, 'not_found', 'Ticket not found')
    return ok(ticket, { scope: key.scope, workspaceId })
  } catch (err) {
    return errorResponse(err)
  }
})
