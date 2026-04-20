/**
 * Minimal markdown renderer for help articles.
 *
 * Why inline rather than react-markdown: the npm install hit a local cache
 * permissions error during build-out, and for a help center authored by a
 * small trusted group the markdown subset we need is small — headings,
 * paragraphs, bold/italic, links, unordered/ordered lists, blockquotes,
 * inline code, fenced code blocks, and horizontal rules. That's ~80 lines
 * of code and zero supply-chain exposure.
 *
 * Safety model: every chunk of user input is HTML-escaped before any
 * markdown-specific replacement runs. The only tags we emit are ones we
 * control. Links are rendered with `rel="noopener noreferrer"` and
 * `target="_blank"` for off-site URLs.
 *
 * If we later want tables / task lists / footnotes / GFM, swap this file's
 * `renderMarkdown` for react-markdown. Callers import only `renderMarkdown`.
 */

import React from 'react'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Inline: bold/italic/code/links. Input is already HTML-escaped. */
function renderInline(text: string): string {
  // Inline code first — its contents shouldn't be touched by bold/italic/link.
  // Use a placeholder so subsequent replacements ignore it, then restore.
  const codeSlots: string[] = []
  text = text.replace(/`([^`]+)`/g, (_m, inner) => {
    codeSlots.push(`<code class="bg-zinc-800 text-zinc-200 rounded px-1.5 py-0.5 text-[0.9em]">${inner}</code>`)
    return `\u0000CODE${codeSlots.length - 1}\u0000`
  })

  // Links: [text](url). URL is validated loosely to block `javascript:` etc.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safe = /^(https?:|mailto:|\/|#)/i.test(url) ? url : '#'
    const external = /^https?:/i.test(safe)
    return `<a href="${safe}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''} class="text-blue-400 hover:text-blue-300 underline">${label}</a>`
  })

  // Bold / italic. Bold first so **foo** isn't eaten by the italic rule.
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-zinc-100">$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  // Restore code slots.
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => codeSlots[Number(i)])
  return text
}

/**
 * Block-level parser. Splits on blank lines, classifies each block, calls
 * renderInline on anything that accepts inline markup.
 */
export function renderMarkdown(source: string): string {
  if (!source) return ''

  const escaped = escapeHtml(source).replace(/\r\n/g, '\n')

  // Pull out fenced code blocks first — their contents are rendered verbatim.
  const codeBlocks: string[] = []
  const withCodeStubs = escaped.replace(/```([a-zA-Z0-9_-]*)?\n([\s\S]*?)```/g, (_m, _lang, body) => {
    codeBlocks.push(`<pre class="bg-zinc-950 border border-zinc-800 rounded-lg p-4 my-4 overflow-x-auto"><code class="text-xs text-zinc-200 font-mono whitespace-pre">${body.replace(/\n$/, '')}</code></pre>`)
    return `\u0000PRE${codeBlocks.length - 1}\u0000`
  })

  const blocks = withCodeStubs.split(/\n{2,}/)
  const out: string[] = []

  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue

    // Restore code-block stubs as-is.
    if (/^\u0000PRE\d+\u0000$/.test(block)) {
      out.push(block.replace(/\u0000PRE(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]))
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(block)) {
      out.push('<hr class="border-zinc-800 my-6" />')
      continue
    }

    // Heading
    const h = block.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const cls = [
        '',
        'text-2xl font-bold text-zinc-100 mt-8 mb-3',
        'text-xl font-semibold text-zinc-100 mt-7 mb-3',
        'text-lg font-semibold text-zinc-100 mt-6 mb-2',
        'text-base font-semibold text-zinc-100 mt-5 mb-2',
        'text-sm font-semibold text-zinc-100 mt-4 mb-2',
        'text-sm font-semibold text-zinc-300 mt-4 mb-2',
      ][level]
      out.push(`<h${level} class="${cls}">${renderInline(h[2].trim())}</h${level}>`)
      continue
    }

    // Blockquote
    if (/^>\s/.test(block)) {
      const inner = block.split('\n').map(l => l.replace(/^>\s?/, '')).join(' ')
      out.push(`<blockquote class="border-l-2 border-zinc-700 pl-4 py-1 my-4 text-zinc-400 italic">${renderInline(inner)}</blockquote>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(block)) {
      const items = block.split('\n').filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/^\d+\.\s+/, ''))
      out.push(`<ol class="list-decimal pl-6 my-3 space-y-1 text-zinc-300">${items.map(i => `<li>${renderInline(i)}</li>`).join('')}</ol>`)
      continue
    }

    // Unordered list
    if (/^[-*]\s/.test(block)) {
      const items = block.split('\n').filter(l => /^[-*]\s/.test(l)).map(l => l.replace(/^[-*]\s+/, ''))
      out.push(`<ul class="list-disc pl-6 my-3 space-y-1 text-zinc-300">${items.map(i => `<li>${renderInline(i)}</li>`).join('')}</ul>`)
      continue
    }

    // Paragraph (default). Single newlines inside become <br /> for readability.
    out.push(`<p class="my-3 leading-relaxed text-zinc-300">${renderInline(block.replace(/\n/g, '<br />'))}</p>`)
  }

  return out.join('\n')
}

/**
 * React component that renders markdown server-side into HTML. Trusted
 * because the input is only ever authored by super-admins, but we still
 * HTML-escape everything up front as a defence-in-depth measure.
 */
export function Markdown({ source }: { source: string }) {
  const html = renderMarkdown(source)
  return <div className="help-md" dangerouslySetInnerHTML={{ __html: html }} />
}
