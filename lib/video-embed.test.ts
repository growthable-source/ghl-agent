import { describe, it, expect } from 'vitest'
import { parseVideo } from './video-embed'

describe('parseVideo', () => {
  it('parses youtube watch + youtu.be to an iframe embed', () => {
    expect(parseVideo('https://www.youtube.com/watch?v=abc123XYZ')).toEqual({
      kind: 'iframe',
      src: 'https://www.youtube.com/embed/abc123XYZ?rel=0&autoplay=0',
    })
    expect(parseVideo('https://youtu.be/abc123XYZ').kind).toBe('iframe')
  })
  it('parses vimeo (with or without /video/)', () => {
    expect(parseVideo('https://vimeo.com/123456789').kind).toBe('iframe')
    expect(parseVideo('https://vimeo.com/video/123456789').kind).toBe('iframe')
  })
  it('parses loom share + embed', () => {
    expect(parseVideo('https://www.loom.com/share/abcdef123456').kind).toBe('iframe')
    expect(parseVideo('https://www.loom.com/embed/abcdef123456').kind).toBe('iframe')
  })
  it('passes the autoplay flag through', () => {
    expect(parseVideo('https://youtu.be/abc123XYZ', { autoplay: true }).src).toContain('autoplay=1')
  })
  it('treats mp4/webm as a native file', () => {
    expect(parseVideo('https://cdn.example.com/demo.mp4')).toEqual({ kind: 'file', src: 'https://cdn.example.com/demo.mp4' })
    expect(parseVideo('https://cdn.example.com/demo.webm?v=2').kind).toBe('file')
  })
  it('returns none for empty / null / unrecognized', () => {
    expect(parseVideo('')).toEqual({ kind: 'none' })
    expect(parseVideo(null)).toEqual({ kind: 'none' })
    expect(parseVideo('https://example.com/not-a-video')).toEqual({ kind: 'none' })
  })
})
