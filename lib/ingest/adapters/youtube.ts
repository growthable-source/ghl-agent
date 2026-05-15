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
 *   fetch() — two paths, captions-first:
 *     1. Try `youtube-transcript` (free, fast, often human-edited).
 *     2. If captions are disabled or missing, fall through to Deepgram
 *        ASR over the audio URL we get from ytdl-core (~$0.0043/min).
 *
 *   The fallback is opt-out — `crawlConfig.forceCaptions: true` skips
 *   ASR entirely (useful when the operator deliberately doesn't want
 *   to spend Deepgram credit on a noisy / non-English channel).
 *
 * crawl_config:
 *   {
 *     recrawlIntervalDays: 7,
 *     language?: 'en',          // hints both captions and Deepgram
 *     forceCaptions?: boolean,  // disable Deepgram fallback
 *     preferAsr?: boolean,      // skip captions, go straight to Deepgram
 *   }
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'
import { transcribeYouTubeWithDeepgram } from '../youtube-asr'

interface YoutubeCrawlConfig {
  recrawlIntervalDays?: number
  language?: string         // ISO 639-1
  forceCaptions?: boolean   // never call Deepgram, even if captions fail
  preferAsr?: boolean       // call Deepgram first; captions only as fallback
}

interface RawYoutube {
  videoId: string
  title: string | null
  channelName: string | null
  publishedAt: string | null
  transcriptText: string | null
  transcriptSource: 'captions' | 'asr' | null
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

    // Decide order. Default: captions first, ASR fallback. If the
    // operator set preferAsr, swap. If forceCaptions, ASR is disabled.
    const tryCaptionsFirst = !cfg.preferAsr
    const allowAsr = !cfg.forceCaptions

    let transcriptText: string | null = null
    let transcriptSource: 'captions' | 'asr' | null = null
    const failures: string[] = []

    const tryCaptions = async (): Promise<string | null> => {
      let YoutubeTranscript: any
      try {
        const mod = await import('youtube-transcript')
        YoutubeTranscript = mod.YoutubeTranscript
      } catch {
        throw new Error('youtube-transcript package not installed')
      }
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(
          item.identifier,
          cfg.language ? { lang: cfg.language } : undefined,
        ) as TranscriptEntry[]
        if (!transcript || transcript.length === 0) return null
        return transcript.map(e => e.text).join(' ').replace(/\s+/g, ' ').trim()
      } catch (err: any) {
        const msg = err?.message ?? ''
        if (/transcript.*disabled|disabled on this video|no transcripts|could not find/i.test(msg)) {
          return null   // signal "no captions" — let the caller fall through
        }
        throw err       // genuine error, surface to operator
      }
    }

    const tryAsr = async (): Promise<string | null> => {
      const result = await transcribeYouTubeWithDeepgram(item.identifier, { language: cfg.language })
      return result.transcript
    }

    const attempts = tryCaptionsFirst ? ['captions', 'asr'] : ['asr', 'captions']
    for (const attempt of attempts) {
      if (attempt === 'asr' && !allowAsr) continue
      try {
        const text = attempt === 'captions' ? await tryCaptions() : await tryAsr()
        if (text && text.length > 0) {
          transcriptText = text
          transcriptSource = attempt as 'captions' | 'asr'
          break
        }
        failures.push(`${attempt}: empty`)
      } catch (err: any) {
        failures.push(`${attempt}: ${err?.message ?? 'unknown'}`)
      }
    }

    if (!transcriptText) {
      // Both paths failed (or ASR was disabled and captions failed).
      // Give the operator a single sentence explaining the actual reason.
      const hadCaptionFailure = failures.find(f => f.startsWith('captions:'))
      const hadAsrFailure = failures.find(f => f.startsWith('asr:'))
      if (!allowAsr && hadCaptionFailure) {
        throw new Error(`No captions for this video and audio transcription is disabled on this source. Turn off "forceCaptions" in the source config to enable Deepgram fallback.`)
      }
      if (hadAsrFailure) {
        // Strip the "asr: " prefix — the underlying error is already
        // human-readable (see youtube-asr.ts).
        throw new Error(hadAsrFailure.replace(/^asr:\s*/, ''))
      }
      throw new Error(`Couldn't read this video. Details: ${failures.join('; ')}`)
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

    return {
      identifier: item.identifier,
      raw: { videoId: item.identifier, title, channelName, publishedAt: null, transcriptText, transcriptSource } satisfies RawYoutube,
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
        // 'captions' | 'asr' — useful when comparing retrieval quality
        // across sources later (ASR is noisier than human captions).
        transcript_source: payload.transcriptSource,
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
