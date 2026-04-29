import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * POST — analyze a brand logo with Claude Vision. Two input shapes
 * supported so the modal works whether or not Blob storage is wired:
 *
 *   1. JSON body: { imageUrl: 'https://…' }  → URL source
 *   2. multipart with `file` field           → base64 source (no Blob
 *                                              required, file never
 *                                              persists server-side)
 *
 * Returns:
 *   {
 *     primaryColor: '#hex',
 *     accentColors: ['#hex', '#hex', '#hex'],
 *     style: 'short style descriptor',
 *     suggestedName?: 'company name if legible in the logo'
 *   }
 *
 * Uses Haiku — color/style extraction is a simple visual task. Failure
 * modes are non-fatal — the brand creation flow still works if vision
 * is down; the user just doesn't get suggestions.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      error: 'Vision unavailable — ANTHROPIC_API_KEY not configured.',
      code: 'VISION_NOT_CONFIGURED',
    }, { status: 503 })
  }

  // Branch on content-type. multipart/form-data → file path; anything
  // else → JSON path with imageUrl. The file path is what the modal
  // falls back to when Blob isn't configured — it sends the raw bytes
  // and we forward them to Claude as base64 without persisting.
  const contentType = req.headers.get('content-type') || ''
  let imageSource: any
  if (contentType.includes('multipart/form-data')) {
    let form: FormData
    try { form = await req.formData() } catch {
      return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing `file` field' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large for analysis (max 5 MB).' }, { status: 413 })
    }
    const buf = Buffer.from(await file.arrayBuffer())
    const mediaType = file.type && file.type.startsWith('image/') ? file.type : 'image/png'
    imageSource = {
      type: 'base64',
      media_type: mediaType,
      data: buf.toString('base64'),
    }
  } else {
    let body: any = {}
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : ''
    if (!imageUrl) return NextResponse.json({ error: 'imageUrl required' }, { status: 400 })
    if (!/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: 'imageUrl must be an http(s) URL' }, { status: 400 })
    }
    imageSource = { type: 'url', url: imageUrl }
  }

  const client = new Anthropic()
  let response: any
  try {
    response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: imageSource } as any,
            {
              type: 'text',
              text: `You are analyzing a brand logo to suggest the brand's identity colors for an operator inbox UI.

Return ONLY a JSON object — no preamble, no markdown fences, no explanation. Shape:

{
  "primaryColor": "#rrggbb",
  "accentColors": ["#rrggbb", "#rrggbb", "#rrggbb"],
  "style": "short two- or three-word style descriptor",
  "suggestedName": "company name visible in the logo, or null if not legible"
}

Rules:
- primaryColor: the single most prominent / recognisable brand colour, the one a customer would point at and say "that's their colour". Avoid pure white or pure black unless the logo is genuinely monochrome.
- accentColors: 2–3 supporting colours pulled from the logo (up to 3). Distinct from primaryColor. Order by prominence.
- style: choose phrases like "modern, bold", "playful, friendly", "minimal, professional", "vintage, warm", "high-contrast, technical".
- suggestedName: only if a wordmark or company name is clearly readable in the image. Null otherwise.
- Hex codes lowercase, with the # prefix.

Return JSON only.`,
            },
          ],
        },
      ],
    })
  } catch (err: any) {
    console.warn('[brand analyze] vision call failed:', err?.message)
    return NextResponse.json({
      error: 'Vision analysis failed. The brand will save without suggested colours.',
      detail: err?.message,
    }, { status: 502 })
  }

  // Pull the text content out of the response. Claude returns content
  // blocks; the first text block is what we want.
  const text = (response.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()

  let parsed: any
  try {
    // Strip any accidental code fences (```json … ```) just in case
    // the model didn't follow instructions perfectly.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({
      error: 'Vision returned a malformed response. The brand will save without suggested colours.',
      raw: text.slice(0, 300),
    }, { status: 502 })
  }

  // Sanity-shape the response so the UI can rely on the structure.
  const HEX_RE = /^#[0-9a-f]{6}$/i
  const primaryColor = typeof parsed.primaryColor === 'string' && HEX_RE.test(parsed.primaryColor)
    ? parsed.primaryColor.toLowerCase() : null
  const accentColors = Array.isArray(parsed.accentColors)
    ? parsed.accentColors.filter((c: unknown) => typeof c === 'string' && HEX_RE.test(c)).map((c: string) => c.toLowerCase()).slice(0, 3)
    : []
  const style = typeof parsed.style === 'string' ? parsed.style.trim().slice(0, 80) : null
  const suggestedName = typeof parsed.suggestedName === 'string' && parsed.suggestedName.trim()
    ? parsed.suggestedName.trim().slice(0, 80)
    : null

  if (!primaryColor && accentColors.length === 0) {
    return NextResponse.json({
      error: 'Could not extract any colours from this image.',
    }, { status: 422 })
  }

  return NextResponse.json({
    primaryColor,
    accentColors,
    style,
    suggestedName,
  })
}
