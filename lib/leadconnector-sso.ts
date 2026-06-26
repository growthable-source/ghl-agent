/**
 * Decryption for LeadConnector Custom App SSO payloads.
 *
 * When Xovera is embedded as an iframe inside LeadConnector (via a
 * Custom Menu Link in the marketplace listing), the parent frame posts
 * an encrypted blob containing the active user's identity. We decrypt
 * it with the Shared Secret (a.k.a. "SSO Key") from the marketplace app
 * settings, trust the resulting user info because LeadConnector signed
 * it with our secret, and mint a Xovera session from it.
 *
 * Encryption format is OpenSSL-compatible (CryptoJS.AES.encrypt default):
 *   base64(  "Salted__" || salt[8] || ciphertext  )
 *
 * Key + IV are derived via EVP_BytesToKey(MD5, password, salt) — 32 bytes
 * of key + 16 bytes of IV for AES-256-CBC. This is what the marketplace
 * emits today; if they switch to authenticated encryption in the future,
 * swap the algorithm below — the call sites won't change.
 */

import crypto from 'node:crypto'

export interface DecryptedSsoPayload {
  userId: string
  companyId: string
  // Sub-account context. When the user opens the menu link inside a
  // location, activeLocation is set to that location's id. For agency-
  // level menu links (no sub-account selected) this may be undefined.
  activeLocation?: string
  type?: 'agency' | 'location'
  role?: 'admin' | 'user'
  userName?: string
  email?: string
  // Anything else the marketplace stuffs in there. Treated as untrusted
  // until we map it to our own ids.
  [key: string]: unknown
}

/**
 * Derive AES-256-CBC key + IV from password + salt the way OpenSSL does
 * with `-md md5` (which is what CryptoJS's default AES does too).
 *
 * Iterates MD5 over (prev || password || salt) until 48 bytes accumulate
 * — first 32 are the key, last 16 are the IV.
 */
function evpBytesToKey(password: Buffer, salt: Buffer, keyLen: number, ivLen: number) {
  const out = Buffer.alloc(keyLen + ivLen)
  let written = 0
  let prev = Buffer.alloc(0)
  while (written < keyLen + ivLen) {
    const hash = crypto.createHash('md5')
    hash.update(prev)
    hash.update(password)
    hash.update(salt)
    prev = hash.digest()
    const take = Math.min(prev.length, keyLen + ivLen - written)
    prev.copy(out, written, 0, take)
    written += take
  }
  return { key: out.subarray(0, keyLen), iv: out.subarray(keyLen, keyLen + ivLen) }
}

export function decryptSsoBlob(encryptedBase64: string, sharedSecret: string): DecryptedSsoPayload {
  if (!sharedSecret) {
    throw new Error('LEADCONNECTOR_SSO_KEY is not configured. Set it in env to the Shared Secret from your marketplace app settings.')
  }
  const raw = Buffer.from(encryptedBase64, 'base64')
  if (raw.length < 16 || raw.subarray(0, 8).toString('utf8') !== 'Salted__') {
    throw new Error('Encrypted payload is not in OpenSSL "Salted__" format — the marketplace may have changed its SSO encryption scheme.')
  }
  const salt = raw.subarray(8, 16)
  const ciphertext = raw.subarray(16)
  const { key, iv } = evpBytesToKey(Buffer.from(sharedSecret, 'utf8'), salt, 32, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted) as DecryptedSsoPayload
}
