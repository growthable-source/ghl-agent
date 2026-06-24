import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveWorkspaceScope } from '@/lib/api-auth'
import { parseWindow, parseLimit, errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { listSlaBreaches } from '@/lib/support-metrics/sla'

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = await resolveWorkspaceScope(key, url.searchParams.get('workspaceId') || undefined)
    const { from, to, brandId } = parseWindow(url)
    const data = await listSlaBreaches(db, { workspaceId, from, to, brandId }, parseLimit(url, 100))
    return ok(data, { scope: key.scope, workspaceId: workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
})
