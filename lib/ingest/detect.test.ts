import { describe, it, expect } from 'vitest'
import { detectUrlKind, detectionFor } from './detect'

describe('detectUrlKind', () => {
  it('classifies YouTube URLs in all common shapes', () => {
    expect(detectUrlKind('https://www.youtube.com/watch?v=abc123')).toBe('youtube')
    expect(detectUrlKind('https://youtu.be/abc123')).toBe('youtube')
    expect(detectUrlKind('https://www.youtube.com/@somehandle')).toBe('youtube')
    expect(detectUrlKind('https://www.youtube.com/channel/UCxyz')).toBe('youtube')
    expect(detectUrlKind('https://m.youtube.com/watch?v=abc')).toBe('youtube')
  })

  it('classifies obvious feed URLs', () => {
    expect(detectUrlKind('https://blog.example.com/feed')).toBe('rss')
    expect(detectUrlKind('https://example.com/rss')).toBe('rss')
    expect(detectUrlKind('https://example.com/rss.xml')).toBe('rss')
    expect(detectUrlKind('https://example.com/atom.xml')).toBe('rss')
    expect(detectUrlKind('https://example.com/feeds/posts')).toBe('rss')
    expect(detectUrlKind('https://example.com/blog/index.xml')).toBe('rss')
  })

  it('defaults everything else to website', () => {
    expect(detectUrlKind('https://help.example.com')).toBe('website')
    expect(detectUrlKind('https://example.com/docs/getting-started')).toBe('website')
    expect(detectUrlKind('https://example.com/sitemap.xml')).toBe('website')
    expect(detectUrlKind('not a url at all')).toBe('website')
  })

  it('does not misfire on words containing feed/rss outside path patterns', () => {
    expect(detectUrlKind('https://example.com/feedback')).toBe('website')
    expect(detectUrlKind('https://grss-fabrics.com/products')).toBe('website')
  })
})

describe('detectionFor', () => {
  it('feeds re-check daily; websites weekly; files never (no config path)', () => {
    expect(detectionFor('https://x.com/feed', 'rss').recrawlIntervalDays).toBe(1)
    expect(detectionFor('https://x.com', 'website').recrawlIntervalDays).toBe(7)
  })

  it('labels channels vs single videos', () => {
    expect(detectionFor('https://www.youtube.com/@growthable', 'youtube').label).toBe('YouTube channel')
    expect(detectionFor('https://youtu.be/abc', 'youtube').label).toBe('YouTube video')
  })

  it('labels sitemaps distinctly and keeps recursive crawl config', () => {
    const d = detectionFor('https://example.com/sitemap.xml', 'website')
    expect(d.label).toBe('sitemap')
    expect(d.crawlConfig.recursive).toBe(true)
    expect(d.sourceType).toBe('docs')
  })
})
