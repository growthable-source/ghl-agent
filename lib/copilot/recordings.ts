/**
 * Co-Pilot source learning — turn a human call OR an SOP document
 * into agent behavior.
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

const MEDIA_PROMPT = `You are analysing a recording of a human running an onboarding / support call where they guide a user through a software product, often sharing or directing the user's screen.

Produce STRICT JSON, no markdown fences:
{
  "transcript": "the full spoken dialogue, lightly cleaned, speaker-labelled as Guide: / User: where you can tell them apart",
  "walkthrough": "a timestamped navigation map of what happened ON SCREEN — each line like '[mm:ss] <page/screen the user was on> → <action the guide directed> (<what was pointed at / clicked>)'. Note where the user hesitated, got lost, or asked a clarifying question, and how the guide recovered. If the recording has no visible screen (audio only), write 'AUDIO ONLY — no screen track' and leave the rest empty."
}

Be concise but specific about UI locations (e.g. "Settings > Integrations, the orange Connect button top-right"). The goal is a map another assistant can use to guide a future user through the same flow.`

const DOC_PROMPT = `You are analysing an onboarding / support DOCUMENT (an SOP, guide, or runbook) that explains how to take a user through a software product. It may contain SCREENSHOTS with captions and step-by-step text.

Produce STRICT JSON, no markdown fences:
{
  "transcript": "the document's instructional content as clean prose — the steps, explanations, and any tips, in order",
  "walkthrough": "a navigation map derived from the screenshots + text — each line like '<step> — <page/screen shown> → <action> (<what to click / where it is>)'. Read the screenshots: note which screen each one shows and what UI element it highlights. If there are no screenshots, write 'TEXT ONLY — no screenshots' and leave this empty."
}

Be specific about UI locations visible in the screenshots (e.g. "the Integrations card, orange Connect button top-right"). The goal is a map another assistant can use to guide a future user through the same flow.`

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

  const ext = (rec.originalFilename.toLowerCase().split('.').pop() ?? '')
  const isPlainText = ext === 'md' || ext === 'markdown' || ext === 'txt'
  const isDocument = isPlainText || ext === 'pdf'

  try {
    const { head } = await import('@vercel/blob')
    const info = await head(rec.storageKey)
    const fileRes = await fetch(info.url)
    if (!fileRes.ok) throw new Error(`could not fetch blob (${fileRes.status})`)

    // Plain-text docs need no model vision pass — the text IS the
    // content; there are no screenshots to read.
    if (isPlainText) {
      const text = await fileRes.text()
      await db.copilotRecording.update({
        where: { id: recordingId },
        data: { status: 'done', transcript: text.slice(0, 60_000) || null, walkthrough: 'TEXT ONLY — no screenshots' },
      })
      await distillPlaybook(rec.agentId).catch(err =>
        console.warn('[sources] distill after process failed:', err instanceof Error ? err.message : err),
      )
      return
    }

    // PDF + audio + video → Gemini Files API (Gemini reads PDF pages
    // including embedded screenshots natively).
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
            { text: isDocument ? DOC_PROMPT : MEDIA_PROMPT },
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

const DISTILL_SYSTEM = `You turn real onboarding/support materials (SOP documents and recordings of human-run calls) into the operating instructions a live AI co-pilot follows while it watches a user's screen.

You are given: the agent's name, any ordered steps the operator already wrote, and the transcripts + screen-walkthroughs of the source material.

Produce STRICT JSON, no markdown fences:
{
  "steps": ["a clean, ordered list of the CONCRETE steps the user must complete, phrased as short imperative actions — e.g. 'Connect your CRM under Settings > Integrations'. This is the checklist the agent walks IN ORDER. Pull these from the SOP / recordings faithfully; do not invent steps that aren't there. 3-30 items."],
  "playbook": "A per-step RUNBOOK in markdown. For EACH step above, write a short block with: exactly what to tell the user to do, WHERE it is on screen (page + the target element and roughly where it sits), the phrasing that works, and any confusion/stall point at that step and how to handle it. Preserve the literal detail from the source — this is the agent's authority on HOW to do each step, so be specific, not generic. End with any objections that came up across the call and how they were handled.",
  "uiMap": "A SCREEN MAP of the product, in markdown, organised by SCREEN/PAGE rather than by step — merge what every source shows into ONE inventory. For each distinct screen seen, write a short block: the screen's name/purpose, how you reach it (the nav path or what you click to land there), and the notable controls on it (buttons, fields, tabs, menus) with roughly where each sits and what it does. This is a map of the UI itself, not a procedure — it lets the agent orient on a screen it saw in one recording while the user is on a related screen later. Only include screens actually visible in the material; do not invent UI. If there is no visible screen content at all, return an empty string."
}

Rules: Follow the source material closely — if the SOP says to do X before Y, keep that order. Don't summarise away the specifics (exact menu names, button locations, field values). If the operator already wrote steps, reconcile them with the source rather than discarding them. Do not invent anything not supported by the material.`

interface DistillResult {
  steps: string[]
  playbook: string
  uiMap: string
}

function parseDistill(raw: string): DistillResult | null {
  const m = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim().match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0]) as { steps?: unknown; playbook?: unknown; uiMap?: unknown }
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim().slice(0, 500)).slice(0, 40)
      : []
    const playbook = typeof obj.playbook === 'string' ? obj.playbook.trim() : ''
    const uiMap = typeof obj.uiMap === 'string' ? obj.uiMap.trim() : ''
    if (!playbook && steps.length === 0) return null
    return { steps, playbook, uiMap }
  } catch {
    return null
  }
}

export async function distillPlaybook(agentId: string): Promise<void> {
  const agent = await db.copilotAgent.findUnique({
    where: { id: agentId },
    include: { recordings: { where: { status: 'done' }, orderBy: { createdAt: 'desc' }, take: 8 } },
  })
  if (!agent || agent.recordings.length === 0) return

  const existingSteps = Array.isArray(agent.steps) ? (agent.steps as string[]).filter(s => typeof s === 'string') : []
  const stepsBlock = existingSteps.length
    ? existingSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(none yet — extract them from the material)'

  const recordingsBlock = agent.recordings
    .map((r, i) => {
      const t = (r.transcript ?? '').slice(0, 8000)
      const w = (r.walkthrough ?? '').slice(0, 5000)
      return `--- Source ${i + 1} (${r.originalFilename}) ---\nCONTENT:\n${t}\n\nSCREEN WALKTHROUGH:\n${w || '(no screen track)'}`
    })
    .join('\n\n')
    .slice(0, 48_000)

  try {
    const client = new Anthropic()
    const completion = await client.messages.create({
      model: DISTILL_MODEL,
      max_tokens: 4000,
      system: DISTILL_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Agent: ${agent.name}\n\nOperator's current steps:\n${stepsBlock}\n\nSource material to learn from:\n\n${recordingsBlock}`,
        },
      ],
    })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const parsed = block ? parseDistill(block.text) : null
    if (!parsed) {
      console.warn(`[recordings] distill produced no usable result for agent ${agentId}`)
      return
    }

    const data: Record<string, unknown> = {}
    if (parsed.playbook) data.playbook = parsed.playbook.slice(0, 16_000)
    if (parsed.uiMap) data.uiMap = parsed.uiMap.slice(0, 12_000)
    // Only auto-fill steps when the operator hasn't authored any — never
    // clobber hand-written steps; the playbook still reconciles to them.
    if (existingSteps.length === 0 && parsed.steps.length > 0) data.steps = parsed.steps
    if (Object.keys(data).length > 0) {
      await db.copilotAgent.update({ where: { id: agentId }, data })
      console.log(
        `[recordings] distilled agent ${agentId} from ${agent.recordings.length} source(s): ${parsed.steps.length} step(s)${existingSteps.length === 0 ? ' auto-filled' : ' (kept operator steps)'}, playbook ${parsed.playbook.length} chars, uiMap ${parsed.uiMap.length} chars`,
      )
    }
  } catch (err) {
    console.error(`[recordings] distillPlaybook ${agentId} failed:`, err)
  }
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
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
