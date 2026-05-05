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
// GA'd as gemini-2.5-flash-image — dropped the -preview suffix.
// Override via env if a newer name ships before this code is updated.
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'

export interface GeneratedImage {
  /** Base64-encoded image bytes (PNG, no data: prefix). */
  base64: string
  /** MIME type Gemini reported. Almost always 'image/png'. */
  mimeType: string
}

/** Result wrapper for callers that want to know WHY a generation
 *  failed (caller wants to surface it to the operator). The plain
 *  generateImage() helper still returns null-on-failure for backward
 *  compatibility with the simpler call sites. */
export interface GenerateImageResult {
  ok: boolean
  image?: GeneratedImage
  error?: string
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
  const r = await generateImageDetailed(args)
  return r.ok ? (r.image ?? null) : null
}

/** Same as generateImage but returns a structured result with an
 *  error reason on failure, so the caller can surface "0/3 images
 *  generated — reason X" to the operator instead of swallowing. */
export async function generateImageDetailed(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  referenceImages?: string[]
}): Promise<GenerateImageResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not set' }

  // Fetch reference images and convert to inline base64 parts. Each
  // fetch is wrapped — a 404, oversized payload, or unsupported MIME
  // shouldn't kill the whole image gen, we just drop it from the
  // parts list and continue with the text prompt only.
  //
  // Gemini's vision input only accepts raster formats — SVG, GIF,
  // HEIC, etc. all return HTTP 400 "Unsupported MIME type" and sink
  // the entire generateContent call. So we filter aggressively.
  const GEMINI_SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
  const refParts: Array<{ inlineData: { mimeType: string; data: string } }> = []
  for (const refUrl of args.referenceImages ?? []) {
    try {
      const r = await fetch(refUrl)
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      // Cap at 4MB per reference — Gemini limits the request payload
      // and oversized refs (uncompressed PNGs) will reject the call.
      if (buf.byteLength > 4 * 1024 * 1024) continue
      const rawMime = r.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'image/png'
      if (!GEMINI_SUPPORTED_MIME.has(rawMime)) {
        console.warn(`[gemini-image] skipping reference ${refUrl} — unsupported MIME ${rawMime} (Gemini accepts PNG/JPEG/WebP only). Falling back to text-only prompt.`)
        continue
      }
      refParts.push({ inlineData: { mimeType: rawMime, data: buf.toString('base64') } })
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
            { text: args.prompt },
          ],
        }],
        // imageConfig.aspectRatio is the native aspect knob (GA'd
        // alongside the gemini-2.5-flash-image release). responseModalities
        // forces image-out so the model doesn't return a text description
        // when the prompt is ambiguous.
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: aspectRatioFor(args.aspect) },
        },
      }),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network_error'
    console.warn('[gemini-image] network error:', reason)
    return { ok: false, error: `network: ${reason}` }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let reason = `HTTP ${res.status}`
    try {
      const json = JSON.parse(body)
      if (json?.error?.message) reason = `HTTP ${res.status}: ${json.error.message}`
    } catch {
      if (body) reason = `HTTP ${res.status}: ${body.slice(0, 200)}`
    }
    console.warn(`[gemini-image] ${reason}`)
    return { ok: false, error: reason }
  }

  let json: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string }
          inline_data?: { mime_type?: string; data?: string }
          text?: string
        }>
      }
      finishReason?: string
    }>
    promptFeedback?: { blockReason?: string }
  }
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: 'response was not JSON' }
  }

  // Surface safety blocks explicitly — Gemini sometimes blocks
  // photographic prompts ("real people") and returns 200 with no
  // inline data. The blockReason in promptFeedback explains why.
  if (json.promptFeedback?.blockReason) {
    return { ok: false, error: `blocked: ${json.promptFeedback.blockReason}` }
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
      return { ok: true, image: { base64: inline.data, mimeType } }
    }
  }
  // No inline data — finishReason explains why (often SAFETY or
  // MAX_TOKENS for the rare cases the model ran out without emitting).
  const finish = json.candidates?.[0]?.finishReason
  return { ok: false, error: finish ? `no image returned (finishReason=${finish})` : 'no image returned' }
}

/** Map our internal aspect labels to the native imageConfig.aspectRatio
 *  enum. Gemini accepts a small fixed set; '16:9' and '1.91:1' (the
 *  Open Graph aspect) are the relevant ones for landing-page imagery. */
function aspectRatioFor(aspect?: 'wide' | 'square' | 'portrait' | 'og'): string {
  switch (aspect) {
    case 'wide':     return '16:9'
    case 'og':       return '16:9' // closest supported value to 1.91:1
    case 'portrait': return '3:4'
    case 'square':   return '1:1'
    default:         return '16:9'
  }
}

/**
 * Convenience: generate + upload to Vercel Blob in one shot. Returns
 * the public URL or null on failure / no Blob token.
 *
 * Caller passes a `keyPrefix` like `landing/<pageId>/hero` so the
 * resulting Blob path is debuggable.
 */
export interface GenerateAndUploadResult {
  ok: boolean
  url?: string
  error?: string
}

export async function generateAndUpload(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  keyPrefix: string
  referenceImages?: string[]
}): Promise<GenerateAndUploadResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, error: 'BLOB_READ_WRITE_TOKEN not set' }
  }
  const r = await generateImageDetailed({
    prompt: args.prompt,
    aspect: args.aspect,
    referenceImages: args.referenceImages,
  })
  if (!r.ok || !r.image) return { ok: false, error: r.error ?? 'unknown_image_gen_failure' }
  try {
    const { put } = await import('@vercel/blob')
    const buffer = Buffer.from(r.image.base64, 'base64')
    const ext = r.image.mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const blob = await put(`${args.keyPrefix}-${Date.now()}.${ext}`, buffer, {
      access: 'public',
      contentType: r.image.mimeType,
    })
    return { ok: true, url: blob.url }
  } catch (err) {
    return { ok: false, error: `blob_put_failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
