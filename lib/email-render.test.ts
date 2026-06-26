import { describe, it, expect } from 'vitest'
import { renderBrandedEmail, escapeHtml, paragraphs } from './email-render'

describe('renderBrandedEmail', () => {
  it('renders title in both html and plaintext', () => {
    const { html, text } = renderBrandedEmail({
      title: 'Trial ending in 3 days',
      bodyHtml: '<p>Pick a plan to keep your agents running.</p>',
    })
    expect(html).toContain('Trial ending in 3 days')
    expect(text).toContain('Trial ending in 3 days')
  })

  it('escapes title content but allows raw bodyHtml', () => {
    const { html } = renderBrandedEmail({
      title: '<script>alert(1)</script>',
      bodyHtml: '<p>Hello <strong>there</strong>.</p>',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    // Raw bodyHtml is preserved — callers own escaping there.
    expect(html).toContain('<strong>there</strong>')
  })

  it('includes the CTA button when provided', () => {
    const { html, text } = renderBrandedEmail({
      title: 'Pay your invoice',
      bodyHtml: '<p>Last attempt failed.</p>',
      severity: 'error',
      cta: { label: 'Update billing', url: 'https://example.com/billing' },
    })
    expect(html).toContain('Update billing')
    expect(html).toContain('https://example.com/billing')
    // The plaintext version surfaces it too.
    expect(text).toContain('Update billing: https://example.com/billing')
  })

  it('renders different colour bars per severity', () => {
    const error = renderBrandedEmail({ title: 'x', bodyHtml: '', severity: 'error' }).html
    const warning = renderBrandedEmail({ title: 'x', bodyHtml: '', severity: 'warning' }).html
    const info = renderBrandedEmail({ title: 'x', bodyHtml: '', severity: 'info' }).html
    expect(error).toContain('#ef4444')
    expect(warning).toContain('#f59e0b')
    // The default accent shows up for info.
    expect(info).toContain('#fa4d2e')
  })

  it('renders a severity badge for warning + error, omits for info', () => {
    expect(renderBrandedEmail({ title: 't', bodyHtml: '', severity: 'warning' }).html).toContain('Action needed')
    expect(renderBrandedEmail({ title: 't', bodyHtml: '', severity: 'error' }).html).toContain('Attention required')
    expect(renderBrandedEmail({ title: 't', bodyHtml: '', severity: 'info' }).html).not.toContain('Action needed')
  })

  it('hides the manage-notifications link when no URL given', () => {
    const html = renderBrandedEmail({ title: 't', bodyHtml: '' }).html
    expect(html).not.toContain('Manage notifications')
  })

  it('renders the manage-notifications link when URL provided', () => {
    const html = renderBrandedEmail({
      title: 't',
      bodyHtml: '',
      manageNotificationsUrl: 'https://app.xovera.io/dashboard',
    }).html
    expect(html).toContain('Manage notifications')
    expect(html).toContain('https://app.xovera.io/dashboard')
  })

  it('embeds the brand wordmark in the hero header', () => {
    const html = renderBrandedEmail({ title: 't', bodyHtml: '' }).html
    expect(html).toContain('Xovera')
    // No external image hosts referenced — every brand element is
    // CSS-only.
    expect(html).not.toMatch(/<img[^>]*src=/i)
  })
})

describe('escapeHtml', () => {
  it('escapes the five XML special chars', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })
})

describe('paragraphs', () => {
  it('escapes string entries', () => {
    expect(paragraphs(['Hello <world>'])).toContain('Hello &lt;world&gt;')
  })

  it('passes through {html:...} entries raw', () => {
    expect(paragraphs([{ html: '<a href="x">link</a>' }])).toContain('<a href="x">link</a>')
  })
})
