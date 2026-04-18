import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getValidAccessToken } from '@/lib/token-store'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/workspaces/:workspaceId/workflows
 *
 * Lists published workflows from the connected GHL location. Used by the
 * agent tools page to populate the add_to_workflow / remove_from_workflow
 * picker. Drafts are filtered out server-side so the agent is never offered
 * a workflow target that won't actually enroll.
 *
 * Requires the OAuth scope `workflows.readonly` — existing connections that
 * predate this scope will 401 here and need to reconnect.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'No location found for workspace' }, { status: 404 })

  const locationId = location.id
  const token = await getValidAccessToken(locationId)
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const res = await fetch(
    `https://services.leadconnectorhq.com/workflows/?locationId=${locationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    }
  )

  if (!res.ok) {
    const body = await res.text()
    // Surface a friendly hint for the common case — missing scope on older
    // connections. GHL returns 401 with a generic body here.
    if (res.status === 401) {
      return NextResponse.json(
        { error: 'Missing workflows.readonly scope. Reconnect the GHL integration to grant it.', detail: body },
        { status: 401 },
      )
    }
    return NextResponse.json({ error: body }, { status: res.status })
  }

  const data = await res.json()
  const all: Array<{ id: string; name: string; status: string }> = data.workflows ?? []
  // Only published workflows — drafts aren't enrollable and would be confusing.
  const published = all
    .filter(w => w.status === 'published')
    .map(w => ({ id: w.id, name: w.name }))
  return NextResponse.json({ workflows: published })
}
