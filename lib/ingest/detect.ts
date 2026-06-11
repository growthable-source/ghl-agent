/**
 * Source auto-detection — the brain behind the "paste any link" box.
 *
 * Users shouldn't have to know whether their link is "a docs crawl
 * target" or "an RSS feed" or "a YouTube channel". They paste a URL;
 * we classify it and pick sensible defaults (including how often to
 * re-check it for changes).
 *
 * Two layers:
 *   - detectUrlKind(url): pure string classification — handles the
 *     unambiguous cases (YouTube, obvious feed URLs, sitemaps).
 *     Unit-tested; no network.
 *   - sniffUrl(url): one cheap fetch for the ambiguous rest — an XML
 *     response that smells like RSS/Atom flips 'website' → 'rss'.
 *     Network failures fall back to 'website' (the crawler will
 *     surface real errors with context).
 */

export type DetectedKind = 'youtube' | 'rss' | 'website'

export interface Detection {
  kind: DetectedKind
  /** sourceType for the KnowledgeSource row. */
  sourceType: 'youtube' | 'rss' | 'docs'
  /** Friendly noun for UI copy ("YouTube video", "feed", "website"). */
  label: string
  /** Days between automatic change-checks. 0 = never. */
  recrawlIntervalDays: number
  /** Adapter crawlConfig defaults. */
  crawlConfig: Record<string, unknown>
}

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'])

const FEED_PATH_PATTERNS = [
  /\/feed\/?$/i,
  /\/rss\/?$/i,
  /\/atom\/?$/i,
  /\.rss$/i,
  /\/feeds?\//i,
  /\/rss\.xml$/i,
  /\/atom\.xml$/i,
  /\/feed\.xml$/i,
  /\/index\.xml$/i,
]

/** Pure classification from the URL alone. */
export function detectUrlKind(rawUrl: string): DetectedKind {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return 'website'
  }

  if (YT_HOSTS.has(url.hostname.toLowerCase())) return 'youtube'

  const path = url.pathname
  if (FEED_PATH_PATTERNS.some(p => p.test(path))) return 'rss'

  return 'website'
}

/** Defaults per kind — cadence + adapter config in one place. */
export function detectionFor(rawUrl: string, kind: DetectedKind): Detection {
  switch (kind) {
    case 'youtube': {
      // Channels keep publishing; single videos don't change. The
      // adapter handles both — a weekly re-check picks up new channel
      // videos and is a no-op (hash match) for a single video.
      return {
        kind,
        sourceType: 'youtube',
        label: /\/(channel|@)/.test(rawUrl) ? 'YouTube channel' : 'YouTube video',
        recrawlIntervalDays: 7,
        crawlConfig: { recrawlIntervalDays: 7 },
      }
    }
    case 'rss':
      return {
        kind,
        sourceType: 'rss',
        label: 'feed',
        recrawlIntervalDays: 1,
        crawlConfig: { recrawlIntervalDays: 1, maxItems: 100 },
      }
    case 'website': {
      const isSitemap = /sitemap[^/]*\.xml$/i.test(rawUrl)
      return {
        kind,
        sourceType: 'docs',
        label: isSitemap ? 'sitemap' : 'website',
        recrawlIntervalDays: 7,
        crawlConfig: { recrawlIntervalDays: 7, recursive: true, maxPages: 500 },
      }
    }
  }
}

/**
 * Network sniff for ambiguous URLs: a 'website' classification gets
 * one cheap GET — if the body is actually an RSS/Atom feed, reclassify.
 * Any failure keeps 'website'; the crawler reports real errors later
 * with much better context than we could here.
 */
export async function detectUrl(rawUrl: string): Promise<Detection> {
  const kind = detectUrlKind(rawUrl)
  if (kind !== 'website') return detectionFor(rawUrl, kind)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.8' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    const contentType = res.headers.get('content-type') ?? ''
    const head = (await res.text()).slice(0, 2000)
    const looksXml = contentType.includes('xml') || head.trimStart().startsWith('<?xml')
    if (looksXml && (/<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head))) {
      return detectionFor(rawUrl, 'rss')
    }
  } catch {
    // Unreachable / slow — let the docs crawler take it from here.
  }
  return detectionFor(rawUrl, 'website')
}
