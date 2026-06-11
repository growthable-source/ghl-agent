/**
 * Voyage AI embedding client — voyage-3, 1024 dimensions.
 *
 * Chosen at lock-in time for: best retrieval-per-dollar, lowest payload
 * size (saves ~33% pgvector storage vs 1536-dim, ~66% vs 3072-dim),
 * competitive MTEB across domains. The pipeline records embeddingModel
 * on every chunk so a future swap is `WHERE embeddingModel = 'old'`
 * selective re-embed, not a full reindex.
 *
 * Batching: Voyage accepts up to 128 inputs per call. We chunk-and-call,
 * exponential-backoff retry on 429 / 5xx. The wider pipeline runs
 * batches sequentially — concurrency is a v2 optimisation under
 * measured load, not before.
 */

export const EMBEDDING_MODEL = 'voyage-3' as const
export const EMBEDDING_DIMS = 1024 as const

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings'
const BATCH_SIZE = 128
const MAX_RETRIES = 4

export interface EmbeddingResult {
  /** Index in the input array — preserves ordering for the caller. */
  index: number
  embedding: number[]
}

interface VoyageBody {
  input: string[]
  model: string
  input_type: 'document' | 'query'
  truncation: boolean
}

interface VoyageResponse {
  data: Array<{ index: number; embedding: number[] }>
  usage?: { total_tokens?: number }
}

/**
 * Embed an array of strings. Use `inputType: 'document'` for chunks
 * (the default) and `'query'` for retrieval-side queries — Voyage
 * uses different projection heads for asymmetric retrieval.
 */
export async function embedTexts(
  texts: string[],
  opts: { inputType?: 'document' | 'query' } = {},
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY env var not set — embeddings unavailable.')
  }

  const inputType = opts.inputType ?? 'document'
  const out: EmbeddingResult[] = []
  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const batch = texts.slice(offset, offset + BATCH_SIZE)
    const body: VoyageBody = {
      input: batch,
      model: EMBEDDING_MODEL,
      input_type: inputType,
      truncation: true,
    }
    const data = await callVoyageWithRetry(apiKey, body)
    for (const item of data.data) {
      out.push({ index: offset + item.index, embedding: item.embedding })
    }
  }
  out.sort((a, b) => a.index - b.index)
  return out
}

async function callVoyageWithRetry(apiKey: string, body: VoyageBody): Promise<VoyageResponse> {
  let lastErr: any
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        // Backoff: 500ms, 1s, 2s, 4s. Capped at MAX_RETRIES.
        const wait = 500 * Math.pow(2, attempt)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // Billing/auth failures get an operator-actionable message —
        // this string lands in IngestionRun.errorLog and renders
        // under the failed source row in the Knowledge UI, so it must
        // say what to actually do (the Firecrawl-402 outage taught us
        // a bare status code costs a debugging session).
        if (res.status === 402 || res.status === 401 || res.status === 403) {
          console.error(`[Voyage] credential/billing failure ${res.status}: ${text.slice(0, 200)}`)
          throw new Error(
            `Embedding provider rejected the request (${res.status}) — check the Voyage account's credits/API key. Knowledge indexing is paused until this is fixed.`,
          )
        }
        throw new Error(`Voyage ${res.status}: ${text.slice(0, 300)}`)
      }
      return await res.json() as VoyageResponse
    } catch (err: any) {
      lastErr = err
      // Network blip — retry with backoff
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
    }
  }
  throw lastErr ?? new Error('Voyage call failed after retries')
}
