/**
 * End-to-end brand scrape pipeline: Browserbase render → Vercel Blob
 * upload → Sonnet 4.6 vision analysis. Used by:
 *   - Funnel POST (implicit on creation when reference_url is set)
 *   - The /scrape-brand route (still around for ad-hoc previews)
 *   - The campaign detail page's "rescan brand" action
 *
 * Persists nothing — the caller decides where the result goes
 * (Campaign.brandScreenshotUrl + brandAnalysis, or the ephemeral
 * wizard JSON response).
 *
 * Safe to call when Browserbase is unconfigured: returns ok:false with
 * a typed reason so the caller can fall back to the regex scraper.
 */

import { put } from '@vercel/blob'
import { isBrowserRenderEnabled, renderUrl } from './brand-render'
import { analyseBrandFromScreenshot, type BrandAnalysis } from './brand-vision'

export interface BrandScrapePipelineSuccess {
  ok: true
  finalUrl: string
  pageTitle: string
  /** Public Vercel Blob URL of the rendered screenshot (so vision /
   *  image-gen can use it as a reference). null when BLOB_READ_WRITE_TOKEN
   *  is missing — the analysis still runs from the in-memory base64. */
  screenshotUrl: string | null
  analysis: BrandAnalysis
  /** Computed-style colours pulled from the live DOM. Useful even
   *  alongside analysis.accent_colors — gives the operator a wider
   *  palette to choose from in the wizard. */
  computedColors: string[]
  textSamples: string[]
  fontFamilies: string[]
}

export interface BrandScrapePipelineFailure {
  ok: false
  /** Why we couldn't run the vision tier. The caller can choose to
   *  fall back to the regex scraper or just degrade silently. */
  reason: 'not_configured' | 'render_failed' | 'analysis_failed'
  error?: string
}

interface PipelineArgs {
  url: string
  /** Path prefix for the Blob upload — typically
   *  `workspaces/<wsId>/brand-renders` or
   *  `workspaces/<wsId>/campaigns/<campaignId>`. */
  blobPathPrefix: string
}

export async function runBrandScrapePipeline(args: PipelineArgs): Promise<BrandScrapePipelineSuccess | BrandScrapePipelineFailure> {
  if (!isBrowserRenderEnabled()) {
    return { ok: false, reason: 'not_configured', error: 'Browserbase not configured' }
  }

  const rendered = await renderUrl(args.url)
  if (!rendered.ok) {
    return { ok: false, reason: 'render_failed', error: rendered.error }
  }

  let screenshotUrl: string | null = null
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const path = `${args.blobPathPrefix.replace(/\/+$/, '')}/${Date.now()}.png`
      const buf = Buffer.from(rendered.screenshotBase64, 'base64')
      const blob = await put(path, buf, {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'image/png',
      })
      screenshotUrl = blob.url
    } catch (err) {
      console.warn('[brand-scrape-pipeline] blob upload failed:', err instanceof Error ? err.message : err)
    }
  }

  let analysis: BrandAnalysis
  try {
    analysis = await analyseBrandFromScreenshot({
      screenshotBase64: rendered.screenshotBase64,
      screenshotMime: rendered.screenshotMime,
      visibleText: rendered.textSamples,
      pageTitle: rendered.title,
      hostname: new URL(rendered.finalUrl).hostname,
    })
  } catch (err) {
    return { ok: false, reason: 'analysis_failed', error: err instanceof Error ? err.message : 'analysis failed' }
  }

  // Stash the actual font names detected from the rendered DOM. The
  // renderer loads these via Google Fonts so the generated page uses
  // the operator's real typography rather than a hardcoded fallback.
  if (rendered.fontFamilies && rendered.fontFamilies.length > 0) {
    analysis.font_families = rendered.fontFamilies
  }

  return {
    ok: true,
    finalUrl: rendered.finalUrl,
    pageTitle: rendered.title,
    screenshotUrl,
    analysis,
    computedColors: rendered.computedColors,
    textSamples: rendered.textSamples,
    fontFamilies: rendered.fontFamilies,
  }
}
