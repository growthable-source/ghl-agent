import { describe, expect, it } from 'vitest'
import { brandedPageTitle, brandIconSvg, brandManifest, brandMetadata, cleanBrandName, parseBrandSettings, safeAccent } from './brand-metadata'

describe('brandMetadata', () => {
  const md = brandMetadata({ name: 'Zolutium', iconUrl: null, accent: '#1d4ed8' }, 'https://live.zolutium.com')

  it('brands the title and replaces every root key that names us', () => {
    expect(md.title).toEqual({ absolute: 'Zolutium', template: '%s | Zolutium' })
    expect(md.applicationName).toBe('Zolutium')
    expect(md.openGraph).toMatchObject({ siteName: 'Zolutium', title: 'Zolutium' })
    expect(md.twitter).toMatchObject({ title: 'Zolutium' })
    for (const k of ['description', 'keywords', 'authors', 'creator', 'publisher'] as const) expect(md[k]).toBeNull()
    expect(JSON.stringify(md).toLowerCase()).not.toContain('xovera')
  })
  it("resolves URLs against the customer's host and is never indexed", () => {
    expect(String(md.metadataBase)).toBe('https://live.zolutium.com/')
    expect(md.alternates).toEqual({ canonical: null })
    expect(md.robots).toEqual({ index: false, follow: false })
  })
  it('falls back to a neutral name, never ours', () => {
    expect(brandMetadata({ name: '  ', iconUrl: null, accent: null }, null).title).toEqual({ absolute: 'Support', template: '%s | Support' })
  })
})

describe('brandIconSvg', () => {
  it("draws the brand's initial on its accent", () => {
    const svg = brandIconSvg('zolutium', '#1d4ed8')
    expect(svg).toContain('fill="#1d4ed8"')
    expect(svg).toContain('>Z</text>')
  })
  it('rejects unsafe accents and escapes nothing dangerous through', () => {
    const svg = brandIconSvg('<x', '"/><script>')
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('fill="#52525b"')
    expect(svg).toContain('>X</text>')
  })
  it('renders a plain tile when the name has no letters', () => {
    expect(brandIconSvg('', null)).not.toContain('<text')
  })
})

describe('helpers', () => {
  it('cleans names and accents', () => {
    expect(cleanBrandName('  Acme   Live  ')).toBe('Acme Live')
    expect(safeAccent('#ABCDEF')).toBe('#ABCDEF')
    expect(safeAccent('red')).toBeNull()
  })
  it('manifest is branded', () => {
    const m = brandManifest({ name: 'Zolutium Live Help', iconUrl: null, accent: null })
    expect(m.name).toBe('Zolutium Live Help')
    expect(m.short_name).toBe('Zolutium Liv')
    expect(JSON.stringify(m).toLowerCase()).not.toContain('xovera')
  })
})

describe('parseBrandSettings', () => {
  it('accepts and normalizes', () => {
    expect(parseBrandSettings({ brandName: '  Zolutium   Live ', faviconUrl: 'https://cdn.x.com/f.png', rootUrl: 'https://zolutium.com' }))
      .toEqual({ ok: true, value: { brandName: 'Zolutium Live', faviconUrl: 'https://cdn.x.com/f.png', rootUrl: 'https://zolutium.com/', logoUrl: null, accentColor: null, loginHeading: null, loginMessage: null } })
  })
  it('accepts sign-in page branding', () => {
    expect(parseBrandSettings({
      logoUrl: 'https://cdn.x.com/logo.png', accentColor: ' #1D4ED8 ',
      loginHeading: '  Team   sign in ', loginMessage: 'Line one  \r\n\n\n\nLine two',
    })).toEqual({ ok: true, value: {
      brandName: null, faviconUrl: null, rootUrl: null,
      logoUrl: 'https://cdn.x.com/logo.png', accentColor: '#1d4ed8',
      loginHeading: 'Team sign in', loginMessage: 'Line one\n\nLine two',
    } })
  })
  it('blank fields clear to null', () => {
    const empty = { brandName: null, faviconUrl: null, rootUrl: null, logoUrl: null, accentColor: null, loginHeading: null, loginMessage: null }
    expect(parseBrandSettings({ brandName: ' ', faviconUrl: '', rootUrl: null, accentColor: '', loginHeading: '  ' })).toEqual({ ok: true, value: empty })
    expect(parseBrandSettings(undefined)).toEqual({ ok: true, value: empty })
  })
  it('rejects bad input', () => {
    expect(parseBrandSettings({ faviconUrl: 'http://x.com/f.png' }).ok).toBe(false)
    expect(parseBrandSettings({ faviconUrl: 'javascript:alert(1)' }).ok).toBe(false)
    expect(parseBrandSettings({ rootUrl: 'zolutium.com' }).ok).toBe(false)
    expect(parseBrandSettings({ rootUrl: 'ftp://zolutium.com' }).ok).toBe(false)
    expect(parseBrandSettings({ brandName: 'x'.repeat(61) }).ok).toBe(false)
    expect(parseBrandSettings({ brandName: 5 }).ok).toBe(false)
    expect(parseBrandSettings({ logoUrl: 'http://x.com/l.png' }).ok).toBe(false)
    expect(parseBrandSettings({ accentColor: 'blue' }).ok).toBe(false)
    expect(parseBrandSettings({ accentColor: '#12345' }).ok).toBe(false)
    expect(parseBrandSettings({ loginHeading: 'x'.repeat(81) }).ok).toBe(false)
    expect(parseBrandSettings({ loginMessage: 'x'.repeat(501) }).ok).toBe(false)
  })
})

describe('brandedPageTitle', () => {
  it('formats a same-segment page title under the brand', () => {
    expect(brandedPageTitle({ name: 'Zolutium', iconUrl: null, accent: null }, 'Talk to us')).toEqual({ absolute: 'Talk to us | Zolutium' })
  })
})
