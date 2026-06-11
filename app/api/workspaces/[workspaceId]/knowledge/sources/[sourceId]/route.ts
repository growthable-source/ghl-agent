/**
 * Per-source management for the simple Knowledge page.
 *
 *   PATCH  { action: 'recheck' }                    → queue a re-read now
 *   PATCH  { action: 'pause' | 'resume' }           → toggle isActive
 *   PATCH  { recrawlIntervalDays: number }          → change auto-check cadence (0 = off)
 *   DELETE                                           → remove the source and everything learned from it
 *
 * Chunks and runs cascade on source delete (schema-level), so a
 * delete is genuinely "forget this" — exactly what the button says.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string; sourceId: string }> }

async function loadScopedSource(workspaceId: string, sourceId: string) {
  return db.knowledgeSource.findFirst({
    where: { id: sourceId, domain: { workspaceId } },
    select: { id: true, crawlConfig: true, isActive: true },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, sourceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const source = await loadScopedSource(workspaceId, sourceId)
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    recrawlIntervalDays?: number
  }

  if (body.action === 'recheck') {
    const pending = await db.ingestionRun.findFirst({
      where: { sourceId, status: { in: ['queued', 'running'] } },
      select: { id: true },
    })
    const run =
      pending ?? (await db.ingestionRun.create({ data: { sourceId, status: 'queued' }, select: { id: true } }))
    return NextResponse.json({ ok: true, runId: run.id })
  }

  if (body.action === 'pause' || body.action === 'resume') {
    await db.knowledgeSource.update({
      where: { id: sourceId },
      data: { isActive: body.action === 'resume' },
    })
    return NextResponse.json({ ok: true, isActive: body.action === 'resume' })
  }

  if (typeof body.recrawlIntervalDays === 'number') {
    const days = Math.max(0, Math.min(90, Math.round(body.recrawlIntervalDays)))
    const cfg = (source.crawlConfig ?? {}) as Record<string, unknown>
    await db.knowledgeSource.update({
      where: { id: sourceId },
      data: { crawlConfig: { ...cfg, recrawlIntervalDays: days } },
    })
    return NextResponse.json({ ok: true, recrawlIntervalDays: days })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, sourceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const source = await loadScopedSource(workspaceId, sourceId)
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.knowledgeSource.delete({ where: { id: sourceId } })
  return NextResponse.json({ ok: true })
}
