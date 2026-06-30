'use client'

import { useState, type FormEvent } from 'react'
import { usePublicVoiceCall } from '@/lib/voice/use-public-voice-call'

/**
 * "Talk to our AI" — a live browser voice call (mic → Gemini Live) gated
 * behind a quick lead-capture form. We save the lead first (so a bailed
 * call is still a lead), then connect. Degrades to a friendly fallback when
 * the demo isn't switched on (no GEMINI_API_KEY / demo agent).
 */
export default function VoiceWebCall({
  fallbackHref = '/services',
  fallbackLabel = 'Book a demo instead',
}: { fallbackHref?: string; fallbackLabel?: string } = {}) {
  const { state, error, secondsLeft, startCall, endCall, reset } = usePublicVoiceCall()
  const [step, setStep] = useState<'idle' | 'lead'>('idle')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true); setFormError('')
    // Capture the lead first (best-effort — never block the call on it).
    try {
      await fetch('/api/public/demo-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), company: company.trim(), source: 'gyms_webvoice' }),
      })
    } catch {}
    setSubmitting(false)
    await startCall()
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  // Idle — the entry button.
  if (step === 'idle' && state === 'idle') {
    return (
      <button type="button" onClick={() => setStep('lead')} className="btn-primary">
        🎙️ Talk to our AI
      </button>
    )
  }

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)' }}>
      {children}
    </div>
  )

  // Live / connecting call UI.
  if (state === 'connecting' || state === 'live') {
    return (
      <Card>
        <div className="text-center py-1">
          <div className="relative mx-auto mb-4 flex items-center justify-center" style={{ width: '5rem', height: '5rem' }}>
            {state === 'live' && <span className="absolute inset-0 rounded-full glow-pulse" style={{ background: 'radial-gradient(circle, rgba(232,68,37,0.55), transparent 70%)' }} />}
            <span className="relative flex items-center justify-center rounded-full" style={{ width: '3.5rem', height: '3.5rem', background: 'linear-gradient(135deg, #fa4d2e, #fb8e4a)' }}>
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="#fff"><path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" /><path d="M19 11a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 10-2 0 7 7 0 006 6.92V21a1 1 0 102 0v-3.08A7 7 0 0019 11z" /></svg>
            </span>
          </div>
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>
            {state === 'connecting' ? 'Connecting…' : 'You’re live — say hello 👋'}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {state === 'connecting' ? 'Allow microphone access when prompted.' : 'Ask about memberships, classes, hours — anything.'}
          </p>
          {state === 'live' && secondsLeft !== null && (
            <p className="text-xs mb-4 font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>Demo ends in {mmss(secondsLeft)}</p>
          )}
          <button type="button" onClick={() => endCall('ended')} className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold" style={{ background: '#dc2626', color: '#fff' }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#fff"><path d="M21 15.46l-5.27-.61-2.52 2.52a15.05 15.05 0 01-6.59-6.59l2.53-2.53L8.05 3H3.04C2.52 12.04 11.96 21.48 21 20.96v-5.5z" transform="rotate(135 12 12)" /></svg>
            Hang up
          </button>
        </div>
      </Card>
    )
  }

  if (state === 'ended') {
    return (
      <Card>
        <div className="text-center py-2">
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>That’s the gist 👏</h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>That was a quick taste — imagine it answering your real leads, 24/7.</p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => { reset(); void startCall() }} className="btn-primary">Talk again</button>
            <a href={fallbackHref} className="text-sm underline" style={{ color: 'rgba(255,255,255,0.75)' }}>{fallbackLabel}</a>
          </div>
        </div>
      </Card>
    )
  }

  if (state === 'error') {
    return (
      <Card>
        <div className="text-center py-2">
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Couldn’t connect</h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>{error || 'Something went wrong.'}</p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => { reset(); void startCall() }} className="btn-primary">Try again</button>
            <a href={fallbackHref} className="text-sm underline" style={{ color: 'rgba(255,255,255,0.75)' }}>{fallbackLabel}</a>
          </div>
        </div>
      </Card>
    )
  }

  if (state === 'unavailable') {
    return (
      <Card>
        <div className="text-center py-2">
          <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Almost there</h3>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>Our live voice demo is rolling out shortly. Book a demo and we’ll show you the AI answering a real lead.</p>
          <a href={fallbackHref} className="btn-primary inline-block">{fallbackLabel}</a>
        </div>
      </Card>
    )
  }

  // step === 'lead' — capture form before connecting.
  return (
    <Card>
      <form onSubmit={submit}>
        <h3 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Talk to our AI, live</h3>
        <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>Quick details, then you’ll be talking to it in your browser in seconds.</p>
        <DarkField label="Your name" value={name} onChange={setName} placeholder="Alex Carter" autoComplete="name" />
        <DarkField label="Work email" value={email} onChange={setEmail} type="email" placeholder="alex@yourgym.com" autoComplete="email" />
        <DarkField label="Gym / studio name" value={company} onChange={setCompany} placeholder="Iron House Fitness" autoComplete="organization" />
        {formError && <p className="text-xs mt-2" style={{ color: '#fca5a5' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="btn-primary w-full mt-4 disabled:opacity-60">{submitting ? 'One sec…' : '🎙️ Start talking'}</button>
        <p className="text-[11px] text-center mt-2.5" style={{ color: 'rgba(255,255,255,0.45)' }}>Uses your mic · ~2 min demo · no spam</p>
      </form>
    </Card>
  )
}

function DarkField({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required placeholder={placeholder} autoComplete={autoComplete}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff' }} />
    </div>
  )
}
