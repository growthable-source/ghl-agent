/**
 * Per-chunk taxonomy classifier using Claude Haiku.
 *
 * Inputs the chunk + the domain's current taxonomy. Outputs:
 *   - taxonomyTags[]: 0 or more keys from the taxonomy (constrained)
 *   - intentTags[]:   0 or more keys from the domain's defaultIntentTags
 *   - primaryTopic:   one short phrase the operator can scan
 *
 * Hybrid pattern: controlled vocabulary as truth, LLM as classifier.
 * Unmatched content lands in the `_other` bucket so taxonomy maintainers
 * can either add a new key (and re-classify) or merge via aliases.
 *
 * Cost: Haiku is ~$1/M input tokens; a typical chunk is ~500 input
 * tokens of content + ~600 of taxonomy/system prompt → ~$0.001 per
 * chunk. At 100k chunks that's $110. Cheap enough to run on every
 * chunk without batching gymnastics.
 */

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 200

export interface TaxonomyRow {
  key: string
  label: string
  aliases: string[]
  parentKey: string | null
}

export interface ClassificationInput {
  content: string
  taxonomy: TaxonomyRow[]
  defaultIntentTags: string[]
  /** Helpful context for the model — page title / breadcrumb /
   *  section heading. Keeps single-paragraph chunks classifiable. */
  contextHint?: string
}

export interface ClassificationResult {
  primaryTopic: string
  taxonomyTags: string[]
  intentTags: string[]
  /** True when the model felt nothing in the taxonomy fits. The
   *  caller still stores the row (with empty taxonomyTags), and
   *  the `_other` bucket dashboard surfaces it for review. */
  hitOtherBucket: boolean
}

export async function classifyChunk(input: ClassificationInput): Promise<ClassificationResult> {
  const taxonomyBlock = input.taxonomy
    .map(t => {
      const aliases = t.aliases.length ? ` (aliases: ${t.aliases.join(', ')})` : ''
      const parent = t.parentKey ? ` [under: ${t.parentKey}]` : ''
      return `- ${t.key}: ${t.label}${aliases}${parent}`
    })
    .join('\n')

  const intentBlock = input.defaultIntentTags.length
    ? input.defaultIntentTags.map(t => `- ${t}`).join('\n')
    : '(no intent tags configured for this domain — leave intent_tags empty)'

  const system = `You classify documentation chunks against a controlled vocabulary.

You will be given:
1. A chunk of text (one section of a help-center page, PDF, etc.)
2. A taxonomy of allowed keys
3. A list of allowed intent tags

Your job: return STRICT JSON matching this shape:
{
  "primary_topic": "one short phrase, under 8 words, describing what this chunk is about",
  "taxonomy_tags": ["key1", "key2"],   // 0-3 keys from the taxonomy, exact key strings
  "intent_tags":   ["how_to"],         // 0-2 keys from the intent list
  "hit_other_bucket": false             // true if NOTHING in the taxonomy fits
}

Rules:
- taxonomy_tags MUST be exact key strings from the taxonomy below — no inventing, no labels-instead-of-keys, no synonyms
- If the chunk genuinely doesn't fit any taxonomy entry, return [] and set hit_other_bucket=true
- intent_tags MUST be exact strings from the intent list (or [])
- primary_topic is descriptive English, not a key
- Output ONLY the JSON object. No markdown fences, no commentary.`

  const userParts: string[] = []
  if (input.contextHint) userParts.push(`Context: ${input.contextHint}`)
  userParts.push(`\nTaxonomy:\n${taxonomyBlock}`)
  userParts.push(`\nIntent tags:\n${intentBlock}`)
  userParts.push(`\nChunk:\n${input.content.slice(0, 6000)}`)

  let parsed: any = null
  try {
    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userParts.join('\n') }],
    })
    const text = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const raw = (text?.text ?? '').trim()
    // Tolerate the occasional ```json fence even though we asked not to.
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    parsed = JSON.parse(stripped)
  } catch (err: any) {
    console.warn('[classify] Haiku call failed:', err?.message)
    // Soft fail — chunk still gets stored with empty tags so the
    // `_other` bucket review picks it up.
    return {
      primaryTopic: '',
      taxonomyTags: [],
      intentTags: [],
      hitOtherBucket: true,
    }
  }

  // Defensive normalisation. Filter taxonomy tags to ones that
  // actually exist; the model occasionally hallucinates close-but-wrong
  // keys and we'd rather drop them than let drift accumulate.
  const validKeys = new Set(input.taxonomy.map(t => t.key))
  const validIntents = new Set(input.defaultIntentTags)
  const taxonomyTags = Array.isArray(parsed?.taxonomy_tags)
    ? parsed.taxonomy_tags.filter((k: unknown): k is string => typeof k === 'string' && validKeys.has(k))
    : []
  const intentTags = Array.isArray(parsed?.intent_tags)
    ? parsed.intent_tags.filter((k: unknown): k is string => typeof k === 'string' && validIntents.has(k))
    : []
  const primaryTopic = typeof parsed?.primary_topic === 'string'
    ? parsed.primary_topic.slice(0, 120)
    : ''
  const hitOtherBucket = !!parsed?.hit_other_bucket || (taxonomyTags.length === 0 && validKeys.size > 0)

  return { primaryTopic, taxonomyTags, intentTags, hitOtherBucket }
}
