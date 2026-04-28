import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

const MAX_SIZE_BYTES = 10 * 1024 * 1024
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic'])
const FILE_MIME = new Set([
  'application/pdf',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

/**
 * Operator-side attachment upload — mirrors the widget-side upload but
 * authenticates via the dashboard session and posts the resulting message
 * with role='agent' + fromHuman=true. Same Blob path layout, same MIME
 * allowlist, same broadcast shape.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'BLOB_READ_WRITE_TOKEN not set' }, { status: 500 })
  }

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true, widgetId: true, status: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `Max ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB` }, { status: 413 })
  }
  const mime = (file.type || '').toLowerCase()
  const isImage = IMAGE_MIME.has(mime)
  const isFile = FILE_MIME.has(mime)
  if (!isImage && !isFile) {
    return NextResponse.json({ error: `Unsupported MIME: ${mime}` }, { status: 415 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `widgets/${convo.widgetId}/${conversationId}/op-${Date.now()}-${safeName}`
  const blob = await put(path, file, {
    access: 'public',
    addRandomSuffix: false,
    contentType: file.type,
  })

  const content = isImage
    ? blob.url
    : JSON.stringify({ url: blob.url, name: file.name, mime, size: file.size })
  const msg = await db.widgetMessage.create({
    data: { conversationId, role: 'agent', content, kind: isImage ? 'image' : 'file' },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      ...(convo.status === 'active' ? { status: 'handed_off' } : {}),
    },
  })
  broadcast(conversationId, {
    type: 'agent_message',
    id: msg.id,
    content,
    kind: isImage ? 'image' : 'file',
    createdAt: msg.createdAt.toISOString(),
    fromHuman: true,
  })

  return NextResponse.json({ messageId: msg.id, kind: isImage ? 'image' : 'file', url: blob.url, name: file.name })
}
