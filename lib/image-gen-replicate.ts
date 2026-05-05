/**
 * Replicate-hosted high-quality image generation.
 *
 * Flux 1.1 Pro Ultra is the current state-of-the-art for landing-page-
 * grade photorealistic imagery (~$0.06/image). Massively better output
 * than Gemini 2.5 Flash Image / nano-banana for the "magazine cover"
 * bar that landing page heroes need.
 *
 * Returns null on every failure so the caller can fall back to Gemini
 * without try/catch. The detailed variant returns { ok, image, error }
 * if the caller wants to surface why.
 *
 * Auth: REPLICATE_API_TOKEN. If unset, isReplicateImageEnabled() is
 * false and the orchestrator skips this provider.
 *
 * Sync model: we use `Prefer: wait` on the Replicate API, which blocks
 * up to 60s for the prediction to finish. Flux 1.1 Pro Ultra typically
 * completes in 4–10s, well within budget. No polling, no webhooks.
 */

const REPLICATE_API = 'https://api.replicate.com/v1'
// Flux 1.1 Pro Ultra — Black Forest Labs' top-tier model on Replicate.
// Override via env for A/B against Recraft V3, Imagen 4 Ultra, etc.
const REPLICATE_MODEL = process.env.REPLICATE_IMAGE_MODEL ?? 'black-forest-labs/flux-1.1-pro-ultra'

export interface ReplicateImage {
  base64: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
}

export interface ReplicateImageResult {
  ok: boolean
  image?: ReplicateImage
  error?: string
}

export function isReplicateImageEnabled(): boolean {
  return !!process.env.REPLICATE_API_TOKEN
}

export async function generateReplicateImage(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  /** When set, becomes Flux's image_prompt input (img2img-style style
   *  conditioning). The model uses it as a SOFT visual reference for
   *  composition + style, not literal copy. Public URL only — Flux
   *  pulls the image server-side. */
  referenceImageUrl?: string | null
}): Promise<ReplicateImageResult> {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) return { ok: false, error: 'REPLICATE_API_TOKEN not set' }

  const aspectRatio = aspectRatioFor(args.aspect)
  const body: Record<string, unknown> = {
    input: {
      prompt: args.prompt,
      aspect_ratio: aspectRatio,
      output_format: 'png',
      // safety_tolerance 1-6, 6 is most permissive. Landing page hero
      // photography sometimes triggers conservative defaults around
      // people. 5 is the highest stable value.
      safety_tolerance: 5,
      // raw=true skews toward natural/editorial photography (less
      // hyper-stylised AI look). Worth the trade for landing-page work.
      raw: true,
    },
  }
  if (args.referenceImageUrl) {
    (body.input as Record<string, unknown>).image_prompt = args.referenceImageUrl
  }

  let res: Response
  try {
    res = await fetch(`${REPLICATE_API}/models/${REPLICATE_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Block up to 60s for the prediction to finish — Flux 1.1 Pro
        // Ultra usually finishes in <10s. Without this header we'd
        // need to poll, which is wasteful for our single-image flow.
        Prefer: 'wait=60',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, error: `network: ${err instanceof Error ? err.message : err}` }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let reason = `HTTP ${res.status}`
    try {
      const json = JSON.parse(text)
      if (json?.detail) reason = `HTTP ${res.status}: ${typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail)}`
      else if (json?.error) reason = `HTTP ${res.status}: ${json.error}`
    } catch {
      if (text) reason = `HTTP ${res.status}: ${text.slice(0, 200)}`
    }
    return { ok: false, error: reason }
  }

  let prediction: {
    status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    output?: string | string[]
    error?: string | null
    urls?: { get?: string }
    id?: string
  }
  try {
    prediction = await res.json()
  } catch {
    return { ok: false, error: 'Replicate response was not JSON' }
  }

  // Prefer:wait can return before completion if the model takes >60s;
  // poll the prediction URL a few more times before giving up.
  if (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.urls?.get) {
    const polled = await pollPrediction(prediction.urls.get, token)
    prediction = polled ?? prediction
  }

  if (prediction.status !== 'succeeded') {
    return { ok: false, error: prediction.error || `prediction status=${prediction.status ?? 'unknown'}` }
  }

  const outUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
  if (!outUrl || typeof outUrl !== 'string') {
    return { ok: false, error: 'Replicate succeeded but returned no image URL' }
  }

  // Fetch the binary so the caller can upload to Vercel Blob.
  // Replicate's URLs expire after 24h so we don't want to serve them
  // directly from production pages.
  let img: Response
  try {
    img = await fetch(outUrl)
  } catch (err) {
    return { ok: false, error: `output fetch: ${err instanceof Error ? err.message : err}` }
  }
  if (!img.ok) return { ok: false, error: `output fetch HTTP ${img.status}` }
  const buf = Buffer.from(await img.arrayBuffer())
  const mimeHeader = img.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/png'
  const mimeType: ReplicateImage['mimeType'] =
    mimeHeader === 'image/jpeg' || mimeHeader === 'image/webp' ? mimeHeader : 'image/png'
  return { ok: true, image: { base64: buf.toString('base64'), mimeType } }
}

/** Convenience: generate via Replicate + upload to Vercel Blob. */
export async function generateAndUploadReplicate(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  keyPrefix: string
  referenceImageUrl?: string | null
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, error: 'BLOB_READ_WRITE_TOKEN not set' }
  }
  const r = await generateReplicateImage({
    prompt: args.prompt,
    aspect: args.aspect,
    referenceImageUrl: args.referenceImageUrl,
  })
  if (!r.ok || !r.image) return { ok: false, error: r.error ?? 'unknown_image_gen_failure' }
  try {
    const { put } = await import('@vercel/blob')
    const buffer = Buffer.from(r.image.base64, 'base64')
    const ext = r.image.mimeType === 'image/jpeg' ? 'jpg' : r.image.mimeType === 'image/webp' ? 'webp' : 'png'
    const blob = await put(`${args.keyPrefix}-${Date.now()}.${ext}`, buffer, {
      access: 'public',
      contentType: r.image.mimeType,
    })
    return { ok: true, url: blob.url }
  } catch (err) {
    return { ok: false, error: `blob_put_failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

interface PredictionPayload {
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: string | string[]
  error?: string | null
  urls?: { get?: string }
}

async function pollPrediction(getUrl: string, token: string): Promise<PredictionPayload | undefined> {
  // Poll every 2s for up to 60 more seconds. Keeps total ceiling
  // around 2 minutes — well under any cron-style timeout.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const p = await fetchPrediction(getUrl, token)
    if (!p) continue
    if (p.status === 'succeeded' || p.status === 'failed' || p.status === 'canceled') return p
  }
  return undefined
}

async function fetchPrediction(getUrl: string, token: string): Promise<PredictionPayload | undefined> {
  try {
    const r = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return undefined
    return (await r.json()) as PredictionPayload
  } catch {
    return undefined
  }
}

function aspectRatioFor(aspect?: 'wide' | 'square' | 'portrait' | 'og'): string {
  switch (aspect) {
    case 'wide':     return '16:9'
    case 'og':       return '16:9' // closest supported
    case 'portrait': return '3:4'
    case 'square':   return '1:1'
    default:         return '16:9'
  }
}
