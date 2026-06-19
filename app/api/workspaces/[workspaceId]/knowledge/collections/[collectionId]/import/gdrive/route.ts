/**
 * POST — import operator-picked Google Drive files into this collection as
 * KnowledgeEntry rows (source='gdrive'), mirroring the crawl/upload path: each
 * file's text is chunked, each chunk becomes one entry with a contentHash.
 *
 * Body: { files: [{ id, name, mimeType }] } — the files chosen via the Google
 * Picker (drive.file scope, so we only ever read what was picked).
 *
 * Dormant until GOOGLE_CONTENT_ENABLED=true. Bounded by a per-request file cap
 * (the Picker is the operator's selection; this is the safety ceiling).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeInCollection } from '@/lib/knowledge'
import { chunkText, estimateTokens } from '@/lib/chunker'
import { isGoogleContentEnabled, refreshAccessToken } from '@/lib/google/content-oauth'
import { fetchDriveFileText, type DriveFileRef } from '@/lib/google/drive-fetch'
import { createHash } from 'node:crypto'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

const MAX_FILES_PER_REQUEST = 25

export async function POST(req: NextRequest, { params }: Params) {
  if (!isGoogleContentEnabled()) {
    return NextResponse.json({ error: 'Google content connector is not enabled' }, { status: 404 })
  }

  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const files = Array.isArray(body.files) ? (body.files as DriveFileRef[]) : []
  const valid = files.filter(f => f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.mimeType === 'string')
  if (valid.length === 0) return NextResponse.json({ error: 'files required' }, { status: 400 })
  if (valid.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json({ error: `Too many files at once (max ${MAX_FILES_PER_REQUEST})` }, { status: 400 })
  }

  const conn = await db.googleContentConnection.findUnique({ where: { workspaceId } })
  if (!conn?.isActive) return NextResponse.json({ error: 'Google not connected' }, { status: 409 })

  let accessToken: string
  try {
    ({ accessToken } = await refreshAccessToken(conn.refreshToken))
  } catch {
    return NextResponse.json({ error: 'Could not refresh Google access — reconnect Google' }, { status: 502 })
  }

  const imported: Array<{ name: string; chunks: number }> = []
  const failed: Array<{ name: string; error: string }> = []
  let totalTokens = 0

  for (const file of valid) {
    try {
      const { name, text } = await fetchDriveFileText(accessToken, file)
      if (!text || text.trim().length < 30) { failed.push({ name: file.name, error: 'no readable content' }); continue }
      const chunks = chunkText(text)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        await createKnowledgeInCollection({
          collectionId,
          workspaceId,
          title: chunks.length === 1 ? name : `${name} (${i + 1}/${chunks.length})`,
          content: chunk,
          source: 'gdrive',
          sourceUrl: `https://drive.google.com/file/d/${file.id}/view`,
          tokenEstimate: estimateTokens(chunk),
          contentHash: createHash('sha256').update(chunk).digest('hex'),
        })
        totalTokens += estimateTokens(chunk)
      }
      imported.push({ name, chunks: chunks.length })
    } catch (err) {
      failed.push({ name: file.name, error: err instanceof Error ? err.message : 'import failed' })
    }
  }

  return NextResponse.json({ success: true, imported, failed, totalTokens })
}
