import { describe, it, expect } from 'vitest'
import { extractMarkdownFromHtml, extractTitle, extractLinks, normalizeCrawlUrl } from './native-web'

describe('extractMarkdownFromHtml', () => {
  it('converts headings, paragraphs and lists; strips chrome', () => {
    const html = `
      <html><head><title>Doc</title><style>.x{color:red}</style></head><body>
      <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
      <main>
        <h1>Getting Started</h1>
        <p>Welcome to the <strong>product</strong>.</p>
        <h2>Install</h2>
        <ul><li>Step one</li><li>Step two</li></ul>
      </main>
      <footer><p>© 2026 Corp</p></footer>
      <script>track()</script>
      </body></html>`
    const md = extractMarkdownFromHtml(html)
    expect(md).toContain('## Getting Started') // h1 demoted to ## for the chunker
    expect(md).toContain('Welcome to the product')
    expect(md).toContain('## Install')
    expect(md).toContain('- Step one')
    expect(md).not.toContain('Pricing') // nav stripped
    expect(md).not.toContain('© 2026') // footer stripped
    expect(md).not.toContain('track()')
  })

  it('prefers <main> content over surrounding page shell', () => {
    const filler = '<p>' + 'sidebar junk '.repeat(30) + '</p>'
    const html = `<body><div>${filler}</div><main><h2>Real content</h2><p>${'body text '.repeat(40)}</p></main></body>`
    const md = extractMarkdownFromHtml(html)
    expect(md).toContain('Real content')
    expect(md).not.toContain('sidebar junk')
  })

  it('decodes HTML entities', () => {
    const md = extractMarkdownFromHtml('<main><p>Fish &amp; chips &gt; salad &#8212; truly</p></main>')
    expect(md).toContain('Fish & chips > salad — truly')
  })

  it('dedupes repeated boilerplate blocks', () => {
    const md = extractMarkdownFromHtml('<p>Accept cookies</p><p>Real paragraph</p><p>Accept cookies</p>')
    expect(md.match(/Accept cookies/g)?.length).toBe(1)
  })

  it('falls back to raw text when no block tags exist (above the noise floor)', () => {
    const text =
      'plain text page with enough words to pass the one-hundred-character minimum threshold for raw extraction to kick in properly'
    expect(extractMarkdownFromHtml(`<div>${text}</div>`)).toContain('plain text page')
    // Sub-floor fragments are treated as noise, not content.
    expect(extractMarkdownFromHtml('<div>tiny fragment</div>')).toBe('')
  })
})

describe('extractTitle', () => {
  it('prefers og:title over <title>', () => {
    const html = '<head><meta property="og:title" content="OG Name"/><title>Tab Name</title></head>'
    expect(extractTitle(html)).toBe('OG Name')
  })
  it('falls back to <title>', () => {
    expect(extractTitle('<title>Just a Tab</title>')).toBe('Just a Tab')
  })
})

describe('normalizeCrawlUrl + extractLinks', () => {
  it('keeps same-host content links, resolves relative, drops assets/anchors/mailto', () => {
    const html = `
      <a href="/docs/intro">Intro</a>
      <a href="https://example.com/docs/setup#section">Setup</a>
      <a href="https://other.com/page">External</a>
      <a href="/logo.png">Logo</a>
      <a href="mailto:hi@example.com">Mail</a>`
    const links = extractLinks(html, 'https://example.com/docs/', 'example.com')
    expect(links).toContain('https://example.com/docs/intro')
    expect(links).toContain('https://example.com/docs/setup') // hash stripped
    expect(links.find(l => l.includes('other.com'))).toBeUndefined()
    expect(links.find(l => l.includes('logo.png'))).toBeUndefined()
    expect(links.find(l => l.startsWith('mailto'))).toBeUndefined()
  })

  it('normalizeCrawlUrl rejects javascript: and foreign protocols', () => {
    expect(normalizeCrawlUrl('javascript:void(0)', 'https://x.com', 'x.com')).toBeNull()
    expect(normalizeCrawlUrl('ftp://x.com/file', 'https://x.com', 'x.com')).toBeNull()
  })
})
