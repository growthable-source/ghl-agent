import { describe, expect, it } from 'vitest'
import { richNodeToMarkdown, type RichNode } from './rich-text-markdown'

// Minimal DOM-shaped builders — the unit harness has no jsdom.
const t = (text: string): RichNode => ({ nodeType: 3, nodeName: '#text', textContent: text, childNodes: [] })
function el(tag: string, kids: RichNode[] = [], attrs: Record<string, string> = {}, style?: RichNode['style']): RichNode {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    get textContent() { return kids.map(k => k.textContent ?? '').join('') },
    childNodes: kids,
    getAttribute: (n: string) => attrs[n] ?? null,
    style,
  }
}
const root = (...kids: RichNode[]) => el('div', kids)
const md = (...kids: RichNode[]) => richNodeToMarkdown(root(...kids))

describe('richNodeToMarkdown', () => {
  it('passes plain text through', () => {
    expect(md(t('hello there'))).toBe('hello there')
  })

  it('serializes bold, italic, and code', () => {
    expect(md(t('a '), el('b', [t('bold')]), t(' '), el('i', [t('it')]), t(' '), el('code', [t('x()')])))
      .toBe('a **bold** *it* `x()`')
  })

  it('moves edge whitespace outside the delimiters', () => {
    expect(md(t('a'), el('strong', [t(' b ')]), t('c'))).toBe('a **b** c')
  })

  it('drops empty marks', () => {
    expect(md(t('a'), el('b', []), el('i', [t('  ')]))).toBe('a')
  })

  it('treats bold-styled spans as bold', () => {
    expect(md(el('span', [t('x')], {}, { fontWeight: '700' }))).toBe('**x**')
  })

  it('splits marks across line breaks so each line parses', () => {
    expect(md(el('b', [t('one'), el('br'), t('two')]))).toBe('**one**\n**two**')
  })

  it('serializes http links and drops unsafe hrefs', () => {
    expect(md(el('a', [t('docs')], { href: 'https://x.com/a' }))).toBe('[docs](https://x.com/a)')
    expect(md(el('a', [t('https://x.com')], { href: 'https://x.com' }))).toBe('https://x.com')
    expect(md(el('a', [t('click')], { href: 'javascript:alert(1)' }))).toBe('click')
  })

  it('maps Chrome div-per-line structure to lines and blank-line paragraphs', () => {
    // "first" ⏎ "second" ⏎ (empty) ⏎ "fourth"
    expect(md(t('first'), el('div', [t('second')]), el('div', [el('br')]), el('div', [t('fourth')])))
      .toBe('first\nsecond\n\nfourth')
  })

  it('maps Firefox br structure the same way', () => {
    expect(md(t('a'), el('br'), el('br'), t('b'))).toBe('a\n\nb')
  })

  it('ignores the trailing caret-placeholder br', () => {
    expect(md(el('div', [t('text'), el('br')]))).toBe('text')
    expect(md(t('text'), el('br'))).toBe('text')
  })

  it('serializes bullet and numbered lists', () => {
    expect(md(
      t('Options:'),
      el('ul', [el('li', [t('one')]), el('li', [el('b', [t('two')])])]),
      el('ol', [el('li', [t('first')]), el('li', [t('second')])]),
    )).toBe('Options:\n- one\n- **two**\n1. first\n2. second')
  })

  it('skips empty list items and keeps numbering contiguous', () => {
    expect(md(el('ol', [el('li', [el('br')]), el('li', [t('a')]), el('li', [t(' ')]), el('li', [t('b')])]))).toBe('1. a\n2. b')
  })

    it('indents nested lists', () => {
    expect(md(el('ul', [el('li', [t('a')]), el('ul', [el('li', [t('b')])])]))).toBe('- a\n  - b')
  })

  it('keeps list item content on the bullet line when wrapped in a block', () => {
    expect(md(el('ul', [el('li', [el('div', [t('x')])])]))).toBe('- x')
  })

  it('separates a paragraph after a list', () => {
    expect(md(el('ul', [el('li', [t('a')])]), el('div', [t('after')]))).toBe('- a\nafter')
  })

  it('normalizes nbsp, trailing spaces, and runs of blank lines', () => {
    expect(md(t('a\u00a0b  '), el('br'), el('br'), el('br'), el('br'), t('c'))).toBe('a b\n\nc')
  })

  it('drops zero-width spaces', () => {
    expect(md(el('code', [t('x')]), t('\u200b after'))).toBe('`x` after')
  })

  it('flattens unknown elements to their text', () => {
    expect(md(el('span', [el('font', [t('styled')])]))).toBe('styled')
  })
})
