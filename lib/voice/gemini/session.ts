/**
 * buildGeminiVoiceSession — the single source of truth for a Gemini
 * native-voice session, consumed by BOTH runtimes:
 *   - web (this plan): the token route mints from it, the browser
 *     GeminiLiveProvider connects with liveConfig as vendorConfig.
 *   - phone (Plan 2): the Fly.io bridge imports this exact function.
 *
 * RUNTIME-AGNOSTIC: no next, no prisma, no @google/genai imports. Pure
 * data in → pure GeminiVoiceSession out. The server mint (mint.ts) is
 * the only piece that touches @google/genai.
 *
 * Mirrors the liveConfig shape the Copilot session-service already
 * ships (responseModalities AUDIO, in/out transcription, context-window
 * compression, session resumption, optional prebuilt voice), minus the
 * screen-vision mediaResolution (voice has no video).
 */

import type { RealtimeToolDef } from '@/lib/copilot/types'
import { agentToolsToRealtimeDefs } from './tool-defs'

export { agentToolsToRealtimeDefs }

export interface GeminiVoiceSession {
  liveConfig: Record<string, unknown>
  tools: RealtimeToolDef[]
  vendorModelId: string
  voiceName: string | null
  maxSessionSecs: number
}

/**
 * Brand-neutral VOICE guardrail. Speech-specific (concise spoken
 * sentences, no markdown), and the hard no-HighLevel/GHL rule — say
 * "your CRM". endCallMessage/firstMessage guidance folded in when set.
 */
function buildVoiceGuardrail(config: {
  firstMessage: string | null
  endCallMessage: string | null
  language: string | null
}): string {
  const lines: string[] = [
    '## Voice agent guardrails',
    'You are a voice agent: the caller HEARS you, they do not read you.',
    'Speak naturally in short, conversational spoken sentences. Never use',
    'markdown, bullet points, code, emoji, or formatting — it cannot be heard.',
    'Spell out anything that must be precise (phone numbers, emails) clearly.',
    'Never name the underlying CRM platform or its vendor brand out loud.',
    'If you need to refer to the underlying system, just say "your CRM".',
  ]
  if (config.language) {
    lines.push(`Speak in ${config.language} unless the caller switches languages.`)
  }
  if (config.firstMessage) {
    lines.push(`Open the call with words to the effect of: "${config.firstMessage}"`)
  }
  if (config.endCallMessage) {
    lines.push(
      `When the conversation is clearly finished, or you must end the call,`,
      `close with words to the effect of: "${config.endCallMessage}"`,
    )
  }
  return lines.join('\n')
}

function buildSystemInstruction(
  agent: { systemPrompt: string; instructions: string | null },
  config: { firstMessage: string | null; endCallMessage: string | null; language: string | null },
  opts: { ragContext?: string } = {},
): string {
  const parts: string[] = [agent.systemPrompt.trim()]
  if (agent.instructions && agent.instructions.trim()) {
    parts.push(agent.instructions.trim())
  }
  if (opts.ragContext && opts.ragContext.trim()) {
    parts.push(`## Knowledge\n${opts.ragContext.trim()}`)
  }
  parts.push(buildVoiceGuardrail(config))
  return parts.join('\n\n')
}

export function buildGeminiVoiceSession(
  agent: {
    name: string
    systemPrompt: string
    instructions: string | null
    enabledTools: string[]
    locationId: string
    workspaceId: string | null
    agentId: string
  },
  config: {
    voiceName: string | null
    model: string
    firstMessage: string | null
    endCallMessage: string | null
    language: string | null
    maxDurationSecs: number
  },
  opts: { ragContext?: string; locale?: string } = {},
): GeminiVoiceSession {
  const tools = agentToolsToRealtimeDefs(agent.enabledTools)
  const systemInstruction = buildSystemInstruction(agent, config, opts)
  const voiceName = config.voiceName || null
  const vendorModelId = config.model
  const maxSessionSecs = Math.max(60, Math.round(config.maxDurationSecs) || 60)

  const liveConfig: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    systemInstruction,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
    ...(voiceName
      ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }
      : {}),
  }

  return { liveConfig, tools, vendorModelId, voiceName, maxSessionSecs }
}

/**
 * Map RealtimeToolDef[] → Gemini functionDeclarations using plain string
 * enum/type tokens (UPPERCASE type names). We DON'T import @google/genai's
 * Type/Behavior enums here to keep this module runtime-agnostic — the
 * string values are wire-identical to the SDK enums. The Copilot
 * session-service uses the SDK enums; this is the same JSON.
 */
function toGeminiFunctionDeclarations(defs: RealtimeToolDef[]) {
  return defs.map(d => ({
    name: d.name,
    description: d.description,
    behavior: 'NON_BLOCKING',
    ...(Object.keys(d.parameters.properties).length > 0
      ? {
          parameters: {
            type: 'OBJECT',
            properties: Object.fromEntries(
              Object.entries(d.parameters.properties).map(([k, v]) => [
                k,
                {
                  type: v.type.toUpperCase(),
                  ...(v.description ? { description: v.description } : {}),
                  ...(v.enum ? { enum: v.enum } : {}),
                },
              ]),
            ),
            ...(d.parameters.required?.length ? { required: d.parameters.required } : {}),
          },
        }
      : {}),
  }))
}
