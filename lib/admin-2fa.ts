/**
 * TOTP 2FA helpers for the super-admin cockpit.
 *
 * Uses otplib v13 functional API. Defaults (SHA-1 / 6 digits / 30s) are
 * what every authenticator app (Google Authenticator, 1Password, Authy,
 * Bitwarden) expects, so we don't override them.
 *
 * `epochTolerance: 30` allows ±30 seconds of clock skew between the
 * server and the user's phone — standard for TOTP to be usable.
 */

import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'

const ISSUER = 'Voxility Admin'

export function generateSecret(): string {
  return otpGenerateSecret()
}

export function otpauthUri(email: string, secret: string): string {
  return generateURI({
    strategy: 'totp',
    issuer: ISSUER,
    label: email,
    secret,
  })
}

export async function otpauthQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri(email, secret), { margin: 1, width: 220 })
}

export function verifyCode(code: string, secret: string): boolean {
  const cleaned = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  try {
    const result = verifySync({ secret, token: cleaned, epochTolerance: 30 })
    return result.valid
  } catch {
    return false
  }
}
