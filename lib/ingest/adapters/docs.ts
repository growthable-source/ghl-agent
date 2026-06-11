/**
 * Docs / website adapter — native crawler, Firecrawl as fallback.
 *
 * History: this adapter was Firecrawl-only. In production every web
 * ingest then failed at once with 402 "insufficient credits" — a
 * metered third-party API in the critical path means "teach your AI
 * a website" breaks when a bill does. Now:
 *
 *   discover  → sitemap.xml first, same-host BFS link crawl second
 *               (lib/ingest/native-web). Zero external calls.
 *   fetch     → plain fetch with a browser-ish UA.
 *   normalize → boilerplate-stripped HTML → markdown. Only when the
 *               native extraction comes back thin (JS-rendered SPA)
 *               AND a FIRECRAWL_API_KEY is configured do we burn one
 *               Firecrawl scrape for that page.
 *
 * crawl_config shape (unchanged from the Firecrawl era):
 *   {
 *     recrawlIntervalDays: number   (default 7)
 *     includeSubpaths:     string[] (extra URLs to seed)
 *     excludePatterns:     string[] (regex; matching URLs dropped)
 *     maxPages:            number   (default 500, hard cap 2000)
 *     recursive:           boolean  (default true)
 *   }
 *
 * Page caps: 500 default / 2000 hard. Runs that can't finish inside
 * one function budget stop at the pipeline's soft deadline and the
 * ingest-queue cron queues a continuation — big sites complete across
 * ticks, with hash-matching making re-walked pages nearly free.
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'
import { fetchPage, extractMarkdownFromHtml, extractTitle, discoverSiteUrls } from '../native-web'

const DEFAULT_MAX_PAGES = 500
const HARD_MAX_PAGES = 2000

interface DocsCrawlConfig {
  recrawlIntervalDays?: number
  includeSubpaths?: string[]
  excludePatterns?: string[]
  maxPages?: number
  recursive?: boolean
}

interface RawDocsPayload {
  html: string
  finalUrl: string
}

export const docsAdapter: SourceAdapter = {
  sourceType: 'docs',

  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    const cfg = ctx.source.crawlConfig as DocsCrawlConfig
    const root = ctx.source.urlOrIdentifier
    const recursive = cfg.recursive !== false
    const maxPages = Math.max(1, Math.min(HARD_MAX_PAGES, cfg.maxPages ?? DEFAULT_MAX_PAGES))
    const explicit = (cfg.includeSubpaths ?? []).filter(u => typeof u === 'string' && u.length > 0)

    const excludeRegexes: RegExp[] = []
    for (const pattern of cfg.excludePatterns ?? []) {
      try {
        excludeRegexes.push(new RegExp(pattern))
      } catch {
        /* invalid pattern — skip rather than fail the crawl */
      }
    }

    let discovered: string[] = [root, ...explicit]
    if (recursive) {
      try {
        discovered = [...(await discoverSiteUrls(root, { maxPages })), ...explicit]
      } catch (err) {
        console.warn('[docs] discovery failed, falling back to root URL only:', err instanceof Error ? err.message : err)
        discovered = [root, ...explicit]
      }
    }

    const seen = new Set<string>()
    const out: DiscoveredItem[] = []
    for (const url of discovered) {
      if (!url || seen.has(url)) continue
      if (excludeRegexes.some(re => re.test(url))) continue
      seen.add(url)
      out.push({ identifier: url })
      if (out.length >= maxPages) break
    }
    return out
  },

  async fetch(_ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent> {
    const page = await fetchPage(item.identifier)
    if (page.status >= 400) {
      throw new Error(`fetch ${page.status} for ${item.identifier}`)
    }
    return {
      identifier: item.identifier,
      raw: { html: page.html, finalUrl: page.finalUrl } satisfies RawDocsPayload,
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const payload = raw.raw as RawDocsPayload
    if (!payload?.html) throw new Error('normalize: empty raw payload')

    let markdown = extractMarkdownFromHtml(payload.html)
    let title = extractTitle(payload.html)

    // Thin result usually means a JS-rendered SPA — the HTML shell
    // carries no content. One Firecrawl scrape (headless render) per
    // such page, only when a key is configured. A 402/missing key
    // degrades to the honest error below, never a silent empty chunk.
    if (markdown.length < 200) {
      const rescued = await firecrawlScrape(payload.finalUrl || raw.identifier)
      if (rescued) {
        markdown = rescued.markdown
        title = rescued.title ?? title
      }
    }

    if (!markdown.trim() || markdown.length < 80) {
      throw new Error('page had no extractable text (likely JS-rendered — configure FIRECRAWL_API_KEY for headless rendering)')
    }

    const sourceUrl = payload.finalUrl || raw.identifier
    let breadcrumbPath: string[] = []
    try {
      breadcrumbPath = new URL(sourceUrl).pathname.split('/').filter(Boolean)
    } catch {
      /* not a URL */
    }

    return {
      identifier: raw.identifier,
      sourceUrl,
      markdown,
      metadata: {
        page_title: title || sourceUrl,
        breadcrumb_path: breadcrumbPath,
        extractor: markdown.length >= 200 ? 'native' : 'firecrawl',
      },
    }
  },
}

/** One-page Firecrawl scrape. Null on ANY failure — fallback only. */
async function firecrawlScrape(url: string): Promise<{ markdown: string; title: string | null } | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    })
    if (!res.ok) {
      console.warn(`[docs] firecrawl fallback ${res.status} for ${url}`)
      return null
    }
    const json = (await res.json()) as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string } } }
    const markdown = (json.data?.markdown ?? '').trim()
    if (!json.success || !markdown) return null
    return { markdown, title: json.data?.metadata?.title ?? null }
  } catch {
    return null
  }
}
