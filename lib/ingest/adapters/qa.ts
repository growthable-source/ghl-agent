/**
 * Inline-text ("qa") adapter — embeds text we already hold, no fetch.
 *
 * Every other adapter pulls content from somewhere (a URL, a PDF, a feed).
 * This one carries its markdown in the KnowledgeSource's crawlConfig, so a
 * distilled Q&A pair (or any operator-authored snippet) can ride the real
 * chunk → classify → embed pipeline and land as a KnowledgeChunk in the
 * brand's KnowledgeDomain — which is what both the widget chat and ticket
 * suggest-reply retrieve against.
 *
 * The source's identifier is a synthetic, non-URL token (e.g.
 * "ticket-resolution:<draftId>"). The pipeline's URL-keyed "already crawled?"
 * skip parses it with new URL() and, on failure, treats it as never-matched —
 * so a qa source always ingests rather than being wrongly skipped.
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'

interface QaCrawlConfig {
  /** The markdown to embed. `text` accepted as an alias. */
  markdown?: string
  text?: string
  /** Optional document title carried onto the chunk metadata. */
  title?: string
}

export const qaAdapter: SourceAdapter = {
  sourceType: 'qa',

  // Single self-referential item — the text is the source, there's nothing
  // to crawl or paginate.
  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    return [{ identifier: ctx.source.urlOrIdentifier }]
  },

  async fetch(ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent> {
    const cfg = (ctx.source.crawlConfig ?? {}) as QaCrawlConfig
    const markdown = (cfg.markdown ?? cfg.text ?? '').trim()
    if (!markdown) throw new Error('qa adapter: no text in crawlConfig (expected markdown/text)')
    return {
      identifier: item.identifier,
      raw: { markdown, title: cfg.title },
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const payload = raw.raw as { markdown: string; title?: string }
    const markdown = payload.markdown.trim()
    if (!markdown) throw new Error('qa adapter: empty markdown after fetch')
    return {
      identifier: raw.identifier,
      // No public URL — the identifier is the stable key the chunk uniqueness
      // constraint uses (unique per sourceId, so no collision risk).
      sourceUrl: raw.identifier,
      markdown,
      metadata: { page_title: payload.title || 'Support answer' },
    }
  },
}
