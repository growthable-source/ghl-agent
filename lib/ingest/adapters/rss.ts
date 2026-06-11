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
    // Native fetch — same outage-driven move as the docs adapter:
    // feed posts are almost always server-rendered articles, the
    // easiest case for the native extractor. Firecrawl remains a
    // thin-page fallback inside normalize().
    const { fetchPage } = await import('../native-web')
    const page = await fetchPage(item.identifier)
    if (page.status >= 400) throw new Error(`fetch ${page.status} for ${item.identifier}`)
    return {
      identifier: item.identifier,
      raw: { html: page.html, finalUrl: page.finalUrl },
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const payload = raw.raw as { html?: string; finalUrl?: string }
    if (!payload?.html) throw new Error('rss adapter: empty raw payload')

    const { extractMarkdownFromHtml, extractTitle } = await import('../native-web')
    let markdown = extractMarkdownFromHtml(payload.html)
    let title = extractTitle(payload.html)

    if (markdown.length < 200) {
      const apiKey = process.env.FIRECRAWL_API_KEY
      if (apiKey) {
        try {
          const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: payload.finalUrl || raw.identifier, formats: ['markdown'], onlyMainContent: true }),
          })
          if (res.ok) {
            const json = (await res.json()) as FirecrawlScrapeResponse
            if (json.success && json.data?.markdown) {
              markdown = json.data.markdown.trim()
              title = json.data.metadata?.title ?? title
            }
          }
        } catch {
          /* fallback only — native error below is the honest signal */
        }
      }
    }

    if (!markdown.trim() || markdown.length < 80) {
      throw new Error('rss adapter: post had no extractable text')
    }

    const sourceUrl = payload.finalUrl || raw.identifier
    let breadcrumbPath: string[] = []
    try {
      breadcrumbPath = new URL(sourceUrl).pathname.split('/').filter(Boolean)
    } catch { /* ignore */ }

    return {
      identifier: raw.identifier,
      sourceUrl,
      markdown,
      metadata: {
        page_title: title || sourceUrl,
        breadcrumb_path: breadcrumbPath,
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
