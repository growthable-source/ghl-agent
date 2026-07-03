import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'
import { detectUrl } from '@/lib/ingest/detect'
import { getOrCreateBrandDomain } from '@/lib/ingest/brand-domain'

/**
 * POST — portal users teach their brand's AI, exactly the way workspace
 * operators do on the Knowledge page. Accepts either:
 *   - JSON { url, brandId }              — any link, type auto-detected
 *   - multipart { file, brandId }        — pdf / txt / md via Vercel Blob
 *
 * Sources land in the brand's own KnowledgeDomain (lazily created), so
 * everything flows through the same crawl → chunk → classify → embed
 * pipeline agents use, and ticket suggest-reply reads it for this brand.
 *
 * Returns immediately; the ingest-queue cron claims the queued run.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = /\.(pdf|txt|md|markdown)$/i

export async function POST(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''

  // ── File branch ──────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    const brandId = typeof form?.get('brandId') === 'string' ? String(form.get('brandId')) : ''
    const guard = await resolveBrandDomain(session.brandIds, brandId)
    if (guard.error) return guard.error

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
    const blob = await put(`knowledge/${guard.domain.workspaceId}/${crypto.randomUUID()}-${safeName}`, file, {
      access: 'public',
      addRandomSuffix: false,
    })

    const source = await db.knowledgeSource.create({
      data: {
        knowledgeDomainId: guard.domain.id,
        sourceType: 'pdf',
        urlOrIdentifier: blob.pathname,
        crawlConfig: { storageKey: blob.pathname, originalFilename: file.name },
        isActive: true,
      },
    })
    const run = await db.ingestionRun.create({
      data: { sourceId: source.id, status: 'queued' },
    })
    return NextResponse.json({ sourceId: source.id, runId: run.id, detected: 'file', label: file.name })
  }

  // ── URL branch ───────────────────────────────────────────────────
  const body = (await req.json().catch(() => ({}))) as { url?: string; brandId?: string }
  const guard = await resolveBrandDomain(session.brandIds, typeof body.brandId === 'string' ? body.brandId : '')
  if (guard.error) return guard.error

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

  // Re-adding the same URL within this brand re-checks it instead of
  // duplicating. Deduped within the brand's domain only — the workspace
  // may legitimately index the same URL elsewhere.
  const existing = await db.knowledgeSource.findFirst({
    where: { knowledgeDomainId: guard.domain.id, urlOrIdentifier: normalizedUrl },
    select: { id: true },
  })
  const source =
    existing ??
    (await db.knowledgeSource.create({
      data: {
        knowledgeDomainId: guard.domain.id,
        sourceType: detection.sourceType,
        urlOrIdentifier: normalizedUrl,
        crawlConfig: detection.crawlConfig as object,
        isActive: true,
      },
      select: { id: true },
    }))

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

async function resolveBrandDomain(
  sessionBrandIds: string[],
  brandId: string,
): Promise<
  | { domain: { id: string; workspaceId: string }; error?: undefined }
  | { domain?: undefined; error: NextResponse }
> {
  if (!brandId || !sessionBrandIds.includes(brandId)) {
    return { error: NextResponse.json({ error: 'Unknown brand' }, { status: 403 }) }
  }
  try {
    const domain = await getOrCreateBrandDomain(brandId)
    if (!domain) return { error: NextResponse.json({ error: 'Brand not found' }, { status: 404 }) }
    return { domain }
  } catch {
    // Pre-migration: KnowledgeDomain.brandId column missing.
    return {
      error: NextResponse.json(
        { error: 'Knowledge for portals isn’t initialised on this database yet. Please try again later.' },
        { status: 503 },
      ),
    }
  }
}
