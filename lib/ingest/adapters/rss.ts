/**
 * RSS / Atom adapter — blog, release notes, podcast show notes.
 *
 * discover() fetches the feed, parses item URLs (RSS <link>, Atom
 * <link href="..."/>), returns each as a DiscoveredItem.
 * fetch() + normalize() reuse Firecrawl's scrape for the actual
 * post body — feeds often only have summaries / first-paragraph
 * snippets, so scraping the full post yields better chunks.
 *
 * crawl_config:
 *   { recrawlIntervalDays: 1, maxItems: 100 }
 *
 * Feed parsing uses a regex pass against the raw XML — keeps the
 * adapter dependency-free. fast-xml-parser would be cleaner but
 * adds ~500kb to the bundle for two regex extractions.
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const DEFAULT_MAX_ITEMS = 100
const HARD_MAX_ITEMS = 500

interface RssCrawlConfig {
  recrawlIntervalDays?: number
  maxItems?: number
  excludePatterns?: string[]
}

interface FirecrawlScrapeResponse {
  success: boolean
  data?: {
    markdown?: string
    metadata?: {
      title?: string
      sourceURL?: string
      ogTitle?: string
      publishedTime?: string
      modifiedTime?: string
    }
  }
  error?: string
}

export const rssAdapter: SourceAdapter = {
  sourceType: 'rss',

  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    const cfg = ctx.source.crawlConfig as RssCrawlConfig
    const feedUrl = ctx.source.urlOrIdentifier
    const maxItems = Math.max(1, Math.min(HARD_MAX_ITEMS, cfg.maxItems ?? DEFAULT_MAX_ITEMS))

    const excludeRegexes: RegExp[] = []
    for (const pattern of cfg.excludePatterns ?? []) {
      try { excludeRegexes.push(new RegExp(pattern)) } catch { /* ignore bad pattern */ }
    }

    const res = await fetch(feedUrl, { headers: { 'User-Agent': 'Voxility-Ingest/1.0' } })
    if (!res.ok) throw new Error(`rss adapter: feed ${res.status} for ${feedUrl}`)
    const xml = await res.text()

    const urls = extractItemUrls(xml)
    if (urls.length === 0) {
      throw new Error('rss adapter: no <link> elements found in feed — is the URL pointing at a valid RSS/Atom document?')
    }

    const seen = new Set<string>()
    const out: DiscoveredItem[] = []
    for (const url of urls) {
      if (!url || seen.has(url)) continue
      if (excludeRegexes.some(re => re.test(url))) continue
      seen.add(url)
      out.push({ identifier: url })
      if (out.length >= maxItems) break
    }
    return out
  },

  async fetch(_ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY env var not set — rss adapter shares the docs scraper.')
    }

    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: item.identifier,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 300)}`)
    }
    const json = await res.json() as FirecrawlScrapeResponse
    if (!json.success || !json.data?.markdown) {
      throw new Error(`rss adapter: Firecrawl returned no markdown for ${item.identifier}`)
    }
    return {
      identifier: item.identifier,
      raw: json.data,
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const data = raw.raw as FirecrawlScrapeResponse['data']
    if (!data) throw new Error('rss adapter: empty raw payload')

    const markdown = (data.markdown ?? '').trim()
    if (!markdown) throw new Error('rss adapter: empty markdown after extraction')

    const sourceUrl = data.metadata?.sourceURL || raw.identifier
    const title = data.metadata?.title || data.metadata?.ogTitle || sourceUrl

    let breadcrumbPath: string[] = []
    try {
      const u = new URL(sourceUrl)
      breadcrumbPath = u.pathname.split('/').filter(Boolean)
    } catch { /* ignore */ }

    return {
      identifier: raw.identifier,
      sourceUrl,
      markdown,
      metadata: {
        page_title: title,
        breadcrumb_path: breadcrumbPath,
        page_last_updated: data.metadata?.modifiedTime || data.metadata?.publishedTime || null,
      },
    }
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function extractItemUrls(xml: string): string[] {
  const urls: string[] = []
  // RSS 2.0: <item><link>https://...</link></item>
  const rssRe = /<item\b[^>]*>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g
  let m: RegExpExecArray | null
  while ((m = rssRe.exec(xml)) !== null) {
    urls.push(unescapeXml(m[1].trim()))
  }
  if (urls.length > 0) return urls

  // Atom: <entry><link href="https://..."/></entry>
  const atomRe = /<entry\b[^>]*>[\s\S]*?<link\b[^>]*\bhref="([^"]+)"[^>]*\/?>[\s\S]*?<\/entry>/g
  while ((m = atomRe.exec(xml)) !== null) {
    urls.push(unescapeXml(m[1].trim()))
  }
  return urls
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
