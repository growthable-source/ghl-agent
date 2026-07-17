/**
 * GET /api/public/try/[slug]/status — landing-page poll target.
 * The FIRST poll is what triggers lazy provisioning (ensureProvisioned
 * is idempotent, so refreshes and concurrent tabs are safe). Also
 * reports crawl progress so the "building your AI" sequence is honest.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureProvisioned } from '@/lib/demo-prospects/provision'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const prospect = await ensureProvisioned(slug)
  if (!prospect) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let ingestion: { status: string; chunksCreated: number } | null = null
  if (prospect.ingestionRunId) {
    const run = await db.ingestionRun.findUnique({
      where: { id: prospect.ingestionRunId },
      select: { status: true, chunksCreated: true },
    })
    if (run) ingestion = { status: run.status, chunksCreated: run.chunksCreated }
  }

  return NextResponse.json({
    status: prospect.status,
    businessName: prospect.businessName,
    ingestion,
  })
}
