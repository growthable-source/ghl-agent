import { describe, it, expect } from 'vitest'
import { buildGeminiVoiceSession, agentToolsToRealtimeDefs } from './session'

const agent = {
  name: 'Ava',
  systemPrompt: 'You are Ava, a friendly receptionist for Acme.',
  instructions: 'Always confirm the appointment date back to the caller.',
  enabledTools: ['get_contact_details', 'book_appointment'],
  locationId: 'loc_1',
  workspaceId: 'ws_1',
  agentId: 'agent_1',
}
const config = {
  voiceName: 'Kore',
  model: 'gemini-3.1-flash-live',
  firstMessage: 'Hi, thanks for calling Acme!',
  endCallMessage: 'Thanks for calling, goodbye!',
  language: 'en-US',
  maxDurationSecs: 720,
}

describe('buildGeminiVoiceSession', () => {
  it('re-exports agentToolsToRealtimeDefs', () => {
    expect(agentToolsToRealtimeDefs(['get_contact_details'])).toHaveLength(1)
  })

  it('composes systemInstruction = prompt + instructions + voice guardrail + first message', () => {
    const s = buildGeminiVoiceSession(agent, config)
    const sys = s.liveConfig.systemInstruction as string
    expect(sys).toContain('You are Ava, a friendly receptionist for Acme.')
    expect(sys).toContain('Always confirm the appointment date back to the caller.')
    expect(sys).toContain('voice agent') // guardrail block present
    expect(sys).toContain('your CRM') // brand-neutral guardrail
    expect(sys).toContain('Hi, thanks for calling Acme!') // first message guidance
    expect(sys).toContain('Thanks for calling, goodbye!') // end-call line
  })

  it('NEVER leaks HighLevel / GHL into the system instruction', () => {
    const sys = buildGeminiVoiceSession(agent, config).liveConfig.systemInstruction as string
    expect(sys).not.toMatch(/highlevel/i)
    expect(sys).not.toMatch(/\bGHL\b/)
  })

  it('omits instructions when null without a dangling separator', () => {
    const s = buildGeminiVoiceSession({ ...agent, instructions: null }, config)
    const sys = s.liveConfig.systemInstruction as string
    expect(sys).toContain('You are Ava')
    expect(sys).not.toContain('\n\nnull')
  })

  it('wires the enabled tools as functionDeclarations and echoes them on tools', () => {
    const s = buildGeminiVoiceSession(agent, config)
    expect(s.tools.map(t => t.name).sort()).toEqual(['book_appointment', 'get_contact_details'])
    const tools = s.liveConfig.tools as Array<{ functionDeclarations: Array<{ name: string }> }>
    const declNames = tools[0].functionDeclarations.map(d => d.name).sort()
    expect(declNames).toEqual(['book_appointment', 'get_contact_details'])
  })

  it('locks AUDIO modality + transcription + the selected voice', () => {
    const s = buildGeminiVoiceSession(agent, config)
    expect(s.liveConfig.responseModalities).toEqual(['AUDIO'])
    expect(s.liveConfig.inputAudioTranscription).toBeDefined()
    expect(s.liveConfig.outputAudioTranscription).toBeDefined()
    const speech = s.liveConfig.speechConfig as {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: string } }
    }
    expect(speech.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore')
    expect(s.voiceName).toBe('Kore')
    expect(s.vendorModelId).toBe('gemini-3.1-flash-live')
  })

  it('omits speechConfig when no voice is chosen', () => {
    const s = buildGeminiVoiceSession(agent, { ...config, voiceName: null })
    expect(s.liveConfig.speechConfig).toBeUndefined()
    expect(s.voiceName).toBeNull()
  })

  it('clamps maxSessionSecs to a sane floor and echoes it', () => {
    expect(buildGeminiVoiceSession(agent, { ...config, maxDurationSecs: 720 }).maxSessionSecs).toBe(720)
    // sub-floor values snap up to 60s minimum
    expect(buildGeminiVoiceSession(agent, { ...config, maxDurationSecs: 5 }).maxSessionSecs).toBe(60)
  })

  it('appends a ragContext block when provided', () => {
    const s = buildGeminiVoiceSession(agent, config, { ragContext: 'Acme is open 9-5 Mon-Fri.' })
    expect(s.liveConfig.systemInstruction as string).toContain('Acme is open 9-5 Mon-Fri.')
  })
})
