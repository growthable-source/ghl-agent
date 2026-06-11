/**
 * POST /api/workspaces/[workspaceId]/knowledge/add
 *
 * The ONE way to teach the workspace something. Accepts either:
 *   - JSON { url }           — any link: website, docs, sitemap,
 *                              YouTube video/channel, RSS/Atom feed.
 *                              Type is auto-detected; the user never
 *                              picks a "source type".
 *   - multipart { file }     — pdf / txt / md, stored in Vercel Blob.
 *
 * Returns IMMEDIATELY: the heavy work (crawl → chunk → classify →
 * embed) runs in the background via a queued IngestionRun that the
 * ingest-queue cron claims within a minute. This replaces the old
 * synchronous in-request crawling/parsing that froze the UI and hit
 * function timeouts on large files.
 *
 * Everything lands in the workspace's default knowledge domain;
 * agents with no explicit domain scope read it automatically — no
 * extra wiring step.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { detectUrl } from '@/lib/ingest/detect'
import { getOrCreateWorkspaceDomain } from '@/lib/ingest/workspace-domain'

const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB — Blob handles it; parsing is async now
const ALLOWED_EXTENSIONS = /\.(pdf|txt|md|markdown)$/i

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const contentType = req.headers.get('content-type') ?? ''

  // ── File branch ──────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ALLOWED_EXTENSIONS.test(file.name)) {
      return NextResponse.json(
        { error: 'Unsupported file type — PDF, TXT, and Markdown files are supported.' },
        { status: 400 },
      )
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is 20 MB.` },
        { status: 400 },
      )
    }

    const { put } = await import('@vercel/blob')
    const safeName = file.name.replace(/[^\w.\- ]+/g, '_')
    const blob = await put(`knowledge/${workspaceId}/${crypto.randomUUID()}-${safeName}`, file, {
      access: 'public',
      addRandomSuffix: false,
    })

    const domain = await getOrCreateWorkspaceDomain(workspaceId)
    const source = await db.knowledgeSource.create({
      data: {
        knowledgeDomainId: domain.id,
        sourceType: 'pdf',
        urlOrIdentifier: blob.pathname,
        crawlConfig: { storageKey: blob.pathname, originalFilename: file.name },
        isActive: true,
      },
    })
    const run = await db.ingestionRun.create({
      data: { sourceId: source.id, status: 'queued' },
    })

    return NextResponse.json({
      sourceId: source.id,
      runId: run.id,
      detected: 'file',
      label: file.name,
    })
  }

  // ── URL branch ───────────────────────────────────────────────────
  const body = (await req.json().catch(() => ({}))) as { url?: string }
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!rawUrl) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return NextResponse.json({ error: 'That doesn’t look like a valid link.' }, { status: 400 })
  }
  const normalizedUrl = parsed.toString()

  const detection = await detectUrl(normalizedUrl)
  const domain = await getOrCreateWorkspaceDomain(workspaceId)

  // Re-adding the same URL re-checks it instead of duplicating the
  // source — pasting twice is "check it again", not "two copies".
  // Deduped across ALL the workspace's domains, not just the default
  // one: sources created on the advanced surface live in other
  // domains and must not get a doppelgänger here.
  const existing = await db.knowledgeSource.findFirst({
    where: { domain: { workspaceId }, urlOrIdentifier: normalizedUrl },
    select: { id: true },
  })
  const source =
    existing ??
    (await db.knowledgeSource.create({
      data: {
        knowledgeDomainId: domain.id,
        sourceType: detection.sourceType,
        urlOrIdentifier: normalizedUrl,
        crawlConfig: detection.crawlConfig as object,
        isActive: true,
      },
      select: { id: true },
    }))

  // Don't stack queued runs for the same source.
  const pending = await db.ingestionRun.findFirst({
    where: { sourceId: source.id, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  const run =
    pending ?? (await db.ingestionRun.create({ data: { sourceId: source.id, status: 'queued' }, select: { id: true } }))

  return NextResponse.json({
    sourceId: source.id,
    runId: run.id,
    detected: detection.kind,
    label: detection.label,
    alreadyExisted: !!existing,
  })
}
