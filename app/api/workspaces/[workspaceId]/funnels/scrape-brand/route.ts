/**
 * GET /api/workspaces/[workspaceId]/funnels/scrape-brand?url=https://...
 *
 * Two-tier brand extractor:
 *   - "vision" tier (default when BROWSERBASE_API_KEY is set):
 *     real Chromium → screenshot → Claude Sonnet 4.6 vision →
 *     structured BrandAnalysis (colours, typography, photography
 *     style, voice tone + samples, design vibe). Plus persists
 *     the screenshot to Vercel Blob so the wizard can preview it
 *     and downstream Gemini calls can use it as a visual reference.
 *   - "scrape" tier (fallback): regex over fetched HTML — what we
 *     had before. No screenshot, no vision pass. Still works without
 *     Browserbase configured, just much weaker signal.
 *
 * Workspace-scoped (not campaign-scoped) — the wizard hits this
 * before the Campaign exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { scrapeBrandFromUrl } from '@/lib/brand-scrape'
import { isBrowserRenderEnabled, renderUrl } from '@/lib/brand-render'
import { analyseBrandFromScreenshot, type BrandAnalysis } from '@/lib/brand-vision'

export const dynamic = 'force-dynamic'
// Browser render + vision pass can take 20-40s on cold sessions.
export const maxDuration = 60

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url).searchParams.get('url')
  if (!url) return NextResponse.json({ error: '`url` query param required' }, { status: 400 })

  // ─── Vision tier (preferred) ───────────────────────────────────────
  if (isBrowserRenderEnabled()) {
    const rendered = await renderUrl(url)
    if (!rendered.ok) {
      return NextResponse.json({ tier: 'vision', error: rendered.error }, { status: 400 })
    }

    let screenshotUrl: string | null = null
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const buf = Buffer.from(rendered.screenshotBase64, 'base64')
        const path = `workspaces/${workspaceId}/brand-renders/${Date.now()}.png`
        const blob = await put(path, buf, {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'image/png',
        })
        screenshotUrl = blob.url
      } catch (err) {
        console.warn('[scrape-brand] screenshot Blob upload failed:', err instanceof Error ? err.message : err)
      }
    }

    let analysis: BrandAnalysis | null = null
    let analysisError: string | null = null
    try {
      analysis = await analyseBrandFromScreenshot({
        screenshotBase64: rendered.screenshotBase64,
        screenshotMime: rendered.screenshotMime,
        visibleText: rendered.textSamples,
        pageTitle: rendered.title,
        hostname: new URL(rendered.finalUrl).hostname,
      })
    } catch (err) {
      analysisError = err instanceof Error ? err.message : 'vision analysis failed'
      console.warn('[scrape-brand] vision analysis failed:', analysisError)
    }

    // Merge vision colours with computed-style colours so the operator
    // gets the broadest palette to choose from. Vision pick is canonical
    // (it's what a designer would identify as primary), computed-style
    // colours are extras.
    const swatches = mergeUnique([
      ...(analysis ? [analysis.primary_color, ...analysis.accent_colors] : []),
      ...rendered.computedColors,
    ])

    return NextResponse.json({
      tier: 'vision',
      ok: true,
      url: rendered.finalUrl,
      title: rendered.title,
      themeColor: analysis?.primary_color ?? null,
      extractedColors: swatches.slice(0, 8),
      textSamples: analysis?.voice_samples?.length ? analysis.voice_samples : rendered.textSamples,
      fontFamilies: rendered.fontFamilies,
      screenshotUrl,
      analysis,
      analysisError,
    })
  }

  // ─── Fallback: regex tier ──────────────────────────────────────────
  const result = await scrapeBrandFromUrl(url)
  if (!result.ok) return NextResponse.json({ tier: 'scrape', error: result.error }, { status: 400 })
  return NextResponse.json({ tier: 'scrape', ...result })
}

function mergeUnique(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of arr) {
    if (!c) continue
    const key = c.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c.trim())
  }
  return out
}
