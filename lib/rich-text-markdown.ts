/**
 * Serialize the inbox rich-text composer's contentEditable DOM to the
 * markdown subset ChatMarkdown renders.
 *
 * Operator replies are stored + broadcast as plain markdown strings —
 * the widget bubble and the inbox transcript both run them through
 * components/ChatMarkdown.tsx. So the composer is WYSIWYG on the
 * operator's side but the wire format stays markdown: no HTML ever
 * reaches the visitor, nothing downstream (transcripts, CRM sync,
 * exports, translation) has to learn a new format, and the output is
 * limited to what ChatMarkdown can actually display:
 *
 *   bold, italic, inline code, http(s) links, bullet + numbered lists,
 *   line breaks, and blank-line paragraph breaks.
 *
 * Anything else the browser produces (spans, fonts, pasted styles) is
 * flattened to its text.
 *
 * Works on a minimal structural node type rather than the DOM's Node so
 * the vitest harness (node env, no jsdom) can exercise it with plain
 * objects. A real DOM Node satisfies the interface as-is.
 */

export interface RichNode {
  nodeType: number // 1 = element, 3 = text
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<RichNode>
  getAttribute?: (name: string) => string | null
  style?: { fontWeight?: string; fontStyle?: string }
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'])

type Mark = 'bold' | 'italic' | 'code'
const MARK_DELIM: Record<Mark, string> = { bold: '**', italic: '*', code: '`' }

function markFor(el: RichNode): Mark | null {
  const tag = el.nodeName.toUpperCase()
  if (tag === 'B' || tag === 'STRONG') return 'bold'
  if (tag === 'I' || tag === 'EM') return 'italic'
  if (tag === 'CODE') return 'code'
  // execCommand with styleWithCSS (Safari sometimes) emits styled spans.
  if (tag === 'SPAN' && el.style) {
    const w = el.style.fontWeight
    if (w === 'bold' || w === 'bolder' || (w && parseInt(w, 10) >= 600)) return 'bold'
    if (el.style.fontStyle === 'italic') return 'italic'
  }
  return null
}

/** Wrap inline content in a markdown delimiter, line by line — ChatMarkdown
 *  parses inline marks per line, so `**a\nb**` would render literally.
 *  Leading/trailing whitespace moves outside the delimiters (`** a**`
 *  doesn't parse as bold). Empty segments get no delimiters at all. */
function wrapMark(inner: string, mark: Mark): string {
  const d = MARK_DELIM[mark]
  return inner
    .split('\n')
    .map(seg => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(seg)!
      if (!m[2]) return seg
      const body = mark === 'code' ? m[2].replace(/`/g, "'") : m[2]
      return `${m[1]}${d}${body}${d}${m[3]}`
    })
    .join('\n')
}

function safeHref(href: string | null | undefined): string | null {
  if (!href) return null
  const h = href.trim()
  return /^https?:\/\/[^\s)]+$/i.test(h) ? h : null
}

function isBlock(n: RichNode): boolean {
  return n.nodeType === ELEMENT_NODE && BLOCK_TAGS.has(n.nodeName.toUpperCase())
}

/** nbsp → space; drop zero-width spaces (the composer inserts one after
 *  an inline <code> so the caret can escape it). */
function cleanText(s: string | null): string {
  return (s ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
}

function hasMeaningfulContent(n: RichNode): boolean {
  return cleanText(n.textContent).trim().length > 0
}

class Out {
  s = ''
  /** Ensure the next write starts on a fresh line. */
  lineStart() { if (this.s.length > 0 && !this.s.endsWith('\n')) this.s += '\n' }
  write(t: string) { this.s += t }
}

/** Inline-only serialization (used inside marks + links, where block
 *  structure can't be represented anyway). */
function inlineText(n: RichNode, inCode: boolean): string {
  if (n.nodeType === TEXT_NODE) return cleanText(n.textContent)
  if (n.nodeType !== ELEMENT_NODE) return ''
  const tag = n.nodeName.toUpperCase()
  if (tag === 'BR') return '\n'
  const kids = Array.from(n.childNodes)
  let s = ''
  kids.forEach((k, idx) => {
    // A trailing <br> in a block is the browser's caret placeholder.
    if (k.nodeType === ELEMENT_NODE && k.nodeName.toUpperCase() === 'BR' && idx === kids.length - 1 && idx > 0) return
    const piece = inlineText(k, inCode)
    if (isBlock(k) && s && !s.endsWith('\n')) s += '\n'
    s += piece
  })
  if (inCode) return s
  const mark = markFor(n)
  if (mark) return mark === 'code' ? wrapMark(inlineText(n, true), 'code') : wrapMark(s, mark)
  if (tag === 'A') {
    const href = safeHref(n.getAttribute?.('href'))
    const label = s.replace(/\n/g, ' ').trim()
    if (!href) return s
    if (!label || label === href) return href
    return `[${label.replace(/[[\]]/g, '')}](${href})`
  }
  return s
}

function serialize(n: RichNode, out: Out, listDepth: number): void {
  if (n.nodeType === TEXT_NODE) { out.write(cleanText(n.textContent)); return }
  if (n.nodeType !== ELEMENT_NODE) return
  const tag = n.nodeName.toUpperCase()

  if (tag === 'BR') { out.write('\n'); return }

  if (tag === 'UL' || tag === 'OL') {
    out.lineStart()
    let num = 1
    for (const li of Array.from(n.childNodes)) {
      if (li.nodeType !== ELEMENT_NODE) continue
      if (li.nodeName.toUpperCase() !== 'LI') {
        // Chrome nests a sub-list directly inside the parent list.
        serialize(li, out, listDepth + 1)
        continue
      }
      // Empty bullets (caret placeholders) would serialize as a bare "-".
      if (!hasMeaningfulContent(li)) continue
      out.lineStart()
      out.write('  '.repeat(listDepth) + (tag === 'OL' ? `${num++}. ` : '- '))
      serializeChildren(li, out, listDepth + 1, true)
      out.lineStart()
    }
    return
  }

  if (markFor(n) || tag === 'A') { out.write(inlineText(n, false)); return }

  if (isBlock(n)) {
    out.lineStart()
    serializeChildren(n, out, listDepth, false)
    out.lineStart()
    return
  }

  serializeChildren(n, out, listDepth, false)
}

function serializeChildren(n: RichNode, out: Out, listDepth: number, inListItem: boolean): void {
  const kids = Array.from(n.childNodes)
  kids.forEach((k, idx) => {
    const isBr = k.nodeType === ELEMENT_NODE && k.nodeName.toUpperCase() === 'BR'
    // Trailing <br> after real content is the browser's caret placeholder,
    // not a user line break. A lone <br> (`<div><br></div>`) IS an empty line.
    if (isBr && idx === kids.length - 1 && kids.slice(0, idx).some(hasMeaningfulContent)) return
    if (isBr && inListItem && kids.length === 1) return
    // Inside a list item a nested block would reset the line and lose the
    // bullet prefix — inline its content instead.
    if (inListItem && isBlock(k) && !['UL', 'OL'].includes(k.nodeName.toUpperCase())) {
      serializeChildren(k, out, listDepth, true)
      return
    }
    serialize(k, out, listDepth)
  })
}

export function richNodeToMarkdown(root: RichNode): string {
  const out = new Out()
  serializeChildren(root, out, 0, false)
  return out.s
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}
