import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { listCsatResponses } from '@/lib/support-metrics/csat'

export async function GET(req: NextRequest) {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = resolveScope(key, { requestedWorkspaceId: url.searchParams.get('workspaceId') || undefined })
    const { from, to, brandId } = parseWindow(url)
    const rating = url.searchParams.get('rating') ? Number(url.searchParams.get('rating')) : undefined
    const handlerParam = url.searchParams.get('handler')
    const handler = handlerParam === 'ai' || handlerParam === 'human' ? handlerParam : undefined
    const cursor = url.searchParams.get('cursor') || undefined
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined
    const data = await listCsatResponses(db, { workspaceId: workspaceId!, from, to, brandId, rating, handler }, { cursor, limit })
    return ok(data, { scope: key.scope, workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
}
