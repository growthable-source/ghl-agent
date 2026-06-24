import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey } from './api-key'

describe('api-key', () => {
  it('generates a vox_live_ prefixed key with a 12-char display prefix', () => {
    const { raw, prefix, hashed } = generateApiKey()
    expect(raw.startsWith('vox_live_')).toBe(true)
    expect(prefix).toBe(raw.slice(0, 12))
    expect(prefix.length).toBe(12)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
  })

  it('hashApiKey is deterministic and matches generate', () => {
    const { raw, hashed } = generateApiKey()
    expect(hashApiKey(raw)).toBe(hashed)
  })

  it('different keys produce different hashes', () => {
    expect(generateApiKey().hashed).not.toBe(generateApiKey().hashed)
  })
})
