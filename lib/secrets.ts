/**
 * Symmetric encryption for at-rest secrets (MCP server bearer tokens, etc).
 *
 * Uses AES-256-GCM. Reads a base64-encoded 32-byte key from
 * SECRETS_ENCRYPTION_KEY. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Stored format:
 *   <base64 ciphertext>.<base64 iv>.<base64 authTag>
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('SECRETS_ENCRYPTION_KEY env var is not set — cannot encrypt or decrypt secrets.')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use \`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\`.`)
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [ct.toString('base64'), iv.toString('base64'), authTag.toString('base64')].join('.')
}

export function decryptSecret(packed: string): string {
  const key = getKey()
  const [ctB64, ivB64, tagB64] = packed.split('.')
  if (!ctB64 || !ivB64 || !tagB64) throw new Error('Invalid ciphertext format')
  const ct = Buffer.from(ctB64, 'base64')
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Mask a secret for display (last 4 chars). */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 4) return '••••'
  return '••••' + secret.slice(-4)
}
