'use client'

import { useState } from 'react'

export default function TwoFactorClient({ initiallyEnrolled }: { initiallyEnrolled: boolean }) {
  const [enrolled, setEnrolled] = useState(initiallyEnrolled)
  const [setupData, setSetupData] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)

  async function startSetup() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/2fa/setup')
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to start setup')
      const data = await res.json()
      setSetupData(data)
    } catch (err: any) {
      setMessage({ text: err.message, tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Verification failed')
      setEnrolled(true)
      setSetupData(null)
      setCode('')
      setMessage({ text: '✓ 2FA is now active. You will be prompted for a code on your next sign-in.', tone: 'ok' })
    } catch (err: any) {
      setMessage({ text: err.message, tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Disable failed')
      setEnrolled(false)
      setPassword('')
      setMessage({ text: '2FA has been disabled. Re-enroll to turn it back on.', tone: 'ok' })
    } catch (err: any) {
      setMessage({ text: err.message, tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  // Enrolled admin — offer a disable flow.
  if (enrolled) {
    return (
      <div className="space-y-5">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
          <p className="text-sm font-medium text-emerald-400">2FA is active.</p>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
            You&apos;ll be prompted for a TOTP code on every new sign-in. Lose access to your
            authenticator? Disable below and re-enroll with a new one.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <p className="text-sm text-zinc-200">Disable 2FA</p>
          <p className="text-xs text-zinc-500">Enter your current admin password to confirm.</p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Current password"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
          <button
            type="button"
            onClick={disable}
            disabled={busy || !password}
            className="text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
          >
            {busy ? 'Disabling…' : 'Disable 2FA'}
          </button>
        </div>

        {message && <Message message={message} />}
      </div>
    )
  }

  // Not enrolled — show the setup flow.
  return (
    <div className="space-y-5">
      {!setupData ? (
        <>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4">
            <p className="text-sm font-medium text-amber-400">2FA is not enabled.</p>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Strongly recommended — password alone is not enough for admin access.
              Setup takes 30 seconds.
            </p>
          </div>
          <button
            type="button"
            onClick={startSetup}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Start 2FA setup'}
          </button>
        </>
      ) : (
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
          <div>
            <p className="text-sm font-medium text-zinc-200">1. Scan this QR code</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Any authenticator app will do — 1Password, Authy, Bitwarden, Google Authenticator.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setupData.qr} alt="TOTP QR code" className="rounded bg-white p-2 w-[220px]" />

          <div>
            <p className="text-xs text-zinc-500">
              Can&apos;t scan? Add the key manually:
            </p>
            <p className="text-xs font-mono bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 mt-1 select-all break-all">
              {setupData.secret}
            </p>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <p className="text-sm font-medium text-zinc-200 mb-1">2. Enter the 6-digit code</p>
            <p className="text-xs text-zinc-500 mb-2">From your authenticator app.</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-center text-lg font-mono tracking-widest text-white focus:outline-none focus:border-zinc-500"
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={verify}
                disabled={busy || code.length !== 6}
                className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {busy ? 'Verifying…' : 'Confirm & enable'}
              </button>
              <button
                type="button"
                onClick={() => { setSetupData(null); setCode('') }}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-sm h-9 px-4 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {message && <Message message={message} />}
    </div>
  )
}

function Message({ message }: { message: { text: string; tone: 'ok' | 'err' } }) {
  return (
    <p className={`text-xs ${message.tone === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
      {message.text}
    </p>
  )
}
