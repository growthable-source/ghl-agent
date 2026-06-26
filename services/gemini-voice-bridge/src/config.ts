/** Env validation for the bridge. Fails fast at boot if anything is missing. */
export interface BridgeConfig {
  port: number
  appUrl: string // Vercel origin, e.g. https://app.xovera.example
  geminiApiKey: string
  geminiModel: string
  signingSecret: string
}

export function loadConfig(): BridgeConfig {
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  const geminiApiKey = process.env.GEMINI_API_KEY ?? ''
  const signingSecret = process.env.GEMINI_VOICE_SIGNING_SECRET ?? ''
  const missing: string[] = []
  if (!appUrl) missing.push('APP_URL')
  if (!geminiApiKey) missing.push('GEMINI_API_KEY')
  if (!signingSecret) missing.push('GEMINI_VOICE_SIGNING_SECRET')
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`)
  return {
    port: Number(process.env.PORT ?? 8080),
    appUrl,
    geminiApiKey,
    geminiModel: process.env.GEMINI_VOICE_MODEL ?? 'gemini-3.1-flash-live',
    signingSecret,
  }
}
