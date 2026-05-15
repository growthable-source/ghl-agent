/**
 * YouTube adapter — channel / playlist / single-video transcripts.
 *
 * Two-step:
 *   discover() resolves the input URL to a list of video IDs:
 *     - https://youtube.com/watch?v=ID            → [ID]
 *     - https://youtu.be/ID                       → [ID]
 *     - https://youtube.com/channel/UCxxxx        → channel RSS, latest ~15 videos
 *     - https://youtube.com/@handle               → resolve handle → channel ID → RSS
 *     - playlists: not supported in v1 (would need YouTube Data API key)
 *
 *   fetch() pulls the transcript via the `youtube-transcript` npm
 *   package — scrapes YouTube's web frontend transcript endpoint.
 *   No API key required; works for any video with public captions.
 *
 * Limitations:
 *   - Videos without captions return empty markdown and fail
 *     normalize() → the run logs the page as failed
 *   - Live streams without retroactive captions don't work
 *   - Auto-captions (vs human captions) are noisier — quality varies
 *
 * crawl_config:
 *   { recrawlIntervalDays: 7, language?: 'en' }  // language=undefined
 *   uses video's default; specify to force a target language
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'

interface YoutubeCrawlConfig {
  recrawlIntervalDays?: number
  language?: string  // ISO 639-1
}

interface RawYoutube {
  videoId: string
  title: string | null
  channelName: string | null
  publishedAt: string | null
  transcriptText: string | null
}

interface TranscriptEntry { text: string; duration: number; offset: number; lang?: string }

export const youtubeAdapter: SourceAdapter = {
  sourceType: 'youtube',

  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    const root = ctx.source.urlOrIdentifier
    const trimmed = root.trim()

    // Single-video URL? Match the common shapes and return the id.
    const single = extractVideoId(trimmed)
    if (single) return [{ identifier: single }]

    // Channel URL? Resolve to channel ID (via redirect/page parse) and
    // hit the RSS feed for the latest videos.
    const channelId = await resolveChannelId(trimmed)
    if (!channelId) {
      throw new Error('youtube adapter: unrecognised URL. Use a video URL (?v=...), a channel URL (/channel/UC..., /@handle), or a youtu.be short link.')
    }

    const videoIds = await fetchChannelVideos(channelId)
    if (videoIds.length === 0) {
      throw new Error(`youtube adapter: channel ${channelId} returned no videos in its RSS feed`)
    }
    return videoIds.map(id => ({ identifier: id }))
  },

  async fetch(ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent> {
    const cfg = ctx.source.crawlConfig as YoutubeCrawlConfig
    let YoutubeTranscript: any
    try {
      // Optional dep — falls through with a clear error if not installed.
      const mod = await import('youtube-transcript')
      YoutubeTranscript = mod.YoutubeTranscript
    } catch {
      throw new Error('youtube adapter: `youtube-transcript` package not installed. Run `npm install youtube-transcript`.')
    }

    let transcript: TranscriptEntry[]
    try {
      transcript = await YoutubeTranscript.fetchTranscript(item.identifier, cfg.language ? { lang: cfg.language } : undefined)
    } catch (err: any) {
      throw new Error(`youtube adapter: transcript fetch failed for ${item.identifier}: ${err?.message ?? 'unknown'}`)
    }

    if (!transcript || transcript.length === 0) {
      throw new Error(`youtube adapter: no transcript available for ${item.identifier} (private video, no captions, or region-restricted)`)
    }

    // Best-effort title / channel name from oEmbed — no API key needed.
    let title: string | null = null
    let channelName: string | null = null
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${item.identifier}&format=json`)
      if (res.ok) {
        const data = await res.json() as { title?: string; author_name?: string }
        title = data.title ?? null
        channelName = data.author_name ?? null
      }
    } catch { /* oEmbed is optional context */ }

    const transcriptText = transcript.map(e => e.text).join(' ').replace(/\s+/g, ' ').trim()

    return {
      identifier: item.identifier,
      raw: { videoId: item.identifier, title, channelName, publishedAt: null, transcriptText } satisfies RawYoutube,
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const payload = raw.raw as RawYoutube
    if (!payload.transcriptText) {
      throw new Error('youtube adapter: empty transcript after extraction')
    }

    const title = payload.title ?? `YouTube video ${payload.videoId}`
    const sourceUrl = `https://www.youtube.com/watch?v=${payload.videoId}`

    // Treat the transcript as one big h2 section. The chunker will
    // paragraph-split it from there.
    const markdown = `## ${title}\n\n${payload.transcriptText}`

    return {
      identifier: raw.identifier,
      sourceUrl,
      markdown,
      metadata: {
        page_title: title,
        breadcrumb_path: payload.channelName ? ['YouTube', payload.channelName] : ['YouTube'],
        page_last_updated: payload.publishedAt,
        video_id: payload.videoId,
        channel_name: payload.channelName,
      },
    }
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '')
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    if (/youtube\.com$/.test(u.hostname) || u.hostname === 'youtube.com' || u.hostname === 'www.youtube.com' || u.hostname === 'm.youtube.com') {
      const v = u.searchParams.get('v')
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
    }
    return null
  } catch { return null }
}

async function resolveChannelId(url: string): Promise<string | null> {
  try {
    const u = new URL(url)
    // Direct /channel/UC... form
    const m = u.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/)
    if (m) return m[1]

    // /@handle, /user/name, /c/name — fetch the channel page and
    // scrape the canonical channelId from the meta tag. YouTube
    // changes this layout occasionally but the `channelId` JSON-LD /
    // og:url contains a stable UC... id.
    if (/^\/@/.test(u.pathname) || /^\/user\//.test(u.pathname) || /^\/c\//.test(u.pathname)) {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) return null
      const html = await res.text()
      const idMatch = html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)
      if (idMatch) return idMatch[1]
      // Fallback — og:url often has the canonical channel URL
      const ogMatch = html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/)
      if (ogMatch) return ogMatch[1]
    }
    return null
  } catch { return null }
}

async function fetchChannelVideos(channelId: string): Promise<string[]> {
  // YouTube's free RSS feed lists ~15 most recent videos. No API key,
  // generous rate limit. For deeper history we'd need YouTube Data API.
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
  if (!res.ok) throw new Error(`youtube RSS ${res.status} for channel ${channelId}`)
  const xml = await res.text()
  const ids: string[] = []
  const re = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    ids.push(match[1])
  }
  return ids
}
