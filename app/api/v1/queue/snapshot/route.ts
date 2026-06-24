import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, resolveScope } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { getQueueSnapshot } from '@/lib/support-metrics/queue'

export async function GET(req: NextRequest) {
  try {
    const key = await authenticateApiKey(req)
    const url = new URL(req.url)
    const { workspaceId } = resolveScope(key, { requestedWorkspaceId: url.searchParams.get('workspaceId') || undefined })
    const data = await getQueueSnapshot(db, workspaceId!)
    return ok(data, { scope: key.scope, workspaceId })
  } catch (err) {
    return errorResponse(err)
  }
}
