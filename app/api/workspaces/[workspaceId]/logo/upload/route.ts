import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

/**
 * Upload a workspace logo image to Vercel Blob.
 *
 * Flow: multipart POST with `file` field → validate MIME + size →
 * upload to Blob with a stable path (so re-uploads overwrite) → save
 * the returned public URL on Workspace.logoUrl → return the URL so
 * the caller can refresh the UI.
 *
 * Constraints:
 *   - Max 2 MB. Logos don't need more than that; anything larger
 *     bloats cold-start page loads.
 *   - image/png, image/jpeg, image/webp, image/svg+xml, image/gif.
 *   - Owner/admin only. Members can't rebrand the workspace.
 *
 * Requires BLOB_READ_WRITE_TOKEN in env. If missing, returns a clear
 * error so operators know exactly what to wire up.
 */

const MAX_SIZE_BYTES = 2 * 1024 * 1024  // 2 MB
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
    return NextResponse.json({ error: 'Only owners and admins can change the workspace logo.' }, { status: 403 })
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      error: 'Blob storage is not configured. Ask your admin to add BLOB_READ_WRITE_TOKEN in Vercel Storage → Blob.',
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

  // Stable path keyed by workspace id + filename hash. Using the original
  // filename suffix keeps Blob's content-type detection happy; prefixing
  // with workspaceId means each workspace's logos are grouped for the
  // eventual "clean up blobs for deleted workspaces" cron.
  const ext = guessExt(file.name, file.type)
  const filename = `workspaces/${workspaceId}/logo-${Date.now()}.${ext}`

  let blobUrl: string
  try {
    const blob = await put(filename, file, {
      access: 'public',
      // `addRandomSuffix: false` → we control the filename. The timestamp
      // in the path guarantees a new URL per upload so CDN caches don't
      // serve the old logo after a re-upload.
      addRandomSuffix: false,
      contentType: file.type,
    })
    blobUrl = blob.url
  } catch (err: any) {
    console.error('[logo upload] Blob put failed:', err)
    return NextResponse.json({ error: `Upload failed: ${err?.message ?? 'unknown error'}` }, { status: 500 })
  }

  await db.workspace.update({
    where: { id: workspaceId },
    data: { logoUrl: blobUrl },
  })

  return NextResponse.json({ logoUrl: blobUrl })
}

/**
 * DELETE — clear the workspace logo and fall back to the emoji icon.
 * Doesn't actually delete the Blob (keeping it doesn't cost meaningfully
 * and a future "restore previous logo" feature would need the file).
 * A separate cleanup cron can prune orphans later.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can change the workspace logo.' }, { status: 403 })
  }
  await db.workspace.update({
    where: { id: workspaceId },
    data: { logoUrl: null },
  })
  return NextResponse.json({ ok: true })
}

function guessExt(name: string, mime: string): string {
  // Prefer the filename's extension if it looks sane; fall back to a
  // mime mapping. Keeps `.svg` SVGs properly suffixed.
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
