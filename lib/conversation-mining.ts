/**
 * Conversation Q&A mining engine.
 *
 * Reads a subaccount's CRM (LeadConnector) conversation history, extracts
 * question→answer pairs from the exchanges a HUMAN actually answered, and
 * stages them as MinedQaPair rows for operator approval. Nothing here writes
 * live knowledge — approval (a separate route) promotes a staged pair into a
 * KnowledgeEntry(source='qa').
 *
 * Cost discipline:
 *   - estimateMining() projects conversation count + token/$ cost so the UI
 *     can show a confirm dialog before anything runs.
 *   - runMiningRun() is deadline-bounded (same pattern as the ingest-queue
 *     cron): it processes conversations until a soft deadline, persists a
 *     keyset cursor, and reports whether a continuation is needed.
 *   - extraction runs on the cheap fleet model (lib/llm `auto`) and its token
 *     use is recorded via the standard LlmUsageDaily rollup.
 */

import { db } from '@/lib/db'
import { getCrmAdapter } from '@/lib/crm/factory'
import { getCrmLiveStatus } from '@/lib/crm/connection-status'
import { createMessage } from '@/lib/llm'
import { costUsd } from '@/lib/llm/pricing'
import { estimateTokens } from '@/lib/chunker'
import { buildTranscript, questionHash } from '@/lib/conversation-mining-utils'
import type { Conversation } from '@/types'

export { normalizeQuestion } from '@/lib/conversation-mining-utils'

const MESSAGES_PER_CONVERSATION = 40
const CONVERSATIONS_PER_LLM_BATCH = 6
const SEARCH_PAGE_SIZE = 100

// Mining is bulk, low-stakes, and runs in the background — it must use the
// cheapest model and NEVER fall back to Anthropic.
//
// Default precedence:
//   1. MINING_MODEL env (explicit override),
//   2. 'openrouter' when OPENROUTER_API_KEY is set (uses OPENROUTER_MODEL),
//   3. 'deepseek-flash' otherwise (DEEPSEEK_BASE_URL/KEY).
// A run's own `model` only wins if it's an explicit, non-'auto', non-Claude key.
function miningModelKey(runModel?: string | null): string {
  if (runModel && runModel !== 'auto' && !runModel.startsWith('claude')) return runModel
  if (process.env.MINING_MODEL) return process.env.MINING_MODEL
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  return 'deepseek-flash'
}

// LeadConnector rate limits a location to a short burst window (~100 req/10s)
// shared across ALL app usage. Mining fans out one getMessages per
// conversation, so it must throttle + back off on 429 or it trips the limit.
const CRM_THROTTLE_MS = 150 // ~6–7 req/s, comfortably under the burst ceiling

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Run a CRM call with exponential backoff on 429 (Too Many Requests). The GHL
 * adapter throws `GHL API error 429 on …`, so we match on the status. Other
 * errors propagate immediately. Bounded attempts; the cron's deadline +
 * cursor resume absorb anything that can't finish this tick.
 */
async function withCrmRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isRateLimit = /\b429\b/.test(msg) || /too many requests/i.test(msg)
      if (!isRateLimit || attempt >= MAX_ATTEMPTS - 1) throw err
      // 2s, 4s, 8s, 16s (+ jitter) — LeadConnector's window is ~10s.
      const delay = 2000 * 2 ** attempt + ((attempt * 137) % 400)
      await sleep(delay)
    }
  }
}

export interface MiningEstimate {
  conversations: number
  /** True when the in-window count exceeded the scan cap and is a floor. */
  capped: boolean
  estTokens: number
  estUsd: number
  model: string
}

const EXTRACTION_SYSTEM = `You extract reusable FAQ pairs from real customer-support conversations.

You are given transcripts where a customer asked things and a HUMAN team member answered. For each transcript, pull out the question→answer pairs that would help an AI assistant answer the SAME question for a future customer.

Strict rules:
- Only emit a pair when a human Agent gave a genuine, reusable answer. Skip greetings, scheduling back-and-forth, "let me check", chit-chat, and one-off answers that only apply to that single customer.
- Rewrite the question into a clean, general form (strip the specific customer's name, order numbers, phone numbers, emails, addresses — never include personal data in the question or answer).
- The answer must be the business's actual answer, generalized and self-contained.
- If a transcript has no reusable Q&A, emit nothing for it.
- confidence is 0..1: how reusable and well-answered the pair is.
- Always reference the conversationIndex you were given for each transcript.`

interface ExtractedPair {
  conversationIndex: number
  question: string
  answer: string
  confidence: number
}

const EMIT_TOOL = {
  name: 'emit_qa_pairs',
  description: 'Return the reusable FAQ pairs found across the given transcripts.',
  input_schema: {
    type: 'object',
    properties: {
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            conversationIndex: { type: 'integer' },
            question: { type: 'string' },
            answer: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['conversationIndex', 'question', 'answer', 'confidence'],
        },
      },
    },
    required: ['pairs'],
  },
}

async function extractBatch(
  batch: Array<{ index: number; transcript: string }>,
  modelKey: string,
  meta: { workspaceId: string; agentId: string },
): Promise<{ pairs: ExtractedPair[]; usage: { input: number; output: number } }> {
  const userText = batch
    .map(b => `--- Transcript ${b.index} ---\n${b.transcript}`)
    .join('\n\n')

  const res = await createMessage(
    modelKey,
    {
      max_tokens: 2000,
      temperature: 0,
      system: EXTRACTION_SYSTEM,
      tools: [EMIT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_qa_pairs' },
      messages: [{ role: 'user', content: userText }],
    },
    // noFallback: never silently retry on Anthropic — fail the batch instead.
    { surface: 'conversation-mining', workspaceId: meta.workspaceId, agentId: meta.agentId, noFallback: true },
  )

  const toolUse = res.content.find(b => b.type === 'tool_use') as { input?: { pairs?: ExtractedPair[] } } | undefined
  const pairs = Array.isArray(toolUse?.input?.pairs) ? toolUse!.input!.pairs! : []
  return {
    pairs,
    usage: { input: res.usage.input_tokens || 0, output: res.usage.output_tokens || 0 },
  }
}

/**
 * Page the CRM's conversation search within [windowStart, windowEnd], newest
 * first, invoking `onPage` for each batch. Stops when older than the window,
 * when `max` is reached, or when the CRM runs out. Returns the keyset cursor
 * of the last conversation seen (epoch-ms) so a caller can resume.
 */
async function pageConversations(
  adapter: Awaited<ReturnType<typeof getCrmAdapter>>,
  opts: { windowStart: number; windowEnd: number; max: number; startAfterDate?: number },
  onPage: (page: Conversation[]) => Promise<boolean>, // return false to stop early (e.g. deadline)
): Promise<{ scanned: number; cursor?: number; done: boolean }> {
  let scanned = 0
  let cursor = opts.startAfterDate
  let done = false

  while (scanned < opts.max) {
    const page = await withCrmRetry(() => adapter.searchConversations({
      limit: SEARCH_PAGE_SIZE,
      sort: 'desc',
      sortBy: 'last_message_date',
      startAfterDate: cursor,
    }))
    if (page.length === 0) { done = true; break }

    const inWindow: Conversation[] = []
    let reachedOlder = false
    for (const c of page) {
      const t = c.sort?.[0] ?? (c.lastMessageDate ? Date.parse(c.lastMessageDate) : 0)
      cursor = t || cursor
      if (t && t < opts.windowStart) { reachedOlder = true; break }
      if (t && t > opts.windowEnd) continue
      inWindow.push(c)
    }

    if (inWindow.length > 0) {
      scanned += inWindow.length
      const keepGoing = await onPage(inWindow.slice(0, Math.max(0, opts.max - (scanned - inWindow.length))))
      if (!keepGoing) break
    }
    if (reachedOlder || page.length < SEARCH_PAGE_SIZE) { done = true; break }
  }
  return { scanned, cursor, done }
}

/**
 * Project the cost of mining a window before anything runs. Scans a bounded
 * sample of conversations to count + measure average transcript size, then
 * extrapolates. Cheap and read-only.
 */
export async function estimateMining(input: {
  locationId: string
  windowStart: Date
  windowEnd: Date
  max: number
  model?: string
}): Promise<MiningEstimate> {
  const status = await getCrmLiveStatus(input.locationId)
  if (!status.live) throw new Error('CRM not connected')

  const adapter = await getCrmAdapter(input.locationId)
  const modelKey = miningModelKey(input.model)

  // Cap the estimate scan so the confirm dialog stays snappy.
  const SCAN_CAP = Math.min(input.max, 300)
  const counted: Conversation[] = []
  await pageConversations(
    adapter,
    { windowStart: input.windowStart.getTime(), windowEnd: input.windowEnd.getTime(), max: SCAN_CAP },
    async (page) => { counted.push(...page); return counted.length < SCAN_CAP },
  )

  // Sample transcripts from up to 8 conversations to get avg input tokens.
  const sample = counted.slice(0, 8)
  let sampledTokens = 0
  let sampledCount = 0
  for (const c of sample) {
    try {
      await sleep(CRM_THROTTLE_MS)
      const msgs = await withCrmRetry(() => adapter.getMessages(c.id, MESSAGES_PER_CONVERSATION))
      const transcript = buildTranscript(msgs)
      if (transcript) { sampledTokens += estimateTokens(transcript); sampledCount++ }
    } catch { /* skip unreadable threads in the estimate */ }
  }
  const avgInputPerConv = sampledCount > 0 ? sampledTokens / sampledCount : 200
  const promptOverhead = estimateTokens(EXTRACTION_SYSTEM) / CONVERSATIONS_PER_LLM_BATCH

  const capped = counted.length >= SCAN_CAP
  const conversations = Math.min(input.max, capped ? input.max : counted.length)
  const estInput = Math.round(conversations * (avgInputPerConv + promptOverhead))
  const estOutput = Math.round(conversations * 120) // a few short pairs per conversation
  const estTokens = estInput + estOutput
  const estUsd = costUsd(modelKey, estInput, estOutput)

  return { conversations, capped, estTokens, estUsd, model: modelKey }
}

export interface RunMiningResult {
  status: 'complete' | 'running' | 'failed'
  deadlineExhausted: boolean
  pairsGenerated: number
  conversationsScanned: number
}

/**
 * Execute (or resume) a ConversationMiningRun until the soft deadline.
 * Idempotent-ish: dedups extracted questions against pairs already staged for
 * the collection and against live qa entries, so re-runs don't pile up
 * duplicates. The cron claims the run row before calling this.
 */
export async function runMiningRun(
  runId: string,
  opts: { deadlineAt: number },
): Promise<RunMiningResult> {
  const run = await db.conversationMiningRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error(`Mining run ${runId} not found`)

  const agent = await db.agent.findUnique({ where: { id: run.agentId }, select: { locationId: true } })
  const locationId = agent?.locationId
  if (!locationId) throw new Error('Agent has no CRM location')
  const status = await getCrmLiveStatus(locationId)
  if (!status.live) throw new Error('CRM not connected')

  const adapter = await getCrmAdapter(locationId)
  const modelKey = miningModelKey(run.model)

  // Preload existing question hashes so we don't re-stage duplicates.
  const seen = new Set<string>()
  const existingPairs = await db.minedQaPair.findMany({
    where: { collectionId: run.collectionId, status: { in: ['pending', 'approved'] } },
    select: { question: true },
  })
  for (const p of existingPairs) seen.add(questionHash(p.question))
  const existingEntries = await db.knowledgeEntry.findMany({
    where: { collectionId: run.collectionId, source: 'qa' },
    select: { title: true },
  })
  for (const e of existingEntries) seen.add(questionHash(e.title))

  let pairsGenerated = run.pairsGenerated
  let conversationsScanned = run.conversationsScanned
  let actualTokens = run.actualTokens
  let deadlineExhausted = false
  let persistedCursor: string = run.cursor ?? ''

  // Extract + stage one batch of transcripts, deduping against `seen`.
  async function flush(inputs: Array<{ index: number; transcript: string; conversationId: string }>) {
    const { pairs, usage } = await extractBatch(
      inputs.map(i => ({ index: i.index, transcript: i.transcript })),
      modelKey,
      { workspaceId: run!.workspaceId, agentId: run!.agentId },
    )
    actualTokens += usage.input + usage.output
    const toCreate: Array<{
      runId: string; workspaceId: string; collectionId: string
      question: string; answer: string; sourceConversationId: string | null
      sourceSnippet: string | null; confidence: number
    }> = []
    for (const p of pairs) {
      const q = (p.question ?? '').trim()
      const a = (p.answer ?? '').trim()
      if (!q || !a) continue
      const h = questionHash(q)
      if (seen.has(h)) continue
      seen.add(h)
      const src = inputs.find(i => i.index === p.conversationIndex)
      toCreate.push({
        runId,
        workspaceId: run!.workspaceId,
        collectionId: run!.collectionId,
        question: q,
        answer: a,
        sourceConversationId: src?.conversationId ?? null,
        sourceSnippet: src ? src.transcript.slice(-600) : null,
        confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0,
      })
    }
    if (toCreate.length > 0) {
      await db.minedQaPair.createMany({ data: toCreate })
      pairsGenerated += toCreate.length
    }
  }

  // Remaining conversation budget for this run across all ticks.
  const remaining = Math.max(0, run.maxConversations - conversationsScanned)
  const startAfter = run.cursor ? Number(run.cursor) || undefined : undefined

  const paged = await pageConversations(
    adapter,
    {
      windowStart: run.windowStart.getTime(),
      windowEnd: run.windowEnd.getTime(),
      max: remaining,
      startAfterDate: startAfter,
    },
    async (page) => {
      // Build transcripts for this page, fetching messages per conversation.
      const batchInputs: Array<{ index: number; transcript: string; conversationId: string }> = []
      for (const c of page) {
        conversationsScanned++
        const t = c.sort?.[0] ?? (c.lastMessageDate ? Date.parse(c.lastMessageDate) : 0)
        if (t) persistedCursor = String(t)
        try {
          await sleep(CRM_THROTTLE_MS)
          const msgs = await withCrmRetry(() => adapter.getMessages(c.id, MESSAGES_PER_CONVERSATION))
          const transcript = buildTranscript(msgs)
          if (transcript) batchInputs.push({ index: batchInputs.length, transcript, conversationId: c.id })
        } catch { /* skip unreadable thread */ }

        if (batchInputs.length >= CONVERSATIONS_PER_LLM_BATCH) {
          await flush(batchInputs)
          batchInputs.length = 0
        }
        if (Date.now() > opts.deadlineAt) { deadlineExhausted = true; break }
      }
      if (batchInputs.length > 0) await flush(batchInputs)

      // Persist progress + cursor each page so a crash resumes cleanly.
      await db.conversationMiningRun.update({
        where: { id: runId },
        data: { conversationsScanned, pairsGenerated, actualTokens, cursor: persistedCursor },
      })
      return !deadlineExhausted
    },
  )

  const finalStatus: RunMiningResult['status'] =
    deadlineExhausted || !paged.done ? 'running' : 'complete'

  await db.conversationMiningRun.update({
    where: { id: runId },
    data: {
      status: finalStatus,
      conversationsScanned,
      pairsGenerated,
      actualTokens,
      cursor: persistedCursor,
    },
  })

  return {
    status: finalStatus,
    deadlineExhausted: finalStatus === 'running',
    pairsGenerated,
    conversationsScanned,
  }
}
