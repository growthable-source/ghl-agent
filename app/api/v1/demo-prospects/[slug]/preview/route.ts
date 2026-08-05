/**
 * POST /api/v1/demo-prospects/{slug}/preview  { previewUrl }
 *
 * The prospecting tool publishes a finished website rebuild onto the
 * prospect's /redesign/{slug} page. Same auth as the rest of /v1/demo-
 * prospects: an org-scope key, or a workspace key for the demos workspace.
 *
 * The page renders this URL as a link the prospect clicks, so it is validated
 * as an absolute https:// URL here rather than trusted — a stored javascript:
 * or data: value would become a live link on a page we send strangers to.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError, type KeyContext } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'

function requireDemoKey(key: KeyContext): void {
  const ws = demoWorkspaceId()
  if (!ws) throw new AuthError(503, 'not_configured', 'Demo provisioning is not configured')
  if (key.scope !== 'org' && key.workspaceId !== ws) {
    throw new AuthError(403, 'forbidden', 'Key is not authorized for demo provisioning')
  }
}

export const POST = withApiLog(async (req: NextRequest, ctx?: unknown) => {
  try {
    const { params } = ctx as { params: Promise<{ slug: string }> }
    const key = await authenticateApiKey(req)
    requireDemoKey(key)

    const { slug } = await params
    const body = (await req.json().catch(() => ({}))) as { previewUrl?: string }
    const previewUrl = (body.previewUrl || '').trim()

    let parsed: URL
    try {
      parsed = new URL(previewUrl)
    } catch {
      throw new AuthError(422, 'bad_param', 'previewUrl must be an absolute URL')
    }
    if (parsed.protocol !== 'https:') {
      throw new AuthError(422, 'bad_param', 'previewUrl must be https')
    }
    if (previewUrl.length > 2048) {
      throw new AuthError(422, 'bad_param', 'previewUrl is too long')
    }

    const updated = await db.demoProspect.updateMany({
      where: { slug },
      data: { previewUrl },
    })
    if (updated.count === 0) {
      throw new AuthError(404, 'not_found', 'No such prospect')
    }

    return ok({ slug, previewUrl }, { apiKeyId: key.apiKeyId })
  } catch (err) {
    return errorResponse(err)
  }
})
