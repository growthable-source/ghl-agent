/**
 * Native web fetching + extraction — no third-party crawler API.
 *
 * Born from a production outage: every web ingest failed with
 * Firecrawl 402 "insufficient credits". A paid metered API in the
 * critical path of "teach your AI a website" means knowledge breaks
 * when a bill does. This module does the 90% case for free:
 *
 *   - fetchPage()              direct fetch, browser-ish UA, timeout
 *   - extractMarkdownFromHtml() boilerplate-stripped HTML → markdown
 *   - discoverSiteUrls()       sitemap.xml first, BFS link crawl second
 *
 * The extractor is regex-based on purpose — no DOM dependency, runs
 * anywhere, unit-testable. It will not beat a headless browser on
 * JS-rendered SPAs; the docs adapter keeps Firecrawl as an OPTIONAL
 * per-page fallback when native extraction comes back thin and a key
 * is configured.
 */

const FETCH_TIMEOUT_MS = 15_000
const UA =
  'Mozilla/5.0 (compatible; VoxilityBot/1.0; +https://voxility.ai) AppleWebKit/537.36 Chrome/124 Safari/537.36'

export interface FetchedPage {
  html: string
  status: number
  finalUrl: string
  contentType: string
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en',
      },
    })
    const html = await res.text()
    return {
      html,
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
    }
  } finally {
    clearTimeout(timer)
  }
}

// ─── HTML → markdown extraction ─────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n))
      } catch {
        return ''
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16))
      } catch {
        return ''
      }
    })
}

/**
 * Pull the page <title> (og:title preferred) without full parsing.
 */
export function extractTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og?.[1]) return decodeEntities(og[1]).trim()
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return t?.[1] ? decodeEntities(t[1]).trim().slice(0, 300) : null
}

/**
 * Boilerplate-stripped HTML → markdown.
 *
 * Strategy: cut obvious chrome (scripts, styles, nav, header, footer,
 * aside, forms, svg, iframes, comments), prefer the <main>/<article>
 * region when present, then linearize the remaining block elements
 * into markdown. Headings keep their level; lists keep bullets;
 * everything else becomes paragraphs. Inline tags are flattened to
 * their text (links keep just the label — chunk text is for
 * retrieval, not navigation).
 */
export function extractMarkdownFromHtml(html: string): string {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|form|template|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')

  // Prefer the main-content region when the page declares one.
  const main =
    h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    h.match(/<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/(div|section)>/i)?.[1]
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 200) h = main

  const blocks: string[] = []
  // Tokenize on block-level boundaries we care about, in document order.
  const re = /<(h[1-6]|p|li|pre|blockquote|td|th|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(h)) !== null) {
    const tag = match[1].toLowerCase()
    const inner = decodeEntities(
      match[2]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim(),
    )
    if (!inner) continue
    if (tag.startsWith('h')) {
      const level = Math.min(6, Math.max(2, Number(tag[1]))) // h1 → ## so the chunker sections on it
      blocks.push(`${'#'.repeat(level)} ${inner}`)
    } else if (tag === 'li') {
      blocks.push(`- ${inner}`)
    } else if (tag === 'pre') {
      blocks.push('```\n' + inner + '\n```')
    } else if (tag === 'blockquote') {
      blocks.push(`> ${inner}`)
    } else {
      blocks.push(inner)
    }
  }

  // Fallback when the page had no recognizable blocks (unusual
  // markup): strip all tags and take the raw text.
  if (blocks.length === 0) {
    const text = decodeEntities(h.replace(/<[^>]+>/g, ' '))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim()
    return text.length > 100 ? text : ''
  }

  // De-noise: drop ultra-short repeated fragments (cookie banners,
  // "Skip to content") and collapse duplicates.
  const seen = new Set<string>()
  const cleaned = blocks.filter(b => {
    const key = b.toLowerCase()
    if (b.length < 3) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return cleaned.join('\n\n').trim()
}

// ─── Link discovery ─────────────────────────────────────────────────

/** Normalize a candidate link for crawl bookkeeping. Returns null for non-crawlable links. */
export function normalizeCrawlUrl(href: string, baseUrl: string, rootHost: string): string | null {
  if (!href) return null
  if (/^(mailto:|tel:|javascript:|#|data:)/i.test(href)) return null
  let abs: URL
  try {
    abs = new URL(href, baseUrl)
  } catch {
    return null
  }
  if (abs.protocol !== 'https:' && abs.protocol !== 'http:') return null
  if (abs.hostname !== rootHost) return null
  // Skip obvious non-content assets.
  if (/\.(png|jpe?g|gif|webp|svg|ico|css|js|mp4|mp3|zip|gz|woff2?)(\?|$)/i.test(abs.pathname)) return null
  abs.hash = ''
  return abs.toString()
}

export function extractLinks(html: string, baseUrl: string, rootHost: string): string[] {
  const out = new Set<string>()
  const re = /<a\b[^>]*href=["']([^"'#][^"']*)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const normalized = normalizeCrawlUrl(m[1], baseUrl, rootHost)
    if (normalized) out.add(normalized)
  }
  return [...out]
}

async function urlsFromSitemap(rootUrl: URL, maxPages: number): Promise<string[]> {
  const candidates = [
    new URL('/sitemap.xml', rootUrl).toString(),
    new URL('/sitemap_index.xml', rootUrl).toString(),
    // The pasted URL might itself be a sitemap.
    ...(rootUrl.pathname.endsWith('.xml') ? [rootUrl.toString()] : []),
  ]
  for (const candidate of candidates) {
    try {
      const page = await fetchPage(candidate)
      if (page.status !== 200 || !/<(urlset|sitemapindex)/i.test(page.html)) continue

      // Sitemap index → fetch up to 5 child sitemaps.
      if (/<sitemapindex/i.test(page.html)) {
        const children = [...page.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]).slice(0, 5)
        const urls: string[] = []
        for (const child of children) {
          try {
            const childPage = await fetchPage(child)
            urls.push(...[...childPage.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]))
          } catch {
            // skip unreadable child sitemap
          }
          if (urls.length >= maxPages) break
        }
        if (urls.length > 0) return urls.slice(0, maxPages)
      }

      const urls = [...page.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1])
      if (urls.length > 0) return urls.slice(0, maxPages)
    } catch {
      // try next candidate
    }
  }
  return []
}

/**
 * Enumerate same-host URLs reachable from `root`: sitemap first
 * (cheap, complete), BFS link crawl as fallback. The BFS fetches
 * pages anyway — those fetches are cheap and uncached, but the
 * pipeline re-fetches per page later; acceptable for v1 (the
 * alternative is threading a page cache through the adapter, which
 * can come when crawl volume justifies it).
 */
export async function discoverSiteUrls(
  root: string,
  opts: { maxPages: number; maxDepth?: number; budgetMs?: number },
): Promise<string[]> {
  const rootUrl = new URL(root)
  const maxDepth = opts.maxDepth ?? 4
  const deadline = Date.now() + (opts.budgetMs ?? 150_000)

  const fromSitemap = await urlsFromSitemap(rootUrl, opts.maxPages)
  if (fromSitemap.length > 1) {
    // Keep only same-host entries — some sitemaps list CDN assets.
    const sameHost = fromSitemap.filter(u => {
      try {
        return new URL(u).hostname === rootUrl.hostname
      } catch {
        return false
      }
    })
    if (sameHost.length > 1) return sameHost.slice(0, opts.maxPages)
  }

  // BFS crawl, 8 fetches in flight — sequential discovery couldn't
  // walk more than a few dozen pages inside its budget, which is why
  // "give it a root URL and it follows all the links" under-delivered.
  const seen = new Set<string>([rootUrl.toString()])
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl.toString(), depth: 0 }]
  const found: string[] = [rootUrl.toString()]
  const CONCURRENCY = 8

  while (queue.length > 0 && found.length < opts.maxPages && Date.now() < deadline) {
    const batch = queue.splice(0, CONCURRENCY).filter(e => e.depth < maxDepth)
    if (batch.length === 0) continue
    const pages = await Promise.all(
      batch.map(async e => {
        try {
          return { entry: e, page: await fetchPage(e.url) }
        } catch {
          return null
        }
      }),
    )
    for (const item of pages) {
      if (!item) continue
      const { entry, page } = item
      if (page.status !== 200 || !page.contentType.includes('html')) continue
      for (const link of extractLinks(page.html, page.finalUrl, rootUrl.hostname)) {
        if (seen.has(link)) continue
        seen.add(link)
        found.push(link)
        queue.push({ url: link, depth: entry.depth + 1 })
        if (found.length >= opts.maxPages) break
      }
      if (found.length >= opts.maxPages) break
    }
  }

  return found
}
