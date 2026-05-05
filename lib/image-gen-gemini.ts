/**
 * Gemini 2.5 Flash Image (codename "nano-banana") wrapper.
 *
 * Generates landing-page imagery from text prompts. Returns base64 PNG
 * bytes the caller can upload to Vercel Blob (or any other store) and
 * reference from the rendered page.
 *
 * Why raw fetch and not @google/generative-ai? The SDK pulls in a hefty
 * tree-shake-resistant dependency for what's a single REST call. Raw
 * fetch is one function and zero dependencies.
 *
 * Auth model:
 *   - GEMINI_API_KEY env var. Get one at aistudio.google.com.
 *   - If missing, generate*() helpers all return null without throwing —
 *     the caller (lib/vsl-generator) treats null as "no image, render
 *     the text-only fallback". Landing-page generation never breaks
 *     because of an image-gen failure.
 *
 * Cost: roughly $0.039 per image as of 2026-04. Three images per page
 * (hero + offer bg + OG) = ~$0.12 / page. Worth it for the visual lift.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image-preview'

export interface GeneratedImage {
  /** Base64-encoded image bytes (PNG, no data: prefix). */
  base64: string
  /** MIME type Gemini reported. Almost always 'image/png'. */
  mimeType: string
}

/** Returns true if Gemini image gen is configured for this deployment. */
export function isGeminiImageEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/**
 * Generate a single image from a text prompt. Returns null on any
 * failure (missing key, API error, model returned no inline data) so
 * the caller can fall back without try/catch.
 *
 * `aspect` is a hint baked into the prompt — Gemini doesn't expose a
 * native aspect-ratio knob on this model, but giving it explicit
 * dimensions in the prompt tilts output toward that shape.
 *
 * `referenceImages` is an optional list of public image URLs (logos,
 * brand inspo, the operator's existing hero photo). They're fetched
 * and inlined into the request as additional `parts` so Gemini can
 * key its output to brand visuals — colour, style, mark — instead of
 * inventing a vibe.
 */
export async function generateImage(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  referenceImages?: string[]
}): Promise<GeneratedImage | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const aspectHint = aspectPromptHint(args.aspect)
  const fullPrompt = `${args.prompt}\n\n${aspectHint}`

  // Fetch reference images and convert to inline base64 parts. Each
  // fetch is wrapped — a 404 on one reference shouldn't kill the
  // whole image gen, we just drop it from the parts list.
  const refParts: Array<{ inlineData: { mimeType: string; data: string } }> = []
  for (const refUrl of args.referenceImages ?? []) {
    try {
      const r = await fetch(refUrl)
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      // Cap at 4MB per reference — Gemini limits the request payload
      // and oversized refs (uncompressed PNGs) will reject the call.
      if (buf.byteLength > 4 * 1024 * 1024) continue
      const mimeType = r.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
      refParts.push({ inlineData: { mimeType, data: buf.toString('base64') } })
    } catch {
      // Skip silently — operator-supplied URL might be on a CDN that
      // 403s us, that's fine.
    }
  }

  const url = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            // Reference images come FIRST so the prompt is "look at
            // these, then generate matching X" rather than the other
            // way around (which Gemini sometimes ignores).
            ...refParts,
            { text: fullPrompt },
          ],
        }],
        generationConfig: {
          // Image-out only. Without this the model may return text
          // describing the image instead of bytes.
          responseModalities: ['IMAGE'],
        },
      }),
    })
  } catch (err) {
    console.warn('[gemini-image] network error:', err instanceof Error ? err.message : err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`[gemini-image] HTTP ${res.status} — ${body.slice(0, 300)}`)
    return null
  }

  let json: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string }
          inline_data?: { mime_type?: string; data?: string }
        }>
      }
    }>
  }
  try {
    json = await res.json()
  } catch {
    return null
  }

  // Gemini occasionally returns either inlineData (camelCase, the docs
  // version) or inline_data (snake_case, what some preview routes
  // shipped with). Check both before giving up.
  for (const cand of json.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const inline = part.inlineData ?? (part.inline_data as { mime_type?: string; data?: string } | undefined)
      if (!inline?.data) continue
      const mimeType =
        (part.inlineData?.mimeType ?? (part.inline_data as { mime_type?: string } | undefined)?.mime_type) ?? 'image/png'
      return { base64: inline.data, mimeType }
    }
  }
  return null
}

function aspectPromptHint(aspect?: 'wide' | 'square' | 'portrait' | 'og'): string {
  switch (aspect) {
    case 'wide':
      return 'Output a wide 16:9 photograph suitable for a hero banner. No text overlays, no logos, no watermarks.'
    case 'og':
      return 'Output a 1200x630 image suitable for an Open Graph social preview. Simple, bold composition. No text overlays. Brand-color tints welcome.'
    case 'portrait':
      return 'Output a tall 3:4 photograph. Minimal background. No text overlays.'
    case 'square':
      return 'Output a 1:1 square image suitable for a small icon-style illustration. Flat, modern, single subject. No text overlays. Brand-color background welcome.'
    default:
      return 'No text overlays, no logos, no watermarks.'
  }
}

/**
 * Convenience: generate + upload to Vercel Blob in one shot. Returns
 * the public URL or null on failure / no Blob token.
 *
 * Caller passes a `keyPrefix` like `landing/<pageId>/hero` so the
 * resulting Blob path is debuggable.
 */
export async function generateAndUpload(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  keyPrefix: string
  referenceImages?: string[]
}): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[gemini-image] BLOB_READ_WRITE_TOKEN missing — cannot persist generated image')
    return null
  }
  const img = await generateImage({
    prompt: args.prompt,
    aspect: args.aspect,
    referenceImages: args.referenceImages,
  })
  if (!img) return null
  // Lazy-import @vercel/blob so build environments without the package
  // installed (none currently, but keeps this file self-contained)
  // surface a useful error rather than a missing-module crash.
  const { put } = await import('@vercel/blob')
  const buffer = Buffer.from(img.base64, 'base64')
  const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const blob = await put(`${args.keyPrefix}-${Date.now()}.${ext}`, buffer, {
    access: 'public',
    contentType: img.mimeType,
  })
  return blob.url
}
