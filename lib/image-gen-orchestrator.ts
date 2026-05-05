/**
 * Image-gen provider router.
 *
 * Calls into the highest-quality image provider that's configured for
 * this deployment, falling back to lower-quality ones automatically.
 * The route handler doesn't need to know which provider ran — it just
 * calls generateLandingImage() and gets a Blob URL back (or a clear
 * error message if every provider failed).
 *
 * Provider preference (best → cheapest):
 *   1. Replicate Flux 1.1 Pro Ultra (~$0.06/image, photorealistic)
 *   2. Gemini 2.5 Flash Image (~$0.04/image, fast, mediocre quality)
 *
 * If neither is configured, returns { ok: false, error } so the
 * caller can fall back to a gradient hero or skip the image entirely.
 */

import { generateAndUploadReplicate, isReplicateImageEnabled } from './image-gen-replicate'
import { generateAndUpload as generateAndUploadGemini, isGeminiImageEnabled } from './image-gen-gemini'

export interface LandingImageResult {
  ok: boolean
  url?: string
  /** Which provider actually generated the image. Useful for the
   *  diagnostic banner in the wizard. */
  provider?: 'replicate' | 'gemini'
  error?: string
}

export interface ProviderStatus {
  replicate: boolean
  gemini: boolean
}

export function getImageProviderStatus(): ProviderStatus {
  return {
    replicate: isReplicateImageEnabled(),
    gemini: isGeminiImageEnabled(),
  }
}

export async function generateLandingImage(args: {
  prompt: string
  aspect?: 'wide' | 'square' | 'portrait' | 'og'
  keyPrefix: string
  /** When the operator has uploaded a logo or we have a screenshot of
   *  their existing site, pass it through. Replicate's Flux uses it as
   *  a soft style reference; Gemini accepts multiple raster-format
   *  references but skips SVGs server-side. */
  referenceImageUrl?: string | null
  /** Multiple reference images for Gemini specifically (it accepts
   *  many; Flux accepts one). When present, the first is used by Flux
   *  and all are passed to Gemini. */
  geminiReferenceImages?: string[]
}): Promise<LandingImageResult> {
  // Preferred: Replicate Flux 1.1 Pro Ultra. Dramatically better
  // landing-page-grade output than nano-banana.
  if (isReplicateImageEnabled()) {
    const r = await generateAndUploadReplicate({
      prompt: args.prompt,
      aspect: args.aspect,
      keyPrefix: args.keyPrefix,
      referenceImageUrl: args.referenceImageUrl ?? null,
    })
    if (r.ok && r.url) return { ok: true, url: r.url, provider: 'replicate' }
    // Replicate failed (auth, quota, model 404, safety block) — log
    // and fall through to Gemini so the operator still gets *some*
    // image rather than nothing.
    console.warn('[image-orchestrator] Replicate failed, falling back to Gemini:', r.error)
    if (!isGeminiImageEnabled()) {
      return { ok: false, error: `Replicate: ${r.error ?? 'unknown'} (Gemini not configured for fallback)` }
    }
  }

  if (isGeminiImageEnabled()) {
    const r = await generateAndUploadGemini({
      prompt: args.prompt,
      aspect: args.aspect,
      keyPrefix: args.keyPrefix,
      referenceImages: args.geminiReferenceImages,
    })
    if (r.ok && r.url) return { ok: true, url: r.url, provider: 'gemini' }
    return { ok: false, error: `Gemini: ${r.error ?? 'unknown'}` }
  }

  return { ok: false, error: 'No image provider configured (set REPLICATE_API_TOKEN or GEMINI_API_KEY).' }
}
