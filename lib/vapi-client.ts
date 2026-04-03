const VAPI_BASE = 'https://api.vapi.ai'
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v2'

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
  return (data as any[]).map((p: any) => ({
    id: p.id,
    number: p.number,
    name: p.name || p.number,
  }))
}

export async function purchasePhoneNumber(areaCode: string, country = 'US') {
  const data = await vapiRequest('/phone-number', {
    method: 'POST',
    body: JSON.stringify({ provider: 'vapi', areaCode, country }),
  })
  return {
    id: (data as any).id,
    number: (data as any).number,
    name: (data as any).name || (data as any).number,
  }
}

// ─── ElevenLabs Voice Library ──────────────────────────────────────────────

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string | null
  labels: Record<string, string>
  category: string
}

export async function searchElevenLabsVoices(search?: string, pageSize = 50): Promise<ElevenLabsVoice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  // Fall back to curated list if no ElevenLabs key
  if (!apiKey) return getCuratedVoices()

  const params = new URLSearchParams({ page_size: String(pageSize) })
  if (search) params.set('search', search)

  const res = await fetch(`${ELEVENLABS_BASE}/voices?${params}`, {
    headers: { 'xi-api-key': apiKey },
  })
  if (!res.ok) return getCuratedVoices()

  const data = await res.json()
  return (data.voices || []).map((v: any) => ({
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url || null,
    labels: v.labels || {},
    category: v.category || 'premade',
  }))
}

function getCuratedVoices(): ElevenLabsVoice[] {
  return [
    { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/preview.mp3', labels: { accent: 'American', gender: 'female', age: 'young', use_case: 'conversational' }, category: 'premade' },
    { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/preview.mp3', labels: { accent: 'American', gender: 'male', age: 'young', use_case: 'narration' }, category: 'premade' },
    { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/preview.mp3', labels: { accent: 'British', gender: 'female', age: 'middle_aged', use_case: 'narration' }, category: 'premade' },
    { voice_id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/nPczCjzI2devNBz1zQrb/preview.mp3', labels: { accent: 'American', gender: 'male', age: 'middle_aged', use_case: 'narration' }, category: 'premade' },
    { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/preview.mp3', labels: { accent: 'British', gender: 'male', age: 'middle_aged', use_case: 'news' }, category: 'premade' },
    { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/XB0fDUnXU5powFXDhCwa/preview.mp3', labels: { accent: 'Swedish', gender: 'female', age: 'middle_aged', use_case: 'conversational' }, category: 'premade' },
    { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/JBFqnCBsd6RMkjVDRZzb/preview.mp3', labels: { accent: 'British', gender: 'male', age: 'middle_aged', use_case: 'narration' }, category: 'premade' },
    { voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/preview.mp3', labels: { accent: 'American', gender: 'female', age: 'young', use_case: 'conversational' }, category: 'premade' },
    { voice_id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/preview.mp3', labels: { accent: 'American', gender: 'male', age: 'middle_aged', use_case: 'conversational' }, category: 'premade' },
    { voice_id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/SAz9YHcvj6GT2YYXdXww/preview.mp3', labels: { accent: 'American', gender: 'non-binary', age: 'young', use_case: 'conversational' }, category: 'premade' },
    { voice_id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/preview.mp3', labels: { accent: 'American', gender: 'male', age: 'middle_aged', use_case: 'conversational' }, category: 'premade' },
    { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/preview.mp3', labels: { accent: 'American', gender: 'female', age: 'young', use_case: 'social_media' }, category: 'premade' },
  ]
}
