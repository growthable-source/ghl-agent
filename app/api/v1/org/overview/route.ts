import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { getOrgOverview } from '@/lib/support-metrics/overview'

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    resolveScope(key, { orgEndpoint: true }) // throws unless org key
    const { from, to } = parseWindow(new URL(req.url))
    const data = await getOrgOverview(db, from, to)
    return ok(data, { scope: 'org', from, to })
  } catch (err) {
    return errorResponse(err)
  }
})
