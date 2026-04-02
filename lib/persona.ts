export interface PersonaSettings {
  agentPersonaName?: string | null
  responseLength: string
  formalityLevel: string
  useEmojis: boolean
  neverSayList: string[]
  simulateTypos: boolean
  typingDelayEnabled: boolean
  typingDelayMinMs: number
  typingDelayMaxMs: number
  languages: string[]
}

export function buildPersonaBlock(persona: PersonaSettings): string {
  const lines: string[] = []

  if (persona.agentPersonaName) {
    lines.push(`Your name is ${persona.agentPersonaName}. Always sign off as ${persona.agentPersonaName}.`)
  }

  const lengthMap: Record<string, string> = {
    BRIEF: 'Keep replies very short — 1 sentence maximum. Be direct.',
    MODERATE: 'Keep replies concise — 1 to 3 sentences.',
    DETAILED: 'Provide thorough replies with full context when needed.',
  }
  lines.push(lengthMap[persona.responseLength] ?? lengthMap.MODERATE)

  const formalityMap: Record<string, string> = {
    CASUAL: 'Use casual, friendly, conversational language. Contractions are fine.',
    NEUTRAL: 'Use clear, professional but approachable language.',
    FORMAL: 'Use formal, professional language at all times.',
  }
  lines.push(formalityMap[persona.formalityLevel] ?? formalityMap.NEUTRAL)

  if (persona.useEmojis) {
    lines.push('You may use emojis sparingly to add warmth.')
  } else {
    lines.push('Do not use emojis.')
  }

  if (persona.neverSayList.length > 0) {
    lines.push(`Never use these words or phrases: ${persona.neverSayList.join(', ')}.`)
  }

  if (persona.simulateTypos) {
    lines.push('Write naturally as a human would in SMS — occasional informal phrasing is fine.')
  }

  if (persona.languages.length > 1) {
    lines.push(`You can respond in these languages: ${persona.languages.join(', ')}. Match the language of the contact.`)
  }

  return `\n\n## Persona & Tone\n${lines.join('\n')}`
}

export function applyTypos(text: string): string {
  const words = text.split(' ')

  const result = words.map((word, idx) => {
    // Skip first word, short words, capitalised (proper nouns)
    if (idx === 0 || word.length < 4 || /^[A-Z]/.test(word)) return word

    // 8% chance per word
    if (Math.random() > 0.08) return word

    const r = Math.random()
    if (r < 0.4) {
      // Transposition — swap two adjacent chars in middle of word
      const i = 1 + Math.floor(Math.random() * (word.length - 2))
      return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)
    } else if (r < 0.7) {
      // Omission — drop a middle character
      const i = 1 + Math.floor(Math.random() * (word.length - 2))
      return word.slice(0, i) + word.slice(i + 1)
    } else {
      // Double strike — repeat a middle character
      const i = 1 + Math.floor(Math.random() * (word.length - 2))
      return word.slice(0, i) + word[i] + word[i] + word.slice(i + 1)
    }
  })

  // 20% chance to lowercase first letter
  const joined = result.join(' ')
  if (Math.random() < 0.2 && joined.length > 0) {
    return joined[0].toLowerCase() + joined.slice(1)
  }
  return joined
}

export function calculateTypingDelay(text: string, minMs: number, maxMs: number): number {
  const base = Math.min(text.length * 28, maxMs)
  const variance = Math.random() * (maxMs - minMs)
  return Math.max(minMs, Math.min(maxMs, base + variance))
}
