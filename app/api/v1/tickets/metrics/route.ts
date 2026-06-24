import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveWorkspaceScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { getTicketMetrics } from '@/lib/support-metrics/tickets'

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = await resolveWorkspaceScope(key, url.searchParams.get('workspaceId') || undefined)
    const { from, to, brandId } = parseWindow(url)
    const data = await getTicketMetrics(db, { workspaceId, from, to, brandId })
    return ok(data, { scope: key.scope, workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
})
