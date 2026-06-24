import { randomBytes, createHash } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function base62(bytes: Buffer): string {
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 62]
  return out
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateApiKey(): { raw: string; prefix: string; hashed: string } {
  const raw = `vox_live_${base62(randomBytes(32))}`
  return { raw, prefix: raw.slice(0, 12), hashed: hashApiKey(raw) }
}
