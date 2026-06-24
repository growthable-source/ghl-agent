import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveWorkspaceScope } from '@/lib/api-auth'
import { parseWindow, parseLimit, errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { listCsatResponses } from '@/lib/support-metrics/csat'

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = await resolveWorkspaceScope(key, url.searchParams.get('workspaceId') || undefined)
    const { from, to, brandId } = parseWindow(url)
    const rating = url.searchParams.get('rating') ? Number(url.searchParams.get('rating')) : undefined
    const handlerParam = url.searchParams.get('handler')
    const handler = handlerParam === 'ai' || handlerParam === 'human' ? handlerParam : undefined
    const cursor = url.searchParams.get('cursor') || undefined
    const data = await listCsatResponses(db, { workspaceId, from, to, brandId, rating, handler }, { cursor, limit: parseLimit(url) })
    return ok(data, { scope: key.scope, workspaceId: workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
})
