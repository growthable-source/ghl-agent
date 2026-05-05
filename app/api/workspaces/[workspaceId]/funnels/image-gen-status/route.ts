/**
 * GET /api/workspaces/[workspaceId]/funnels/image-gen-status
 *
 * Returns { enabled: bool } so the wizard can warn the operator when
 * GEMINI_API_KEY isn't wired and pages will render text-only. Doesn't
 * leak the key itself — just whether it exists. Workspace-scoped so
 * we still gate on auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isGeminiImageEnabled } from '@/lib/image-gen-gemini'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  return NextResponse.json({ enabled: isGeminiImageEnabled() })
}
