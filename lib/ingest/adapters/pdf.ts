/**
 * PDF adapter — local extraction via unpdf.
 *
 * Why unpdf: pure JS, no native deps, runs on Vercel functions. Handles
 * ~80% of clean text PDFs. Scanned / image-only PDFs return empty text;
 * those fail visibly so the ingestion run logs the page and a human
 * can flag for re-upload or escalate to a hosted OCR service (Reducto
 * or similar) when the volume justifies the bill.
 *
 * crawl_config shape:
 *   {
 *     storageKey:        string  (Vercel Blob path or equivalent)
 *     originalFilename:  string
 *     pageRange?:        [number, number]  (optional; for slicing huge PDFs)
 *   }
 *
 * discover() returns one item — PDFs are file-uploads, not crawl targets.
 * fetch() pulls bytes from blob storage. normalize() runs unpdf and
 * concatenates the per-page text, keeping page numbers in the metadata
 * so chunk anchors can deep-link to the page.
 *
 * Per the brief: this exists alongside the docs adapter so the
 * SourceAdapter interface is proven by two concrete implementations
 * before more types land.
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'

interface PdfCrawlConfig {
  storageKey?: string
  originalFilename?: string
  pageRange?: [number, number]
}

interface RawPdfPayload {
  buffer: ArrayBuffer
  filename: string
}

export const pdfAdapter: SourceAdapter = {
  sourceType: 'pdf',

  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    // A KnowledgeSource of type 'pdf' represents ONE uploaded PDF.
    // The identifier is the storage key (stable across recrawls).
    const cfg = ctx.source.crawlConfig as PdfCrawlConfig
    const key = cfg.storageKey || ctx.source.urlOrIdentifier
    if (!key) {
      throw new Error('pdf adapter: crawlConfig.storageKey (or urlOrIdentifier) required')
    }
    return [{ identifier: key }]
  },

  async fetch(ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent> {
    const cfg = ctx.source.crawlConfig as PdfCrawlConfig
    const filename = cfg.originalFilename || item.identifier.split('/').pop() || 'document.pdf'

    // The storageKey is a Vercel Blob path. @vercel/blob's `head()`
    // returns a downloadUrl we can fetch with public Internet.
    let downloadUrl: string
    try {
      const { head } = await import('@vercel/blob')
      const info = await head(item.identifier)
      downloadUrl = info.url
    } catch (err: any) {
      throw new Error(`pdf adapter: blob head failed for ${item.identifier}: ${err?.message}`)
    }

    const res = await fetch(downloadUrl)
    if (!res.ok) throw new Error(`pdf adapter: blob fetch ${res.status}`)
    const buffer = await res.arrayBuffer()

    return {
      identifier: item.identifier,
      raw: { buffer, filename } satisfies RawPdfPayload,
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const payload = raw.raw as RawPdfPayload
    if (!payload?.buffer) throw new Error('pdf adapter: empty raw payload')

    // Plain-text uploads (.txt / .md) ride this same adapter — the
    // unified upload flow stores every file kind under sourceType
    // 'pdf' (display label "File"). Text needs no extraction: decode
    // and hand it to the shared chunker, which understands markdown
    // headings natively.
    if (/\.(txt|md|markdown)$/i.test(payload.filename)) {
      const text = new TextDecoder('utf-8').decode(payload.buffer).trim()
      if (!text) throw new Error('file adapter: text file was empty')
      return {
        identifier: raw.identifier,
        sourceUrl: raw.identifier,
        markdown: text,
        metadata: { original_filename: payload.filename, file_kind: 'text' },
      }
    }

    // Dynamic import so a missing dep surfaces only when a PDF source
    // actually ingests — the rest of the pipeline keeps building.
    let extractText: (data: Uint8Array | ArrayBuffer) => Promise<{ totalPages: number; text: string[] }>
    try {
      const unpdf = await import('unpdf')
      extractText = unpdf.extractText
    } catch {
      throw new Error('pdf adapter: `unpdf` package not installed. Run `npm install unpdf`.')
    }

    const result = await extractText(new Uint8Array(payload.buffer))
    const pageTexts = result.text.map((t, i) => ({ page: i + 1, text: (t || '').trim() }))
    const totalPages = result.totalPages

    // Build a single markdown document with H2 page-breaks so the
    // shared chunker treats each page as its own section. Anchors
    // become #page-N for deep-linking.
    const markdown = pageTexts
      .filter(p => p.text.length > 0)
      .map(p => `## Page ${p.page}\n\n${p.text}`)
      .join('\n\n')

    if (!markdown.trim()) {
      throw new Error('pdf adapter: extracted text was empty — possibly a scanned/image-only PDF')
    }

    return {
      identifier: raw.identifier,
      sourceUrl: raw.identifier, // PDFs aren't web-accessible; storage key is the canonical ref
      markdown,
      metadata: {
        original_filename: payload.filename,
        total_pages: totalPages,
        extracted_pages: pageTexts.filter(p => p.text.length > 0).length,
      },
    }
  },
}
