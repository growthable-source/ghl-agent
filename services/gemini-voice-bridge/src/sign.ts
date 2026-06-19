import { createHmac } from 'node:crypto'

/** HMAC-SHA256 (base64url) of a request body — the X-Voice-Signature value. */
export function signBridgeRequest(secret: string, body: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(body).digest('base64url')
}
