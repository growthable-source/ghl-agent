import { describe, it, expect, afterEach } from 'vitest'
import { providerKeyMissing } from './index'

const VAR = 'TEST_PROVIDER_KEY_ENV'

afterEach(() => {
  delete process.env[VAR]
})

describe('providerKeyMissing', () => {
  it('reports an unset variable as missing', () => {
    expect(providerKeyMissing({ apiKeyEnv: VAR })).toBe(true)
  })

  it('reports an empty string as missing', () => {
    process.env[VAR] = ''
    expect(providerKeyMissing({ apiKeyEnv: VAR })).toBe(true)
  })

  // A whitespace-only value reaches the provider as `Bearer ` — the exact
  // 401 "Missing Authentication header" that hid the renamed OpenRouter
  // credential for five days. Treat it as absent, not as a real key.
  it('reports a whitespace-only value as missing', () => {
    process.env[VAR] = '   \n'
    expect(providerKeyMissing({ apiKeyEnv: VAR })).toBe(true)
  })

  it('accepts a real key', () => {
    process.env[VAR] = 'sk-or-v1-abc123'
    expect(providerKeyMissing({ apiKeyEnv: VAR })).toBe(false)
  })

  // Trailing whitespace from an `echo`-piped `vercel env add` still
  // authenticates upstream, so it must NOT be treated as missing.
  it('accepts a key with trailing whitespace', () => {
    process.env[VAR] = 'sk-or-v1-abc123\n'
    expect(providerKeyMissing({ apiKeyEnv: VAR })).toBe(false)
  })
})
