import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeForAgent } from '@/lib/knowledge'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * YouTube transcript import — pulls the public caption track for a video
 * and stores it as a KnowledgeEntry. Works for videos with captions
 * (auto-generated count) and a public URL.
 *
 * The flow:
 *   1. Resolve the video ID from a youtube.com / youtu.be URL.
 *   2. Hit the public watch page to find the timedtext track URL embedded
 *      in the player config.
 *   3. Fetch the timedtext XML and concatenate <text> nodes.
 *
 * No API key required — this uses the same endpoints the YouTube web
 * player uses. If YouTube changes the markup, this will need an update;
 * a more durable alternative is the npm `youtube-transcript` package.
 */

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1) || null
    }
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const v = u.searchParams.get('v')
      if (v) return v
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/]+)/)
      if (m) return m[2]
    }
  } catch {}
  // Bare 11-char id?
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim()
  return null
}

interface CaptionTrack { baseUrl: string; languageCode: string; name?: { simpleText?: string } }

async function fetchTranscript(videoId: string): Promise<{ title: string; text: string }> {
  // 1. Fetch the watch page HTML.
  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; VoxilityBot/1.0)',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!watchRes.ok) throw new Error(`YouTube watch page returned ${watchRes.status}`)
  const html = await watchRes.text()

  // 2. Extract title.
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  const title = (titleMatch?.[1] || `YouTube ${videoId}`).replace(/\s*-\s*YouTube\s*$/, '').trim()

  // 3. Find the captionTracks array embedded in the page's player_response.
  const ctMatch = html.match(/"captionTracks":(\[[^\]]+\])/)
  if (!ctMatch) throw new Error('No captions available for this video')
  let tracks: CaptionTrack[]
  try {
    // The embedded JSON uses real escapes; safe to parse.
    tracks = JSON.parse(ctMatch[1].replace(/\\u0026/g, '&'))
  } catch {
    throw new Error('Could not parse caption tracks')
  }
  if (tracks.length === 0) throw new Error('No captions available for this video')

  // Prefer English; fall back to first.
  const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0]
  if (!track.baseUrl) throw new Error('Caption track has no URL')

  // 4. Fetch the XML transcript.
  const xmlRes = await fetch(track.baseUrl)
  if (!xmlRes.ok) throw new Error(`Caption track fetch returned ${xmlRes.status}`)
  const xml = await xmlRes.text()

  // 5. Strip XML tags and decode entities into clean prose.
  const lines: string[] = []
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(xml)) !== null) {
    const decoded = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/\n+/g, ' ')
      .trim()
    if (decoded) lines.push(decoded)
  }
  if (lines.length === 0) throw new Error('Transcript is empty')
  return { title, text: lines.join(' ') }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const url = String(body.url || '').trim()
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const videoId = extractVideoId(url)
  if (!videoId) return NextResponse.json({ error: 'Could not parse a YouTube video ID from that URL' }, { status: 400 })

  try {
    const { title, text } = await fetchTranscript(videoId)
    const entry = await createKnowledgeForAgent({
      agentId,
      title,
      content: text,
      source: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    })
    return NextResponse.json({ entry })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'YouTube import failed' }, { status: 502 })
  }
}
