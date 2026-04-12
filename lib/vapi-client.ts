const VAPI_BASE = 'https://api.vapi.ai'

async function vapiRequest(path: string, options: RequestInit = {}) {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) throw new Error('VAPI_API_KEY not set')
  const res = await fetch(`${VAPI_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Vapi API error ${res.status}: ${err}`)
  }
  return res.json()
}

export async function listPhoneNumbers() {
  const data = await vapiRequest('/phone-number')
  const items = Array.isArray(data) ? data : (data as any).results || (data as any).data || []
  return (items as any[])
    .filter((p: any) => p.number) // Only show numbers with an actual phone number assigned
    .map((p: any) => ({
      id: p.id,
      number: p.number,
      name: p.name || p.number,
      provider: p.provider || 'unknown',
      status: p.status || 'unknown',
    }))
}

export async function purchasePhoneNumber(areaCode: string) {
  const payload: Record<string, string> = { provider: 'vapi' }
  if (areaCode) payload.numberDesiredAreaCode = areaCode

  const data = await vapiRequest('/phone-number', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return {
    id: (data as any).id,
    number: (data as any).number,
    name: (data as any).name || (data as any).number,
  }
}

// ─── Outbound Calls ───────────────────────────────────────────────────────

export async function createOutboundCall(opts: {
  phoneNumberId: string
  customerNumber: string
  assistant: Record<string, unknown>
  assistantOverrides?: { variableValues?: Record<string, string> }
}): Promise<{ id: string; status: string }> {
  const data = await vapiRequest('/call', {
    method: 'POST',
    body: JSON.stringify({
      phoneNumberId: opts.phoneNumberId,
      customer: { number: opts.customerNumber },
      assistant: opts.assistant,
      ...(opts.assistantOverrides ? { assistantOverrides: opts.assistantOverrides } : {}),
    }),
  })
  return { id: (data as any).id, status: (data as any).status }
}

// ─── ElevenLabs Voice Library ──────────────────────────────────────────────

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string | null
  labels: Record<string, string>
  category: string
}

export async function searchElevenLabsVoices(search?: string): Promise<ElevenLabsVoice[]> {
  // Try ElevenLabs API with key first (full library), then public endpoint, then curated fallback
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        Accept: 'application/json',
        ...(elevenLabsKey ? { 'xi-api-key': elevenLabsKey } : {}),
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return getCuratedVoices()

    const data = await res.json()
    let voices: ElevenLabsVoice[] = (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      preview_url: v.preview_url || null,
      labels: v.labels || {},
      category: v.category || 'premade',
    }))

    if (search) {
      const q = search.toLowerCase()
      voices = voices.filter(v =>
        v.name.toLowerCase().includes(q) ||
        Object.values(v.labels).some(l => l.toLowerCase().includes(q))
      )
    }

    return voices.length > 0 ? voices : getCuratedVoices()
  } catch {
    return getCuratedVoices()
  }
}

function getCuratedVoices(): ElevenLabsVoice[] {
  return [
    { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3', labels: { accent: 'american', gender: 'female', age: 'young', use_case: 'conversational', description: 'Confident and warm, mature quality with reassuring tone' }, category: 'premade' },
    { voice_id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/cjVigY5qzO86Huf0OWal/d098fda0-6456-4030-b3d8-63aa048c9070.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'conversational', description: 'Smooth, trustworthy tenor perfect for agentic use cases' }, category: 'premade' },
    { voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3', labels: { accent: 'american', gender: 'female', age: 'young', use_case: 'conversational', description: 'Playful, bright and warm' }, category: 'premade' },
    { voice_id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/3f4bde72-cc48-40dd-829f-57fbf906f4d7.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'conversational', description: 'Charming, down-to-earth and natural' }, category: 'premade' },
    { voice_id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/hpp4J3VqNfWAUOO0d1Us/dab0f5ba-3aa4-48a8-9fad-f138fea1126d.mp3', labels: { accent: 'american', gender: 'female', age: 'middle_aged', use_case: 'professional', description: 'Professional, bright and warm' }, category: 'premade' },
    { voice_id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'conversational', description: 'Laid-back, casual and resonant' }, category: 'premade' },
    { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3', labels: { accent: 'american', gender: 'female', age: 'middle_aged', use_case: 'professional', description: 'Knowledgeable and professional' }, category: 'premade' },
    { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/63148076-6363-42db-aea8-31424308b92c.mp3', labels: { accent: 'american', gender: 'male', age: 'young', use_case: 'social_media', description: 'Energetic and warm' }, category: 'premade' },
    { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3', labels: { accent: 'american', gender: 'female', age: 'young', use_case: 'social_media', description: 'Enthusiast with quirky attitude' }, category: 'premade' },
    { voice_id: 'bIHbv24MWmeRgasZH58o', name: 'Will', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3', labels: { accent: 'american', gender: 'male', age: 'young', use_case: 'conversational', description: 'Relaxed optimist, laid back' }, category: 'premade' },
    { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3', labels: { accent: 'british', gender: 'female', age: 'middle_aged', use_case: 'educational', description: 'Clear and engaging educator' }, category: 'premade' },
    { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/JBFqnCBsd6RMkjVDRZzb/e6206d1a-0721-4787-aafb-06a6e705cac5.mp3', labels: { accent: 'british', gender: 'male', age: 'middle_aged', use_case: 'narrative', description: 'Warm, captivating storyteller' }, category: 'premade' },
    { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/7eee0236-1a72-4b86-b303-5dcadc007ba9.mp3', labels: { accent: 'british', gender: 'male', age: 'middle_aged', use_case: 'news', description: 'Steady broadcaster' }, category: 'premade' },
    { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3', labels: { accent: 'british', gender: 'female', age: 'middle_aged', use_case: 'narration', description: 'Velvety actress with warmth and clarity' }, category: 'premade' },
    { voice_id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/nPczCjzI2devNBz1zQrb/2dd3e72c-4fd3-42f1-93ea-abc5d4e5aa1d.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'narration', description: 'Deep, resonant and comforting' }, category: 'premade' },
    { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3', labels: { accent: 'australian', gender: 'male', age: 'young', use_case: 'conversational', description: 'Deep, confident and energetic' }, category: 'premade' },
    { voice_id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/SAz9YHcvj6GT2YYXdXww/e6c95f0b-2227-491a-b3d7-2249240decb7.mp3', labels: { accent: 'american', gender: 'neutral', age: 'middle_aged', use_case: 'conversational', description: 'Relaxed, neutral and informative' }, category: 'premade' },
    { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'social_media', description: 'Dominant, firm and confident' }, category: 'premade' },
    { voice_id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3', labels: { accent: 'american', gender: 'male', age: 'old', use_case: 'narration', description: 'Wise, mature and balanced' }, category: 'premade' },
  ]
}
