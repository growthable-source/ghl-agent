/**
 * YouTube → Deepgram audio transcription.
 *
 * Used as a fallback when YouTube captions are unavailable or
 * explicitly disabled. The flow:
 *
 *   1. ytdl-core resolves the video URL to a direct audio stream URL
 *      (no download — these are signed googlevideo.com URLs valid for
 *      ~6 hours). This step is where most things break: bot detection,
 *      age restriction, region blocks. The error message names which.
 *
 *   2. Deepgram's prerecorded endpoint accepts a `url` body and pulls
 *      the audio itself. We use nova-3 (current SOTA for English),
 *      diarize off (faster, cheaper), smart_format on for readable
 *      output, and `punctuate` so the transcript chunker has natural
 *      sentence boundaries to split on.
 *
 * Cost: ~$0.0043/minute on nova-3 prerecorded. A 30-minute video runs
 * ~$0.13; a typical help-center 5-min clip ~$0.02. Fine to run on every
 * caption-less video without rate limiting.
 *
 * Failure modes that get surfaced as user-friendly errors:
 *   - DEEPGRAM_API_KEY not set in env
 *   - ytdl couldn't find an audio format (private/age-gated/region)
 *   - Deepgram 4xx (auth failure, bad URL)
 *   - Deepgram returned empty transcript (silent or near-silent video)
 *
 * Note on YouTube ToS: ytdl-core requests the same player URL the
 * YouTube web client uses; we're not scraping or redistributing. We
 * never store the audio — only the transcript Deepgram returns.
 */

import ytdl from '@distube/ytdl-core'

const DEEPGRAM_ENDPOINT = 'https://api.deepgram.com/v1/listen'
const DEEPGRAM_MODEL = 'nova-3'

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
        confidence?: number
      }>
    }>
  }
  err_msg?: string
}

export interface AsrResult {
  transcript: string
  durationSec: number | null
  costEstimateUsd: number | null
}

export async function transcribeYouTubeWithDeepgram(videoId: string, opts: { language?: string } = {}): Promise<AsrResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is not set. Add it in your environment to enable audio transcription for videos without captions.')
  }

  // ─── 1. Resolve direct audio URL ────────────────────────────────────
  let info: ytdl.videoInfo
  try {
    info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`)
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (/age.restricted|sign.in.to.confirm/i.test(msg)) {
      throw new Error(`This video is age-restricted and YouTube won't release the audio without a signed-in cookie.`)
    }
    if (/private/i.test(msg)) {
      throw new Error(`This video is private — we can't pull the audio for transcription.`)
    }
    if (/unavailable/i.test(msg)) {
      throw new Error(`This video is unavailable (deleted, region-restricted, or never published).`)
    }
    throw new Error(`Couldn't load video metadata from YouTube: ${msg.slice(0, 200)}`)
  }

  const durationSec = info?.videoDetails?.lengthSeconds ? Number(info.videoDetails.lengthSeconds) : null

  // Pick the smallest audio-only track we can find — quality is fine
  // for ASR and the smaller file transfers faster to Deepgram.
  const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio', filter: 'audioonly' })
  if (!audioFormat?.url) {
    throw new Error(`YouTube didn't expose an audio-only stream for this video — we'd need to demux from video, which isn't supported here.`)
  }

  // ─── 2. Hand the URL to Deepgram ────────────────────────────────────
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    smart_format: 'true',
    punctuate: 'true',
  })
  if (opts.language) params.set('language', opts.language)

  let dgRes: Response
  try {
    dgRes = await fetch(`${DEEPGRAM_ENDPOINT}?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: audioFormat.url }),
    })
  } catch (err: any) {
    throw new Error(`Couldn't reach Deepgram: ${err?.message ?? 'network error'}`)
  }

  if (!dgRes.ok) {
    const errText = await dgRes.text().catch(() => '')
    if (dgRes.status === 401 || dgRes.status === 403) {
      throw new Error(`Deepgram rejected the API key (HTTP ${dgRes.status}). Check DEEPGRAM_API_KEY.`)
    }
    if (dgRes.status === 400) {
      throw new Error(`Deepgram couldn't process the audio URL (HTTP 400). ${errText.slice(0, 200)}`)
    }
    throw new Error(`Deepgram returned HTTP ${dgRes.status}. ${errText.slice(0, 200)}`)
  }

  const data = (await dgRes.json()) as DeepgramListenResponse
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
  if (!transcript.trim()) {
    throw new Error(`Deepgram returned an empty transcript — the video may be silent, music-only, or too noisy to transcribe.`)
  }

  const costEstimateUsd = durationSec !== null ? (durationSec / 60) * 0.0043 : null

  return { transcript: transcript.trim(), durationSec, costEstimateUsd }
}
