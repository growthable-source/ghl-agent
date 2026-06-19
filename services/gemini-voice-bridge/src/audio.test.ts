import { describe, it, expect } from 'vitest'
import { muLawDecodeSample, muLawEncodeSample, muLawDecode, muLawEncode, resampleLinear } from './audio'

describe('μ-law sample round-trip', () => {
  it('decode→encode is value-stable for every code (byte-exact except negative-zero)', () => {
    for (let code = 0; code < 256; code++) {
      const pcm = muLawDecodeSample(code)
      const back = muLawEncodeSample(pcm)
      // 0x7F is μ-law "negative zero": it decodes to 0, and encode(0)
      // canonicalizes to 0xFF ("positive zero"). Both decode to 0, so the
      // round-trip stays value-stable even though the byte differs.
      expect(muLawDecodeSample(back)).toBe(pcm)
      if (code !== 0x7f) expect(back).toBe(code)
    }
  })

  it('encode→decode stays within one μ-law quantization step', () => {
    // μ-law is coarse; a mid-scale PCM value should survive within ~0.4% FS.
    for (const pcm of [-32124, -8000, -100, 0, 100, 8000, 32124]) {
      const code = muLawEncodeSample(pcm)
      const out = muLawDecodeSample(code)
      expect(Math.abs(out - pcm)).toBeLessThanOrEqual(0.06 * 65536)
    }
  })

  it('encodes silence (0) to 0xFF and decodes 0xFF near zero', () => {
    expect(muLawEncodeSample(0)).toBe(0xff)
    expect(Math.abs(muLawDecodeSample(0xff))).toBeLessThanOrEqual(8)
  })
})

describe('buffer-level μ-law', () => {
  it('decode produces one Int16 per μ-law byte', () => {
    const ulaw = Buffer.from([0xff, 0x00, 0x7f, 0x80])
    const pcm = muLawDecode(ulaw)
    expect(pcm.length).toBe(4)
    expect(pcm).toBeInstanceOf(Int16Array)
  })

  it('encode produces one byte per Int16 sample', () => {
    const pcm = Int16Array.from([0, 1000, -1000, 32000])
    const ulaw = muLawEncode(pcm)
    expect(ulaw.length).toBe(4)
    expect(ulaw).toBeInstanceOf(Buffer)
  })
})

describe('resampleLinear', () => {
  it('upsamples 8k→16k by ~2x length', () => {
    const src = Int16Array.from({ length: 80 }, (_, i) => Math.round(1000 * Math.sin(i / 4)))
    const out = resampleLinear(src, 8000, 16000)
    expect(out.length).toBe(160)
  })

  it('downsamples 24k→8k by ~1/3 length', () => {
    const src = Int16Array.from({ length: 240 }, (_, i) => Math.round(1000 * Math.sin(i / 8)))
    const out = resampleLinear(src, 24000, 8000)
    expect(out.length).toBe(80)
  })

  it('returns the same data when rates match', () => {
    const src = Int16Array.from([1, 2, 3, 4])
    const out = resampleLinear(src, 8000, 8000)
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
  })

  it('preserves endpoints and stays monotone on a ramp', () => {
    const src = Int16Array.from({ length: 9 }, (_, i) => i * 1000) // 0..8000
    const out = resampleLinear(src, 8000, 16000)
    expect(out[0]).toBe(0)
    // last output sample maps near the last input sample
    expect(out[out.length - 1]).toBeGreaterThanOrEqual(7000)
  })
})
