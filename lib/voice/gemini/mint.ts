/**
 * Server-only mint: GeminiVoiceSession → a Google ephemeral token with
 * the session config LOCKED inside via liveConnectConstraints, so the
 * browser (or the Plan-2 bridge) holds the connection but cannot tamper
 * with the model id, prompt, or tools.
 *
 * Reuses the exact pattern from lib/copilot/session-service.ts
 * (mintEphemeralToken): uses:10 (the WS drops ~10min in and the client
 * reconnects with its sessionResumption handle), expireTime padded +5min
 * past the session ceiling, v1alpha http.
 */

import { GoogleGenAI } from '@google/genai'
import type { GeminiVoiceSession } from './session'

export class GeminiVoiceNotConfiguredError extends Error {}
export class GeminiVoiceTokenMintError extends Error {}

export async function mintGeminiVoiceToken(
  s: GeminiVoiceSession,
): Promise<{ token: string; vendorModelId: string; maxSessionSecs: number }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GeminiVoiceNotConfiguredError('missing GEMINI_API_KEY')

  const now = Date.now()
  try {
    const ai = new GoogleGenAI({ apiKey })
    const token = await ai.authTokens.create({
      config: {
        uses: 10,
        expireTime: new Date(now + (s.maxSessionSecs + 300) * 1000).toISOString(),
        newSessionExpireTime: new Date(now + s.maxSessionSecs * 1000).toISOString(),
        liveConnectConstraints: { model: s.vendorModelId, config: s.liveConfig },
        httpOptions: { apiVersion: 'v1alpha' },
      },
    })
    if (!token.name) throw new Error('token response missing name')
    return { token: token.name, vendorModelId: s.vendorModelId, maxSessionSecs: s.maxSessionSecs }
  } catch (err) {
    if (err instanceof GeminiVoiceNotConfiguredError) throw err
    console.error('[GeminiVoice] ephemeral token mint failed:', err)
    throw new GeminiVoiceTokenMintError(err instanceof Error ? err.message : String(err))
  }
}
