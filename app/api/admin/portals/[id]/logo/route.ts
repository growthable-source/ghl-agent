import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Portal logo upload — super-admin only. Multipart POST with a `file`
 * field; stores the image in Blob and returns `{ logoUrl }`. The
 * caller sets it into the branding form and persists on save (same
 * flow as the brand logo route). 2 MB cap, image MIME allowlist —
 * mirrors lib/.../brands/upload-logo.
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId } = await params
  const portal = await db.portal.findUnique({ where: { id: portalId }, select: { id: true } })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

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

  // Timestamped path so each upload gets a unique CDN URL (no stale logo).
  const ext = guessExt(file.name, file.type)
  const filename = `portals/${portalId}/logo-${Date.now()}.${ext}`

  let blobUrl: string
  try {
    const blob = await put(filename, file, { access: 'public', addRandomSuffix: false, contentType: file.type })
    blobUrl = blob.url
  } catch (err: any) {
    console.error('[portal logo upload] Blob put failed:', err)
    return NextResponse.json({ error: `Upload failed: ${err?.message ?? 'unknown error'}` }, { status: 500 })
  }

  logAdminActionAfter({ admin: session, action: 'upload_portal_logo', target: portalId, meta: { logoUrl: blobUrl } })
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
