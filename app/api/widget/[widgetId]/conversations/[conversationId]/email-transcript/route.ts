import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

/**
 * POST /api/widget/:widgetId/conversations/:conversationId/email-transcript
 * Body: { email }
 *
 * Sends the visitor a copy of their conversation. Useful for
 * compliance ("send me a copy of what we agreed") and for visitors
 * who want a permanent record they can search later.
 *
 * Emails are sent via the existing Resend integration the rest of the
 * platform uses (RESEND_API_KEY + NOTIFICATION_FROM_EMAIL).
 */

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

function renderHtml(params: {
  brandName: string
  primaryColor: string
  messages: Array<{ role: string; content: string; kind: string; createdAt: Date }>
}): string {
  const rows = params.messages.map(m => {
    const time = new Date(m.createdAt).toLocaleString()
    const isVisitor = m.role === 'visitor'
    const align = isVisitor ? 'right' : 'left'
    const bg = isVisitor ? params.primaryColor : '#f4f4f5'
    const fg = isVisitor ? '#ffffff' : '#111827'
    let body = ''
    if (m.kind === 'image') {
      body = `<img src="${escapeHtml(m.content)}" alt="" style="max-width:280px;border-radius:8px;display:block;" />`
    } else if (m.kind === 'file') {
      try {
        const meta = JSON.parse(m.content) as { url: string; name: string }
        body = `📎 <a href="${escapeHtml(meta.url)}" style="color:inherit;text-decoration:underline;">${escapeHtml(meta.name)}</a>`
      } catch {
        body = `📎 <a href="${escapeHtml(m.content)}" style="color:inherit;">attachment</a>`
      }
    } else if (m.role === 'system') {
      return `<tr><td colspan="2" style="padding:6px 0;text-align:center;color:#9ca3af;font-size:11px;font-style:italic;">${escapeHtml(m.content)}</td></tr>`
    } else {
      body = escapeHtml(m.content).replace(/\n/g, '<br/>')
    }
    return `<tr><td style="padding:6px 0;text-align:${align};">
      <div style="display:inline-block;background:${bg};color:${fg};padding:10px 14px;border-radius:14px;max-width:80%;text-align:left;font-size:14px;line-height:1.5;">${body}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px;text-align:${align};">${escapeHtml(time)}</div>
    </td></tr>`
  }).join('\n')

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <tr><td style="padding:24px 28px;border-top:4px solid ${params.primaryColor};">
          <h1 style="margin:0 0 4px;font-size:18px;color:#111827;font-weight:600;">Your conversation with ${escapeHtml(params.brandName)}</h1>
          <p style="margin:0 0 18px;font-size:12px;color:#6b7280;">Here's a copy of what you talked about, for your records.</p>
          <table role="presentation" width="100%">${rows}</table>
        </td></tr>
        <tr><td style="padding:14px 28px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;">Powered by Voxility</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400, headers })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      error: 'Email delivery not configured. Operator: set RESEND_API_KEY.',
    }, { status: 500, headers })
  }
  const from = process.env.NOTIFICATION_FROM_EMAIL || 'Voxility <notifications@voxility.app>'

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    include: { widget: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers })

  const messages = await db.widgetMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })
  if (messages.length === 0) {
    return NextResponse.json({ error: 'Nothing to send yet — start a chat first.' }, { status: 400, headers })
  }

  const html = renderHtml({
    brandName: convo.widget.name || 'us',
    primaryColor: convo.widget.primaryColor || '#fa4d2e',
    messages,
  })
  const text = messages.map(m => {
    const who = m.role === 'visitor' ? 'You' : m.role === 'agent' ? 'Agent' : '—'
    const body = m.kind === 'image' ? `[image: ${m.content}]`
      : m.kind === 'file' ? `[file: ${m.content}]`
      : m.content
    return `${who}: ${body}`
  }).join('\n\n')

  const subject = `Your chat with ${convo.widget.name || 'us'}`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [email], subject, html, text }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      return NextResponse.json({ error: `Email send failed: ${errBody.slice(0, 200)}` }, { status: 502, headers })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Email send failed' }, { status: 502, headers })
  }

  return NextResponse.json({ ok: true, sentTo: email }, { headers })
}
