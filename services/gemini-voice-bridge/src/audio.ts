/**
 * Audio transcode for the Twilio ↔ Gemini bridge.
 *
 * Twilio Media Streams carry G.711 μ-law, 8 kHz, mono, base64.
 * Gemini Live wants PCM16 16 kHz mono in, and emits PCM16 24 kHz mono out.
 *
 * Pipeline:
 *   inbound : μ-law 8k  → PCM16 8k → resample 16k → Gemini
 *   outbound: Gemini PCM16 24k → resample 8k → μ-law 8k → Twilio
 *
 * μ-law is the standard ITU-T G.711 implementation (BIAS 0x84, CLIP 32635).
 */

const BIAS = 0x84
const CLIP = 32635

/** Encode one PCM16 sample (-32768..32767) to an 8-bit μ-law code. */
export function muLawEncodeSample(sample: number): number {
  let s = sample
  // Clamp to int16.
  if (s > 32767) s = 32767
  if (s < -32768) s = -32768
  // Sign bit, then work with magnitude.
  let sign = (s >> 8) & 0x80
  if (sign !== 0) s = -s
  if (s > CLIP) s = CLIP
  s = s + BIAS
  // Find exponent (position of highest set bit above the bias region).
  let exponent = 7
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f
  const muLaw = ~(sign | (exponent << 4) | mantissa) & 0xff
  return muLaw
}

/** Decode one 8-bit μ-law code to a PCM16 sample. */
export function muLawDecodeSample(muLaw: number): number {
  const u = ~muLaw & 0xff
  const sign = u & 0x80
  const exponent = (u >> 4) & 0x07
  const mantissa = u & 0x0f
  let sample = ((mantissa << 3) + BIAS) << exponent
  sample -= BIAS
  // `|| 0` normalizes the μ-law "negative zero" (0x7F) from -0 to +0 —
  // identical for audio, and avoids JS's -0/+0 distinction downstream.
  return (sign !== 0 ? -sample : sample) || 0
}

/** Decode a μ-law byte Buffer to PCM16. */
export function muLawDecode(ulaw: Buffer): Int16Array {
  const out = new Int16Array(ulaw.length)
  for (let i = 0; i < ulaw.length; i++) out[i] = muLawDecodeSample(ulaw[i])
  return out
}

/** Encode PCM16 to a μ-law byte Buffer. */
export function muLawEncode(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = muLawEncodeSample(pcm[i])
  return out
}

/**
 * Linear resampler. Maps `src` (at `srcRate`) onto `dstRate` using
 * straight-line interpolation between neighbouring source samples.
 * Adequate for 8↔16↔24 kHz speech; no anti-alias filter (the rate
 * ratios here are gentle and Gemini/Twilio both band-limit voice).
 */
export function resampleLinear(src: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) return src
  const dstLen = Math.round((src.length * dstRate) / srcRate)
  if (dstLen <= 0) return new Int16Array(0)
  const out = new Int16Array(dstLen)
  const ratio = (src.length - 1) / Math.max(1, dstLen - 1)
  for (let i = 0; i < dstLen; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = src[idx] ?? 0
    const b = src[idx + 1] ?? a
    out[i] = Math.round(a + (b - a) * frac)
  }
  return out
}
