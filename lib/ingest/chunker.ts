/**
 * Semantic chunker — adapter-agnostic.
 *
 * Strategy:
 *   - Primary boundary: h2 (## ...)
 *   - Secondary boundary: h3 (### ...) when an h2 section exceeds ~1000 tokens
 *   - Target chunk size: 200–800 tokens
 *   - Chunks under 100 tokens merge forward within the same h2
 *   - NEVER span h2 boundaries — h2 ≈ "page section", and the LLM gets
 *     confused when one chunk straddles two unrelated topics
 *
 * Token counting: rough approximation via word-count × 1.3. This isn't
 * production-perfect (a real tokenizer would be tighter) but it's fast,
 * has no native deps, and the chunker's job is to produce reasonable
 * windows, not exact-size ones. The embedder caps each chunk via the
 * model's own tokenizer when it calls the API.
 */

const TARGET_MIN_TOKENS = 200
const TARGET_MAX_TOKENS = 800
const MERGE_BELOW = 100
const H3_SPLIT_THRESHOLD = 1000

export interface SectionMeta {
  /** The heading text the chunk lives under (h2 if present, else h3, else doc title). */
  heading: string
  /** Slug-ified anchor for deep-linking — derived from the heading. */
  anchor: string
}

export interface RawChunk {
  content: string
  section: SectionMeta
  approxTokens: number
}

export function chunkMarkdown(markdown: string, docTitle?: string): RawChunk[] {
  const sections = splitByH2(markdown, docTitle)
  const chunks: RawChunk[] = []
  for (const section of sections) {
    const tokenEstimate = approxTokenCount(section.body)
    if (tokenEstimate <= TARGET_MAX_TOKENS) {
      chunks.push({ content: section.body.trim(), section: section.meta, approxTokens: tokenEstimate })
      continue
    }
    // Section too big — split on h3 boundaries; falls back to paragraph
    // boundaries if there are no h3s big enough to help.
    chunks.push(...splitOversizedSection(section.body, section.meta))
  }
  return mergeUndersizedNeighbours(chunks)
}

interface Section { meta: SectionMeta; body: string }

function splitByH2(markdown: string, docTitle?: string): Section[] {
  // We track sections as [heading, content...] pairs, defaulting the
  // pre-h2 lead-in to the doc title (or "Introduction" when nothing
  // sensible is around).
  const lines = markdown.split('\n')
  const sections: Section[] = []
  let currentHeading = docTitle || 'Introduction'
  let currentBuffer: string[] = []
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/)
    if (h2) {
      if (currentBuffer.length) {
        sections.push({
          meta: { heading: currentHeading, anchor: slug(currentHeading) },
          body: currentBuffer.join('\n').trim(),
        })
      }
      currentHeading = h2[1].trim()
      currentBuffer = []
      continue
    }
    currentBuffer.push(line)
  }
  if (currentBuffer.length) {
    sections.push({
      meta: { heading: currentHeading, anchor: slug(currentHeading) },
      body: currentBuffer.join('\n').trim(),
    })
  }
  return sections.filter(s => s.body.length > 0)
}

function splitOversizedSection(body: string, parentMeta: SectionMeta): RawChunk[] {
  // Prefer h3 boundaries. If none, fall back to paragraph splits.
  if (/^###\s+/m.test(body)) {
    const lines = body.split('\n')
    const subs: RawChunk[] = []
    let currentHeading = parentMeta.heading
    let currentBuffer: string[] = []
    const flush = () => {
      const text = currentBuffer.join('\n').trim()
      if (!text) return
      subs.push({
        content: text,
        section: {
          heading: currentHeading,
          anchor: slug(currentHeading),
        },
        approxTokens: approxTokenCount(text),
      })
    }
    for (const line of lines) {
      const h3 = line.match(/^###\s+(.+)/)
      if (h3) {
        flush()
        currentHeading = `${parentMeta.heading} — ${h3[1].trim()}`
        currentBuffer = []
        continue
      }
      currentBuffer.push(line)
    }
    flush()
    // Any individual sub still huge → recursively paragraph-split.
    const out: RawChunk[] = []
    for (const sub of subs) {
      if (sub.approxTokens <= H3_SPLIT_THRESHOLD) out.push(sub)
      else out.push(...paragraphSplit(sub.content, sub.section))
    }
    return out
  }
  return paragraphSplit(body, parentMeta)
}

function paragraphSplit(body: string, meta: SectionMeta): RawChunk[] {
  // Greedy: accumulate paragraphs into a buffer until we'd cross
  // TARGET_MAX_TOKENS, then emit. A single oversize paragraph emits
  // as-is and we trust the embedder's truncation.
  const paragraphs = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const out: RawChunk[] = []
  let buf: string[] = []
  let bufTokens = 0
  for (const para of paragraphs) {
    const t = approxTokenCount(para)
    if (bufTokens + t > TARGET_MAX_TOKENS && buf.length) {
      out.push({ content: buf.join('\n\n'), section: meta, approxTokens: bufTokens })
      buf = []
      bufTokens = 0
    }
    buf.push(para)
    bufTokens += t
  }
  if (buf.length) {
    out.push({ content: buf.join('\n\n'), section: meta, approxTokens: bufTokens })
  }
  return out
}

function mergeUndersizedNeighbours(chunks: RawChunk[]): RawChunk[] {
  if (chunks.length <= 1) return chunks
  const out: RawChunk[] = []
  for (const chunk of chunks) {
    const last = out[out.length - 1]
    // Merge only WITHIN the same h2 heading — never across, per the
    // chunker's hard rule.
    const sameSection = last && last.section.heading === chunk.section.heading
    if (sameSection && last.approxTokens < MERGE_BELOW) {
      last.content = last.content + '\n\n' + chunk.content
      last.approxTokens += chunk.approxTokens
      continue
    }
    out.push({ ...chunk })
  }
  return out
}

function approxTokenCount(text: string): number {
  // ~1.3 tokens per word for English markdown content. Good enough for
  // boundary decisions; the real tokenizer runs at embed time.
  const words = (text.match(/\S+/g) ?? []).length
  return Math.ceil(words * 1.3)
}

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
