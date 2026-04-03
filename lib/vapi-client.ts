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
  return (data as any[]).map((p: any) => ({
    id: p.id,
    number: p.number,
    name: p.name || p.number,
  }))
}

export async function listVoices() {
  // Return curated list of ElevenLabs voices available on Vapi
  return [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Female)', provider: 'elevenlabs' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam (Male)', provider: 'elevenlabs' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily (Female)', provider: 'elevenlabs' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian (Male)', provider: 'elevenlabs' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Male)', provider: 'elevenlabs' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte (Female)', provider: 'elevenlabs' },
  ]
}
