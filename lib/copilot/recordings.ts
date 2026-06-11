/**
 * Co-Pilot recording learning — turn a human call into agent behavior.
 *
 * The pipeline that makes "feed it recordings of real onboarding calls
 * and it learns" real, WITHOUT any neural training:
 *
 *   processRecording(id):
 *     1. pull the uploaded file (audio or screen video) from Blob
 *     2. hand it to Gemini, which natively reads BOTH tracks and
 *        returns (a) the spoken transcript and (b) a timestamped
 *        SCREEN WALKTHROUGH — where the human navigated, what they
 *        pointed at, where the user stalled. The video track is the
 *        valuable half for an onboarding agent: it's a navigation map,
 *        not just dialogue.
 *     3. store both on the recording row.
 *
 *   distillPlaybook(agentId):
 *     read every processed recording for the agent + its current steps,
 *     and rewrite the agent's PLAYBOOK — the distilled "how a great
 *     human runs this": phrasings that land, objections + how they were
 *     answered, the real step order, screen anchors (which page each
 *     step happens on, what the target looks like), and known stall
 *     points. That text is baked into every live session's prompt.
 *
 * Cost is one-time per recording (distilled once); live sessions only
 * ever use the resulting text. Everything here is best-effort and
 * inspectable — the playbook is editable prose, not a black box.
 */

import { GoogleGenAI, createPartFromUri } from '@google/genai'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'

const VIDEO_MODEL = process.env.COPILOT_RECORDING_MODEL || 'gemini-2.5-flash'
const DISTILL_MODEL = 'claude-haiku-4-5-20251001'
const FILE_ACTIVE_TIMEOUT_MS = 90_000

const EXTRACT_PROMPT = `You are analysing a recording of a human running an onboarding / support call where they guide a user through a software product, often sharing or directing the user's screen.

Produce STRICT JSON, no markdown fences:
{
  "transcript": "the full spoken dialogue, lightly cleaned, speaker-labelled as Guide: / User: where you can tell them apart",
  "walkthrough": "a timestamped navigation map of what happened ON SCREEN — each line like '[mm:ss] <page/screen the user was on> → <action the guide directed> (<what was pointed at / clicked>)'. Note where the user hesitated, got lost, or asked a clarifying question, and how the guide recovered. If the recording has no visible screen (audio only), write 'AUDIO ONLY — no screen track' and leave the rest empty."
}

Be concise but specific about UI locations (e.g. "Settings > Integrations, the orange Connect button top-right"). The goal is a map another assistant can use to guide a future user through the same flow.`

export async function processRecording(recordingId: string): Promise<void> {
  const rec = await db.copilotRecording.findUnique({ where: { id: recordingId } })
  if (!rec || rec.status === 'done') return

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    await db.copilotRecording.update({
      where: { id: recordingId },
      data: { status: 'failed', error: 'Recording analysis is not configured (missing model credentials).' },
    })
    return
  }

  await db.copilotRecording.update({ where: { id: recordingId }, data: { status: 'processing', error: null } })

  try {
    // Blob → bytes → Gemini Files API.
    const { head } = await import('@vercel/blob')
    const info = await head(rec.storageKey)
    const fileRes = await fetch(info.url)
    if (!fileRes.ok) throw new Error(`could not fetch recording blob (${fileRes.status})`)
    const bytes = new Uint8Array(await fileRes.arrayBuffer())
    const mimeType = info.contentType || guessMime(rec.originalFilename)

    const ai = new GoogleGenAI({ apiKey: geminiKey })
    const uploaded = await ai.files.upload({
      file: new Blob([bytes], { type: mimeType }),
      config: { mimeType, displayName: rec.originalFilename },
    })

    // Gemini processes media async — poll until ACTIVE.
    let file = uploaded
    const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS
    while (file.state === 'PROCESSING' && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000))
      file = await ai.files.get({ name: file.name as string })
    }
    if (file.state !== 'ACTIVE') throw new Error(`Gemini file never became ACTIVE (state=${file.state})`)

    const result = await ai.models.generateContent({
      model: VIDEO_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            createPartFromUri(file.uri as string, file.mimeType as string),
            { text: EXTRACT_PROMPT },
          ],
        },
      ],
    })

    const raw = (result.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    let parsed: { transcript?: string; walkthrough?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Model returned prose — keep it as the transcript rather than
      // losing the work.
      parsed = { transcript: raw.slice(0, 40_000), walkthrough: '' }
    }

    await db.copilotRecording.update({
      where: { id: recordingId },
      data: {
        status: 'done',
        transcript: (parsed.transcript ?? '').slice(0, 60_000) || null,
        walkthrough: (parsed.walkthrough ?? '').slice(0, 30_000) || null,
      },
    })

    // Clean up the Gemini-side copy; the distilled text is what we keep.
    await ai.files.delete({ name: file.name as string }).catch(() => undefined)

    // Re-distill the agent's playbook now that there's new material.
    await distillPlaybook(rec.agentId).catch(err =>
      console.warn('[recordings] distill after process failed:', err instanceof Error ? err.message : err),
    )
  } catch (err) {
    console.error(`[recordings] processing ${recordingId} failed:`, err)
    await db.copilotRecording.update({
      where: { id: recordingId },
      data: { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    })
  }
}

const DISTILL_SYSTEM = `You write the PLAYBOOK for a live AI co-pilot that guides users through a procedure in real time while watching their screen.

You are given: the agent's name, its current ordered steps, and transcripts + screen-walkthroughs of real human-run calls of the same procedure.

Write the playbook as clear instructions the co-pilot will follow. Cover:
- The real step order humans use (correct or refine the given steps if the recordings show a better flow).
- For each step: where it happens on screen (page + the target element and roughly where it sits), and the exact kind of phrasing that worked.
- Common objections / points of confusion that came up, and how the human handled them.
- Known stall points — where users get lost — and how to pre-empt or recover.

Be specific and practical. Output plain prose/markdown the co-pilot reads as guidance — NOT JSON. Keep it under 600 words. Do not invent details that aren't supported by the recordings or steps.`

export async function distillPlaybook(agentId: string): Promise<void> {
  const agent = await db.copilotAgent.findUnique({
    where: { id: agentId },
    include: { recordings: { where: { status: 'done' }, orderBy: { createdAt: 'desc' }, take: 8 } },
  })
  if (!agent || agent.recordings.length === 0) return

  const steps = Array.isArray(agent.steps) ? (agent.steps as string[]).filter(s => typeof s === 'string') : []
  const stepsBlock = steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(no explicit steps yet — infer them from the recordings)'

  const recordingsBlock = agent.recordings
    .map((r, i) => {
      const t = (r.transcript ?? '').slice(0, 6000)
      const w = (r.walkthrough ?? '').slice(0, 4000)
      return `--- Recording ${i + 1} (${r.originalFilename}) ---\nTRANSCRIPT:\n${t}\n\nSCREEN WALKTHROUGH:\n${w || '(audio only)'}`
    })
    .join('\n\n')
    .slice(0, 40_000)

  try {
    const client = new Anthropic()
    const completion = await client.messages.create({
      model: DISTILL_MODEL,
      max_tokens: 1500,
      system: DISTILL_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Agent: ${agent.name}\n\nCurrent steps:\n${stepsBlock}\n\nReal calls to learn from:\n\n${recordingsBlock}`,
        },
      ],
    })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const playbook = (block?.text ?? '').trim()
    if (playbook) {
      await db.copilotAgent.update({ where: { id: agentId }, data: { playbook: playbook.slice(0, 12_000) } })
      console.log(`[recordings] distilled playbook for agent ${agentId} from ${agent.recordings.length} recording(s)`)
    }
  } catch (err) {
    console.error(`[recordings] distillPlaybook ${agentId} failed:`, err)
  }
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
  }
  return map[ext] || 'application/octet-stream'
}
