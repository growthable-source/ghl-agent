/**
 * Pre-campaign brand-asset upload.
 *
 * The funnel wizard wants the operator to upload a logo BEFORE the
 * Campaign row exists (the wizard creates the Campaign at the end).
 * This endpoint accepts a logo upload, stores it in Blob, and returns
 * the public URL. The wizard holds the URL in component state and
 * passes it to /funnels POST as `logoUrl`.
 *
 * Same MIME/size constraints as the campaign-scoped POST route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
])

export async function POST(req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob storage not configured. Add BLOB_READ_WRITE_TOKEN in Vercel → Storage → Blob.' },
      { status: 500 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a `file` field.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Logo too large — max ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 })
  }
  if (!ALLOWED.has(file.type.toLowerCase())) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `workspaces/${workspaceId}/brand-uploads/logo-${Date.now()}.${ext}`
  try {
    const blob = await put(path, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    })
    return NextResponse.json({ logoUrl: blob.url })
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 500 },
    )
  }
}
