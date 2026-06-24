import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { getSlaMetrics } from '@/lib/support-metrics/sla'

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = resolveScope(key, { requestedWorkspaceId: url.searchParams.get('workspaceId') || undefined })
    const { from, to, brandId } = parseWindow(url)
    const data = await getSlaMetrics(db, { workspaceId: workspaceId!, from, to, brandId })
    return ok(data, { scope: key.scope, workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
})
