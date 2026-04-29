import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

/**
 * Brand logo upload — workspace-scoped (not brand-scoped) so it can
 * be called during the *create* flow before a brand exists.
 *
 * Multipart POST with a `file` field. Returns `{ logoUrl }` — the
 * caller stores it on the brand on save (or feeds it into the
 * analyze endpoint to extract suggested colors).
 *
 * Constraints mirror the workspace logo route — same 2 MB cap, same
 * MIME allowlist. Owner/admin only.
 */

const MAX_SIZE_BYTES = 2 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can manage brands.' }, { status: 403 })
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      error: 'Blob storage is not configured. Add BLOB_READ_WRITE_TOKEN in Vercel Storage → Blob.',
    }, { status: 500 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data body with a `file` field.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field.' }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({
      error: `File too large — max ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB. Your upload was ${(file.size / 1024 / 1024).toFixed(2)} MB.`,
    }, { status: 413 })
  }
  if (!ALLOWED_MIME.has(file.type.toLowerCase())) {
    return NextResponse.json({
      error: `Unsupported file type: ${file.type || 'unknown'}. Allowed: PNG, JPEG, WebP, SVG, GIF.`,
    }, { status: 415 })
  }

  // Path: workspaces/<id>/brands/logo-<ts>.<ext>. The timestamp guarantees
  // a unique URL per upload so the CDN doesn't serve a stale logo.
  const ext = guessExt(file.name, file.type)
  const filename = `workspaces/${workspaceId}/brands/logo-${Date.now()}.${ext}`

  let blobUrl: string
  try {
    const blob = await put(filename, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    })
    blobUrl = blob.url
  } catch (err: any) {
    console.error('[brand logo upload] Blob put failed:', err)
    return NextResponse.json({ error: `Upload failed: ${err?.message ?? 'unknown error'}` }, { status: 500 })
  }

  return NextResponse.json({ logoUrl: blobUrl })
}

function guessExt(name: string, mime: string): string {
  const fromName = name.split('.').pop()?.toLowerCase()
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/.test(fromName)) return fromName
  switch (mime) {
    case 'image/png':     return 'png'
    case 'image/jpeg':    return 'jpg'
    case 'image/jpg':     return 'jpg'
    case 'image/webp':    return 'webp'
    case 'image/svg+xml': return 'svg'
    case 'image/gif':     return 'gif'
    default:              return 'bin'
  }
}
