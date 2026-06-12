'use client'

/**
 * Tiny, safe markdown renderer for chat bubbles.
 *
 * Agent replies are written in markdown but the widget + inbox bubbles
 * rendered them as plain text — visitors saw literal "**Triggers**" and
 * bullet lists collapsed into paragraphs. Pulling in a full markdown
 * stack for a chat bubble is overkill (and react-markdown isn't a
 * dependency), so this hand-rolls the small subset chat replies
 * actually use, building React nodes directly — no HTML strings, no
 * injection surface.
 *
 * Supported:
 *   blocks  — paragraphs, #–###### headings (rendered as compact bold
 *             lines, not giant h1s), bullet lists (hyphen, asterisk,
 *             or •), "1." ordered lists, ``` code fences
 *   inline  — **bold**, *italic*, `code`, [label](https://…) links,
 *             bare https:// URLs
 *
 * Everything inherits the bubble's text colour so it works on both the
 * accent-coloured operator bubble and the grey visitor-facing one.
 */

import React from 'react'

// NOTE: no lookbehind anywhere — Safari only parses lookbehind from
// 16.4, and a regex literal it can't parse kills the entire script
// chunk (the widget runs in arbitrary visitor browsers). The italic
// pattern captures its one-char prefix instead; renderInline re-emits
// it as plain text.
const INLINE_PATTERNS: Array<{ type: 'code' | 'bold' | 'italic' | 'link' | 'url'; re: RegExp }> = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'bold', re: /\*\*([^*]+)\*\*/ },
  { type: 'italic', re: /(^|[\s(])\*([^*\s][^*]*?)\*(?![\w*])/ },
  { type: 'link', re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/ },
  { type: 'url', re: /https?:\/\/[^\s<>"')\]]+/ },
]

function renderInline(text: string, keyBase: string, allowBold = true): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let rest = text
  let i = 0
  while (rest.length > 0) {
    let earliest: { type: string; match: RegExpExecArray } | null = null
    for (const p of INLINE_PATTERNS) {
      if (p.type === 'bold' && !allowBold) continue
      const m = p.re.exec(rest)
      if (m && (earliest === null || m.index < earliest.match.index)) {
        earliest = { type: p.type, match: m }
      }
    }
    if (!earliest) { out.push(rest); break }
    const { type, match } = earliest
    // Italic's regex captures a one-char prefix (start-of-string or
    // whitespace/paren) in match[1] — keep it as plain text.
    const prefixLen = type === 'italic' ? match[1].length : 0
    if (match.index + prefixLen > 0) out.push(rest.slice(0, match.index + prefixLen))
    const key = `${keyBase}-${i++}`
    if (type === 'code') {
      out.push(
        <code key={key} className="px-1 py-0.5 rounded bg-black/15 font-mono text-[0.875em]">
          {match[1]}
        </code>,
      )
    } else if (type === 'bold') {
      // Bold content can carry italic/code/links inside; bold inside
      // bold can't occur (the ** delimiters would have split it).
      out.push(<strong key={key} className="font-semibold">{renderInline(match[1], key, false)}</strong>)
    } else if (type === 'italic') {
      out.push(<em key={key}>{match[2]}</em>)
    } else if (type === 'link') {
      out.push(
        <a key={key} href={match[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
          {match[1]}
        </a>,
      )
    } else {
      // Bare URL — trim trailing punctuation that's almost certainly
      // sentence-level, not part of the link ("see https://x.com.").
      let url = match[0]
      let trail = ''
      while (/[.,;:!?]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1) }
      out.push(
        <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all hover:opacity-80">
          {url}
        </a>,
      )
      if (trail) out.push(trail)
    }
    rest = rest.slice(match.index + match[0].length)
  }
  return out
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/
const ORDERED_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/

export default function ChatMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let key = 0

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return
    const k = `p${key++}`
    blocks.push(
      <p key={k} className="my-1.5 leading-snug">
        {buf.map((ln, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(ln, `${k}-${j}`)}
          </React.Fragment>
        ))}
      </p>,
    )
  }

  let para: string[] = []
  while (i < lines.length) {
    const line = lines[i]

    if (/^```/.test(line)) {
      flushParagraph(para); para = []
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++ // skip closing fence (or run off the end on an unclosed one)
      blocks.push(
        <pre key={`c${key++}`} className="my-1.5 p-2 rounded-lg bg-black/15 font-mono text-[0.85em] overflow-x-auto whitespace-pre-wrap">
          {code.join('\n')}
        </pre>,
      )
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushParagraph(para); para = []
      blocks.push(
        <p key={`h${key++}`} className="mt-2.5 mb-1 font-semibold leading-snug">
          {renderInline(heading[2], `h${key}`)}
        </p>,
      )
      i++
      continue
    }

    if (BULLET_RE.test(line)) {
      flushParagraph(para); para = []
      const items: string[] = []
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(BULLET_RE.exec(lines[i])![1])
        i++
      }
      blocks.push(
        <ul key={`u${key++}`} className="my-1.5 pl-4 list-disc space-y-1 leading-snug">
          {items.map((it, j) => <li key={j}>{renderInline(it, `u${key}-${j}`)}</li>)}
        </ul>,
      )
      continue
    }

    if (ORDERED_RE.test(line)) {
      flushParagraph(para); para = []
      const items: string[] = []
      let start = 1
      let first = true
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        const m = ORDERED_RE.exec(lines[i])!
        if (first) { start = parseInt(m[1], 10) || 1; first = false }
        items.push(m[2])
        i++
      }
      blocks.push(
        <ol key={`o${key++}`} start={start} className="my-1.5 pl-4 list-decimal space-y-1 leading-snug">
          {items.map((it, j) => <li key={j}>{renderInline(it, `o${key}-${j}`)}</li>)}
        </ol>,
      )
      continue
    }

    if (line.trim() === '') {
      flushParagraph(para); para = []
      i++
      continue
    }

    para.push(line)
    i++
  }
  flushParagraph(para)

  // Trim the outer margins so the bubble's own padding frames the
  // content — without this the first/last paragraph margins make the
  // bubble look unevenly padded.
  return <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>
}
