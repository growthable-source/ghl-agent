import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { parseWindow, errorResponse, ok } from '@/lib/api-scope'
import { listTickets } from '@/lib/support-metrics/tickets'

export async function GET(req: NextRequest) {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = resolveScope(key, { requestedWorkspaceId: url.searchParams.get('workspaceId') || undefined })
    const { from, to, brandId } = parseWindow(url)
    const cursor = url.searchParams.get('cursor') || undefined
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined
    const data = await listTickets(db, { workspaceId: workspaceId!, from, to, brandId }, { cursor, limit })
    return ok(data, { scope: key.scope, workspaceId, from, to })
  } catch (err) {
    return errorResponse(err)
  }
}
