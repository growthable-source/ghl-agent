/**
 * GET /api/public/try/[slug]/status — landing-page poll target.
 *
 * Read-only: this NO LONGER triggers provisioning (that used to happen
 * lazily on the first poll — see git history / lib/demo-prospects/
 * provision.ts's doc comment for the old behavior). Provisioning now
 * only starts when the visitor explicitly clicks "Train my AI
 * receptionist", via POST /api/public/try/[slug]/train. This route just
 * reports current state and stamps clickedAt once per prospect so we
 * still know the page was viewed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Distinguish "feature not configured" from "no such prospect" — both
  // would otherwise 404 identically, but only one of them means the
  // feature is turned off.
  if (!demoWorkspaceId()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Stamp the click once, best-effort. Conditioned on clickedAt being
  // null so repeated polls/refreshes/concurrent tabs don't re-write it.
  if (!prospect.clickedAt) {
    await db.demoProspect.updateMany({
      where: { id: prospect.id, clickedAt: null },
      data: { clickedAt: new Date() },
    }).catch(() => {})
  }

  let ingestion: { status: string; chunksCreated: number; pagesAttempted: number; pagesSucceeded: number } | null = null
  if (prospect.ingestionRunId) {
    const run = await db.ingestionRun.findUnique({
      where: { id: prospect.ingestionRunId },
      select: { status: true, chunksCreated: true, pagesAttempted: true, pagesSucceeded: true },
    })
    if (run) {
      ingestion = {
        status: run.status,
        chunksCreated: run.chunksCreated,
        pagesAttempted: run.pagesAttempted,
        pagesSucceeded: run.pagesSucceeded,
      }
    }
  }

  return NextResponse.json({
    status: prospect.status,
    businessName: prospect.businessName,
    websiteUrl: prospect.websiteUrl,
    ingestion,
  })
}
