'use client'

import { useState, type FormEvent } from 'react'

/**
 * "Have the AI call you" demo flow. Phone-verified so we only ever dial a
 * number the visitor controls: name + phone → SMS code → verify → outbound
 * call. Posts to /api/public/voice-demo/{start,verify}. Degrades to a clear
 * message when the live demo isn't switched on yet (no Twilio creds).
 */
type Step = 'idle' | 'form' | 'code' | 'calling' | 'unavailable'

export default function VoiceCallTest({
  fallbackHref = '/services',
  fallbackLabel = 'Book a demo instead',
}: {
  fallbackHref?: string
  fallbackLabel?: string
} = {}) {
  const [step, setStep] = useState<Step>('idle')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [masked, setMasked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/public/voice-demo/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 503) { setStep('unavailable'); return }
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      setMasked(data.sentTo || phone.trim())
      setStep('code')
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/public/voice-demo/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'That code is incorrect.')
      setStep('calling')
    } catch (err) { setError(err instanceof Error ? err.message : 'That code is incorrect.') }
    finally { setBusy(false) }
  }

  if (step === 'idle') {
    return (
      <button type="button" onClick={() => setStep('form')} className="btn-primary">
        Have the AI call you →
      </button>
    )
  }

  return (
    <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)' }}>
      {step === 'form' && (
        <form onSubmit={start}>
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Let our AI call you</h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>We&apos;ll text a code to confirm it&apos;s you, then call you in seconds.</p>
          <DarkField label="Your name" value={name} onChange={setName} placeholder="Alex Carter" autoComplete="name" />
          <DarkField label="Mobile number" value={phone} onChange={setPhone} type="tel" placeholder="(555) 123-4567" autoComplete="tel" />
          {error && <p className="text-xs mt-2" style={{ color: '#fca5a5' }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full mt-4 disabled:opacity-60">{busy ? 'Texting you…' : 'Text me a code'}</button>
          <p className="text-[11px] text-center mt-2.5" style={{ color: 'rgba(255,255,255,0.45)' }}>US &amp; Canada mobiles · standard rates may apply</p>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verify}>
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Enter your code</h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>We texted a 6-digit code to {masked}.</p>
          <input
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
            className="w-full rounded-lg px-3 py-3 text-center text-2xl tracking-[0.4em] font-bold outline-none"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff' }}
          />
          {error && <p className="text-xs mt-2" style={{ color: '#fca5a5' }}>{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full mt-4 disabled:opacity-60">{busy ? 'Verifying…' : 'Verify & call me'}</button>
          <button type="button" onClick={() => { setStep('form'); setCode(''); setError('') }} className="text-xs underline w-full text-center mt-3" style={{ color: 'rgba(255,255,255,0.6)' }}>Use a different number</button>
        </form>
      )}

      {step === 'calling' && (
        <div className="text-center py-2">
          <div className="mx-auto mb-4 flex items-center justify-center rounded-full" style={{ width: '3.25rem', height: '3.25rem', background: 'linear-gradient(135deg, #fa4d2e, #fb8e4a)' }}>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#fff"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" /></svg>
          </div>
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Calling you now 📞</h3>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>Your phone should ring at {masked} any second — pick up and say hi.</p>
        </div>
      )}

      {step === 'unavailable' && (
        <div className="text-center py-2">
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Almost there</h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>Our live call demo is rolling out shortly. Book a demo and we&apos;ll show you the voice AI answering a real lead.</p>
          <a href={fallbackHref} className="btn-primary inline-block">{fallbackLabel}</a>
        </div>
      )}
    </div>
  )
}

function DarkField({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} required placeholder={placeholder} autoComplete={autoComplete}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff' }}
      />
    </div>
  )
}
