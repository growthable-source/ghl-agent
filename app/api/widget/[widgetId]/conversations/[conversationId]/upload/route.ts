import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

/**
 * POST /api/widget/:widgetId/conversations/:conversationId/upload
 *
 * Multipart upload from the widget composer. Stores in Vercel Blob,
 * persists a WidgetMessage with kind='image' or 'file', broadcasts the
 * new message over SSE so other tabs/operators see it instantly.
 *
 * The image URL alone goes in `content` for image messages; for files
 * we stringify { url, name, mime, size } so the renderer can show a
 * download link with the original filename.
 *
 * The agent does NOT yet ingest image content (vision) — uploads exist
 * for human-to-human handoff and operator inbox visibility. Agent gets
 * a text breadcrumb on its next inbound turn so it can acknowledge.
 */

const MAX_SIZE_BYTES = 10 * 1024 * 1024  // 10 MB
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic'])
const FILE_MIME = new Set([
  'application/pdf',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      error: 'File uploads not configured. Operator: add BLOB_READ_WRITE_TOKEN under Vercel → Storage → Blob.',
    }, { status: 500, headers })
  }

  // Verify conversation belongs to widget
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers })

  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a `file` field.' }, { status: 400, headers })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field.' }, { status: 400, headers })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({
      error: `File too large — max ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB. Yours was ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
    }, { status: 413, headers })
  }
  const mime = (file.type || '').toLowerCase()
  const isImage = IMAGE_MIME.has(mime)
  const isFile = FILE_MIME.has(mime)
  if (!isImage && !isFile) {
    return NextResponse.json({
      error: `Unsupported file type: ${mime || 'unknown'}. Allowed: images (PNG/JPEG/WebP/GIF/HEIC), PDF, plain text, CSV, Word, Excel.`,
    }, { status: 415, headers })
  }

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `widgets/${widgetId}/${conversationId}/${Date.now()}-${safeName}`

  let blobUrl: string
  try {
    const blob = await put(path, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    })
    blobUrl = blob.url
  } catch (err: any) {
    return NextResponse.json({ error: `Upload failed: ${err?.message ?? 'unknown error'}` }, { status: 500, headers })
  }

  // Persist as a visitor message
  const content = isImage
    ? blobUrl
    : JSON.stringify({ url: blobUrl, name: file.name, mime, size: file.size })
  const msg = await db.widgetMessage.create({
    data: {
      conversationId,
      role: 'visitor',
      content,
      kind: isImage ? 'image' : 'file',
    },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), staleNotifiedAt: null },
  })

  broadcast(conversationId, {
    type: 'visitor_message',
    id: msg.id,
    content,
    kind: isImage ? 'image' : 'file',
    createdAt: msg.createdAt.toISOString(),
  })
  void ext // intentionally unused — kept for future filename-extension routing

  return NextResponse.json({
    messageId: msg.id,
    kind: isImage ? 'image' : 'file',
    url: blobUrl,
    name: file.name,
    mime,
    size: file.size,
  }, { headers })
}
